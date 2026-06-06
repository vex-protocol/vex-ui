import type { Message } from "@vex-chat/libvex";

import { Platform } from "react-native";

import {
    $channels,
    $familiars,
    $servers,
    $user,
    shouldNotify,
    vexService,
} from "@vex-chat/store";

import notifee, {
    AndroidCategory,
    EventType,
    AndroidImportance as NotifeeAndroidImportance,
} from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import { AndroidImportance, IosAuthorizationStatus } from "expo-notifications";

import {
    navigateToDeviceRequests,
    navigationRef,
} from "../navigation/navigationRef";

import { handleNativeCallBackgroundNotification } from "./nativeCallUi";
import {
    dequeuePendingNotificationRoute,
    enqueuePendingNotificationRoute,
    normalizeAndroidMessageRouteData,
    pendingNotificationRouteCount,
    requeuePendingNotificationRoute,
} from "./notificationRouteQueue";

const CHANNEL_ID = "vex-messages";
const MESSAGE_NOTIFICATION_ID = "vex-message-summary";
// Separate channel so users can mute messages but keep account-security
// notifications loud (or vice versa) from system Settings → Notifications.
// Device-approval requests are time-bounded (the request expires on a
// short TTL) and security-relevant, so they get HIGH importance with a
// default sound regardless of the messages channel preference.
const DEVICE_APPROVAL_CHANNEL_ID = "vex-device-approval";

// Message banners intentionally avoid sender names, channel names, avatars, and
// plaintext previews. The OS may persist notification text/images in
// notification history, backups, and platform logs. Routing data remains opaque
// IDs for wake-sync/dedupe; message taps only wake/sync the app so the user
// returns to whatever route they had open last.
//
// Android message taps use Notifee (`displayNotification`); routing data is
// also queued from `onBackgroundEvent` in index.js until NavigationContainer
// is ready (`flushPendingNotificationRoutes`).
//
// Routing still uses opaque IDs in `data`; human strings are not required there.

// Device-approval banners are also content-free for the same reason:
// the approval flow proves which device wants in via the matching
// 4-character code displayed inside the app, not via anything the OS
// might log. We just need the visible banner to nudge the user to
// open the app and look at the approval screen.
const DEVICE_APPROVAL_TITLE = "New Device Approval";
const DEVICE_APPROVAL_BODY =
    "Someone is trying to sign in to your Vex account.";

// Resilience caps for the notification pipeline. When the
// foreground-service has been pulling messages while the screen was
// off and the device wakes, we may have a small burst of new mail to
// announce. Each `scheduleNotificationAsync` is a binder roundtrip to
// NotificationManagerService and competes for the JS thread; firing
// dozens in parallel is what an Android ANR looks like in slow motion.
//
// Drain cap = ceiling on visible banners per drain (anything beyond
// this is silently dropped from the queue — the user already has
// unread state in-app to discover them).
// Queue cap = hard ceiling on the queue's length itself, drop-oldest
// when exceeded. Belt-and-suspenders on top of the drain cap: if the
// drain ever stalls (a hung binder call, a runaway producer), the
// queue still can't grow without bound and starve memory. The chosen
// value is large enough that a normal wake-from-sleep backlog never
// touches it.
// Yield = ms to release the event loop between scheduling calls so
// the JS thread can service Fabric sync calls / pings / UI work.
const NOTIFICATION_DRAIN_CAP = 6;
const NOTIFICATION_QUEUE_CAP = 50;
const NOTIFICATION_DRAIN_YIELD_MS = 25;

let channelReady = false;
let deviceApprovalChannelReady = false;
const notificationQueue: Message[] = [];
let notificationDrainInFlight = false;
let messageNotificationCount = 0;
// Per-process dedupe so we never fire the same OS banner twice for the
// same requestID. App.tsx already tracks "seen" request IDs at the toast
// layer, but if the watcher re-runs (resume, refresh) it can call us
// again for the same ID; we'd rather drop the duplicate than spam.
const notifiedApprovalRequestIDs = new Set<string>();

let pendingRouteDrainInFlight = false;

function logPushDelivery(
    message: string,
    details?: Record<string, unknown>,
): void {
    if (details) {
        console.info(`[vex-push] ${message}`, details);
        return;
    }
    console.info(`[vex-push] ${message}`);
}

function summarizePushData(
    data: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (!data || typeof data !== "object") {
        return {};
    }
    return {
        callID: data["callID"],
        event: data["event"],
        keys: Object.keys(data).sort(),
        kind: data["kind"],
        mailID: data["mailID"],
        requestID: data["requestID"],
    };
}

// Show banner + play sound when a notification arrives while the app is open.
Notifications.setNotificationHandler({
    handleNotification: () =>
        Promise.resolve({
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
        }),
});

export async function clearMessageNotificationSummary(): Promise<void> {
    resetMessageNotificationSummary();
    if (Platform.OS === "android") {
        await notifee
            .cancelNotification(
                MESSAGE_NOTIFICATION_ID,
                MESSAGE_NOTIFICATION_ID,
            )
            .catch(() => {
                // Best-effort; the notification may already be gone.
            });
        return;
    }
    await Notifications.dismissNotificationAsync(MESSAGE_NOTIFICATION_ID).catch(
        () => {
            // Best-effort; the notification may already be gone.
        },
    );
    await Notifications.cancelScheduledNotificationAsync(
        MESSAGE_NOTIFICATION_ID,
    ).catch(() => {
        // Best-effort; the notification may already be delivered or gone.
    });
}

/**
 * Lets App.tsx forget previously-notified request IDs. Called on
 * sign-out / user switch so a returning user doesn't carry the
 * previous account's dedupe set into their session.
 */
export function clearNotifiedApprovalRequestIDs(): void {
    notifiedApprovalRequestIDs.clear();
}

/**
 * Dismisses the OS banner posted for `requestID`, if any. Called when
 * the watcher observes that a previously-pending request has moved to
 * approved / rejected / expired so the user doesn't keep seeing a
 * banner for something they've already handled.
 */
export async function dismissDeviceApprovalNotification(
    requestID: string,
): Promise<void> {
    notifiedApprovalRequestIDs.delete(requestID);
    try {
        await Notifications.dismissNotificationAsync(
            deviceApprovalNotificationID(requestID),
        );
    } catch {
        // Best-effort; the banner may have already been dismissed by
        // the user, or never posted (e.g. iOS background).
    }
}

/**
 * Called from `NavigationContainer` `onReady` so cold-start / background taps
 * that arrived before the navigator mounted are replayed once.
 */
export function flushPendingNotificationRoutes(): void {
    void drainPendingNotificationRoutes();
}

export async function requestNotificationPermission(): Promise<boolean> {
    const settings = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return (
        settings.granted ||
        settings.ios?.status === IosAuthorizationStatus.PROVISIONAL
    );
}

export function setupNotificationHandlers(): () => void {
    logPushDelivery("installing notification listeners", {
        platform: Platform.OS,
    });
    const receivedSubscription = Notifications.addNotificationReceivedListener(
        (notification) => {
            const data = notification.request.content.data as Record<
                string,
                unknown
            >;
            logPushDelivery("notification received in foreground", {
                identifier: notification.request.identifier,
                ...summarizePushData(data),
            });
            if (isRemotePushNotification(notification)) {
                void handleRemotePushWake(data);
                return;
            }
            logPushDelivery("local notification foreground wake skipped", {
                identifier: notification.request.identifier,
                ...summarizePushData(data),
            });
        },
    );

    const subscription = Notifications.addNotificationResponseReceivedListener(
        (response) => {
            const data = response.notification.request.content.data as Record<
                string,
                unknown
            >;
            logPushDelivery("notification response received", {
                actionIdentifier: response.actionIdentifier,
                identifier: response.notification.request.identifier,
                ...summarizePushData(data),
            });
            routeNotificationTap(data, { syncFirst: true });
        },
    );

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) {
        const data = lastResponse.notification.request.content.data as Record<
            string,
            unknown
        >;
        logPushDelivery("last notification response found on startup", {
            actionIdentifier: lastResponse.actionIdentifier,
            identifier: lastResponse.notification.request.identifier,
            ...summarizePushData(data),
        });
        routeNotificationTap(data, { syncFirst: true });
    }

    let unsubNotifee: (() => void) | undefined;
    if (Platform.OS === "android") {
        unsubNotifee = notifee.onForegroundEvent(({ detail, type }) => {
            const data = detail.notification?.data as
                | Record<string, unknown>
                | undefined;
            if (type === EventType.ACTION_PRESS) {
                void handleNativeCallBackgroundNotification(
                    data,
                    detail.pressAction?.id,
                );
                return;
            }
            if (
                type === EventType.DISMISSED &&
                detail.notification?.id === MESSAGE_NOTIFICATION_ID
            ) {
                resetMessageNotificationSummary();
                return;
            }
            if (type !== EventType.PRESS) {
                return;
            }
            if (!data || (data["kind"] !== "dm" && data["kind"] !== "group")) {
                return;
            }
            logPushDelivery("notifee foreground notification press", {
                keys: Object.keys(data).sort(),
                kind: data["kind"],
                mailID: data["mailID"],
            });
            routeNotificationTap(normalizeAndroidMessageRouteData(data), {
                syncFirst: true,
            });
        });

        void notifee.getInitialNotification().then(async (initial) => {
            if (!initial) {
                return;
            }
            const data = initial.notification.data as
                | Record<string, unknown>
                | undefined;
            const handledCallAction =
                await handleNativeCallBackgroundNotification(
                    data,
                    initial.pressAction?.id,
                );
            if (handledCallAction) {
                return;
            }
            if (!data || (data["kind"] !== "dm" && data["kind"] !== "group")) {
                return;
            }
            logPushDelivery("notifee initial notification found", {
                keys: Object.keys(data).sort(),
                kind: data["kind"],
                mailID: data["mailID"],
            });
            routeNotificationTap(normalizeAndroidMessageRouteData(data), {
                syncFirst: true,
            });
        });
    }

    queueMicrotask(() => {
        flushPendingNotificationRoutes();
    });

    return () => {
        receivedSubscription.remove();
        subscription.remove();
        unsubNotifee?.();
    };
}

/**
 * Posts an OS-level banner for a fresh device-sign-in request that
 * arrived over the WebSocket. Cheap when called repeatedly for the
 * same `requestID` — we dedupe per process so a watcher refresh that
 * re-observes the same pending request won't post a second banner.
 *
 * This complements the in-app `pendingApprovalNotice` toast: the toast
 * is what the user sees if they're already in the app, the OS banner
 * is what wakes them up when they're not. Tapping either lands on the
 * same `DeviceRequests` screen where the matching 4-character code
 * lives.
 *
 * On Android, this rides on the foreground service keeping the JS
 * engine alive long enough to receive the WS event in the first
 * place; on iOS the OS will only deliver this while the app is
 * foreground (no background WebSocket), and the foreground notification
 * handler above will surface it as a heads-up banner.
 */
export async function showDeviceApprovalNotification(
    requestID: string,
): Promise<void> {
    if (notifiedApprovalRequestIDs.has(requestID)) {
        return;
    }
    notifiedApprovalRequestIDs.add(requestID);
    try {
        await ensureDeviceApprovalChannel();
        await Notifications.scheduleNotificationAsync({
            content: {
                body: DEVICE_APPROVAL_BODY,
                data: {
                    event: "deviceRequest",
                    kind: "deviceApproval",
                    requestID,
                },
                priority: Notifications.AndroidNotificationPriority.MAX,
                ...iosDefaultNotificationSound(),
                title: DEVICE_APPROVAL_TITLE,
            },
            // Use the requestID itself as the OS-level identifier so we
            // can dismiss the banner cleanly once the request resolves
            // (approved / rejected / expired). Without this the banner
            // would linger in the tray after the user has already
            // dealt with it on the original device.
            identifier: deviceApprovalNotificationID(requestID),
            trigger: { channelId: DEVICE_APPROVAL_CHANNEL_ID },
        });
    } catch {
        // Non-fatal — the in-app toast is still firing in parallel
        // and will surface the request when the user opens the app.
        notifiedApprovalRequestIDs.delete(requestID);
    }
}

/**
 * Public entry point for "tell the user about this message."
 *
 * Implementation note: this looks like a single async function but
 * internally it's a queue + drain. Callers fire-and-forget many of
 * these in rapid succession (one per atom-update tick when a backlog
 * lands); the queue serializes the binder calls to
 * NotificationManagerService and yields between them so we can never
 * saturate the JS thread badly enough to ANR. Returns once *this*
 * message has been dispatched (or skipped/dropped).
 */
export async function showMessageNotification(mail: Message): Promise<void> {
    notificationQueue.push(mail);
    // Drop oldest when over the hard ceiling. We prefer to surface the
    // most recent messages to the user; older queued ones are stale by
    // the time we'd dispatch them anyway, and the unread state in-app
    // is the source of truth for "what did I miss."
    while (notificationQueue.length > NOTIFICATION_QUEUE_CAP) {
        notificationQueue.shift();
    }
    await drainNotificationQueue();
}

function canRouteNotificationNow(): boolean {
    return navigationRef.isReady() && $user.get() !== null;
}

function deviceApprovalNotificationID(requestID: string): string {
    // Namespaced so it can never collide with a notification ID we
    // generate elsewhere in the app (currently message banners are
    // auto-IDed by expo-notifications, but a future change could add
    // explicit IDs there too).
    return `vex-device-approval:${requestID}`;
}

async function drainNotificationQueue(): Promise<void> {
    if (notificationDrainInFlight) {
        return;
    }
    notificationDrainInFlight = true;
    try {
        let dispatched = 0;
        while (notificationQueue.length > 0) {
            const mail = notificationQueue.shift();
            if (!mail) {
                continue;
            }
            if (dispatched >= NOTIFICATION_DRAIN_CAP) {
                // Soft cap. Leave the rest in-app; never let the queue
                // become a self-DOS vector during a wake-from-sleep
                // backlog. Drop silently rather than backpressure
                // upstream — the user can see the unread badges in
                // the app anyway.
                continue;
            }
            try {
                await scheduleOneMessageNotification(mail);
                dispatched += 1;
            } catch {
                // A single failed scheduleNotificationAsync must not
                // poison the queue for everything behind it.
            }
            // Yield to the event loop. Lets Fabric sync calls, server
            // pings, and any pending React render run between binder
            // calls instead of starving them.
            await sleep(NOTIFICATION_DRAIN_YIELD_MS);
        }
    } finally {
        notificationDrainInFlight = false;
    }
}

async function drainPendingNotificationRoutes(): Promise<void> {
    if (pendingRouteDrainInFlight) {
        return;
    }
    pendingRouteDrainInFlight = true;
    try {
        while (pendingNotificationRouteCount() > 0) {
            const next = dequeuePendingNotificationRoute();
            if (!next) {
                continue;
            }
            if (isMessageNotificationData(next.data)) {
                if (next.syncFirst) {
                    await handleRemotePushWake(next.data).catch(() => {
                        /* wake sync is best-effort; taps should still be handled */
                    });
                }
                handleNotificationPress(next.data);
                continue;
            }
            if (!canRouteNotificationNow()) {
                requeuePendingNotificationRoute(next);
                logPushDelivery("notification route flush deferred", {
                    navigationReady: navigationRef.isReady(),
                    pending: pendingNotificationRouteCount(),
                    signedIn: $user.get() !== null,
                });
                return;
            }
            if (next.syncFirst) {
                await handleRemotePushWake(next.data).catch(() => {
                    /* wake sync is best-effort; taps should still route */
                });
            }
            handleNotificationPress(next.data);
        }
    } finally {
        pendingRouteDrainInFlight = false;
    }
}

async function ensureChannel(): Promise<void> {
    if (channelReady) return;
    if (Platform.OS === "android") {
        await notifee.createChannel({
            id: CHANNEL_ID,
            importance: NotifeeAndroidImportance.HIGH,
            name: "Messages",
            // Do not set `sound: "default"` here. Current native notification
            // modules treat it as a custom sound resource named "default" and
            // warn when that resource is not bundled. Omit sound to use
            // platform/channel default behavior.
            vibration: true,
        });
    } else {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
            importance: AndroidImportance.HIGH,
            name: "Messages",
        });
    }
    channelReady = true;
}

async function ensureDeviceApprovalChannel(): Promise<void> {
    if (deviceApprovalChannelReady) return;
    await Notifications.setNotificationChannelAsync(
        DEVICE_APPROVAL_CHANNEL_ID,
        {
            importance: AndroidImportance.HIGH,
            name: "Device requests",
        },
    );
    deviceApprovalChannelReady = true;
}

function findServerForChannel(channelID: string): string | undefined {
    const channels = $channels.get();
    for (const [serverID, serverChannels] of Object.entries(channels)) {
        if (serverChannels.some((c) => c.channelID === channelID)) {
            return serverID;
        }
    }
    return undefined;
}

function handleNotificationPress(
    data: Record<string, unknown> | undefined,
): void {
    const kind = data?.["kind"];
    const event = data?.["event"];
    if (isDeviceApprovalNotificationData(data)) {
        // Land on the actual approve/deny applet — the matching code is
        // displayed inside that screen, and that's the only thing the
        // user has to do here.
        logPushDelivery("routing notification tap", {
            event,
            kind,
            target: "DeviceRequests",
        });
        navigateToDeviceRequests();
        return;
    }
    if (data && isMessageNotificationData(data)) {
        logPushDelivery("message notification tap handled", {
            event,
            kind,
        });
        void clearMessageNotificationSummary();
        return;
    }
    logPushDelivery("notification tap ignored; no route fields", {
        ...summarizePushData(data),
    });
}

async function handleRemotePushWake(
    data: Record<string, unknown> | undefined,
): Promise<void> {
    const event = data?.["event"];
    const kind = data?.["kind"];
    if (
        event !== "mail" &&
        event !== "callWake" &&
        event !== "deviceRequest" &&
        event !== "deviceListChanged" &&
        kind !== "dm" &&
        kind !== "group"
    ) {
        logPushDelivery("notification data ignored for wake sync", {
            ...summarizePushData(data),
        });
        return;
    }
    logPushDelivery("remote push wake sync requested", {
        event,
        kind,
    });
    try {
        const result = await vexService.runBackgroundNetworkFetch();
        logPushDelivery("remote push wake sync finished", {
            result,
        });
    } catch (err: unknown) {
        console.warn(
            "[vex-push] remote push wake sync failed",
            err instanceof Error ? err.message : String(err),
        );
    }
}

function incrementMessageNotificationSummary(): number {
    messageNotificationCount += 1;
    return messageNotificationCount;
}

function iosDefaultNotificationSound(): { sound?: "default" } {
    return Platform.OS === "ios" ? { sound: "default" } : {};
}

function isDeviceApprovalNotificationData(
    data: Record<string, unknown> | undefined,
): boolean {
    return (
        data?.["kind"] === "deviceApproval" ||
        data?.["event"] === "deviceRequest"
    );
}

function isMessageNotificationData(data: Record<string, unknown>): boolean {
    const kind = data["kind"];
    return data["event"] === "mail" || kind === "dm" || kind === "group";
}

function isRemotePushNotification(
    notification: Notifications.Notification,
): boolean {
    const trigger = notification.request.trigger as null | {
        remoteMessage?: unknown;
        type?: unknown;
    };
    return trigger?.type === "push" || trigger?.remoteMessage != null;
}

function messageNotificationTitle(count: number): string {
    return count <= 1 ? "New Message" : `${count.toString()} New Messages`;
}

function resetMessageNotificationSummary(): void {
    messageNotificationCount = 0;
}

function resolveAuthorNameMobile(userID: string): string | undefined {
    return $familiars.get()[userID]?.username;
}

function resolveChannelInfoMobile(
    channelID: string,
): undefined | { channelName: string; serverName: string } {
    const serverID = findServerForChannel(channelID);
    if (!serverID) {
        return undefined;
    }
    const serverChannels = $channels.get()[serverID] ?? [];
    const channel = serverChannels.find((c) => c.channelID === channelID);
    const server = $servers.get()[serverID];
    const channelName = channel?.name ?? "channel";
    const serverName = server?.name ?? serverID.slice(0, 8);
    return { channelName, serverName };
}

function routeNotificationTap(
    data: Record<string, unknown> | undefined,
    options: { syncFirst?: boolean } = {},
): void {
    if (!data || typeof data !== "object") {
        return;
    }
    if (isDeviceApprovalNotificationData(data)) {
        if (canRouteNotificationNow()) {
            if (options.syncFirst === true) {
                void (async () => {
                    await handleRemotePushWake(data);
                    handleNotificationPress(data);
                })().catch((err: unknown) => {
                    console.warn(
                        "[vex-push] device approval notification tap handling failed",
                        err instanceof Error ? err.message : String(err),
                    );
                    handleNotificationPress(data);
                });
                return;
            }
            handleNotificationPress(data);
            return;
        }
        logPushDelivery("device approval notification tap queued", {
            navigationReady: navigationRef.isReady(),
            signedIn: $user.get() !== null,
            ...summarizePushData(data),
        });
        enqueuePendingNotificationRoute(data, {
            dedupeKey:
                typeof data["requestID"] === "string"
                    ? data["requestID"]
                    : undefined,
            syncFirst: options.syncFirst === true,
        });
        return;
    }
    if (isMessageNotificationData(data)) {
        if (options.syncFirst === true) {
            void (async () => {
                await handleRemotePushWake(data);
                handleNotificationPress(data);
            })().catch((err: unknown) => {
                console.warn(
                    "[vex-push] message notification tap handling failed",
                    err instanceof Error ? err.message : String(err),
                );
                handleNotificationPress(data);
            });
            return;
        }
        handleNotificationPress(data);
        return;
    }
    if (canRouteNotificationNow()) {
        if (options.syncFirst === true) {
            void (async () => {
                await handleRemotePushWake(data);
                handleNotificationPress(data);
            })().catch((err: unknown) => {
                console.warn(
                    "[vex-push] notification tap handling failed",
                    err instanceof Error ? err.message : String(err),
                );
                handleNotificationPress(data);
            });
            return;
        }
        handleNotificationPress(data);
        return;
    }
    logPushDelivery("notification tap queued", {
        navigationReady: navigationRef.isReady(),
        signedIn: $user.get() !== null,
        ...summarizePushData(data),
    });
    enqueuePendingNotificationRoute(data, {
        syncFirst: options.syncFirst === true,
    });
}

async function scheduleOneMessageNotification(mail: Message): Promise<void> {
    const payload = shouldNotify(
        mail,
        (uid) => resolveAuthorNameMobile(uid),
        mail.group ? (cid) => resolveChannelInfoMobile(cid) : undefined,
    );
    if (!payload) return;

    const serverID = mail.group ? findServerForChannel(mail.group) : undefined;

    await ensureChannel();

    const routeData: Record<string, string> = {
        authorID: payload.authorID,
        event: "mail",
        kind: payload.group ? "group" : "dm",
        mailID: payload.mailID,
    };
    if (payload.group && serverID) {
        routeData["channelID"] = payload.group;
        routeData["serverID"] = serverID;
    }

    const title = messageNotificationTitle(
        incrementMessageNotificationSummary(),
    );

    if (Platform.OS === "android") {
        await notifee.displayNotification({
            android: {
                category: AndroidCategory.STATUS,
                channelId: CHANNEL_ID,
                pressAction: { id: "default" },
                smallIcon: "notification_icon",
                tag: MESSAGE_NOTIFICATION_ID,
            },
            data: routeData,
            id: MESSAGE_NOTIFICATION_ID,
            title,
        });
        return;
    }

    await Notifications.dismissNotificationAsync(MESSAGE_NOTIFICATION_ID).catch(
        () => {
            // Best-effort; the prior summary may already be gone.
        },
    );
    await Notifications.cancelScheduledNotificationAsync(
        MESSAGE_NOTIFICATION_ID,
    ).catch(() => {
        // Best-effort; the prior summary may already be delivered or gone.
    });
    await Notifications.scheduleNotificationAsync({
        content: {
            data: routeData,
            ...iosDefaultNotificationSound(),
            title,
        },
        identifier: MESSAGE_NOTIFICATION_ID,
        trigger: { channelId: CHANNEL_ID },
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

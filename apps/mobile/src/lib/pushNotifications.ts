import type {
    PushNotificationChannel,
    PushNotificationEvent,
} from "@vex-chat/store";

import { Platform } from "react-native";

import { $user, vexService } from "@vex-chat/store";

import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AndroidImportance, IosAuthorizationStatus } from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { atom } from "nanostores";

import { $nativeCallPushToken } from "./nativeCallPushTokens";

const ENABLED_STORE_KEY = "vex.pushNotifications.enabled.v1";
const SUBSCRIPTION_KEY_PREFIX = "vex.pushNotifications.subscription.v1";
const CLEANUP_KEY_PREFIX = "vex.pushNotifications.cleanup.v1";
const PUSH_CHANNEL_ID = "vex-push-messages-v2";
const EXPO_GENERAL_EVENTS: PushNotificationEvent[] = [
    "mail",
    "deviceRequest",
    "deviceListChanged",
];
const EXPO_FALLBACK_EVENTS: PushNotificationEvent[] = [
    ...EXPO_GENERAL_EVENTS,
    "callWake",
];
const CALL_WAKE_EVENTS: PushNotificationEvent[] = ["callWake"];

export type PushNotificationStatus =
    | "denied"
    | "disabled"
    | "error"
    | "idle"
    | "permission_needed"
    | "subscribed"
    | "subscribing";

interface DesiredSubscription {
    channel: PushNotificationChannel;
    events: PushNotificationEvent[];
    platform: "android" | "ios" | "web";
    token: string;
}

interface ExpoConfigWithProjectID {
    extra?: {
        eas?: {
            projectId?: unknown;
        };
    };
}

interface StoredSubscription {
    channel: PushNotificationChannel;
    events: PushNotificationEvent[];
    platform: "android" | "ios" | "web";
    subscriptionID: string;
    token: string;
}

export const $pushNotificationsEnabled = atom<boolean>(true);
export const $pushNotificationStatus = atom<PushNotificationStatus>("idle");

let preferenceHydration: null | Promise<void> = null;

export async function hydratePushNotificationPreference(): Promise<void> {
    if (!preferenceHydration) {
        preferenceHydration = readPushNotificationPreference();
    }
    await preferenceHydration;
}

export async function reconcilePushNotificationSubscription(): Promise<void> {
    await hydratePushNotificationPreference();
    if (!$pushNotificationsEnabled.get()) {
        const cleanupSucceeded =
            await cleanupStoredPushNotificationSubscription();
        $pushNotificationStatus.set("disabled");
        if (!cleanupSucceeded) {
            $pushNotificationStatus.set("error");
        }
        return;
    }

    $pushNotificationStatus.set("subscribing");
    try {
        await cleanupQueuedPushNotificationSubscriptions();
        logPush("reconciling subscription", {
            platform: Platform.OS,
        });
        const desired = await collectDesiredSubscriptions();
        if (desired.length === 0) {
            logPush("subscription skipped; no push tokens available");
            return;
        }

        const previous = await readStoredSubscriptions();
        logPush("desired push subscriptions resolved", {
            channels: desired.map(subscriptionKey).sort(),
            previous: previous.map(subscriptionKey).sort(),
        });

        const next: StoredSubscription[] = [];
        const desiredByKey = new Map(
            desired.map((subscription) => [
                subscriptionKey(subscription),
                subscription,
            ]),
        );
        const previousByKey = new Map(
            previous.map((subscription) => [
                subscriptionKey(subscription),
                subscription,
            ]),
        );

        for (const stored of previous) {
            const matching = desiredByKey.get(subscriptionKey(stored));
            if (matching && storedSubscriptionMatches(stored, matching)) {
                next.push(stored);
                continue;
            }
            await queuePushNotificationSubscriptionCleanup(
                stored.subscriptionID,
            );
        }

        for (const subscription of desired) {
            const previousMatch = previousByKey.get(
                subscriptionKey(subscription),
            );
            if (
                previousMatch &&
                storedSubscriptionMatches(previousMatch, subscription)
            ) {
                continue;
            }
            const response = await vexService.subscribePushNotifications({
                channel: subscription.channel,
                events: subscription.events,
                platform: subscription.platform,
                token: subscription.token,
            });
            next.push({
                ...subscription,
                subscriptionID: response.subscriptionID,
            });
            logPush("server subscription stored", {
                channel: subscription.channel,
                platform: subscription.platform,
                subscriptionID: response.subscriptionID,
                token: redactToken(subscription.token),
            });
        }

        await writeStoredSubscriptions(next);

        await cleanupQueuedPushNotificationSubscriptions();

        $pushNotificationStatus.set("subscribed");
    } catch (err: unknown) {
        console.warn(
            "[vex-push] subscription failed",
            err instanceof Error ? err.message : String(err),
        );
        $pushNotificationStatus.set("error");
    }
}

export async function setPushNotificationsEnabled(
    enabled: boolean,
): Promise<void> {
    await hydratePushNotificationPreference();
    $pushNotificationsEnabled.set(enabled);
    await SecureStore.setItemAsync(ENABLED_STORE_KEY, enabled ? "1" : "0");
    if (enabled) {
        await reconcilePushNotificationSubscription();
        return;
    }

    $pushNotificationStatus.set("disabled");
    const cleanupSucceeded = await cleanupStoredPushNotificationSubscription();
    if (!cleanupSucceeded) {
        $pushNotificationStatus.set("error");
    }
}

export async function unsubscribeStoredPushNotificationSubscription(
    userID: string,
): Promise<void> {
    await cleanupStoredPushNotificationSubscription(userID);
}

async function cleanupQueuedPushNotificationSubscriptions(
    userID?: string,
): Promise<boolean> {
    const pending = await readPendingCleanupSubscriptionIDs(userID);
    if (pending.length === 0) {
        return true;
    }

    const remaining: string[] = [];
    for (const subscriptionID of pending) {
        try {
            logPush("removing queued subscription", {
                subscriptionID,
                userID: userID ?? $user.get()?.userID ?? null,
            });
            await vexService.unsubscribePushNotifications(subscriptionID);
        } catch (err: unknown) {
            remaining.push(subscriptionID);
            console.warn(
                "[vex-push] queued subscription cleanup failed",
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    await writePendingCleanupSubscriptionIDs(remaining, userID);
    return remaining.length === 0;
}

async function cleanupStoredPushNotificationSubscription(
    userID?: string,
): Promise<boolean> {
    const previous = await readStoredSubscriptions(userID);
    for (const subscription of previous) {
        await queuePushNotificationSubscriptionCleanup(
            subscription.subscriptionID,
            userID,
        );
    }
    await clearStoredSubscriptions(userID);
    return cleanupQueuedPushNotificationSubscriptions(userID);
}

function cleanupStoreKey(userID = $user.get()?.userID): string {
    return `${CLEANUP_KEY_PREFIX}.${userID ?? "anonymous"}`;
}

async function clearStoredSubscriptions(userID?: string): Promise<void> {
    await SecureStore.deleteItemAsync(subscriptionStoreKey(userID));
}

async function collectDesiredSubscriptions(): Promise<DesiredSubscription[]> {
    const platform = pushPlatform();
    const desired: DesiredSubscription[] = [];

    const nativeCallToken = await getNativeCallPushTokenIfAllowed();
    const expoToken = await getExpoPushTokenIfAllowed().catch(
        (err: unknown) => {
            console.warn(
                "[vex-push] expo token unavailable",
                err instanceof Error ? err.message : String(err),
            );
            return null;
        },
    );
    if (expoToken) {
        desired.push({
            channel: "expo",
            events: nativeCallToken
                ? EXPO_GENERAL_EVENTS
                : EXPO_FALLBACK_EVENTS,
            platform,
            token: expoToken,
        });
        logPush("expo push token ready", {
            token: redactToken(expoToken),
        });
    }

    if (nativeCallToken) {
        desired.push({
            channel: nativeCallToken.channel,
            events: CALL_WAKE_EVENTS,
            platform,
            token: nativeCallToken.token,
        });
        logPush("native call push token ready", {
            channel: nativeCallToken.channel,
            token: redactToken(nativeCallToken.token),
        });
    }

    return desired;
}

async function ensureAndroidPushChannel(): Promise<void> {
    if (Platform.OS !== "android") {
        return;
    }
    logPush("ensuring android notification channel", {
        channelID: PUSH_CHANNEL_ID,
    });
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
        importance: AndroidImportance.HIGH,
        name: "Push notifications",
        // Do not set `sound: "default"` here. Current native notification
        // modules treat it as a custom sound resource named "default" and warn
        // when that resource is not bundled. Omit sound to use platform/channel
        // default behavior.
        vibrationPattern: [0, 250],
    });
}

function eventsKey(events: PushNotificationEvent[]): string {
    return uniqueEvents(events).sort().join(",");
}

async function getExpoPushToken(): Promise<string> {
    const projectId =
        (Constants.expoConfig as ExpoConfigWithProjectID | null | undefined)
            ?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (typeof projectId !== "string" || projectId.length === 0) {
        throw new Error("Expo project id is unavailable.");
    }
    logPush("requesting expo push token", {
        projectID: projectId,
    });
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

async function getExpoPushTokenIfAllowed(): Promise<null | string> {
    await ensureAndroidPushChannel();
    const existing = await Notifications.getPermissionsAsync();
    logPush("notification permission state", {
        canAskAgain: existing.canAskAgain,
        granted: existing.granted,
        status: existing.status,
    });
    if (isNotificationPermissionGranted(existing)) {
        return getExpoPushToken();
    }

    if (!existing.canAskAgain) {
        $pushNotificationStatus.set("denied");
        return null;
    }

    $pushNotificationStatus.set("permission_needed");
    logPush("requesting notification permission");
    const requested = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    logPush("notification permission request result", {
        canAskAgain: requested.canAskAgain,
        granted: requested.granted,
        status: requested.status,
    });
    if (!isNotificationPermissionGranted(requested)) {
        $pushNotificationStatus.set("denied");
        return null;
    }
    return getExpoPushToken();
}

async function getFirebaseMessagingToken(): Promise<null | string> {
    if (Platform.OS !== "android") {
        return null;
    }
    try {
        const mod = await import("@react-native-firebase/messaging");
        const messaging = mod.default();
        await messaging.registerDeviceForRemoteMessages?.();
        const token = await messaging.getToken();
        return typeof token === "string" && token.trim().length > 0
            ? token.trim()
            : null;
    } catch (err: unknown) {
        console.warn(
            "[vex-push] firebase messaging token unavailable",
            err instanceof Error ? err.message : String(err),
        );
        return null;
    }
}

async function getNativeCallPushTokenIfAllowed(): Promise<null | {
    channel: Extract<PushNotificationChannel, "apnsVoip" | "fcmCall">;
    token: string;
}> {
    if (Platform.OS === "ios") {
        return $nativeCallPushToken.get();
    }
    if (Platform.OS !== "android") {
        return null;
    }
    await ensureAndroidPushChannel();
    const settings = await Notifications.getPermissionsAsync();
    if (!isNotificationPermissionGranted(settings)) {
        return null;
    }
    const firebaseToken = await getFirebaseMessagingToken();
    if (firebaseToken) {
        return { channel: "fcmCall", token: firebaseToken };
    }
    try {
        const token: unknown = await Notifications.getDevicePushTokenAsync();
        const data =
            typeof token === "object" && token !== null && "data" in token
                ? (token as { data?: unknown }).data
                : null;
        if (typeof data === "string" && data.trim().length > 0) {
            return { channel: "fcmCall", token: data.trim() };
        }
    } catch (err: unknown) {
        console.warn(
            "[vex-push] native android push token unavailable",
            err instanceof Error ? err.message : String(err),
        );
    }
    return null;
}

function isNotificationPermissionGranted(
    settings: Notifications.NotificationPermissionsStatus,
): boolean {
    return (
        settings.granted ||
        settings.ios?.status === IosAuthorizationStatus.PROVISIONAL
    );
}

function isPushNotificationEvent(
    value: unknown,
): value is PushNotificationEvent {
    return (
        value === "callWake" ||
        value === "deviceListChanged" ||
        value === "deviceRequest" ||
        value === "mail"
    );
}

function logPush(message: string, details?: Record<string, unknown>): void {
    if (details) {
        console.info(`[vex-push] ${message}`, details);
        return;
    }
    console.info(`[vex-push] ${message}`);
}

function parseStoredSubscription(value: unknown): null | StoredSubscription {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const obj = value as Record<string, unknown>;
    if (
        typeof obj["subscriptionID"] !== "string" ||
        typeof obj["token"] !== "string"
    ) {
        return null;
    }
    const channel =
        obj["channel"] === "apnsVoip" ||
        obj["channel"] === "expo" ||
        obj["channel"] === "fcmCall"
            ? obj["channel"]
            : "expo";
    const platform =
        obj["platform"] === "android" ||
        obj["platform"] === "ios" ||
        obj["platform"] === "web"
            ? obj["platform"]
            : pushPlatform();
    const events: PushNotificationEvent[] = Array.isArray(obj["events"])
        ? obj["events"].filter(isPushNotificationEvent)
        : channel === "expo"
          ? EXPO_FALLBACK_EVENTS
          : ["callWake"];
    return {
        channel,
        events: uniqueEvents(events),
        platform,
        subscriptionID: obj["subscriptionID"],
        token: obj["token"],
    };
}

function pushPlatform(): "android" | "ios" | "web" {
    if (Platform.OS === "android" || Platform.OS === "ios") {
        return Platform.OS;
    }
    return "web";
}

async function queuePushNotificationSubscriptionCleanup(
    subscriptionID: string,
    userID?: string,
): Promise<void> {
    const pending = await readPendingCleanupSubscriptionIDs(userID);
    await writePendingCleanupSubscriptionIDs(
        uniqueSubscriptionIDs([...pending, subscriptionID]),
        userID,
    );
}

async function readPendingCleanupSubscriptionIDs(
    userID?: string,
): Promise<string[]> {
    try {
        const raw = await SecureStore.getItemAsync(cleanupStoreKey(userID));
        if (!raw) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return uniqueSubscriptionIDs(
                parsed.filter(
                    (value): value is string => typeof value === "string",
                ),
            );
        }
    } catch {
        // Treat corrupt cleanup state as empty; a later active subscription
        // record can still be queued again if it needs cleanup.
    }
    return [];
}

async function readPushNotificationPreference(): Promise<void> {
    try {
        const raw = await SecureStore.getItemAsync(ENABLED_STORE_KEY);
        $pushNotificationsEnabled.set(raw !== "0");
        $pushNotificationStatus.set(raw === "0" ? "disabled" : "idle");
    } catch {
        $pushNotificationsEnabled.set(true);
        $pushNotificationStatus.set("idle");
    }
}

async function readStoredSubscriptions(
    userID?: string,
): Promise<StoredSubscription[]> {
    try {
        const raw = await SecureStore.getItemAsync(
            subscriptionStoreKey(userID),
        );
        if (!raw) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.flatMap((value) => {
                const subscription = parseStoredSubscription(value);
                return subscription ? [subscription] : [];
            });
        }
        const legacy = parseStoredSubscription(parsed);
        if (legacy) {
            return [legacy];
        }
    } catch {
        // Treat corrupt storage as no subscription.
    }
    return [];
}

function redactToken(token: string): string {
    if (token.length <= 16) {
        return token;
    }
    return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function storedSubscriptionMatches(
    stored: StoredSubscription,
    desired: DesiredSubscription,
): boolean {
    return (
        stored.channel === desired.channel &&
        stored.platform === desired.platform &&
        stored.token === desired.token &&
        eventsKey(stored.events) === eventsKey(desired.events)
    );
}

function subscriptionKey(
    subscription: Pick<StoredSubscription, "channel" | "platform">,
): string {
    return `${subscription.platform}:${subscription.channel}`;
}

function subscriptionStoreKey(userID = $user.get()?.userID): string {
    return `${SUBSCRIPTION_KEY_PREFIX}.${userID ?? "anonymous"}`;
}

function uniqueEvents(
    events: PushNotificationEvent[],
): PushNotificationEvent[] {
    return [...new Set(events)];
}

function uniqueSubscriptionIDs(subscriptionIDs: string[]): string[] {
    return [...new Set(subscriptionIDs)];
}

async function writePendingCleanupSubscriptionIDs(
    subscriptionIDs: string[],
    userID?: string,
): Promise<void> {
    const uniqueIDs = uniqueSubscriptionIDs(subscriptionIDs);
    if (uniqueIDs.length === 0) {
        await SecureStore.deleteItemAsync(cleanupStoreKey(userID));
        return;
    }
    await SecureStore.setItemAsync(
        cleanupStoreKey(userID),
        JSON.stringify(uniqueIDs),
    );
}

async function writeStoredSubscriptions(
    subscriptions: StoredSubscription[],
): Promise<void> {
    if (subscriptions.length === 0) {
        await clearStoredSubscriptions();
        return;
    }
    await SecureStore.setItemAsync(
        subscriptionStoreKey(),
        JSON.stringify(
            subscriptions.map((subscription) => ({
                ...subscription,
                events: uniqueEvents(subscription.events),
            })),
        ),
    );
}

import { Platform } from "react-native";

import { $user, vexService } from "@vex-chat/store";

import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AndroidImportance, IosAuthorizationStatus } from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { atom } from "nanostores";

import { buildInfo } from "./buildInfo";

const ENABLED_STORE_KEY = "vex.pushNotifications.enabled.v1";
const SUBSCRIPTION_KEY_PREFIX = "vex.pushNotifications.subscription.v1";
const CLEANUP_KEY_PREFIX = "vex.pushNotifications.cleanup.v1";
const PUSH_CHANNEL_ID = "vex-push-messages-v2";

export type PushNotificationStatus =
    | "denied"
    | "disabled"
    | "error"
    | "idle"
    | "permission_needed"
    | "subscribed"
    | "subscribing"
    | "unsupported";

interface ExpoConfigWithProjectID {
    extra?: {
        eas?: {
            projectId?: unknown;
        };
    };
}

interface StoredSubscription {
    subscriptionID: string;
    token: string;
}

export const $pushNotificationsEnabled = atom<boolean>(
    buildInfo.capabilities.remotePushNotifications,
);
export const $pushNotificationStatus = atom<PushNotificationStatus>(
    buildInfo.capabilities.remotePushNotifications ? "idle" : "unsupported",
);

let preferenceHydration: null | Promise<void> = null;

export async function hydratePushNotificationPreference(): Promise<void> {
    if (!buildInfo.capabilities.remotePushNotifications) {
        $pushNotificationsEnabled.set(false);
        $pushNotificationStatus.set("unsupported");
        return;
    }
    if (!preferenceHydration) {
        preferenceHydration = readPushNotificationPreference();
    }
    await preferenceHydration;
}

export async function reconcilePushNotificationSubscription(): Promise<void> {
    await hydratePushNotificationPreference();
    if (!buildInfo.capabilities.remotePushNotifications) {
        $pushNotificationsEnabled.set(false);
        $pushNotificationStatus.set("unsupported");
        logPush("subscription skipped; remote push unsupported in this build", {
            target: buildInfo.target,
        });
        return;
    }
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
        const token = await getExpoPushTokenIfAllowed();
        if (!token) {
            logPush("subscription skipped; no push token available");
            return;
        }
        logPush("expo push token ready", {
            token: redactToken(token),
        });

        const previous = await readStoredSubscription();
        if (previous) {
            logPush("found stored subscription", {
                subscriptionID: previous.subscriptionID,
                tokenMatches: previous.token === token,
            });
        }
        const subscription = await vexService.subscribePushNotifications({
            channel: "expo",
            events: ["mail", "deviceRequest", "deviceListChanged"],
            platform:
                Platform.OS === "android" || Platform.OS === "ios"
                    ? Platform.OS
                    : "web",
            token,
        });

        if (
            previous &&
            previous.subscriptionID !== subscription.subscriptionID
        ) {
            await queuePushNotificationSubscriptionCleanup(
                previous.subscriptionID,
            );
        }

        await writeStoredSubscription({
            subscriptionID: subscription.subscriptionID,
            token,
        });
        logPush("server subscription stored", {
            subscriptionID: subscription.subscriptionID,
        });

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
    if (!buildInfo.capabilities.remotePushNotifications) {
        $pushNotificationsEnabled.set(false);
        $pushNotificationStatus.set("unsupported");
        return;
    }
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
    const previous = await readStoredSubscription(userID);
    if (previous) {
        await queuePushNotificationSubscriptionCleanup(
            previous.subscriptionID,
            userID,
        );
        await clearStoredSubscription(userID);
    }
    return cleanupQueuedPushNotificationSubscriptions(userID);
}

function cleanupStoreKey(userID = $user.get()?.userID): string {
    return `${CLEANUP_KEY_PREFIX}.${userID ?? "anonymous"}`;
}

async function clearStoredSubscription(userID?: string): Promise<void> {
    await SecureStore.deleteItemAsync(subscriptionStoreKey(userID));
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

function isNotificationPermissionGranted(
    settings: Notifications.NotificationPermissionsStatus,
): boolean {
    return (
        settings.granted ||
        settings.ios?.status === IosAuthorizationStatus.PROVISIONAL
    );
}

function logPush(message: string, details?: Record<string, unknown>): void {
    if (details) {
        console.info(`[vex-push] ${message}`, details);
        return;
    }
    console.info(`[vex-push] ${message}`);
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

async function readStoredSubscription(
    userID?: string,
): Promise<null | StoredSubscription> {
    try {
        const raw = await SecureStore.getItemAsync(
            subscriptionStoreKey(userID),
        );
        if (!raw) {
            return null;
        }
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed === "object" &&
            parsed !== null &&
            "subscriptionID" in parsed &&
            "token" in parsed &&
            typeof (parsed as { subscriptionID: unknown }).subscriptionID ===
                "string" &&
            typeof (parsed as { token: unknown }).token === "string"
        ) {
            return parsed as StoredSubscription;
        }
    } catch {
        // Treat corrupt storage as no subscription.
    }
    return null;
}

function redactToken(token: string): string {
    if (token.length <= 16) {
        return token;
    }
    return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function subscriptionStoreKey(userID = $user.get()?.userID): string {
    return `${SUBSCRIPTION_KEY_PREFIX}.${userID ?? "anonymous"}`;
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

async function writeStoredSubscription(
    subscription: StoredSubscription,
): Promise<void> {
    await SecureStore.setItemAsync(
        subscriptionStoreKey(),
        JSON.stringify(subscription),
    );
}

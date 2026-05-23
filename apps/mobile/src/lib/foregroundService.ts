import { Linking, Platform } from "react-native";

import { vexService } from "@vex-chat/store";

import notifee, { AndroidImportance } from "@notifee/react-native";
import * as SecureStore from "expo-secure-store";
import { atom } from "nanostores";

import { buildInfo } from "./buildInfo";

/**
 * "Always-on connection" mode keeps the libvex WebSocket alive while
 * the app is backgrounded. Implemented as an Android foreground service
 * (via `@notifee/react-native`) with a persistent low-importance
 * notification — the Android contract for "the user knows this is
 * running, don't kill it for being idle".
 *
 * iOS has no comparable surface (the OS strictly suspends backgrounded
 * apps); the toggle is hidden from iOS users at the UI layer.
 *
 * Reliability is best-effort:
 *   - Stock AOSP / Pixel / GrapheneOS: indefinite once the user grants
 *     "Unrestricted" battery access (Settings → Battery → Unrestricted).
 *   - Samsung / Xiaomi / Huawei / Oppo: per-OEM kill lists may still
 *     stop the service on a long-enough idle. See dontkillmyapp.com
 *     for per-vendor escape hatches; we link users there from the
 *     settings screen rather than encoding them in code.
 *
 * Architectural note:
 *   We deliberately do NOT relocate the WebSocket into native code.
 *   The libvex `Client` already owns ping/reconnect/dedup; the FGS's
 *   only job is to keep the JS engine alive long enough for that
 *   logic to run. The service body is therefore a Promise that never
 *   resolves — Notifee's documented pattern for "stay alive
 *   indefinitely until {@link stopAlwaysOn} is called or the OS
 *   reclaims the process."
 */

const STORE_KEY = "vex.alwaysOnConnection.v1";
const CHANNEL_ID = "vex-connection";
const FGS_NOTIFICATION_ID = "vex-connection";

/** User preference: should the foreground service run on next app launch? */
export const $alwaysOnEnabled = atom<boolean>(false);

let registered = false;
let hydrated = false;
let serviceRunning = false;

/**
 * "If the user wants the FGS, make sure it's running."
 *
 * Called from the app's resume handler. The Android OS can silently
 * reap a foreground service under memory pressure (especially on
 * aggressive OEM kill-list builds), and the JS side has no event for
 * that — `serviceRunning` stays `true` even after the native service
 * is gone. Rather than try to detect the kill, we just (re-)assert
 * intent every time the app comes back to foreground while the user
 * has always-on enabled.
 *
 * `notifee.displayNotification` with the same `id` and
 * `asForegroundService: true` is idempotent: when the service is
 * already running it just refreshes the notification, when it isn't
 * it spawns a fresh one. So this is safe to call repeatedly.
 *
 * Best-effort by design — failures are swallowed because we'd rather
 * the user resume the app cleanly than crash on a transient notifee
 * error during a wake window.
 */
export async function ensureAlwaysOnRunning(): Promise<void> {
    if (!isAlwaysOnSupported()) {
        return;
    }
    if (!$alwaysOnEnabled.get()) {
        return;
    }
    try {
        await startAlwaysOn();
    } catch {
        // Swallow — see jsdoc.
    }
}

export async function hydrateAlwaysOnPreference(): Promise<void> {
    if (hydrated) {
        return;
    }
    hydrated = true;
    try {
        const raw = await SecureStore.getItemAsync(STORE_KEY);
        if (raw === "1") {
            $alwaysOnEnabled.set(true);
        }
    } catch {
        // SecureStore can throw on misconfigured devices; defaulting
        // to "off" is the safe choice — the user can flip it back on
        // from Settings if they meant to keep it.
    }
}

export function isAlwaysOnSupported(): boolean {
    return (
        buildInfo.capabilities.alwaysOnConnection && Platform.OS === "android"
    );
}

/**
 * Opens Android's battery-optimization settings list so the user can
 * exempt the app. Without this exemption Doze will throttle network
 * access for backgrounded foreground services on most stock builds.
 *
 * Uses the system intent (`Linking.sendIntent`) rather than a new
 * Expo dependency. No-op on iOS.
 */
export async function openBatteryOptimizationSettings(): Promise<void> {
    if (Platform.OS !== "android") {
        return;
    }
    try {
        await Linking.sendIntent(
            "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS",
        );
    } catch {
        // Some OEM builds gate this intent; fall back to generic
        // app-settings so the user can still reach Battery from there.
        try {
            await Linking.openSettings();
        } catch {
            // ignore — best effort
        }
    }
}

export async function startAlwaysOn(): Promise<void> {
    if (!isAlwaysOnSupported()) {
        return;
    }
    ensureRegistered();

    const wasRunning = serviceRunning;

    const channelId = await notifee.createChannel({
        id: CHANNEL_ID,
        importance: AndroidImportance.LOW,
        name: "Connection",
    });

    await notifee.displayNotification({
        android: {
            asForegroundService: true,
            channelId,
            ongoing: true,
            pressAction: { id: "default" },
            // `notification_icon` is a vector drawable written into
            // `android/.../res/drawable/notification_icon.xml` by
            // our `plugins/withNotificationIcon.js` config plugin
            // (registered in app.config.js). The plugin runs after
            // `expo-notifications` and intentionally strips the
            // raster PNGs that plugin would otherwise generate, so
            // our white-silhouette vector is what actually resolves
            // at runtime.
            //
            // Why bother having our own plugin instead of trusting
            // expo-notifications: Android 13+ rejects FGS startup
            // if smallIcon can't be resolved, surfacing as
            //   IllegalArgumentException: Invalid notification (no
            //     valid small icon)
            // from inside `app.notifee.core.ForegroundService.
            // onStartCommand` — a native callback no JS try/catch
            // can intercept. Any drift between app.json's icon
            // config and the actual drawable on disk (stale
            // prebuild, partial regeneration, etc.) crashes the app
            // the moment the user toggles always-on. Owning the
            // drawable in our own plugin makes that failure mode
            // structurally impossible.
            smallIcon: "notification_icon",
        },
        body: "Connected",
        id: FGS_NOTIFICATION_ID,
        title: "Vex",
    });

    serviceRunning = true;
    $alwaysOnEnabled.set(true);

    // After a fresh (re-)start, the watchdog's last-frame timestamp
    // belongs to the *previous* (now-dead) socket and would falsely
    // report "healthy" on the next resume probe. Force it to zero so
    // the upcoming `refreshSessionAfterForeground` correctly opts into
    // a full reconnect until the new socket actually receives a frame.
    // No-op when start() was a true cold-start; the watchdog was
    // already 0 in that case.
    if (wasRunning) {
        vexService.resetWebsocketWatchdog();
    }

    try {
        await SecureStore.setItemAsync(STORE_KEY, "1");
    } catch {
        // Persistence failure is non-fatal — current session still
        // benefits from the running FGS; user just won't auto-resume
        // on next launch.
    }
}

export async function stopAlwaysOn(): Promise<void> {
    if (!isAlwaysOnSupported()) {
        return;
    }
    await suspendAlwaysOn();

    $alwaysOnEnabled.set(false);

    try {
        await SecureStore.deleteItemAsync(STORE_KEY);
    } catch {
        // ignore — the in-memory atom is the source of truth for the
        // current session.
    }
}

/**
 * Stops the running FGS without changing the persisted preference.
 * Use for transient "the user signed out" or "the network is gone"
 * scenarios where we want the connection notification gone but want
 * to honor the user's toggle on next sign-in. For an explicit user
 * toggle-off, call {@link stopAlwaysOn} instead.
 *
 * The {@link $alwaysOnEnabled} atom is intentionally left alone here:
 * it reflects the user's *preference*, not the runtime state of the
 * service. The Switch in Settings should keep showing "on" across a
 * sign-out → sign-in cycle if that's what the user chose.
 */
export async function suspendAlwaysOn(): Promise<void> {
    if (!isAlwaysOnSupported() || !serviceRunning) {
        return;
    }
    try {
        await notifee.stopForegroundService();
    } catch {
        // Notifee may throw if the service isn't actually running
        // (e.g., killed by the OS already). Either way we want the
        // notification gone.
    }
    try {
        await notifee.cancelNotification(FGS_NOTIFICATION_ID);
    } catch {
        // ignore
    }
    serviceRunning = false;
}

/**
 * Idempotently registers the FGS body. Safe to call repeatedly; only
 * the first invocation has effect. Notifee requires the runner to be
 * registered before {@link startAlwaysOn} can attach a notification
 * to it.
 */
function ensureRegistered(): void {
    if (registered) {
        return;
    }
    registered = true;
    notifee.registerForegroundService(() => {
        return new Promise(() => {
            // Intentionally never resolves. Notifee tears the service
            // down via `stopForegroundService()`, which abandons this
            // Promise — fine for GC. If the OS kills the process the
            // whole JS context goes with it.
        });
    });
}

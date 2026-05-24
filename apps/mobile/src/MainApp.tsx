import type { Message } from "@vex-chat/libvex";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    AppState,
    Linking,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    Vibration,
    View,
} from "react-native";

import {
    $groupMessages,
    $hydrationStatus,
    $keyReplaced,
    $messages,
    $user,
    parseVexLink,
    vexService,
} from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import { NavigationContainer } from "@react-navigation/native";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { type AppUpdateState, checkForAppUpdates } from "./lib/appUpdates";
import {
    BACKGROUND_NETWORK_SYNC_TASK,
    BACKGROUND_PUSH_NOTIFICATION_TASK,
} from "./lib/backgroundTaskDefinitions";
import { getServerOptions } from "./lib/config";
import { hydrateDevOptionsUnlocked } from "./lib/devMode";
import {
    $alwaysOnEnabled,
    ensureAlwaysOnRunning,
    hydrateAlwaysOnPreference,
    isAlwaysOnSupported,
    startAlwaysOn,
    suspendAlwaysOn,
} from "./lib/foregroundService";
import { $incomingShare } from "./lib/incomingShareState";
import {
    clearCredentials,
    keychainKeyStore,
    setUserIDForUsername,
} from "./lib/keychain";
import {
    clearNotifiedApprovalRequestIDs,
    dismissDeviceApprovalNotification,
    flushPendingNotificationRoutes,
    setupNotificationHandlers,
    showDeviceApprovalNotification,
    showMessageNotification,
} from "./lib/notifications";
import { authenticatePasskey, registerPasskey } from "./lib/passkey";
import { mobileConfig } from "./lib/platform";
import {
    hydratePushNotificationPreference,
    reconcilePushNotificationSubscription,
    unsubscribeStoredPushNotificationSubscription,
} from "./lib/pushNotifications";
import { hydrateLocalMessageRetention } from "./lib/retentionPreference";
import {
    BoundedStringSet,
    NOTIFIED_MAILID_DEDUP_CAP,
    runtimeNotifiedMailIDs,
} from "./lib/runtimeNotificationDedupe";
import { getIncomingShareIntent, type IncomingShare } from "./lib/shareIntent";
import {
    navigateToAboutSettings,
    navigateToDeviceRequests,
    navigationRef,
} from "./navigation/navigationRef";
import { RootNavigator } from "./navigation/RootNavigator";
import { colors, fontFamilies } from "./theme";

vexService.setPasskeyCeremonyDriver({
    authenticate: authenticatePasskey,
    register: registerPasskey,
});

interface AppUpdateNotice {
    message: string;
    title: string;
}

function MainApp() {
    const keyReplaced = useStore($keyReplaced);
    const hydrationStatus = useStore($hydrationStatus);
    const user = useStore($user);
    const appStateRef = useRef(AppState.currentState);
    const bootstrappedRef = useRef(false);
    const authProbeInFlightRef = useRef(false);
    const networkRefreshInFlightRef = useRef(false);
    const resumeProbeInFlightRef = useRef(false);
    const [authNotice, setAuthNotice] = useState<null | string>(null);
    const [rateLimitNotice, setRateLimitNotice] = useState<null | string>(null);
    const [pendingApprovalNotice, setPendingApprovalNotice] = useState<null | {
        count: number;
    }>(null);
    const [appUpdateNotice, setAppUpdateNotice] =
        useState<AppUpdateNotice | null>(null);
    const notifiedMailIDsRef = useRef<BoundedStringSet>(
        new BoundedStringSet(NOTIFIED_MAILID_DEDUP_CAP),
    );
    const notificationHistoryCutoffMsRef = useRef(0);
    const pendingInviteIDRef = useRef<null | string>(null);
    const pendingShareIDRef = useRef<null | string>(null);
    const lastHandledShareIDRef = useRef<null | string>(null);
    const seenPendingRequestIDsRef = useRef<Set<string>>(new Set());
    const userID = user?.userID;

    const flushPendingInviteRoute = useCallback(() => {
        const inviteID = pendingInviteIDRef.current;
        if (!inviteID || !$user.get() || !navigationRef.isReady()) {
            return;
        }
        pendingInviteIDRef.current = null;
        navigationRef.navigate("App", {
            params: { inviteID },
            screen: "InvitePreview",
        });
    }, []);

    const flushPendingShareRoute = useCallback(() => {
        const shareID = pendingShareIDRef.current;
        if (!shareID || !$user.get() || !navigationRef.isReady()) {
            return;
        }
        pendingShareIDRef.current = null;
        navigationRef.navigate("App", {
            screen: "ShareComposer",
        });
    }, []);

    const handleIncomingShare = useCallback(
        (share: IncomingShare | null) => {
            if (!share || lastHandledShareIDRef.current === share.id) {
                return;
            }
            lastHandledShareIDRef.current = share.id;
            pendingShareIDRef.current = share.id;
            $incomingShare.set(share);
            flushPendingShareRoute();
        },
        [flushPendingShareRoute],
    );

    const pollIncomingShare = useCallback(() => {
        if (Platform.OS !== "android") {
            return;
        }
        void getIncomingShareIntent()
            .then(handleIncomingShare)
            .catch((err: unknown) => {
                console.warn(
                    "[vex-share] failed to inspect incoming share",
                    err instanceof Error ? err.message : String(err),
                );
            });
    }, [handleIncomingShare]);

    const handleIncomingLink = useCallback(
        (url: null | string) => {
            if (!url) {
                return;
            }
            const link = parseVexLink(url);
            if (link.type !== "invite") {
                return;
            }
            pendingInviteIDRef.current = link.inviteID;
            flushPendingInviteRoute();
        },
        [flushPendingInviteRoute],
    );

    const logoutWithPushNotificationCleanup = useCallback(async () => {
        const activeUserID = $user.get()?.userID ?? userID;
        try {
            if (activeUserID) {
                await unsubscribeStoredPushNotificationSubscription(
                    activeUserID,
                );
            }
        } catch (err: unknown) {
            console.warn(
                "[vex-push] pre-logout cleanup failed",
                err instanceof Error ? err.message : String(err),
            );
        }
        await vexService.logout();
    }, [userID]);

    useEffect(() => {
        vexService.setBackgroundConnectionRecoverySuspended(
            AppState.currentState !== "active",
        );
        const subscription = AppState.addEventListener("change", (next) => {
            vexService.setBackgroundConnectionRecoverySuspended(
                next !== "active",
            );
        });
        return () => {
            subscription.remove();
        };
    }, []);

    useEffect(() => {
        void Linking.getInitialURL()
            .then(handleIncomingLink)
            .catch(() => {
                /* Ignore malformed platform launch URLs. */
            });
        const subscription = Linking.addEventListener("url", ({ url }) => {
            handleIncomingLink(url);
        });
        return () => {
            subscription.remove();
        };
    }, [handleIncomingLink]);

    useEffect(() => {
        flushPendingInviteRoute();
        flushPendingShareRoute();
    }, [flushPendingInviteRoute, flushPendingShareRoute, userID]);

    useEffect(() => {
        pollIncomingShare();
        const subscription = AppState.addEventListener("change", (next) => {
            if (next === "active") {
                pollIncomingShare();
            }
        });
        return () => {
            subscription.remove();
        };
    }, [pollIncomingShare]);

    useEffect(() => {
        const unsubNotif = setupNotificationHandlers();
        // Hydrate the developer-options easter-egg flag from
        // SecureStore. Fire-and-forget — the atom defaults to false
        // until the persisted value lands.
        void hydrateDevOptionsUnlocked();
        // Hydrate the always-on connection preference. Service start
        // is gated on the sign-in transition below, so we don't spin
        // up a foreground service before there's anything to connect.
        if (isAlwaysOnSupported()) {
            void hydrateAlwaysOnPreference();
        }
        void hydratePushNotificationPreference();
        return () => {
            unsubNotif();
        };
    }, []);

    // Mirror the active user's userID into SecureStore so the offline
    // account picker can render real avatars (the libvex StoredCredentials
    // shape doesn't carry userID, so we maintain a parallel mapping per
    // username here). Best-effort — failure just causes the picker to
    // fall back to initial-letter tiles.
    useEffect(() => {
        if (!user) {
            return;
        }
        void setUserIDForUsername(user.username, user.userID).catch(() => {
            /* swallow — non-fatal */
        });
    }, [user]);

    useEffect(() => {
        if (Platform.OS !== "android") {
            return;
        }
        const registerBackgroundSyncTask = async () => {
            try {
                const status = await BackgroundTask.getStatusAsync();
                if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
                    return;
                }
                const alreadyRegistered =
                    await TaskManager.isTaskRegisteredAsync(
                        BACKGROUND_NETWORK_SYNC_TASK,
                    );
                if (alreadyRegistered) {
                    return;
                }
                await BackgroundTask.registerTaskAsync(
                    BACKGROUND_NETWORK_SYNC_TASK,
                    {
                        minimumInterval: 15 * 60,
                    },
                );
            } catch (err: unknown) {
                console.warn(
                    "[vex-auth] background sync registration failed",
                    err instanceof Error ? err.message : String(err),
                );
            }
        };
        void registerBackgroundSyncTask();
        return;
    }, []);

    useEffect(() => {
        if (Platform.OS !== "android") {
            return;
        }
        const registerBackgroundPushTask = async () => {
            try {
                const alreadyRegistered =
                    await TaskManager.isTaskRegisteredAsync(
                        BACKGROUND_PUSH_NOTIFICATION_TASK,
                    );
                if (alreadyRegistered) {
                    return;
                }
                await Notifications.registerTaskAsync(
                    BACKGROUND_PUSH_NOTIFICATION_TASK,
                );
                console.info("[vex-push] background push task registered");
            } catch (err: unknown) {
                console.warn(
                    "[vex-push] background push task registration failed",
                    err instanceof Error ? err.message : String(err),
                );
            }
        };
        void registerBackgroundPushTask();
        return;
    }, []);

    useEffect(() => {
        if (bootstrappedRef.current) {
            return;
        }
        bootstrappedRef.current = true;
        void (async () => {
            try {
                await hydrateLocalMessageRetention();
                const result = await vexService.autoLogin(
                    keychainKeyStore,
                    mobileConfig(),
                    getServerOptions(),
                );
                if (!result.ok && result.requireReauth && result.error) {
                    // Stale credentials were just cleared by the auth flow
                    // (401 expired token, or 404 device/user removed
                    // server-side). Surface the toast so the user has
                    // context for why they're back at the sign-in screen.
                    setAuthNotice(result.error);
                }
                if (!result.ok && result.error) {
                    // Avoid noisy unhandled rejections and keep bootstrap debuggable.
                    console.warn("[vex-auth] autoLogin failed", result.error);
                }
                // Familiars are populated by vexService.populateState() during bootstrap
            } catch (err: unknown) {
                console.warn(
                    "[vex-auth] bootstrap failed",
                    err instanceof Error ? err.message : String(err),
                );
            }
        })();
    }, []);

    const checkForOpeningAppUpdate = useCallback(() => {
        void checkForAppUpdates({ force: true, silent: true }).then((state) => {
            if (!$user.get()) {
                return;
            }
            const notice = appUpdateNoticeForState(state);
            setAppUpdateNotice(notice);
        });
    }, []);

    useEffect(() => {
        if (!userID) {
            setAppUpdateNotice(null);
            return;
        }
        checkForOpeningAppUpdate();
        const subscription = AppState.addEventListener("change", (next) => {
            if (next === "active") {
                checkForOpeningAppUpdate();
            }
        });
        return () => {
            subscription.remove();
        };
    }, [checkForOpeningAppUpdate, userID]);

    // Resilience: retry `autoLogin` on AppState resume when we still
    // don't have a logged-in user.
    //
    // The bootstrap effect above only runs once per process lifetime,
    // so a transient failure at cold start (device offline, server
    // briefly down, captive portal) leaves the user stuck on the auth
    // screen until they manually try to sign in. Repeating the attempt
    // every time the device comes back to foreground papers over the
    // common "I came back from being offline" case automatically.
    //
    // Notes:
    //   - Top-level AppState listener (not gated on `user`), because
    //     the user-gated effects below short-circuit when `user` is
    //     null and we need to act in exactly that case.
    //   - Throttled to once per 30s so a flaky network can't turn
    //     resume-storms into autoLogin-storms.
    //   - `vexService.autoLogin` is internally idempotent (returns
    //     immediately with ok:true if a session already exists), so
    //     it's safe to call even if a competing path has just signed
    //     us in.
    useEffect(() => {
        let lastAttemptAt = 0;
        const RETRY_THROTTLE_MS = 30_000;
        const subscription = AppState.addEventListener("change", (next) => {
            if (next !== "active") {
                return;
            }
            if (!bootstrappedRef.current) {
                // Bootstrap hasn't even started yet (rare race); let
                // it have the first attempt.
                return;
            }
            if ($user.get()) {
                return;
            }
            if (vexService.isAuthFlowInFlight()) {
                // Native auth sheets can resume the app before signup/login
                // has finished setting $user; don't start a competing retry.
                return;
            }
            const now = Date.now();
            if (now - lastAttemptAt < RETRY_THROTTLE_MS) {
                return;
            }
            lastAttemptAt = now;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        void (async () => {
                            try {
                                await hydrateLocalMessageRetention();
                                const result = await vexService.autoLogin(
                                    keychainKeyStore,
                                    mobileConfig(),
                                    getServerOptions(),
                                );
                                if (
                                    !result.ok &&
                                    result.requireReauth &&
                                    result.error
                                ) {
                                    setAuthNotice(result.error);
                                }
                            } catch (err: unknown) {
                                console.warn(
                                    "[vex-auth] resume retry failed",
                                    err instanceof Error
                                        ? err.message
                                        : String(err),
                                );
                            }
                        })();
                    }, 50);
                });
            });
        });
        return () => {
            subscription.remove();
        };
    }, []);

    useEffect(() => {
        if (!authNotice) {
            return;
        }
        const timer = setTimeout(() => {
            setAuthNotice(null);
        }, 6000);
        return () => {
            clearTimeout(timer);
        };
    }, [authNotice]);

    useEffect(() => {
        if (!rateLimitNotice) {
            return;
        }
        const timer = setTimeout(() => {
            setRateLimitNotice(null);
        }, 6000);
        return () => {
            clearTimeout(timer);
        };
    }, [rateLimitNotice]);

    useEffect(() => {
        if (!pendingApprovalNotice) {
            return;
        }
        const timer = setTimeout(() => {
            setPendingApprovalNotice(null);
        }, 7000);
        return () => {
            clearTimeout(timer);
        };
    }, [pendingApprovalNotice]);

    useEffect(() => {
        if (!appUpdateNotice) {
            return;
        }
        const timer = setTimeout(() => {
            setAppUpdateNotice(null);
        }, 8000);
        return () => {
            clearTimeout(timer);
        };
    }, [appUpdateNotice]);

    const maybeShowRateLimitNotice = () => {
        if (!vexService.consumeRateLimitNotice()) {
            return;
        }
        setRateLimitNotice(
            "Server is rate limiting requests. Retrying automatically...",
        );
    };
    const showHydrationGate = user !== null && !hydrationStatus.ready;
    const hydrationPercent =
        hydrationStatus.totalSteps > 0
            ? Math.min(
                  100,
                  Math.round(
                      (hydrationStatus.completedSteps /
                          hydrationStatus.totalSteps) *
                          100,
                  ),
              )
            : 0;
    const hydrationStageLabel =
        hydrationStatus.stage === "loading_channels"
            ? "Loading channels"
            : hydrationStatus.stage === "loading_group_history"
              ? "Loading channel history"
              : hydrationStatus.stage === "loading_familiars"
                ? "Loading familiars"
                : hydrationStatus.stage === "loading_sessions"
                  ? "Loading message history"
                  : "Preparing account";

    useEffect(() => {
        notifiedMailIDsRef.current = new BoundedStringSet(
            NOTIFIED_MAILID_DEDUP_CAP,
        );
        runtimeNotifiedMailIDs.clear();
        notificationHistoryCutoffMsRef.current = Date.now();
    }, [user, user?.userID]);

    useEffect(() => {
        seenPendingRequestIDsRef.current = new Set();
        setPendingApprovalNotice(null);
        // Forget any OS-banner dedupe state from a previous session so
        // a returning user (or post-sign-out re-login) gets a fresh
        // banner for genuinely-new requests on this account.
        clearNotifiedApprovalRequestIDs();
        if (!user?.userID) {
            return;
        }
        let active = true;
        const refreshPendingApprovals = async () => {
            try {
                const requests = await vexService.listPendingDeviceRequests();
                if (!active) {
                    return;
                }
                const pending = requests.filter(
                    (request) => request.status === "pending",
                );
                const nextIDs = new Set(
                    pending.map((request) => request.requestID),
                );
                // Compute the actual list of brand-new requestIDs (rather
                // than just a boolean) so we can post one OS banner per
                // new request without spamming for ones the user has
                // already seen.
                const newRequests = pending.filter(
                    (request) =>
                        !seenPendingRequestIDsRef.current.has(
                            request.requestID,
                        ),
                );
                // Any requestID we previously surfaced an OS banner
                // for that's no longer pending — approved, rejected,
                // or expired — should have its banner dismissed so the
                // user doesn't keep seeing a stale notification for
                // something they've already handled.
                for (const previousID of seenPendingRequestIDsRef.current) {
                    if (!nextIDs.has(previousID)) {
                        void dismissDeviceApprovalNotification(previousID);
                    }
                }
                seenPendingRequestIDsRef.current = nextIDs;
                if (pending.length === 0) {
                    setPendingApprovalNotice(null);
                    return;
                }
                if (newRequests.length > 0) {
                    // Soft tactile cue so the approver notices a fresh
                    // device request even if the toast is partly out of view.
                    Vibration.vibrate([0, 18, 60, 18]);
                    setPendingApprovalNotice({ count: pending.length });
                    // Now that the Android FGS keeps the WS alive while
                    // backgrounded, also post an OS-level banner so the
                    // user is woken up to approve from outside the app.
                    // The notification module dedupes per-process by
                    // requestID, so a watcher refresh that re-observes
                    // the same request can't double-fire.
                    for (const request of newRequests) {
                        void showDeviceApprovalNotification(request.requestID);
                    }
                }
            } catch {
                // ignore request-list errors in toast logic
            }
        };
        void refreshPendingApprovals();
        const unsubscribe = vexService.onDeviceRequestQueueChanged(() => {
            void refreshPendingApprovals();
        });
        return () => {
            active = false;
            unsubscribe();
        };
    }, [user?.userID]);

    useEffect(() => {
        if (!user) {
            return;
        }
        let active = true;
        const pollWhoAmI = async () => {
            if (authProbeInFlightRef.current) {
                return;
            }
            authProbeInFlightRef.current = true;
            try {
                const status = await vexService.probeAuthSession();
                maybeShowRateLimitNotice();
                if (!active) {
                    return;
                }
                if (status === "offline") {
                    if (networkRefreshInFlightRef.current) {
                        return;
                    }
                    networkRefreshInFlightRef.current = true;
                    try {
                        const refreshed =
                            await vexService.refreshSessionAfterForeground();
                        maybeShowRateLimitNotice();
                        if (refreshed !== "unauthorized") {
                            return;
                        }
                        await logoutWithPushNotificationCleanup();
                        setAuthNotice("Session expired. Please sign in again.");
                        return;
                    } finally {
                        networkRefreshInFlightRef.current = false;
                    }
                }
                if (status !== "unauthorized") {
                    return;
                }
                if (networkRefreshInFlightRef.current) {
                    return;
                }
                networkRefreshInFlightRef.current = true;
                try {
                    const refreshed =
                        await vexService.refreshSessionAfterForeground();
                    maybeShowRateLimitNotice();
                    if (refreshed !== "unauthorized") {
                        return;
                    }
                    await logoutWithPushNotificationCleanup();
                    setAuthNotice("Session expired. Please sign in again.");
                } finally {
                    networkRefreshInFlightRef.current = false;
                }
            } catch (err: unknown) {
                console.warn(
                    "[vex-auth] whoami poll failed",
                    err instanceof Error ? err.message : String(err),
                );
            } finally {
                authProbeInFlightRef.current = false;
            }
        };
        void pollWhoAmI();
        const interval = setInterval(() => {
            void pollWhoAmI();
        }, 10_000);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [logoutWithPushNotificationCleanup, user]);

    useEffect(() => {
        if (!user) {
            return;
        }
        let active = true;
        const onResume = async () => {
            if (
                resumeProbeInFlightRef.current ||
                networkRefreshInFlightRef.current
            ) {
                return;
            }
            resumeProbeInFlightRef.current = true;
            networkRefreshInFlightRef.current = true;
            try {
                const status = await vexService.refreshSessionAfterForeground();
                maybeShowRateLimitNotice();
                if (!active || status !== "unauthorized") {
                    return;
                }
                await logoutWithPushNotificationCleanup();
                setAuthNotice("Session expired. Please sign in again.");
            } catch (err: unknown) {
                console.warn(
                    "[vex-auth] app resume refresh failed",
                    err instanceof Error ? err.message : String(err),
                );
            } finally {
                resumeProbeInFlightRef.current = false;
                networkRefreshInFlightRef.current = false;
            }
        };
        const subscription = AppState.addEventListener(
            "change",
            (nextState) => {
                const previous = appStateRef.current;
                appStateRef.current = nextState;
                const resumed =
                    (previous === "background" || previous === "inactive") &&
                    nextState === "active";
                if (resumed) {
                    // Defer the resume probe past the next paint so
                    // the UI thread can finish the activity foreground
                    // transition (unlock animation, layout) before we
                    // start the heavy work (HTTP probe + possible
                    // WebSocket reconnect + inbox sync). Two RAFs
                    // guarantees we're after a committed frame; the
                    // small setTimeout adds a touch more headroom for
                    // slower devices. This is the difference between
                    // "the user sees the chat list pop in" and "the
                    // user sees an ANR dialog because the JS thread
                    // was saturated during the unlock window."
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            setTimeout(() => {
                                // Re-assert the FGS first: if the OS
                                // killed it silently while we were
                                // backgrounded, this brings it back.
                                // Cheap when it's already alive
                                // (idempotent notifee call). Done
                                // before onResume so the watchdog
                                // reset (inside startAlwaysOn) lands
                                // before refreshSessionAfterForeground
                                // reads `isWebsocketLikelyHealthy`.
                                void ensureAlwaysOnRunning();
                                void onResume();
                            }, 50);
                        });
                    });
                }
            },
        );
        return () => {
            active = false;
            subscription.remove();
        };
    }, [logoutWithPushNotificationCleanup, user]);

    // Show local notifications for incoming messages.
    //
    // We deliberately do NOT useStore() the message atoms here:
    //   - This component renders no UI that depends on them.
    //   - useStore() forces a re-render of the App root on every atom
    //     update; during a wake-from-sleep backlog (foreground service
    //     pulling queued mail) that's dozens of full-tree reconciles
    //     in a few hundred ms, on the same JS thread Android wants
    //     responsive for the activity foreground transition.
    //
    // Subscribing directly to the atoms keeps the side effect (queue
    // a notification when a thread grows) without taxing React's
    // render path. The notification queue inside `notifications.ts`
    // serializes the resulting bridge calls so the burst can't
    // saturate the JS thread either way.
    useEffect(() => {
        if (!user) {
            return;
        }
        let prevDms = $messages.get();
        let prevGroups = $groupMessages.get();
        const queueIfNew = (newMsg: Message): void => {
            if (
                notifiedMailIDsRef.current.has(newMsg.mailID) ||
                runtimeNotifiedMailIDs.has(newMsg.mailID)
            ) {
                return;
            }
            notifiedMailIDsRef.current.add(newMsg.mailID);
            runtimeNotifiedMailIDs.add(newMsg.mailID);
            if (
                isHistoricalMessage(
                    newMsg.timestamp,
                    notificationHistoryCutoffMsRef.current,
                )
            ) {
                return;
            }
            void showMessageNotification(newMsg);
        };
        const handleDelta = (
            next: Record<string, Message[]>,
            prev: Record<string, Message[]>,
        ): void => {
            for (const [threadID, thread] of Object.entries(next)) {
                const prevThread = prev[threadID] ?? [];
                if (thread.length <= prevThread.length) {
                    continue;
                }
                const newMsg = thread[thread.length - 1];
                if (!newMsg) {
                    continue;
                }
                queueIfNew(newMsg);
            }
        };
        const unsubDms = $messages.subscribe((next) => {
            const prev = prevDms;
            prevDms = next;
            handleDelta(next, prev);
        });
        const unsubGroups = $groupMessages.subscribe((next) => {
            const prev = prevGroups;
            prevGroups = next;
            handleDelta(next, prev);
        });
        return () => {
            unsubDms();
            unsubGroups();
        };
    }, [user]);

    useEffect(() => {
        if (keyReplaced) {
            // Key was replaced server-side — clear stored credentials and force re-auth
            void clearCredentials();
            // Navigation auto-redirects to Auth via $user becoming null
        }
    }, [keyReplaced]);

    // Drop the foreground service (and its persistent "Connected"
    // notification) on sign-out, and resume it on sign-in if the user
    // had it enabled. The persisted preference (SecureStore) is the
    // source of truth across sign-out/sign-in cycles.
    const userPresentRef = useRef(user != null);
    const previousUserIDRef = useRef<null | string>(userID ?? null);
    useEffect(() => {
        const wasPresent = userPresentRef.current;
        const present = user != null;
        const previousUserID = previousUserIDRef.current;
        userPresentRef.current = present;
        previousUserIDRef.current = userID ?? null;
        if (wasPresent && !present && previousUserID) {
            void unsubscribeStoredPushNotificationSubscription(previousUserID);
        }
        if (!isAlwaysOnSupported()) {
            return;
        }
        if (wasPresent && !present) {
            void suspendAlwaysOn().catch(() => {
                // Best-effort; the service will stop with the process
                // anyway when Android reclaims it.
            });
        }
        if (!wasPresent && present) {
            // User just signed in. Wait for the persisted preference
            // to land (the boot effect kicks off hydration but it's
            // async; autoLogin can complete first), then start the
            // FGS if the user had it enabled.
            void (async () => {
                try {
                    await hydrateAlwaysOnPreference();
                    if ($alwaysOnEnabled.get()) {
                        await startAlwaysOn();
                    }
                } catch (err: unknown) {
                    console.warn(
                        "[vex-fgs] post-login start failed",
                        err instanceof Error ? err.message : String(err),
                    );
                }
            })();
        }
    }, [user, userID]);

    useEffect(() => {
        if (!userID) {
            return;
        }
        void reconcilePushNotificationSubscription();
        flushPendingNotificationRoutes();
    }, [userID]);

    return (
        <SafeAreaProvider>
            <StatusBar barStyle="light-content" />
            {authNotice && (
                <View pointerEvents="none" style={styles.noticeWrap}>
                    <View style={styles.noticeCard}>
                        <Text style={styles.noticeText}>{authNotice}</Text>
                    </View>
                </View>
            )}
            {rateLimitNotice && (
                <View pointerEvents="none" style={styles.rateNoticeWrap}>
                    <View style={styles.rateNoticeCard}>
                        <Text style={styles.rateNoticeText}>
                            {rateLimitNotice}
                        </Text>
                    </View>
                </View>
            )}
            {pendingApprovalNotice && (
                <View style={styles.approvalNoticeWrap}>
                    <Pressable
                        onPress={() => {
                            setPendingApprovalNotice(null);
                            // Land directly on the approval applet — the
                            // intermediate "Devices" menu was added later
                            // and is the wrong target now (one extra tap
                            // before the user can actually approve/deny).
                            navigateToDeviceRequests();
                        }}
                        style={styles.approvalNoticeCard}
                    >
                        <Text style={styles.approvalNoticeTitle}>
                            Device approval requested
                        </Text>
                        <Text style={styles.approvalNoticeText}>
                            {pendingApprovalNotice.count} pending request
                            {pendingApprovalNotice.count === 1 ? "" : "s"}. Tap
                            to review.
                        </Text>
                    </Pressable>
                </View>
            )}
            {appUpdateNotice && (
                <View
                    style={[
                        styles.updateNoticeWrap,
                        pendingApprovalNotice
                            ? styles.updateNoticeWrapStacked
                            : null,
                    ]}
                >
                    <Pressable
                        onPress={() => {
                            setAppUpdateNotice(null);
                            navigateToAboutSettings();
                        }}
                        style={styles.updateNoticeCard}
                    >
                        <View style={styles.updateNoticeIcon}>
                            <Ionicons
                                color="#8DF5B0"
                                name="sparkles-outline"
                                size={18}
                            />
                        </View>
                        <View style={styles.updateNoticeCopy}>
                            <Text style={styles.updateNoticeTitle}>
                                {appUpdateNotice.title}
                            </Text>
                            <Text style={styles.updateNoticeText}>
                                {appUpdateNotice.message}
                            </Text>
                        </View>
                    </Pressable>
                </View>
            )}
            <NavigationContainer
                onReady={() => {
                    flushPendingNotificationRoutes();
                    flushPendingInviteRoute();
                    flushPendingShareRoute();
                }}
                ref={navigationRef}
                theme={{
                    colors: {
                        background: colors.bg,
                        border: colors.borderSubtle,
                        card: colors.card,
                        notification: colors.error,
                        primary: colors.accentMuted,
                        text: colors.textSecondary,
                    },
                    dark: true,
                    fonts: {
                        bold: {
                            fontFamily: fontFamilies.heading,
                            fontWeight: "500",
                        },
                        heavy: {
                            fontFamily: fontFamilies.heading,
                            fontWeight: "500",
                        },
                        medium: {
                            fontFamily: fontFamilies.body,
                            fontWeight: "500",
                        },
                        regular: {
                            fontFamily: fontFamilies.mono,
                            fontWeight: "300",
                        },
                    },
                }}
            >
                <RootNavigator />
            </NavigationContainer>
            {showHydrationGate && (
                <View style={styles.hydrationGate}>
                    <View
                        pointerEvents="none"
                        style={styles.hydrationGlowTop}
                    />
                    <View
                        pointerEvents="none"
                        style={styles.hydrationGlowBottom}
                    />
                    <View style={styles.hydrationCard}>
                        <Text style={styles.hydrationTitle}>
                            Setting up your account
                        </Text>
                        <Text style={styles.hydrationSubtitle}>
                            {hydrationStageLabel}
                        </Text>
                        <View style={styles.hydrationTrack}>
                            <View style={styles.hydrationTrackGlow} />
                            <View
                                style={[
                                    styles.hydrationFill,
                                    { width: `${hydrationPercent}%` },
                                ]}
                            />
                        </View>
                        <Text style={styles.hydrationPercent}>
                            {hydrationPercent}% complete
                        </Text>
                    </View>
                </View>
            )}
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    approvalNoticeCard: {
        backgroundColor: "rgba(26, 42, 33, 0.97)",
        borderColor: "rgba(74, 222, 128, 0.4)",
        borderRadius: 10,
        borderWidth: 1,
        maxWidth: 420,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    approvalNoticeText: {
        color: "rgba(224,255,236,0.9)",
        fontSize: 12,
        marginTop: 2,
    },
    approvalNoticeTitle: {
        color: "#B5F5CD",
        fontSize: 13,
        fontWeight: "700",
    },
    approvalNoticeWrap: {
        alignItems: "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 98,
        zIndex: 998,
    },
    hydrationCard: {
        backgroundColor: "rgba(24, 30, 44, 0.46)",
        borderColor: "rgba(198, 221, 255, 0.26)",
        borderRadius: 16,
        borderWidth: 1,
        gap: 8,
        maxWidth: 420,
        paddingHorizontal: 18,
        paddingVertical: 16,
        shadowColor: "#6AB5FF",
        shadowOffset: { height: 0, width: 0 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
        width: "88%",
    },
    hydrationFill: {
        backgroundColor: "rgba(138, 214, 255, 0.88)",
        borderRadius: 999,
        height: "100%",
        shadowColor: "#7AD4FF",
        shadowOffset: { height: 0, width: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 14,
    },
    hydrationGate: {
        alignItems: "center",
        backgroundColor: "rgba(8, 10, 14, 0.92)",
        bottom: 0,
        justifyContent: "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
        zIndex: 1200,
    },
    hydrationGlowBottom: {
        backgroundColor: colors.accent,
        borderRadius: 140,
        bottom: -42,
        height: 160,
        left: "18%",
        opacity: 0.1,
        position: "absolute",
        width: 160,
    },
    hydrationGlowTop: {
        backgroundColor: colors.accent,
        borderRadius: 170,
        height: 180,
        opacity: 0.12,
        position: "absolute",
        right: -64,
        top: -70,
        width: 180,
    },
    hydrationPercent: {
        color: "#C6E8FF",
        fontSize: 12,
        fontWeight: "600",
    },
    hydrationSubtitle: {
        color: "#DCF1FF",
        fontSize: 14,
        fontWeight: "500",
    },
    hydrationTitle: {
        color: "#F2F8FF",
        fontSize: 17,
        fontWeight: "700",
    },
    hydrationTrack: {
        backgroundColor: "rgba(223, 243, 255, 0.2)",
        borderColor: "rgba(255,255,255,0.25)",
        borderRadius: 999,
        borderWidth: 1,
        height: 8,
        marginTop: 6,
        overflow: "hidden",
        width: "100%",
    },
    hydrationTrackGlow: {
        backgroundColor: "rgba(138, 214, 255, 0.22)",
        bottom: -1,
        left: 0,
        position: "absolute",
        right: 0,
        top: -1,
    },
    noticeCard: {
        backgroundColor: "rgba(36, 40, 50, 0.96)",
        borderColor: "rgba(255,255,255,0.16)",
        borderRadius: 10,
        borderWidth: 1,
        maxWidth: 420,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    noticeText: {
        color: "#E7EAF1",
        fontSize: 13,
        fontWeight: "600",
    },
    noticeWrap: {
        alignItems: "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 54,
        zIndex: 999,
    },
    rateNoticeCard: {
        backgroundColor: "rgba(73, 55, 20, 0.96)",
        borderColor: "rgba(255, 205, 99, 0.38)",
        borderRadius: 10,
        borderWidth: 1,
        maxWidth: 460,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    rateNoticeText: {
        color: "#FFE7AE",
        fontSize: 13,
        fontWeight: "600",
    },
    rateNoticeWrap: {
        alignItems: "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 54,
        zIndex: 1000,
    },
    updateNoticeCard: {
        alignItems: "center",
        backgroundColor: "rgba(18, 34, 26, 0.97)",
        borderColor: "rgba(74, 222, 128, 0.42)",
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: "row",
        gap: 10,
        maxWidth: 440,
        paddingHorizontal: 14,
        paddingVertical: 11,
        shadowColor: "#4ADE80",
        shadowOffset: { height: 0, width: 0 },
        shadowOpacity: 0.18,
        shadowRadius: 18,
        width: "90%",
    },
    updateNoticeCopy: {
        flex: 1,
        gap: 2,
    },
    updateNoticeIcon: {
        alignItems: "center",
        backgroundColor: "rgba(74, 222, 128, 0.14)",
        borderColor: "rgba(74, 222, 128, 0.46)",
        borderRadius: 999,
        borderWidth: 1,
        height: 34,
        justifyContent: "center",
        width: 34,
    },
    updateNoticeText: {
        color: "rgba(224,255,236,0.86)",
        fontSize: 12,
    },
    updateNoticeTitle: {
        color: "#B5F5CD",
        fontSize: 13,
        fontWeight: "700",
    },
    updateNoticeWrap: {
        alignItems: "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 98,
        zIndex: 997,
    },
    updateNoticeWrapStacked: {
        top: 164,
    },
});

export default MainApp;

function appUpdateNoticeForState(
    state: AppUpdateState,
): AppUpdateNotice | null {
    switch (state.status) {
        case "apk_available":
            return {
                message: "A new APK is ready. Tap to open the updater.",
                title: "App update available",
            };
        case "ota_available":
            return {
                message: state.latestCommit?.shortSha
                    ? `Version ${state.latestCommit.shortSha} is ready. Tap to install.`
                    : "A compatible OTA update is ready. Tap to install.",
                title: "OTA update available",
            };
        case "ota_ready":
            return {
                message:
                    "Restart Vex to finish installing the downloaded update.",
                title: "Update ready",
            };
        default:
            return null;
    }
}

function isHistoricalMessage(
    timestamp: string,
    notificationCutoffMs: number,
): boolean {
    const messageMs = Date.parse(timestamp);
    if (!Number.isFinite(messageMs)) {
        return false;
    }
    return messageMs <= notificationCutoffMs;
}

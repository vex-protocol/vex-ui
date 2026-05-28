/**
 * VexService — the sole gateway between UI components and the Vex protocol.
 *
 * Privately owns the Client instance. Components never access Client directly.
 * All state mutations go through this service → writable atoms.
 * Components subscribe to readonly atom exports from domains/.
 */
import type {
    Channel,
    ClientEvents,
    ClientOptions,
    Device,
    Invite,
    KeyStore,
    Message,
    Passkey,
    Permission,
    Server,
    Storage,
    StoredCredentials,
    User,
} from "@vex-chat/libvex";
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
} from "@vex-chat/types";

import { Client, msgpack } from "@vex-chat/libvex";

import { validate as uuidValidate } from "uuid";

import {
    $authStatusWritable,
    $avatarHashWritable,
    $avatarVersionsWritable,
    $devicesWritable,
    $familiarsWritable,
    $historyRecoveryStatusWritable,
    $hydrationStatusWritable,
    $keyReplacedWritable,
    $pendingApprovalStageWritable,
    $signedOutIntentWritable,
    $userWritable,
} from "./domains/identity.ts";
import {
    $channelUnreadCountsWritable,
    $dmUnreadCountsWritable,
    $groupMessagesWritable,
    $messagesWritable,
} from "./domains/messaging.ts";
import {
    $channelsWritable,
    $onlineListsWritable,
    $permissionsWritable,
    $serversWritable,
} from "./domains/servers.ts";
import {
    $localMessageRetentionDaysWritable,
    clampLocalMessageRetentionDays,
    setLocalMessageRetentionDaysPreference,
} from "./domains/settings.ts";
import {
    applyMessageDeleteEvent,
    applyMessageReactionEvent,
    applyMessageUpdateEvent,
    createDeleteBatchEventExtra,
    createDeleteEventExtra,
    createReactionEventExtra,
    createUpdateEventExtra,
    type EncryptedFileAttachment,
    foldMessageEvents,
    messageDeleteEvent,
    messageDeleteEventTargetMailIDs,
    type MessageEmoji,
    messageReactionEvent,
    messageUpdateEvent,
} from "./message-utils.ts";

// ── Public types ────────────────────────────────────────────────────────────

export type AuthProbeStatus = "authenticated" | "offline" | "unauthorized";
/** Result from any auth flow. */
export interface AuthResult {
    error?: string;
    keyReplaced?: boolean;
    ok: boolean;
    /**
     * Set when signup created the account/device, but the required first
     * passkey did not finish. Credentials have been saved so callers should
     * retry auth/passkey setup instead of submitting another registration.
     */
    passkeySetupRequired?: boolean;
    pendingDeviceApproval?: boolean;
    pendingRequestID?: string;
    /**
     * The new device's own public signing key (hex). Provided so the
     * AuthenticateScreen can render the same matching code on both the
     * new and the approving device — both derive it from these bytes
     * (the new device from `client.getKeys().public`, the approver from
     * the request payload's `signKey`).
     */
    pendingSignKey?: string;
    /**
     * Existing user's ID when registration hit a "username already
     * taken" branch. Lets the UI fetch the public avatar from the
     * unauthenticated `/avatar/:userID` endpoint to power an
     * "is this you?" confirmation. Optional because older servers
     * don't include it in the pending response.
     */
    pendingUserID?: string;
    /**
     * Set when the server reported that our stored credentials no longer
     * authenticate (401 from `/auth/device*` for an expired session, or
     * 404 when the device record / its owning user has been deleted
     * server-side). The auth flow has already cleared the offending
     * keychain entry and reset auth state; the caller's job is just to
     * route the user back into the sign-in flow rather than surface a
     * retry-able error. App.tsx uses this to drive the "Session expired"
     * toast; HangTightScreen uses it to skip its own error phase and go
     * straight to the account picker / handle form.
     */
    requireReauth?: boolean;
}

export type BackgroundNetworkFetchResult = "failed" | "new_data" | "no_data";

/** App-provided platform configuration for client bootstrap. */
export interface BootstrapConfig {
    /**
     * Open (or create) per-identity local storage. Platforms compose the
     * final file path from `username` + the configured server host so each
     * identity on each server owns an isolated encrypted DB. Switching
     * between identities is non-destructive; sealed columns stay paired
     * with the deviceKey that encrypted them.
     */
    createStorage(privateKey: string, username: string): Promise<Storage>;
    deviceName: string;
}

export interface CreateServerResult extends OperationResult {
    channelID?: string;
    channelName?: string;
    serverID?: string;
    serverName?: string;
}

export interface DeviceApprovalRequest {
    approvedDeviceID?: string;
    createdAt: string;
    deviceName: string;
    error?: string;
    expiresAt: string;
    requestID: string;
    signKey: string;
    status: "approved" | "expired" | "pending" | "rejected";
    username: string;
}

export interface InvitePreview {
    channels: Channel[];
    invite: Invite;
    server: null | Server;
}

export interface JoinInviteResult extends OperationResult {
    channelID?: string;
    channelName?: string;
    serverID?: string;
    serverName?: string;
}

/** Result from any mutation operation. */
export interface OperationResult {
    error?: string;
    ok: boolean;
}

export interface PasskeyCeremonyDriver {
    authenticate(
        options: PublicKeyCredentialRequestOptionsJSON,
    ): Promise<Record<string, unknown>>;
    register(
        options: PublicKeyCredentialCreationOptionsJSON,
    ): Promise<Record<string, unknown>>;
}

export interface PasskeyDeviceRestoreResult extends OperationResult {
    recoveredDeviceID?: string;
}

/**
 * Result of {@link VexService.beginPasskeySignIn}. Hands back the
 * options the host needs to drive the platform WebAuthn ceremony,
 * plus the `requestID` that ties the assertion in
 * {@link VexService.finishPasskeySignIn} back to the same begin call.
 */
export interface PasskeySignInBegin {
    options: PublicKeyCredentialRequestOptionsJSON;
    requestID: string;
}

export interface PushNotificationSubscriptionInput {
    channel: "expo";
    events?: string[];
    platform?: "android" | "ios" | "web";
    token: string;
}

export type ResumeNetworkStatus = "signed_out" | AuthProbeStatus;

export interface SendMessageOptions {
    extra?: null | string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Server connection options — identical across all auth flows. */
export interface ServerOptions {
    host: string;
    inMemoryDb?: boolean;
    /**
     * Local message retention in days (1–30). Values above 30 are clamped
     * by the protocol client to match server-side mail TTL.
     */
    localMessageRetentionDays?: number;
    logLevel?:
        | "debug"
        | "error"
        | "http"
        | "info"
        | "silly"
        | "verbose"
        | "warn";
    unsafeHttp?: boolean;
}

export interface SessionInfo {
    authStatus:
        | "authenticated"
        | "checking"
        | "offline"
        | "signed_out"
        | "unauthorized";
    deviceID: string;
    tokenExp?: number;
    tokenExpiresAt?: string;
    tokenRemainingHours?: number;
    userID: string;
    username: string;
}

export interface ThreadDeleteForEveryoneResult extends OperationResult {
    batchCount?: number;
    deletedCount?: number;
    localDeleted?: boolean;
}

interface ClientHttpLike {
    get?: (...args: unknown[]) => Promise<unknown>;
    post?: (...args: unknown[]) => Promise<unknown>;
}

type ClientWithDeviceApprovals = Omit<Client, "devices"> & {
    devices: DevicesWithApprovalLike;
};

interface ClientWithInternalHttp {
    http?: ClientHttpLike;
}

interface ClientWithLocalDatabaseLike {
    database?: {
        deleteMessage?: (mailID: string) => Promise<void>;
        saveMessage?: (message: Message) => Promise<void>;
        updateMessage?: (
            mailID: string,
            patch: { extra?: null | string | undefined; message?: string },
        ) => Promise<boolean>;
    };
}

interface ClientWithMessageExtraLike {
    messages: {
        group: (
            channelID: string,
            message: string,
            opts?: { extra?: null | string; retentionHintDays?: number },
        ) => Promise<void>;
        send: (
            userID: string,
            message: string,
            opts?: { extra?: null | string; retentionHintDays?: number },
        ) => Promise<void>;
    };
}

interface ClientWithNotificationSubscriptionsLike {
    subscribeNotifications?: unknown;
    unsubscribeNotifications?: unknown;
}

interface ClientWithPushNotificationFallback extends ClientWithInternalHttp {
    getHost?: () => string;
    me?: {
        device?: () => {
            deviceID?: unknown;
        };
    };
}

interface ClientWithServerChannelBootstrapLike {
    servers?: ServersWithBootstrapLike;
}

interface ClientWithSocketLike {
    socket?: unknown;
}

interface ClientWithSyncInboxLike {
    syncInboxNow?: unknown;
}

interface ClientWithUserDeviceListLike {
    getUserDeviceList?: (userID: string) => Promise<Device[] | null>;
}

interface DevicesWithApprovalLike {
    abortPendingRegistration?: (args: {
        challenge: string;
        requestID: string;
    }) => Promise<unknown>;
    approveRequest?: (requestID: string) => Promise<unknown>;
    beginPendingPasskeyRegistration?: (args: {
        challenge: string;
        name: string;
        requestID: string;
    }) => Promise<{
        options: unknown;
        requestID: string;
    }>;
    delete: (deviceID: string) => Promise<void>;
    finishPendingPasskeyRegistration?: (args: {
        challenge: string;
        name: string;
        requestID: string;
        response: Record<string, unknown>;
    }) => Promise<Passkey>;
    getRequest?: (requestID: string) => Promise<DeviceApprovalRequest | null>;
    listRequests?: () => Promise<DeviceApprovalRequest[]>;
    pollPendingRegistration?: (args: {
        challenge: string;
        requestID: string;
    }) => Promise<DeviceApprovalRequest | null>;
    publishPendingRegistration?: (args: {
        challenge: string;
        requestID: string;
    }) => Promise<unknown>;
    register: () => Promise<unknown>;
    rejectRequest?: (requestID: string) => Promise<unknown>;
    retrieve: (
        deviceIdentifier: string,
    ) => Promise<null | { deviceID: string }>;
}

interface HttpErrorLike {
    response: { data?: unknown; status: number };
}

interface MessageMapWritableLike {
    get: () => Record<string, Message[]>;
    setKey: (key: string, messages: Message[]) => void;
}

interface NotificationSubscriptionLike {
    subscriptionID: string;
}

type PasskeySessionState = "authenticated" | "not_registered" | "unavailable";

interface PendingMessageEventMessage {
    attempts: number;
    message: Message;
    queuedAt: number;
}

interface PendingReactionMessage {
    attempts: number;
    message: Message;
    queuedAt: number;
}

interface ServerChannelBootstrapLike {
    channelsByServer: Record<string, Channel[]>;
    servers: Server[];
}

interface ServersWithBootstrapLike {
    retrieveWithChannels?: () => Promise<ServerChannelBootstrapLike>;
}

interface WebSocketDebugLike {
    off(event: "message", listener: (data: Uint8Array) => void): void;
    on(event: "message", listener: (data: Uint8Array) => void): void;
    send(data: Uint8Array): void;
}

const REGISTER_STEP_TIMEOUT_MS = 12000;
const PASSKEY_SETUP_TIMEOUT_MS = 5 * 60 * 1000;
const DEVICE_AUTH_REFRESH_THRESHOLD_MS = 6 * 24 * 60 * 60 * 1000;
const DEVICE_AUTH_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOCAL_DECRYPT_RECOVERY_ERROR =
    "Local encrypted data could not be recovered on this device. Please sign in again.";
// WebSocket watchdog: spire pings every 5s, libvex's own keep-alive
// fires after ~30s of silence (post-fix in 6.1.7+). 45s gives that
// path a chance to run first; the watchdog only triggers if libvex's
// detector didn't (older SDK, or some edge case where it didn't).
const WS_WATCHDOG_CHECK_INTERVAL_MS = 30_000;
const WS_WATCHDOG_STALE_THRESHOLD_MS = 45_000;
// Tighter threshold for "is the socket *currently* delivering frames?"
// used by `refreshSessionAfterForeground` to decide whether the
// foreground-service kept the connection healthy across the resume.
// Server pings land every 5s, so a frame within the last 12s is a
// strong signal we don't need to tear the socket down. Anything older
// is treated as stale → full reconnect.
const WS_FRESH_FRAME_THRESHOLD_MS = 12_000;
const MAX_PROCESSED_REACTION_MAIL_IDS = 2_000;
const MAX_PENDING_REACTION_CONVERSATIONS = 100;
const MAX_PENDING_REACTION_MESSAGES_PER_CONVERSATION = 200;
const MAX_PENDING_REACTION_APPLY_ATTEMPTS = 20;
const PENDING_REACTION_MESSAGE_TTL_MS = 5 * 60 * 1000;
const MAX_PROCESSED_MESSAGE_EVENT_MAIL_IDS = MAX_PROCESSED_REACTION_MAIL_IDS;
const MAX_PENDING_MESSAGE_EVENT_CONVERSATIONS =
    MAX_PENDING_REACTION_CONVERSATIONS;
const MAX_PENDING_MESSAGE_EVENT_MESSAGES_PER_CONVERSATION =
    MAX_PENDING_REACTION_MESSAGES_PER_CONVERSATION;
const MAX_PENDING_MESSAGE_EVENT_APPLY_ATTEMPTS =
    MAX_PENDING_REACTION_APPLY_ATTEMPTS;
const PENDING_MESSAGE_EVENT_TTL_MS = PENDING_REACTION_MESSAGE_TTL_MS;
const MESSAGE_DELETE_EVENT_BATCH_SIZE = 50;

class Disposable {
    private fns: Array<() => void> = [];

    add(fn: () => void): void {
        this.fns.push(fn);
    }

    dispose(): void {
        const fns = this.fns;
        this.fns = [];
        for (const fn of fns) {
            try {
                fn();
            } catch (e: unknown) {
                console.error("[vex-store] disposer threw", e);
            }
        }
    }
}

class VexService {
    private activePendingDeviceApproval: null | {
        approvedDeviceID?: string;
        challenge: null | string;
        deviceKey: string;
        deviceName: string;
        keyStore: KeyStore;
        requestID: string;
        username: string;
    } = null;
    private authFlowInFlightCount = 0;
    private autoLoginInFlight: null | Promise<AuthResult> = null;
    private backgroundConnectionRecoverySuspended = false;
    private client: Client | null = null;
    private connectionRecoveryInFlight = false;
    /**
     * Populated when `register()` hits "username taken" and the server
     * created a deferred enrollment (no owner push until
     * {@link publishDeferredDeviceApprovalAndStartWatching}).
     */
    private deferredDeviceApproval: null | {
        challenge: string;
        deviceKey: string;
        deviceName: string;
        keyStore: KeyStore;
        requestID: string;
        username: string;
    } = null;
    private readonly deviceRequestQueueListeners = new Set<() => void>();
    private readonly disposable = new Disposable();
    private readonly failedUserLookups = new Set<string>();
    private readonly invitePreviewCache = new Map<
        string,
        Promise<InvitePreview | null>
    >();
    private lastConnectionRecoveryAt = 0;
    private lastDeviceAuthRefreshAttemptAt = 0;
    private logoutInFlight: null | Promise<void> = null;
    private passkeyCeremonyDriver: null | PasskeyCeremonyDriver = null;
    private pendingApprovalWatchCancel: (() => void) | null = null;
    private readonly pendingMessageEventMessages = new Map<
        string,
        Map<string, PendingMessageEventMessage>
    >();
    private pendingRateLimitNotice = false;
    private readonly pendingReactionMessages = new Map<
        string,
        Map<string, PendingReactionMessage>
    >();
    /**
     * When true, {@link runPopulateStateBody} stops scheduling more history
     * loads so {@link close} can shut SQLite without racing decrypt threads.
     */
    private populateStateAbort = false;
    private populateStateInFlight: null | Promise<void> = null;
    private readonly processedMessageEventMailIDs = new Set<string>();
    private readonly processedReactionMailIDs = new Set<string>();
    private wsDebugEnabled = shouldDebugAuth();
    private wsDebugFrameLogsEnabled = shouldDebugAuth();
    private wsDebugInboundListener: ((data: Uint8Array) => void) | null = null;
    private wsDebugOriginalSend: ((data: Uint8Array) => void) | null = null;
    private wsDebugSocket: null | WebSocketDebugLike = null;
    private wsDebugStateLogsEnabled = shouldDebugAuth();
    // Watchdog state. Tracks the last time *any* inbound frame
    // (including server pings every 5s) arrived on the underlying
    // WebSocket. If the gap exceeds {@link WS_WATCHDOG_STALE_THRESHOLD_MS}
    // we force a reconnect — backstop for half-open sockets where
    // neither libvex's ping detector nor the OS surfaces a close event
    // (Android emulator NAT timeouts, sleeping mobile radios).
    private wsWatchdogInterval: null | ReturnType<typeof setInterval> = null;
    private wsWatchdogLastFrameAt = 0;
    private wsWatchdogListener: ((data: Uint8Array) => void) | null = null;
    private wsWatchdogSocket: null | WebSocketDebugLike = null;

    // ── Auth flows ──────────────────────────────────────────────────────

    /**
     * Deletes a deferred enrollment on the server before any owner
     * notification (user said the account wasn't theirs).
     */
    async abortDeferredDeviceApproval(): Promise<void> {
        const d = this.deferredDeviceApproval;
        if (!d) {
            return;
        }
        const client = this.client;
        if (!client) {
            this.deferredDeviceApproval = null;
            return;
        }
        const abort = (client as unknown as ClientWithDeviceApprovals).devices
            .abortPendingRegistration;
        if (typeof abort !== "function") {
            this.deferredDeviceApproval = null;
            return;
        }
        try {
            await abort({
                challenge: d.challenge,
                requestID: d.requestID,
            });
        } catch {
            /* row may already be gone */
        }
        this.deferredDeviceApproval = null;
    }

    async approveDeviceRequest(requestID: string): Promise<OperationResult> {
        let shouldRestoreDeviceSession = false;
        try {
            const client = this.requireClient();
            const withApprovals =
                client as unknown as ClientWithDeviceApprovals;
            if (!withApprovals.devices.approveRequest) {
                return {
                    error: "Client does not support device approvals yet.",
                    ok: false,
                };
            }
            const username = this.currentClientUsername();
            const passkeyState =
                await this.satisfyPasskeyForCurrentClient(username);
            if (passkeyState === "unavailable") {
                return {
                    error: "Passkeys aren't available on this device.",
                    ok: false,
                };
            }
            if (passkeyState === "not_registered") {
                return {
                    error: "Add a passkey before approving another device.",
                    ok: false,
                };
            }

            shouldRestoreDeviceSession = true;
            await withApprovals.devices.approveRequest(requestID);
            const restoreErr = await this.loginWithDeviceKeyWithRetry(client);
            if (restoreErr) {
                debugAuth("deviceApproval:restoreDeviceSession:failed", {
                    message: errorMessage(restoreErr),
                    requestID,
                });
                return {
                    error: `Device approved, but this device could not restore its session: ${errorMessage(restoreErr)}`,
                    ok: false,
                };
            }
            return { ok: true };
        } catch (err: unknown) {
            if (shouldRestoreDeviceSession && this.client) {
                const restoreErr = await this.loginWithDeviceKeyWithRetry(
                    this.client,
                );
                if (restoreErr) {
                    debugAuth("deviceApproval:restoreAfterFailure:failed", {
                        message: errorMessage(restoreErr),
                        requestID,
                    });
                }
            }
            return { error: errorMessage(err), ok: false };
        }
    }

    /**
     * Auto-login from stored credentials → connect.
     * Returns { ok: false } if no credentials found.
     */
    async autoLogin(
        keyStore: KeyStore,
        config: BootstrapConfig,
        options: ServerOptions,
    ): Promise<AuthResult> {
        if (this.autoLoginInFlight) {
            return this.autoLoginInFlight;
        }
        // An autoLogin attempt is intentional re-auth; clear the explicit
        // sign-out intent so subsequent flows behave normally.
        $signedOutIntentWritable.set(false);
        const run = async (): Promise<AuthResult> => {
            if (
                this.client &&
                $userWritable.get() !== null &&
                $authStatusWritable.get() === "authenticated"
            ) {
                debugAuth("autoLogin:skip:already-authenticated", {
                    host: options.host,
                });
                return { ok: true };
            }
            this.setAuthStatus("checking");
            debugAuth("autoLogin:start", { host: options.host });
            let creds;
            try {
                creds = await keyStore.load();
            } catch (loadErr: unknown) {
                return { error: errorMessage(loadErr), ok: false };
            }
            if (!creds) {
                this.setAuthStatus("signed_out");
                return { ok: false };
            }

            try {
                await this.initClient(
                    creds.deviceKey,
                    creds.username,
                    config,
                    options,
                );
                debugAuth("autoLogin:initClient:ok", {
                    host: options.host,
                    username: creds.username,
                });
                const client = this.requireClient();

                const { authErr, passkeyState } =
                    await this.loginWithDeviceKeyWithPasskeyRetry(
                        client,
                        creds.username,
                        creds.deviceID,
                    );
                if (authErr) {
                    await this.close();
                    if (isStaleCredentialError(authErr)) {
                        debugAuth(
                            "autoLogin:stale-credentials:clearingCredentials",
                            {
                                status: hasHttpStatus(authErr)
                                    ? authErr.response.status
                                    : null,
                                username: creds.username,
                            },
                        );
                        await this.clearStoredCredentials(
                            keyStore,
                            creds.username,
                        );
                        this.setAuthStatus("unauthorized");
                        return {
                            error: "Session expired. Please sign in again.",
                            ok: false,
                            requireReauth: true,
                        };
                    }
                    return { error: errorMessage(authErr), ok: false };
                }

                if (passkeyState === "not_registered") {
                    await this.registerInitialPasskeyForCurrentClient(
                        config.deviceName || "This device",
                    );
                }

                const connectStart = Date.now();
                await client.connect();
                debugAuth("autoLogin:connect:ok", {
                    durationMs: Date.now() - connectStart,
                    username: creds.username,
                });
                $userWritable.set(client.me.user());
                this.setAuthStatus("authenticated");
                this.kickPopulateState();
                return { ok: true };
            } catch (err: unknown) {
                if (isDecryptMismatchError(err)) {
                    debugAuth("autoLogin:decrypt-mismatch:recover:start", {
                        username: creds.username,
                    });
                    try {
                        await this.initClient(
                            creds.deviceKey,
                            creds.username,
                            config,
                            options,
                            true,
                        );
                        const recovered = this.requireClient();
                        const { authErr, passkeyState } =
                            await this.loginWithDeviceKeyWithPasskeyRetry(
                                recovered,
                                creds.username,
                                creds.deviceID,
                            );
                        if (authErr) {
                            await this.close();
                            if (isStaleCredentialError(authErr)) {
                                debugAuth(
                                    "autoLogin:decrypt-mismatch:recover:stale-credentials:clearingCredentials",
                                    {
                                        status: hasHttpStatus(authErr)
                                            ? authErr.response.status
                                            : null,
                                        username: creds.username,
                                    },
                                );
                                await this.clearStoredCredentials(
                                    keyStore,
                                    creds.username,
                                );
                                this.setAuthStatus("unauthorized");
                                return {
                                    error: "Session expired. Please sign in again.",
                                    ok: false,
                                    requireReauth: true,
                                };
                            }
                            return {
                                error: errorMessage(authErr),
                                ok: false,
                            };
                        }

                        if (passkeyState === "not_registered") {
                            await this.registerInitialPasskeyForCurrentClient(
                                config.deviceName || "This device",
                            );
                        }

                        await recovered.connect();
                        $userWritable.set(recovered.me.user());
                        this.setAuthStatus("authenticated");
                        this.kickPopulateState();
                        debugAuth("autoLogin:decrypt-mismatch:recover:ok", {
                            username: creds.username,
                        });
                        return { ok: true };
                    } catch (recoveryErr: unknown) {
                        if (isPasskeySetupRequiredError(recoveryErr)) {
                            return {
                                error: initialPasskeySetupErrorMessage(
                                    recoveryErr,
                                ),
                                ok: false,
                                passkeySetupRequired: true,
                            };
                        }
                        try {
                            await this.close();
                        } catch {
                            /* ignore close errors */
                        }
                        debugAuth("autoLogin:decrypt-mismatch:recover:failed", {
                            message: errorMessage(recoveryErr),
                            username: creds.username,
                        });
                        return {
                            error: LOCAL_DECRYPT_RECOVERY_ERROR,
                            ok: false,
                        };
                    }
                }
                if (isPasskeySetupRequiredError(err)) {
                    return {
                        error: initialPasskeySetupErrorMessage(err),
                        ok: false,
                        passkeySetupRequired: true,
                    };
                }
                try {
                    await this.close();
                } catch {
                    /* ignore close errors */
                }
                if (isStaleCredentialError(err)) {
                    debugAuth(
                        "autoLogin:catch:stale-credentials:clearingCredentials",
                        {
                            status: hasHttpStatus(err)
                                ? err.response.status
                                : null,
                            username: creds.username,
                        },
                    );
                    await this.clearStoredCredentials(keyStore, creds.username);
                    this.setAuthStatus("unauthorized");
                    return {
                        error: "Session expired. Please sign in again.",
                        ok: false,
                        requireReauth: true,
                    };
                }
                if (isNetworkError(err)) {
                    this.setAuthStatus("offline");
                }
                if ($keyReplacedWritable.get()) {
                    return { keyReplaced: true, ok: false };
                }
                return { error: errorMessage(err), ok: false };
            }
        };
        this.authFlowInFlightCount += 1;
        this.autoLoginInFlight = run();
        try {
            return await this.autoLoginInFlight;
        } finally {
            this.autoLoginInFlight = null;
            this.authFlowInFlightCount = Math.max(
                0,
                this.authFlowInFlightCount - 1,
            );
        }
    }

    /**
     * Begin a passkey-registration ceremony for the currently
     * signed-in user. Returns the WebAuthn options the host should
     * pass to the platform ceremony. Pair with
     * {@link finishPasskeyRegistration} once the user has approved
     * on their authenticator.
     */
    async beginPasskeyRegistration(name: string): Promise<{
        options: PublicKeyCredentialCreationOptionsJSON;
        requestID: string;
    }> {
        const client = this.requireClient();
        const begin = await client.passkeys.beginRegistration(name);
        return {
            options: begin.options as PublicKeyCredentialCreationOptionsJSON,
            requestID: begin.requestID,
        };
    }

    /**
     * Begin a passkey authentication ceremony. Stage one of the
     * recovery flow: the host drives the platform WebAuthn ceremony
     * with the returned options, then hands the assertion back via
     * {@link finishPasskeySignIn}.
     *
     * Boots a fresh, unauthenticated client against the supplied
     * server (no device login, no storage). The username doesn't
     * have to match anything on this device — the user is asserting
     * "I'm @username, here's a passkey that proves it".
     */
    async beginPasskeySignIn(
        username: string,
        config: BootstrapConfig,
        options: ServerOptions,
    ): Promise<PasskeySignInBegin> {
        const trimmed = username.trim();
        if (trimmed.length === 0) {
            throw new Error("Enter the username for your account.");
        }
        // Fresh client with a throwaway key — we never call
        // loginWithDeviceKey on it. The HTTP transport is what we
        // need; the device key just gives the constructor something
        // to seal storage with.
        const privateKey = Client.generateSecretKey();
        await this.initClient(privateKey, trimmed, config, options, true);
        const client = this.requireClient();
        const begin = await client.passkeys.beginAuthentication(trimmed);
        return {
            options: begin.options as PublicKeyCredentialRequestOptionsJSON,
            requestID: begin.requestID,
        };
    }

    /**
     * Zero-input bootstrap flow used on app startup:
     * 1) attempt device-key auto-login from local credentials
     * 2) if no credentials exist, auto-provision a fresh key cluster/device
     */
    async bootstrapAuth(
        keyStore: KeyStore,
        config: BootstrapConfig,
        options: ServerOptions,
    ): Promise<AuthResult> {
        const existing = await this.autoLogin(keyStore, config, options);
        if (existing.ok) {
            return existing;
        }
        // Only auto-provision when there is no local credential material.
        if (existing.error) {
            return existing;
        }

        const autoUsername = generateAutoProvisionUsername();
        return this.register(autoUsername, "", config, options, keyStore);
    }

    /**
     * Cancels a pending device-approval handshake that was started by
     * `register()` after discovering the username was already taken.
     *
     * This is called when the user, on the "Is this you?" confirmation
     * screen, picks "no — different name". We stop polling the server
     * locally and reset the approval stage to "idle" so the auth UI
     * doesn't show stale "waiting for approval" state.
     *
     * Note: the request itself still exists server-side until its TTL
     * expires (a few minutes). We can't reject it from here because the
     * new (unauthenticated) device doesn't own a token capable of
     * touching the protected `/users/:id/devices/...` reject route. The
     * existing device's owner will see the notification and can simply
     * deny it themselves.
     */
    cancelPendingApproval(): void {
        this.stopPendingApprovalWatcher();
        this.activePendingDeviceApproval = null;
        this.deferredDeviceApproval = null;
        $pendingApprovalStageWritable.set("idle");
    }

    async close(): Promise<void> {
        this.pendingMessageEventMessages.clear();
        this.pendingReactionMessages.clear();
        this.processedMessageEventMailIDs.clear();
        this.processedReactionMailIDs.clear();
        if (this.client) {
            // `populateState` walks every channel + DM and decrypts SQLite
            // history — if we `database.close()` while that is still in
            // flight, native drivers can hard-crash (especially on sign-out).
            this.populateStateAbort = true;
            if (this.populateStateInFlight) {
                await this.populateStateInFlight;
            }
            this.populateStateAbort = false;

            this.detachWebsocketDebug();
            const c = this.client;
            this.unwireEvents();
            this.client = null;
            try {
                await c.close(true);
            } catch {
                // Ignore close errors — the Client may have a
                // half-open WebSocket that throws on teardown.
            }
        }
    }

    async completeInitialPasskeySetup(
        config: BootstrapConfig,
    ): Promise<AuthResult> {
        return this.trackAuthFlow(() =>
            this.completeInitialPasskeySetupInternal(config),
        );
    }

    async completePendingApprovalWithExistingPasskey(): Promise<OperationResult> {
        return this.trackAuthFlow(() =>
            this.finishApprovedPendingDeviceLogin({ promptForPasskey: true }),
        );
    }

    async completePendingApprovalWithNewPasskey(
        name?: string,
    ): Promise<OperationResult> {
        return this.trackAuthFlow(async () => {
            const pending = this.activePendingDeviceApproval;
            if (!pending || !pending.approvedDeviceID) {
                return {
                    error: "No approved device enrollment is waiting for passkey setup.",
                    ok: false,
                };
            }
            if (!pending.challenge) {
                return {
                    error: "This server does not support passkey setup for approved devices. Update and try again.",
                    ok: false,
                };
            }
            const driver = this.passkeyCeremonyDriver;
            if (!driver) {
                return {
                    error: "Passkeys aren't available on this device.",
                    ok: false,
                };
            }
            const client =
                this.requireClient() as unknown as ClientWithDeviceApprovals;
            const beginPending = client.devices.beginPendingPasskeyRegistration;
            const finishPending =
                client.devices.finishPendingPasskeyRegistration;
            if (
                typeof beginPending !== "function" ||
                typeof finishPending !== "function"
            ) {
                return {
                    error: "Update the Vex client to finish passkey setup on this device.",
                    ok: false,
                };
            }
            const passkeyName = name ?? pending.deviceName;
            try {
                $pendingApprovalStageWritable.set("passkey_setup");
                const begin = await beginPending({
                    challenge: pending.challenge,
                    name: passkeyName,
                    requestID: pending.requestID,
                });
                const response = await driver.register(
                    begin.options as PublicKeyCredentialCreationOptionsJSON,
                );
                await finishPending({
                    challenge: pending.challenge,
                    name: passkeyName,
                    requestID: begin.requestID,
                    response,
                });
                return await this.finishApprovedPendingDeviceLogin({
                    promptForPasskey: true,
                });
            } catch (err: unknown) {
                return { error: errorMessage(err), ok: false };
            }
        });
    }

    async completePendingApprovalWithoutPasskey(): Promise<OperationResult> {
        return this.trackAuthFlow(() =>
            this.finishApprovedPendingDeviceLogin({ promptForPasskey: false }),
        );
    }

    consumeRateLimitNotice(): boolean {
        if (!this.pendingRateLimitNotice) {
            return false;
        }
        this.pendingRateLimitNotice = false;
        return true;
    }

    async createChannel(
        name: string,
        serverID: string,
    ): Promise<OperationResult> {
        try {
            const client = this.requireClient();
            await client.channels.create(name, serverID);
            const channels = await client.channels.retrieve(serverID);
            $channelsWritable.setKey(serverID, channels);
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async createInvite(serverID: string, duration: string): Promise<Invite> {
        const client = this.requireClient();
        return client.invites.create(serverID, duration);
    }

    async createServer(name: string): Promise<CreateServerResult> {
        try {
            const client = this.requireClient();
            const server = await client.servers.create(name);
            $serversWritable.setKey(server.serverID, server);
            const channels = await client.channels.retrieve(server.serverID);
            $channelsWritable.setKey(server.serverID, channels);
            await this.cacheCurrentUserServerPermission(
                client,
                server.serverID,
            );
            const firstChannel = channels[0];
            return {
                ok: true,
                serverID: server.serverID,
                serverName: server.name,
                ...(firstChannel
                    ? {
                          channelID: firstChannel.channelID,
                          channelName: firstChannel.name,
                      }
                    : {}),
            };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    /** Delete all local data — message history, sessions, keys. Credentials (keychain) cleared by consumer. */
    async deleteAllData(): Promise<void> {
        if (this.client) {
            try {
                await this.client.deleteAllData();
            } catch {
                /* ignore — may fail if not connected */
            }
        }
        this.client = null;
        this.resetAll();
    }

    // ── Server CRUD ─────────────────────────────────────────────────────

    async deleteLocalMessage(
        conversationKey: string,
        mailID: string,
        isGroup: boolean,
    ): Promise<boolean> {
        const writable = isGroup ? $groupMessagesWritable : $messagesWritable;
        const thread = writable.get()[conversationKey] ?? [];
        if (thread.length === 0) {
            return false;
        }
        if (!thread.some((msg) => msg.mailID === mailID)) {
            return false;
        }

        const database = (this.client as ClientWithLocalDatabaseLike | null)
            ?.database;
        const deleteMessage = database?.deleteMessage;
        if (typeof deleteMessage !== "function") {
            debugAuth("local-message-delete:missing-storage", {
                conversationKey,
                isGroup,
                mailID,
            });
            return false;
        }

        try {
            await deleteMessage.call(database, mailID);
        } catch (err: unknown) {
            debugAuth("local-message-delete:failed", {
                conversationKey,
                isGroup,
                mailID,
                message: errorMessage(err),
            });
            return false;
        }

        const currentThread = writable.get()[conversationKey] ?? [];
        const nextThread = currentThread.filter((msg) => msg.mailID !== mailID);
        if (nextThread.length === currentThread.length) {
            return true;
        }
        writable.setKey(conversationKey, nextThread);
        return true;
    }

    async deleteLocalThread(
        conversationKey: string,
        isGroup: boolean,
    ): Promise<boolean> {
        const writable = isGroup ? $groupMessagesWritable : $messagesWritable;
        const thread = writable.get()[conversationKey] ?? [];
        if (thread.length === 0) {
            return false;
        }

        try {
            const client = this.requireClient();
            await client.messages.delete(conversationKey);
        } catch (err: unknown) {
            debugAuth("local-thread-delete:failed", {
                conversationKey,
                isGroup,
                message: errorMessage(err),
            });
            return false;
        }

        const threads: Record<string, Message[]> = Object.fromEntries(
            Object.entries(writable.get()).filter(
                ([key]) => key !== conversationKey,
            ),
        );
        writable.set(threads);
        if (isGroup) {
            $channelUnreadCountsWritable.setKey(conversationKey, 0);
        } else {
            $dmUnreadCountsWritable.setKey(conversationKey, 0);
        }
        return true;
    }

    async deleteMessageForEveryone(
        conversationKey: string,
        mailID: string,
        isGroup: boolean,
    ): Promise<OperationResult> {
        const actorUserID = $userWritable.get()?.userID;
        if (!actorUserID) {
            return { error: "Not signed in.", ok: false };
        }
        const target = this.findThreadMessage(conversationKey, mailID, isGroup);
        if (!target) {
            return { error: "Message not found.", ok: false };
        }
        if (target.authorID !== actorUserID) {
            return {
                error: "You can only delete your own messages.",
                ok: false,
            };
        }

        const result = await this.sendMessageExtra(
            conversationKey,
            isGroup,
            createDeleteEventExtra(mailID),
            isGroup ? "delete-group-message" : "delete-dm-message",
        );
        if (!result.ok) {
            return result;
        }
        this.applyLocalMessageDelete(
            conversationKey,
            mailID,
            isGroup,
            actorUserID,
        );
        return { ok: true };
    }

    /**
     * Remove a passkey from the currently signed-in account. Works
     * with either a device session OR a passkey session — spire's
     * delete route accepts both, and the UI surfaces this from both
     * Settings and the recovery screen.
     */
    async deletePasskey(passkeyID: string): Promise<OperationResult> {
        try {
            const client = this.requireClient();
            await client.passkeys.delete(passkeyID);
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async deleteServer(serverID: string): Promise<OperationResult> {
        try {
            const client = this.requireClient();
            await client.servers.delete(serverID);
            this.removeServerFromLocalState(serverID);
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async deleteThreadForEveryone(
        conversationKey: string,
        isGroup: boolean,
    ): Promise<ThreadDeleteForEveryoneResult> {
        const actorUserID = $userWritable.get()?.userID;
        if (!actorUserID) {
            return { error: "Not signed in.", ok: false };
        }

        const writable = isGroup ? $groupMessagesWritable : $messagesWritable;
        const thread = writable.get()[conversationKey] ?? [];
        if (thread.length === 0) {
            return {
                batchCount: 0,
                deletedCount: 0,
                localDeleted: false,
                ok: true,
            };
        }

        const targetMailIDs = thread
            .filter((message) => message.authorID === actorUserID)
            .map((message) => message.mailID);
        const batches = chunkArray(
            targetMailIDs,
            MESSAGE_DELETE_EVENT_BATCH_SIZE,
        );
        let sentCount = 0;
        for (const batch of batches) {
            const result = await this.sendMessageExtra(
                conversationKey,
                isGroup,
                createDeleteBatchEventExtra(batch),
                isGroup ? "delete-group-thread" : "delete-dm-thread",
            );
            if (!result.ok) {
                return {
                    batchCount: batches.length,
                    deletedCount: sentCount,
                    ...(result.error ? { error: result.error } : {}),
                    ok: false,
                };
            }
            sentCount += batch.length;
        }

        const localDeleted = await this.deleteLocalThread(
            conversationKey,
            isGroup,
        );
        return {
            batchCount: batches.length,
            deletedCount: targetMailIDs.length,
            localDeleted,
            ok: true,
        };
    }

    async downloadFileAttachment(
        attachment: EncryptedFileAttachment,
    ): Promise<OperationResult & { data?: Uint8Array }> {
        try {
            const client = this.requireClient();
            const file = await client.files.retrieve(
                attachment.fileID,
                attachment.key,
            );
            if (!file) {
                return { error: "File not found.", ok: false };
            }
            return { data: new Uint8Array(file.data), ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async editMessage(
        conversationKey: string,
        mailID: string,
        isGroup: boolean,
        content: string,
    ): Promise<OperationResult> {
        const actorUserID = $userWritable.get()?.userID;
        if (!actorUserID) {
            return { error: "Not signed in.", ok: false };
        }
        const message = content.trim();
        if (message.length === 0) {
            return { error: "Message cannot be empty.", ok: false };
        }
        const target = this.findThreadMessage(conversationKey, mailID, isGroup);
        if (!target) {
            return { error: "Message not found.", ok: false };
        }
        if (target.authorID !== actorUserID) {
            return { error: "You can only edit your own messages.", ok: false };
        }
        if (target.message === message) {
            return { ok: true };
        }

        const result = await this.sendMessageExtra(
            conversationKey,
            isGroup,
            createUpdateEventExtra(mailID, message),
            isGroup ? "edit-group-message" : "edit-dm-message",
        );
        if (!result.ok) {
            return result;
        }
        this.applyLocalMessageUpdate(
            conversationKey,
            mailID,
            isGroup,
            message,
            actorUserID,
        );
        return { ok: true };
    }

    /**
     * Finish a passkey-registration ceremony. Persists the new
     * authenticator on spire and returns the public passkey shape
     * for the Settings list.
     */
    async finishPasskeyRegistration(args: {
        name: string;
        requestID: string;
        response: Record<string, unknown>;
    }): Promise<{ error?: string; ok: boolean; passkey?: Passkey }> {
        try {
            const client = this.requireClient();
            const passkey = await client.passkeys.finishRegistration(args);
            return { ok: true, passkey };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    /**
     * Finish a passkey authentication ceremony. Stage two of the
     * recovery flow. On success the libvex Client is in
     * "passkey-only" mode — it can call the `passkeys.*` admin
     * routes (list/delete devices, recover/reject pending
     * enrollment) but messaging is unavailable until a device key
     * takes over. The caller is expected to drive the user through
     * the recovery screen and either:
     *   - recover a pending enrollment for a fresh device, then
     *     swap to a normal device session via `login()`/`autoLogin()`
     *   - or just clean up old devices and sign back out.
     */
    async finishPasskeySignIn(args: {
        requestID: string;
        response: Record<string, unknown>;
    }): Promise<{
        error?: string;
        ok: boolean;
        userID?: string;
        username?: string;
    }> {
        try {
            const client = this.requireClient();
            const result = await client.passkeys.finishAuthentication(args);
            // We deliberately don't flip $userWritable / authStatus
            // to "authenticated" here — the user is *not* in a full
            // messaging session, just a short-lived recovery one.
            // The recovery screen reads `getPasskeyUser()` to know
            // who's authenticated.
            return {
                ok: true,
                userID: result.user.userID,
                username: result.user.username,
            };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async getChannelMembers(channelID: string): Promise<User[]> {
        const client = this.requireClient();
        return client.channels.userList(channelID);
    }

    // ── Channel operations ──────────────────────────────────────────────

    async getDeviceRequest(
        requestID: string,
    ): Promise<DeviceApprovalRequest | null> {
        const client =
            this.requireClient() as unknown as ClientWithDeviceApprovals;
        if (typeof client.devices.getRequest === "function") {
            return client.devices.getRequest(requestID);
        }
        if (typeof client.devices.listRequests === "function") {
            const requests = await client.devices.listRequests();
            return (
                requests.find((request) => request.requestID === requestID) ??
                null
            );
        }
        return null;
    }

    async getInvites(serverID: string): Promise<Invite[]> {
        const client = this.requireClient();
        return client.invites.retrieve(serverID);
    }

    /** Effective local retention cap (defaults to 30 when signed out). */
    getLocalMessageRetentionDays(): number {
        const c = this.client as unknown as {
            getLocalMessageRetentionDays?: () => number;
        };
        const fromClient = c?.getLocalMessageRetentionDays?.();
        if (typeof fromClient === "number" && Number.isFinite(fromClient)) {
            return fromClient;
        }
        return $localMessageRetentionDaysWritable.get();
    }

    async getServerPermissions(serverID: string): Promise<Permission[]> {
        const client = this.requireClient();
        return client.moderation.fetchPermissionList(serverID);
    }

    async getSessionInfo(): Promise<null | SessionInfo> {
        try {
            const client = this.requireClient();
            const user = client.me.user();
            const device = client.me.device();
            let tokenExp: number | undefined;
            try {
                const auth = await client.whoami();
                tokenExp = auth.exp;
            } catch {
                // If whoami fails we can still return local session metadata.
            }
            const expMs =
                typeof tokenExp === "number"
                    ? jwtExpToEpochMs(tokenExp)
                    : undefined;
            const remainingMs =
                typeof expMs === "number"
                    ? Math.max(0, expMs - Date.now())
                    : undefined;
            return {
                authStatus: $authStatusWritable.get(),
                deviceID: device.deviceID,
                userID: user.userID,
                username: user.username,
                ...(typeof tokenExp === "number" ? { tokenExp } : {}),
                ...(typeof expMs === "number"
                    ? { tokenExpiresAt: new Date(expMs).toISOString() }
                    : {}),
                ...(typeof remainingMs === "number"
                    ? {
                          tokenRemainingHours: Math.floor(
                              remainingMs / (1000 * 60 * 60),
                          ),
                      }
                    : {}),
            };
        } catch {
            return null;
        }
    }

    getWebsocketDebugEnabled(): boolean {
        return this.wsDebugEnabled;
    }

    // ── Messaging ───────────────────────────────────────────────────────

    getWebsocketFrameDebugEnabled(): boolean {
        return this.wsDebugFrameLogsEnabled;
    }

    getWebsocketStateDebugEnabled(): boolean {
        return this.wsDebugStateLogsEnabled;
    }

    isAuthFlowInFlight(): boolean {
        return (
            this.authFlowInFlightCount > 0 || this.autoLoginInFlight !== null
        );
    }

    async joinInvite(inviteID: string): Promise<JoinInviteResult> {
        try {
            const client = this.requireClient();
            const permission = await client.invites.redeem(inviteID);
            const server = await client.servers.retrieveByID(
                permission.resourceID,
            );
            if (!server) {
                return { error: "Server not found", ok: false };
            }
            $serversWritable.setKey(server.serverID, server);
            const channels = await client.channels.retrieve(server.serverID);
            $channelsWritable.setKey(server.serverID, channels);
            $permissionsWritable.setKey(permission.permissionID, permission);
            const firstChannel = channels[0];
            return {
                ok: true,
                serverID: server.serverID,
                serverName: server.name,
                ...(firstChannel
                    ? {
                          channelID: firstChannel.channelID,
                          channelName: firstChannel.name,
                      }
                    : {}),
            };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async kickServerMember(
        serverID: string,
        userID: string,
    ): Promise<OperationResult> {
        try {
            const client = this.requireClient();
            await client.moderation.kick(userID, serverID);
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async leaveServer(serverID: string): Promise<OperationResult> {
        try {
            const client = this.requireClient();
            await client.servers.leave(serverID);
            this.removeServerFromLocalState(serverID);
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async listMyDevices(): Promise<Device[]> {
        const client = this.requireClient();
        const userID = client.me.user().userID;
        const withList = client as unknown as ClientWithUserDeviceListLike;
        let devices: Device[] = [];
        if (typeof withList.getUserDeviceList === "function") {
            devices = (await withList.getUserDeviceList(userID)) ?? [];
        }
        const sorted = [...devices].sort(
            (a, b) =>
                new Date(b.lastLogin).getTime() -
                new Date(a.lastLogin).getTime(),
        );
        $devicesWritable.setKey(userID, sorted);
        return sorted;
    }

    /**
     * List all passkeys belonging to the current account. Works in
     * either a device session or a passkey-recovery session.
     */
    async listPasskeys(): Promise<Passkey[]> {
        const client = this.requireClient();
        return client.passkeys.list();
    }

    async listPendingDeviceRequests(): Promise<DeviceApprovalRequest[]> {
        const client =
            this.requireClient() as unknown as ClientWithDeviceApprovals;
        if (!client.devices.listRequests) {
            return [];
        }
        return client.devices.listRequests();
    }

    /**
     * Login with stored device key → register device if needed → connect.
     */
    async login(
        username: string,
        _password: string,
        config: BootstrapConfig,
        options: ServerOptions,
        keyStore: KeyStore,
    ): Promise<AuthResult> {
        return this.trackAuthFlow(() =>
            this.loginInternal(username, _password, config, options, keyStore),
        );
    }

    async logout(): Promise<void> {
        if (this.logoutInFlight) {
            return this.logoutInFlight;
        }
        const run = async (): Promise<void> => {
            this.stopPendingApprovalWatcher();
            await this.close();
            this.resetAll();
            this.setAuthStatus("signed_out");
            // Mark sign-out as explicit so the auth UI does not auto-login from
            // the keychain credentials we intentionally keep around.
            $signedOutIntentWritable.set(true);
        };
        this.logoutInFlight = run();
        try {
            await this.logoutInFlight;
        } finally {
            this.logoutInFlight = null;
        }
    }

    async lookupUser(query: string): Promise<null | User> {
        try {
            const client = this.requireClient();
            // Lowercase non-UUID lookups so cache keys / negative-
            // cache hits inside libvex are consistent regardless of
            // how the caller typed the handle. UUID identifiers are
            // pass-through; libvex's `fetchUser` makes the same
            // distinction internally.
            const trimmed = query.trim();
            const normalizedQuery = uuidValidate(trimmed)
                ? trimmed
                : trimmed.toLowerCase();
            const [user] = await client.users.retrieve(normalizedQuery);
            return user;
        } catch {
            return null;
        }
    }

    markRead(conversationKey: string): void {
        $dmUnreadCountsWritable.setKey(conversationKey, 0);
        $channelUnreadCountsWritable.setKey(conversationKey, 0);
    }

    onDeviceRequestQueueChanged(listener: () => void): () => void {
        this.deviceRequestQueueListeners.add(listener);
        return () => {
            this.deviceRequestQueueListeners.delete(listener);
        };
    }

    // ── User operations ─────────────────────────────────────────────────

    /** Delete a device using the passkey-only session. */
    async passkeyDeleteDevice(deviceID: string): Promise<OperationResult> {
        try {
            const client = this.requireClient();
            await client.passkeys.deleteDevice(deviceID);
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    /** List all of the account's devices using the passkey-only session. */
    async passkeyListDevices(): Promise<Device[]> {
        const client = this.requireClient();
        const devices = await client.passkeys.listDevices();
        return [...devices].sort(
            (a, b) =>
                new Date(b.lastLogin).getTime() -
                new Date(a.lastLogin).getTime(),
        );
    }

    /** Reject a pending device-enrollment request using the passkey-only session. */
    async passkeyRejectDeviceRequest(
        requestID: string,
    ): Promise<OperationResult> {
        try {
            const client = this.requireClient();
            await client.passkeys.rejectDeviceRequest(requestID);
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    /**
     * Recover the pending "new device" enrollment with a registered passkey.
     * This is used when the user has no other signed-in device to approve from:
     * the passkey session recovers this device and the server revokes every
     * previously trusted device before this client swaps into a normal
     * device-key session.
     */
    async passkeyRestorePendingDevice(
        requestID: string,
    ): Promise<PasskeyDeviceRestoreResult> {
        return this.trackAuthFlow(() =>
            this.passkeyRestorePendingDeviceInternal(requestID),
        );
    }

    async previewInvite(inviteID: string): Promise<InvitePreview | null> {
        const cached = this.invitePreviewCache.get(inviteID);
        if (cached) {
            return cached;
        }

        const previewPromise = this.fetchInvitePreview(inviteID).catch(
            (err: unknown) => {
                this.invitePreviewCache.delete(inviteID);
                throw err;
            },
        );
        this.invitePreviewCache.set(inviteID, previewPromise);
        return previewPromise;
    }

    async probeAuthSession(): Promise<AuthProbeStatus> {
        try {
            const client = this.requireClient();
            const auth = await client.whoami();
            $userWritable.set(auth.user);
            await this.refreshSessionTokenIfStale(auth.exp);
            this.setAuthStatus("authenticated");
            return "authenticated";
        } catch (err: unknown) {
            if (isRateLimitedError(err)) {
                // 429 should not cascade into forced logout flows.
                this.markRateLimited("probeAuthSession");
                this.setAuthStatus("authenticated");
                return "authenticated";
            }
            // 404 here means the user record (or device record, depending on
            // the server build) backing our token has been deleted while we
            // were holding a still-valid JWT. Treat it as unauthorized so the
            // caller's recovery path (refresh → fail → clear creds + bounce
            // to sign-in) fires the same way it does for an expired token.
            if (isStaleCredentialError(err)) {
                this.setAuthStatus("unauthorized");
                return "unauthorized";
            }
            this.setAuthStatus("offline");
            return "offline";
        }
    }

    /**
     * Notifies the account owner's other devices and starts polling for
     * approval. Call after the user confirms "this account is mine" on the
     * gate screen (or immediately from UIs that have no such gate).
     */
    async publishDeferredDeviceApprovalAndStartWatching(
        keyStore: KeyStore,
    ): Promise<{ error?: string; ok: boolean }> {
        const d = this.deferredDeviceApproval;
        if (!d) {
            return {
                error: "No pending device enrollment to confirm.",
                ok: false,
            };
        }
        if (d.keyStore !== keyStore) {
            return { error: "Key store mismatch.", ok: false };
        }
        const client = this.client;
        if (!client) {
            return { error: "Client not ready.", ok: false };
        }
        const withDevices = client as unknown as ClientWithDeviceApprovals;
        const publish = withDevices.devices.publishPendingRegistration;
        if (typeof publish !== "function") {
            return {
                error: "Update the Vex client to confirm this device.",
                ok: false,
            };
        }
        try {
            await publish({
                challenge: d.challenge,
                requestID: d.requestID,
            });
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
        this.startPendingApprovalWatcher({
            challenge: d.challenge,
            deviceKey: d.deviceKey,
            deviceName: d.deviceName,
            keyStore: d.keyStore,
            requestID: d.requestID,
            username: d.username,
        });
        this.deferredDeviceApproval = null;
        return { ok: true };
    }

    async refreshSessionAfterForeground(): Promise<ResumeNetworkStatus> {
        if (!this.client) {
            this.setAuthStatus("signed_out");
            return "signed_out";
        }
        this.setAuthStatus("checking");
        const probe = await this.probeAuthSession();
        if (probe === "unauthorized") {
            const client = this.requireClient();
            const username = this.currentClientUsername();
            const { authErr, passkeyState } =
                await this.loginWithDeviceKeyWithPasskeyRetry(client, username);
            if (authErr) {
                this.setAuthStatus("unauthorized");
                return "unauthorized";
            }
            if (passkeyState === "not_registered") {
                await this.registerInitialPasskeyForCurrentClient(
                    "This device",
                );
            }
            const afterRelogin = await this.probeAuthSession();
            if (afterRelogin !== "authenticated") {
                return afterRelogin;
            }
        } else if (probe !== "authenticated") {
            return probe;
        }

        try {
            // If the foreground-service kept the WebSocket alive through
            // the background → resume window, the watchdog will have a
            // very recent inbound-frame timestamp. Tearing that socket
            // down just to redo the Noise handshake + login is wasted
            // CPU on the JS thread at exactly the moment Android wants
            // the UI thread responsive (unlock animation, activity
            // foreground transition). Skip the reconnect when we have
            // strong evidence the socket is healthy; fall through to a
            // lightweight inbox sync.
            //
            // If the watchdog is stale (FGS got killed by the OS, or
            // we're not in always-on mode), do the full reconnect — the
            // socket can't be trusted.
            if (!this.isWebsocketLikelyHealthy()) {
                const reconnect = this.client.reconnectWebsocket();
                reconnect.catch(() => {
                    /* consumed by withTimeout below; prevents late RN unhandled rejection logs */
                });
                await withTimeout(
                    reconnect,
                    10_000,
                    "WebSocket reconnect timed out after app resume.",
                );
                // reconnectWebsocket() swaps the underlying socket object; re-bind
                // debug hooks so inbound/outbound frame logging continues.
                this.attachWebsocketDebug();
            }
            if (hasSyncInboxNow(this.client)) {
                await withTimeout(
                    this.client.syncInboxNow(),
                    10_000,
                    "Inbox sync timed out after app resume.",
                );
            } else {
                await withTimeout(
                    this.populateState(),
                    10_000,
                    "State refresh timed out after app resume.",
                );
            }
            this.setAuthStatus("authenticated");
            return "authenticated";
        } catch (err: unknown) {
            if (isRateLimitedError(err)) {
                this.markRateLimited("refreshSessionAfterForeground");
                this.setAuthStatus("authenticated");
                return "authenticated";
            }
            if (isStaleCredentialError(err)) {
                this.setAuthStatus("unauthorized");
                return "unauthorized";
            }
            this.setAuthStatus("offline");
            return "offline";
        }
    }

    async refreshSessionTokenIfStale(exp: number): Promise<void> {
        const expMs = jwtExpToEpochMs(exp);
        if (!Number.isFinite(expMs)) {
            return;
        }
        const remainingMs = expMs - Date.now();
        if (remainingMs > DEVICE_AUTH_REFRESH_THRESHOLD_MS) {
            return;
        }
        const elapsedSinceAttempt =
            Date.now() - this.lastDeviceAuthRefreshAttemptAt;
        if (elapsedSinceAttempt < DEVICE_AUTH_REFRESH_INTERVAL_MS) {
            return;
        }
        this.lastDeviceAuthRefreshAttemptAt = Date.now();
        try {
            const client = this.requireClient();
            const username = this.currentClientUsername();
            const { authErr, passkeyState } =
                await this.loginWithDeviceKeyWithPasskeyRetry(client, username);
            if (authErr) {
                debugAuth("session:refresh:failed", {
                    message: errorMessage(authErr),
                });
                return;
            }
            if (passkeyState === "not_registered") {
                await this.registerInitialPasskeyForCurrentClient(
                    "This device",
                );
            }
            debugAuth("session:refresh:ok", {
                remainingHours: Math.floor(remainingMs / (1000 * 60 * 60)),
            });
        } catch (err: unknown) {
            debugAuth("session:refresh:error", {
                message: errorMessage(err),
            });
        }
    }

    /**
     * Register a new account → save credentials → connect.
     */
    async register(
        username: string,
        _password: string,
        config: BootstrapConfig,
        options: ServerOptions,
        keyStore: KeyStore,
    ): Promise<AuthResult> {
        return this.trackAuthFlow(() =>
            this.registerInternal(
                username,
                _password,
                config,
                options,
                keyStore,
            ),
        );
    }

    async rejectDeviceRequest(requestID: string): Promise<OperationResult> {
        try {
            const client =
                this.requireClient() as unknown as ClientWithDeviceApprovals;
            if (!client.devices.rejectRequest) {
                return {
                    error: "Client does not support device approvals yet.",
                    ok: false,
                };
            }
            await client.devices.rejectRequest(requestID);
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    async removeDevice(deviceID: string): Promise<OperationResult> {
        try {
            const client = this.requireClient();
            await client.devices.delete(deviceID);
            await this.listMyDevices();
            return { ok: true };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }
    }

    resetAllUnread(): void {
        $dmUnreadCountsWritable.set({});
        $channelUnreadCountsWritable.set({});
    }

    /**
     * Clears the WebSocket watchdog's "last frame" timestamp.
     *
     * Called by the foreground-service module after a revive (when the
     * OS killed the FGS and we re-create it). Without this, the next
     * `refreshSessionAfterForeground` could see a stale-but-recent
     * timestamp from the dead socket and incorrectly skip the
     * reconnect path. Forcing the watchdog into "no observed frames
     * yet" state means {@link isWebsocketLikelyHealthy} returns false
     * until the new socket genuinely receives a frame, which is the
     * conservative correct answer.
     */
    resetWebsocketWatchdog(): void {
        this.wsWatchdogLastFrameAt = 0;
    }

    async runBackgroundNetworkFetch(): Promise<BackgroundNetworkFetchResult> {
        const client = this.client;
        if (!client) {
            return "no_data";
        }
        try {
            const status = await this.probeAuthSession();
            if (status !== "authenticated") {
                return status === "offline" ? "no_data" : "failed";
            }
            if (hasSyncInboxNow(client)) {
                await client.syncInboxNow();
            } else {
                await this.populateState();
            }
            return "new_data";
        } catch {
            return "failed";
        }
    }

    async sendDM(
        recipientID: string,
        content: string,
        options?: SendMessageOptions,
    ): Promise<OperationResult> {
        const send = async (): Promise<void> => {
            const client =
                this.requireClient() as unknown as ClientWithMessageExtraLike;
            await client.messages.send(recipientID, content, options);
        };
        try {
            await send();
            return { ok: true };
        } catch (err: unknown) {
            if (isNetworkError(err) || isNotAuthenticatedError(err)) {
                // `messages.send` goes over WS; if that path says
                // unauthenticated, force reconnect instead of trusting a
                // potentially stale "healthy" watchdog timestamp from HTTP.
                this.resetWebsocketWatchdog();
                const recovered = await this.recoverConnection("send-dm");
                if (recovered === "authenticated") {
                    try {
                        await send();
                        return { ok: true };
                    } catch (retryErr: unknown) {
                        if (
                            isUnauthorizedError(retryErr) ||
                            isNotAuthenticatedError(retryErr)
                        ) {
                            this.setAuthStatus("unauthorized");
                        } else if (isNetworkError(retryErr)) {
                            this.setAuthStatus("offline");
                        }
                        return { error: errorMessage(retryErr), ok: false };
                    }
                }
            }
            return { error: errorMessage(err), ok: false };
        }
    }

    async sendGroupMessage(
        channelID: string,
        content: string,
        options?: SendMessageOptions,
    ): Promise<OperationResult> {
        const send = async (): Promise<void> => {
            const client =
                this.requireClient() as unknown as ClientWithMessageExtraLike;
            await client.messages.group(channelID, content, options);
        };
        try {
            await send();
            return { ok: true };
        } catch (err: unknown) {
            if (isNetworkError(err) || isNotAuthenticatedError(err)) {
                // Same rationale as DM sends: prefer a hard WS re-auth cycle
                // after transport/auth failures on the socket path.
                this.resetWebsocketWatchdog();
                const recovered = await this.recoverConnection("send-group");
                if (recovered === "authenticated") {
                    try {
                        await send();
                        return { ok: true };
                    } catch (retryErr: unknown) {
                        if (
                            isUnauthorizedError(retryErr) ||
                            isNotAuthenticatedError(retryErr)
                        ) {
                            this.setAuthStatus("unauthorized");
                        } else if (isNetworkError(retryErr)) {
                            this.setAuthStatus("offline");
                        }
                        return { error: errorMessage(retryErr), ok: false };
                    }
                }
            }
            return { error: errorMessage(err), ok: false };
        }
    }

    async setAvatar(data: Uint8Array): Promise<OperationResult> {
        const bumpVersionForCurrentUser = (): void => {
            $avatarHashWritable.set(Date.now());
            const me = $userWritable.get();
            if (me?.userID) {
                $avatarVersionsWritable.setKey(me.userID, Date.now());
            }
        };
        try {
            const client = this.requireClient();
            await client.me.setAvatar(data);
            bumpVersionForCurrentUser();
            return { ok: true };
        } catch (err: unknown) {
            const message = errorMessage(err);
            if (looksLikeReactNativeBlobError(message)) {
                // React Native/Hermes can reject Blob(ArrayBufferView) construction.
                // libvex has a built-in JSON/base64 upload fallback that is used
                // when FormData is unavailable, so temporarily disable FormData
                // for this call and retry through that code path.
                try {
                    await runWithFormDataDisabled(async () => {
                        const client = this.requireClient();
                        await client.me.setAvatar(data);
                        bumpVersionForCurrentUser();
                    });
                    return { ok: true };
                } catch (retryErr: unknown) {
                    return { error: errorMessage(retryErr), ok: false };
                }
            }
            return { error: errorMessage(err), ok: false };
        }
    }

    setBackgroundConnectionRecoverySuspended(suspended: boolean): void {
        this.backgroundConnectionRecoverySuspended = suspended;
    }

    /**
     * Updates the local message retention preference (1–30 days) and
     * applies it to the live client when connected.
     */
    setLocalMessageRetentionDays(days: number): void {
        const clamped = clampLocalMessageRetentionDays(days);
        setLocalMessageRetentionDaysPreference(clamped);
        const c = this.client as unknown as {
            setLocalMessageRetentionDays?: (d: number) => void;
        };
        c?.setLocalMessageRetentionDays?.(clamped);
    }

    setPasskeyCeremonyDriver(driver: null | PasskeyCeremonyDriver): void {
        this.passkeyCeremonyDriver = driver;
    }

    setWebsocketDebug(enabled: boolean): void {
        this.wsDebugEnabled = enabled;
        if (enabled) {
            this.attachWebsocketDebug();
            return;
        }
        this.detachWebsocketDebug();
    }

    setWebsocketFrameDebug(enabled: boolean): void {
        this.wsDebugFrameLogsEnabled = enabled;
        if (!this.wsDebugEnabled) {
            return;
        }
        this.detachWebsocketDebug();
        this.attachWebsocketDebug();
    }

    setWebsocketStateDebug(enabled: boolean): void {
        this.wsDebugStateLogsEnabled = enabled;
    }

    // ── Unread management ───────────────────────────────────────────────

    async subscribePushNotifications(
        input: PushNotificationSubscriptionInput,
    ): Promise<NotificationSubscriptionLike> {
        const client = this.requireClient();
        const legacyClient =
            client as unknown as ClientWithPushNotificationFallback;
        if (hasNotificationSubscriptionApi(client)) {
            return client.subscribeNotifications(input);
        }

        const http = legacyClient.http;
        const post = http?.post;
        if (typeof post !== "function") {
            throw new Error("Push subscriptions are not supported by libvex.");
        }
        const deviceID = legacyClient.me?.device?.().deviceID;
        const getHost = legacyClient.getHost;
        if (typeof deviceID !== "string" || typeof getHost !== "function") {
            throw new Error("Push subscriptions are not supported by libvex.");
        }
        const response = (await post.call(
            http,
            getHost.call(legacyClient) +
                "/device/" +
                deviceID +
                "/notifications/subscriptions",
            JSON.stringify(input),
            {
                headers: { "Content-Type": "application/json" },
                responseType: "json",
            },
        )) as { data?: unknown };

        return parseNotificationSubscription(response.data);
    }

    async toggleMessageReaction(
        conversationKey: string,
        mailID: string,
        isGroup: boolean,
        emoji: MessageEmoji,
    ): Promise<OperationResult> {
        if (!$userWritable.get()?.userID) {
            return { error: "Not signed in.", ok: false };
        }

        const extra = createReactionEventExtra(mailID, emoji);
        return this.sendMessageExtra(
            conversationKey,
            isGroup,
            extra,
            isGroup ? "react-group" : "react-dm",
        );
    }

    async unsubscribePushNotifications(subscriptionID: string): Promise<void> {
        const client = this.requireClient();
        const legacyClient =
            client as unknown as ClientWithPushNotificationFallback;
        if (hasNotificationSubscriptionApi(client)) {
            await client.unsubscribeNotifications(subscriptionID);
            return;
        }

        const http = legacyClient.http;
        const del = (http as undefined | { delete?: unknown })?.delete;
        if (typeof del !== "function") {
            throw new Error("Push subscriptions are not supported by libvex.");
        }
        const deviceID = legacyClient.me?.device?.().deviceID;
        const getHost = legacyClient.getHost;
        if (typeof deviceID !== "string" || typeof getHost !== "function") {
            throw new Error("Push subscriptions are not supported by libvex.");
        }
        await del.call(
            http,
            getHost.call(legacyClient) +
                "/device/" +
                deviceID +
                "/notifications/subscriptions/" +
                subscriptionID,
        );
    }

    // ── Notifications ───────────────────────────────────────────────────

    async uploadFileAttachment(input: {
        contentType: string;
        data: Uint8Array;
        fileName: string;
        fileSize?: number;
    }): Promise<OperationResult & { attachment?: EncryptedFileAttachment }> {
        const upload = async (): Promise<EncryptedFileAttachment> => {
            const client = this.requireClient();
            const [details, key] = await client.files.create(input.data);
            return {
                contentType: input.contentType || "application/octet-stream",
                fileID: details.fileID,
                fileName: input.fileName,
                fileSize: input.fileSize ?? input.data.byteLength,
                key,
            };
        };

        try {
            const attachment = await upload();
            return { attachment, ok: true };
        } catch (err: unknown) {
            const message = errorMessage(err);
            if (looksLikeReactNativeBlobError(message)) {
                try {
                    const attachment = await runWithFormDataDisabled(upload);
                    return { attachment, ok: true };
                } catch (retryErr: unknown) {
                    return { error: errorMessage(retryErr), ok: false };
                }
            }
            return { error: message, ok: false };
        }
    }

    // ── Encrypted message metadata ──────────────────────────────────────

    private applyLocalMessageDelete(
        conversationKey: string,
        mailID: string,
        isGroup: boolean,
        actorUserID: string,
    ): boolean {
        return this.applyLocalMessageDeleteBatch(
            conversationKey,
            [mailID],
            isGroup,
            actorUserID,
        );
    }

    private applyLocalMessageDeleteBatch(
        conversationKey: string,
        mailIDs: string[],
        isGroup: boolean,
        actorUserID: string,
    ): boolean {
        const writable = isGroup ? $groupMessagesWritable : $messagesWritable;
        const thread = writable.get()[conversationKey] ?? [];
        const nextThread = applyMessageDeleteEvent(
            thread,
            { action: "delete", targetMailIDs: mailIDs },
            actorUserID,
        );
        if (nextThread === thread) {
            return false;
        }
        writable.setKey(conversationKey, nextThread);
        for (const mailID of mailIDs) {
            void this.deletePersistedMessage(mailID);
        }
        return true;
    }

    private applyLocalMessageUpdate(
        conversationKey: string,
        mailID: string,
        isGroup: boolean,
        message: string,
        actorUserID: string,
    ): boolean {
        const writable = isGroup ? $groupMessagesWritable : $messagesWritable;
        const thread = writable.get()[conversationKey] ?? [];
        const nextThread = applyMessageUpdateEvent(
            thread,
            { action: "update", message, targetMailID: mailID },
            actorUserID,
        );
        if (nextThread === thread) {
            return false;
        }
        writable.setKey(conversationKey, nextThread);
        void this.updatePersistedMessage(
            mailID,
            message,
            nextThread.find((item) => item.mailID === mailID),
        );
        return true;
    }

    private applyMessageEventMessage(
        writable: MessageMapWritableLike,
        conversationKey: string,
        msg: Message,
    ): boolean {
        const targetMailIDs = messageEventTargetMailIDs(msg);
        if (targetMailIDs.length === 0) {
            return false;
        }
        if (this.processedMessageEventMailIDs.has(msg.mailID)) {
            return true;
        }

        const thread = writable.get()[conversationKey] ?? [];
        const targetExists = thread.some((message) =>
            targetMailIDs.includes(message.mailID),
        );
        const nextThread = applyMessageEventToThread(thread, msg);
        if (nextThread === thread) {
            const me = $userWritable.get();
            if (targetExists || me?.userID === msg.authorID) {
                this.rememberProcessedMessageEventMailID(msg.mailID);
                return true;
            }
            this.queuePendingMessageEventMessage(conversationKey, msg);
            return true;
        }

        this.rememberProcessedMessageEventMailID(msg.mailID);
        writable.setKey(conversationKey, nextThread);
        this.persistAppliedMessageEvent(msg, nextThread);
        return true;
    }

    private applyPendingMessageEventMessages(
        writable: MessageMapWritableLike,
        conversationKey: string,
    ): void {
        const pending = this.pendingMessageEventMessages.get(conversationKey);
        if (!pending || pending.size === 0) {
            return;
        }

        let thread = writable.get()[conversationKey] ?? [];
        const now = Date.now();
        for (const [mailID, pendingEvent] of pending) {
            const msg = pendingEvent.message;
            if (this.processedMessageEventMailIDs.has(mailID)) {
                pending.delete(mailID);
                continue;
            }
            if (
                now - pendingEvent.queuedAt > PENDING_MESSAGE_EVENT_TTL_MS ||
                pendingEvent.attempts >=
                    MAX_PENDING_MESSAGE_EVENT_APPLY_ATTEMPTS
            ) {
                pending.delete(mailID);
                continue;
            }
            const targetMailIDs = messageEventTargetMailIDs(msg);
            if (targetMailIDs.length === 0) {
                pending.delete(mailID);
                continue;
            }
            const targetExists = thread.some((message) =>
                targetMailIDs.includes(message.mailID),
            );
            const nextThread = applyMessageEventToThread(thread, msg);
            if (nextThread === thread) {
                if (targetExists) {
                    pending.delete(mailID);
                    this.rememberProcessedMessageEventMailID(mailID);
                    continue;
                }
                pendingEvent.attempts += 1;
                continue;
            }
            thread = nextThread;
            pending.delete(mailID);
            this.rememberProcessedMessageEventMailID(mailID);
            this.persistAppliedMessageEvent(msg, thread);
        }

        if (pending.size === 0) {
            this.pendingMessageEventMessages.delete(conversationKey);
        }
        writable.setKey(conversationKey, thread);
    }

    private applyPendingReactionMessages(
        writable: MessageMapWritableLike,
        conversationKey: string,
    ): void {
        const pending = this.pendingReactionMessages.get(conversationKey);
        if (!pending || pending.size === 0) {
            return;
        }

        let thread = writable.get()[conversationKey] ?? [];
        const now = Date.now();
        for (const [mailID, pendingReaction] of pending) {
            const msg = pendingReaction.message;
            if (this.processedReactionMailIDs.has(mailID)) {
                pending.delete(mailID);
                continue;
            }
            if (
                now - pendingReaction.queuedAt >
                    PENDING_REACTION_MESSAGE_TTL_MS ||
                pendingReaction.attempts >= MAX_PENDING_REACTION_APPLY_ATTEMPTS
            ) {
                pending.delete(mailID);
                continue;
            }
            const event = messageReactionEvent(msg);
            if (!event) {
                pending.delete(mailID);
                continue;
            }
            const nextThread = applyMessageReactionEvent(
                thread,
                event,
                msg.authorID,
            );
            if (nextThread === thread) {
                pendingReaction.attempts += 1;
                continue;
            }
            thread = nextThread;
            pending.delete(mailID);
            this.rememberProcessedReactionMailID(mailID);
        }

        if (pending.size === 0) {
            this.pendingReactionMessages.delete(conversationKey);
        }
        writable.setKey(conversationKey, thread);
    }

    private applyReactionMessage(
        writable: MessageMapWritableLike,
        conversationKey: string,
        msg: Message,
    ): boolean {
        const event = messageReactionEvent(msg);
        if (!event) {
            return false;
        }
        if (this.processedReactionMailIDs.has(msg.mailID)) {
            return true;
        }

        const thread = writable.get()[conversationKey] ?? [];
        const nextThread = applyMessageReactionEvent(
            thread,
            event,
            msg.authorID,
        );
        if (nextThread === thread) {
            this.queuePendingReactionMessage(conversationKey, msg);
            return true;
        }
        this.rememberProcessedReactionMailID(msg.mailID);
        writable.setKey(conversationKey, nextThread);
        return true;
    }

    private attachWebsocketDebug(): void {
        if (!this.wsDebugEnabled || !this.client) {
            return;
        }
        const socket = getClientSocket(this.client);
        if (!socket) {
            return;
        }
        if (this.wsDebugSocket === socket && this.wsDebugInboundListener) {
            return;
        }
        this.detachWebsocketDebug();
        if (!this.wsDebugFrameLogsEnabled) {
            this.wsDebugSocket = socket;
            this.logWsState("ws:debug:attached", { frames: false });
            return;
        }
        const inbound = (data: Uint8Array) => {
            debugAuth("ws:in", describeWsFrame(data));
        };
        const originalSend = socket.send.bind(socket);
        socket.send = (data: Uint8Array) => {
            debugAuth("ws:out", describeWsFrame(data));
            originalSend(data);
        };
        socket.on("message", inbound);
        this.wsDebugSocket = socket;
        this.wsDebugInboundListener = inbound;
        this.wsDebugOriginalSend = originalSend;
        this.logWsState("ws:debug:attached", { frames: true });
    }

    /**
     * Binds the watchdog's "any inbound frame" listener to the
     * underlying WebSocket and starts the periodic stale check.
     * Idempotent when called against the same socket; on a socket
     * swap (after `reconnectWebsocket`), detaches the old listener
     * and re-binds to the new one.
     */
    private attachWebsocketWatchdog(): void {
        if (!this.client) {
            return;
        }
        const socket = getClientSocket(this.client);
        if (!socket) {
            return;
        }
        if (this.wsWatchdogSocket === socket && this.wsWatchdogListener) {
            return;
        }
        this.detachWebsocketWatchdogListener();
        const listener = (_data: Uint8Array) => {
            this.wsWatchdogLastFrameAt = Date.now();
        };
        socket.on("message", listener);
        this.wsWatchdogSocket = socket;
        this.wsWatchdogListener = listener;
        this.wsWatchdogLastFrameAt = Date.now();
        if (!this.wsWatchdogInterval) {
            this.wsWatchdogInterval = setInterval(() => {
                this.checkWebsocketWatchdog();
            }, WS_WATCHDOG_CHECK_INTERVAL_MS);
        }
    }

    // ── Private ─────────────────────────────────────────────────────────

    private async cacheCurrentUserServerPermission(
        client: Client,
        serverID: string,
    ): Promise<void> {
        try {
            const userID = client.me.user().userID;
            const permission = (await client.permissions.retrieve()).find(
                (candidate) =>
                    candidate.resourceID === serverID &&
                    candidate.resourceType === "server" &&
                    candidate.userID === userID,
            );
            if (permission) {
                $permissionsWritable.setKey(
                    permission.permissionID,
                    permission,
                );
                return;
            }
            debugAuth("server:create:permission-missing", {
                serverID,
                userID,
            });
        } catch (err: unknown) {
            debugAuth("server:create:permission-refresh:failed", {
                message: errorMessage(err),
                serverID,
            });
        }
    }

    private checkWebsocketWatchdog(): void {
        if (!this.client || this.wsWatchdogLastFrameAt === 0) {
            return;
        }
        if (this.backgroundConnectionRecoverySuspended) {
            return;
        }
        const elapsed = Date.now() - this.wsWatchdogLastFrameAt;
        if (elapsed <= WS_WATCHDOG_STALE_THRESHOLD_MS) {
            return;
        }
        this.logWsState("ws:watchdog:stale", { elapsedMs: elapsed });
        // Reset so we don't fire repeatedly while recovery is in
        // flight; the new connection's first inbound frame will
        // refresh the timestamp organically.
        this.wsWatchdogLastFrameAt = Date.now();
        void this.recoverConnection("watchdog-stale");
    }

    private async clearStoredCredentials(
        keyStore: KeyStore,
        username: string,
    ): Promise<void> {
        try {
            await keyStore.clear(username);
        } catch {
            /* ignore — best-effort cleanup */
        }
    }

    private async completeInitialPasskeySetupInternal(
        config: BootstrapConfig,
    ): Promise<AuthResult> {
        let client: Client;
        try {
            client = this.requireClient();
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }

        try {
            await withTimeout(
                this.registerInitialPasskeyForCurrentClient(
                    config.deviceName || "This device",
                ),
                PASSKEY_SETUP_TIMEOUT_MS,
                "Signup stalled while adding a passkey.",
            );
        } catch (err: unknown) {
            debugAuth("passkey:registerInitial:retry:failed", {
                message: errorMessage(err),
            });
            if (isUnauthorizedError(err)) {
                this.setAuthStatus("unauthorized");
            } else if (isNetworkError(err)) {
                this.setAuthStatus("offline");
            }
            return {
                error: initialPasskeySetupErrorMessage(err),
                ok: false,
                passkeySetupRequired: true,
            };
        }

        try {
            await withTimeout(
                client.connect(),
                REGISTER_STEP_TIMEOUT_MS,
                "Signup stalled while opening realtime connection.",
            );
            $userWritable.set(client.me.user());
            this.setAuthStatus("authenticated");
            this.kickPopulateState();
            return { ok: true };
        } catch (err: unknown) {
            debugAuth("passkey:registerInitial:retryConnect:failed", {
                message: errorMessage(err),
            });
            if (isUnauthorizedError(err)) {
                this.setAuthStatus("unauthorized");
            } else if (isNetworkError(err)) {
                this.setAuthStatus("offline");
            }
            return {
                error: errorMessage(err),
                ok: false,
            };
        }
    }

    private configureHttpForRuntime(client: Client): void {
        if (!isReactNativeRuntime()) {
            return;
        }
        const internals = client as unknown as ClientWithInternalHttp;
        const http = internals.http;
        if (!http) {
            return;
        }
        this.wrapHttpMethodsWithTimeout(http);
    }

    private async createClientWithRecovery(
        privateKey: string,
        clientOptions: ClientOptions,
        storage: Storage,
        allowStorageReset: boolean,
        username: string,
    ): Promise<Client> {
        try {
            return await Client.create(privateKey, clientOptions, storage);
        } catch (err: unknown) {
            if (allowStorageReset && isDecryptMismatchError(err)) {
                debugAuth("initClient:recover:purgeKeyData", { username });
                await storage.purgeKeyData();
                return Client.create(privateKey, clientOptions, storage);
            }
            throw err;
        }
    }

    // ── Private ─────────────────────────────────────────────────────────

    private currentClientUsername(): string {
        const user = $userWritable.get();
        if (user?.username) {
            return user.username;
        }
        return this.requireClient().me.user().username;
    }

    private async deletePersistedMessage(mailID: string): Promise<void> {
        const database = (this.client as ClientWithLocalDatabaseLike | null)
            ?.database;
        const deleteMessage = database?.deleteMessage;
        if (typeof deleteMessage !== "function") {
            debugAuth("message-delete:missing-storage", { mailID });
            return;
        }
        try {
            await deleteMessage.call(database, mailID);
        } catch (err: unknown) {
            debugAuth("message-delete:persist-failed", {
                mailID,
                message: errorMessage(err),
            });
        }
    }

    private detachWebsocketDebug(): void {
        if (!this.wsDebugSocket) {
            return;
        }
        if (this.wsDebugInboundListener) {
            this.wsDebugSocket.off("message", this.wsDebugInboundListener);
        }
        if (this.wsDebugOriginalSend) {
            this.wsDebugSocket.send = this.wsDebugOriginalSend;
        }
        this.wsDebugInboundListener = null;
        this.wsDebugOriginalSend = null;
        this.wsDebugSocket = null;
        this.logWsState("ws:debug:detached");
    }

    /**
     * Removes only the inbound-frame listener and clears the socket
     * pointer; leaves the periodic interval running so the next
     * `attachWebsocketWatchdog` call can re-bind without restarting
     * the timer.
     */
    private detachWebsocketWatchdogListener(): void {
        if (this.wsWatchdogSocket && this.wsWatchdogListener) {
            try {
                this.wsWatchdogSocket.off("message", this.wsWatchdogListener);
            } catch {
                // socket may already be in a torn-down state; ignore.
            }
        }
        this.wsWatchdogSocket = null;
        this.wsWatchdogListener = null;
    }

    private ensureFamiliarCached(userID: string): void {
        if ($familiarsWritable.get()[userID]) return;
        if (this.failedUserLookups.has(userID)) return;

        $familiarsWritable.setKey(userID, {
            lastSeen: new Date().toISOString(),
            userID,
            username: userID.slice(0, 8),
        });

        const client = this.client;
        if (!client) return;
        client.users
            .retrieve(userID)
            .then(([u]) => {
                if (u) {
                    $familiarsWritable.setKey(userID, u);
                } else {
                    this.failedUserLookups.add(userID);
                }
            })
            .catch(() => {
                this.failedUserLookups.add(userID);
            });
    }

    private extractPendingApprovalDetails(err: unknown): null | {
        challenge: null | string;
        requestID: string;
        userID: null | string;
    } {
        // libvex >=6.1.4 throws a typed error carrying both fields;
        // newer libvex/server pairings additionally carry the existing
        // user's ID so we can show their avatar in the "is this you?"
        // confirmation.
        if (
            err !== null &&
            typeof err === "object" &&
            "requestID" in err &&
            typeof (err as { requestID: unknown }).requestID === "string"
        ) {
            const requestID = (err as { requestID: string }).requestID;
            const maybeChallenge = (err as { challenge?: unknown }).challenge;
            const maybeUserID = (err as { userID?: unknown }).userID;
            return {
                challenge:
                    typeof maybeChallenge === "string" ? maybeChallenge : null,
                requestID,
                userID:
                    typeof maybeUserID === "string" && maybeUserID.length > 0
                        ? maybeUserID
                        : null,
            };
        }
        const message =
            err !== null &&
            typeof err === "object" &&
            "message" in err &&
            typeof (err as { message: unknown }).message === "string"
                ? (err as { message: string }).message
                : "";
        const match = /requestID=([0-9a-fA-F-]+)/.exec(message);
        if (match?.[1]) {
            return { challenge: null, requestID: match[1], userID: null };
        }
        return null;
    }

    private async fetchInvitePreview(
        inviteID: string,
    ): Promise<InvitePreview | null> {
        const client = this.requireClient();
        const internals = client as unknown as ClientWithInternalHttp;
        const http = internals.http;
        const get = http?.get;
        if (typeof get !== "function") {
            throw new Error("Invite previews are not supported by libvex.");
        }

        try {
            const response = await get.call(
                http,
                `${client.getHost()}/invite/${inviteID}/preview`,
            );
            return decodeInvitePreviewResponseData(
                getHttpResponseData(response),
            );
        } catch (err: unknown) {
            if (isUnauthorizedError(err)) {
                return null;
            }
            if (!isNotFoundError(err)) {
                throw err;
            }
        }

        try {
            const response = await get.call(
                http,
                `${client.getHost()}/invite/${inviteID}`,
            );
            return {
                channels: [],
                invite: decodeInviteResponseData(getHttpResponseData(response)),
                server: null,
            };
        } catch (err: unknown) {
            if (isNotFoundError(err) || isUnauthorizedError(err)) {
                return null;
            }
            throw err;
        }
    }

    private async findPendingRequestAfterRegisterFailure(
        client: Client,
        username: string,
        deviceName: string,
    ): Promise<null | string> {
        try {
            const withApprovals =
                client as unknown as ClientWithDeviceApprovals;
            let requests: DeviceApprovalRequest[] | null = null;
            if (withApprovals.devices.listRequests) {
                requests = await withApprovals.devices.listRequests();
            }
            if (!requests || requests.length === 0) {
                return null;
            }
            const pending = requests.filter((req) => req.status === "pending");
            if (pending.length === 0) {
                return null;
            }
            const ownSignKey = client.getKeys().public;
            const bySignKey = pending.find((req) => req.signKey === ownSignKey);
            if (bySignKey) {
                return bySignKey.requestID;
            }
            const byExactMeta = pending.find(
                (req) =>
                    req.username === username && req.deviceName === deviceName,
            );
            if (byExactMeta) {
                return byExactMeta.requestID;
            }
            const recent = pending
                .filter((req) => req.username === username)
                .sort(
                    (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime(),
                );
            return recent[0]?.requestID ?? null;
        } catch {
            return null;
        }
    }

    private findThreadMessage(
        conversationKey: string,
        mailID: string,
        isGroup: boolean,
    ): Message | null {
        const writable = isGroup ? $groupMessagesWritable : $messagesWritable;
        return (
            (writable.get()[conversationKey] ?? []).find(
                (message) => message.mailID === mailID,
            ) ?? null
        );
    }

    private async finishApprovedPendingDeviceLogin({
        promptForPasskey,
    }: {
        promptForPasskey: boolean;
    }): Promise<OperationResult> {
        const pending = this.activePendingDeviceApproval;
        if (!pending || !pending.approvedDeviceID) {
            return {
                error: "No approved device enrollment is waiting for sign-in.",
                ok: false,
            };
        }
        const client = this.requireClient();
        try {
            $pendingApprovalStageWritable.set("signing_in");
            let authErr: Error | null;
            try {
                if (promptForPasskey) {
                    ({ authErr } =
                        await this.loginWithDeviceKeyWithPasskeyRetry(
                            client,
                            pending.username,
                            pending.approvedDeviceID,
                        ));
                } else {
                    authErr = await this.loginWithDeviceKeyWithRetry(
                        client,
                        pending.approvedDeviceID,
                    );
                }
            } catch (err: unknown) {
                debugAuth("approvalWatcher:passkeyRetryable", {
                    message: errorMessage(err),
                });
                $pendingApprovalStageWritable.set("passkey_setup");
                return { error: errorMessage(err), ok: false };
            }
            if (authErr) {
                debugAuth("approvalWatcher:loginFailed", {
                    message: errorMessage(authErr),
                    promptForPasskey,
                });
                $pendingApprovalStageWritable.set(
                    isPasskeyRequiredError(authErr)
                        ? "passkey_setup"
                        : "failed",
                );
                return {
                    error:
                        !promptForPasskey && isPasskeyRequiredError(authErr)
                            ? "This device still needs a passkey before it can finish signing in."
                            : errorMessage(authErr),
                    ok: false,
                };
            }
            await this.saveCredentials(pending.keyStore, {
                deviceID: pending.approvedDeviceID,
                deviceKey: pending.deviceKey,
                token: "",
                username: pending.username,
            });
            $pendingApprovalStageWritable.set("loading_account");
            await client.connect();
            $userWritable.set(client.me.user());
            this.setAuthStatus("authenticated");
            this.kickPopulateState();
            debugAuth("approvalWatcher:done", {
                requestID: pending.requestID,
            });
            this.activePendingDeviceApproval = null;
            this.deferredDeviceApproval = null;
            $pendingApprovalStageWritable.set("idle");
            return { ok: true };
        } catch (err: unknown) {
            $pendingApprovalStageWritable.set("failed");
            return { error: errorMessage(err), ok: false };
        }
    }

    private handleDirectMessage(msg: Message): void {
        const me = $userWritable.get();
        const isOwnMessage = Boolean(me && msg.authorID === me.userID);
        const threadKey = isOwnMessage ? msg.readerID : msg.authorID;
        const prev = $messagesWritable.get()[threadKey] ?? [];
        if (prev.some((m) => m.mailID === msg.mailID)) return;
        if (this.applyMessageEventMessage($messagesWritable, threadKey, msg)) {
            return;
        }
        if (this.applyReactionMessage($messagesWritable, threadKey, msg)) {
            return;
        }

        $messagesWritable.setKey(threadKey, [...prev, msg]);
        this.applyPendingMessageEventMessages($messagesWritable, threadKey);
        this.applyPendingReactionMessages($messagesWritable, threadKey);

        if (!isOwnMessage) {
            const count = ($dmUnreadCountsWritable.get()[threadKey] ?? 0) + 1;
            $dmUnreadCountsWritable.setKey(threadKey, count);
        }

        this.ensureFamiliarCached(threadKey);
    }

    private handleGroupMessage(msg: Message, channelID: string): void {
        const prev = $groupMessagesWritable.get()[channelID] ?? [];
        if (prev.some((m) => m.mailID === msg.mailID)) return;
        if (
            this.applyMessageEventMessage(
                $groupMessagesWritable,
                channelID,
                msg,
            )
        ) {
            return;
        }
        if (this.applyReactionMessage($groupMessagesWritable, channelID, msg)) {
            return;
        }

        $groupMessagesWritable.setKey(channelID, [...prev, msg]);
        this.applyPendingMessageEventMessages(
            $groupMessagesWritable,
            channelID,
        );
        this.applyPendingReactionMessages($groupMessagesWritable, channelID);

        const me = $userWritable.get();
        if (me && msg.authorID !== me.userID) {
            const count =
                ($channelUnreadCountsWritable.get()[channelID] ?? 0) + 1;
            $channelUnreadCountsWritable.setKey(channelID, count);
        }
    }

    private async initClient(
        privateKey: string,
        username: string,
        config: BootstrapConfig,
        options: ServerOptions,
        allowStorageReset = false,
    ): Promise<void> {
        debugAuth("initClient:start", { host: options.host, username });
        await this.close();
        this.resetAll();

        const storage = await config.createStorage(privateKey, username);
        debugAuth("initClient:storage:ok", { username });

        const clientOptions = {
            ...options,
            deviceName: config.deviceName,
            localMessageRetentionDays: clampLocalMessageRetentionDays(
                options.localMessageRetentionDays,
            ),
        } as ClientOptions;

        this.client = await this.createClientWithRecovery(
            privateKey,
            clientOptions,
            storage,
            allowStorageReset,
            username,
        );
        debugAuth("initClient:client:create:ok", { host: options.host });
        this.configureHttpForRuntime(this.client);
        this.attachWebsocketDebug();
        this.wireEvents();
    }

    private isDeviceExistsError(err: unknown): boolean {
        return hasHttpStatus(err) && err.response.status === 470;
    }

    /**
     * Best-effort "is the WebSocket currently usable?" check, based on
     * how recently the watchdog has seen an inbound frame. A healthy
     * socket sees a server ping every ~5s, so a frame within
     * {@link WS_FRESH_FRAME_THRESHOLD_MS} is strong evidence the
     * connection is live.
     *
     * Returns false in three cases that all *should* trigger a full
     * reconnect:
     *   - No client yet (nothing to check).
     *   - Watchdog has never observed a frame on this socket.
     *   - The last frame is older than the freshness threshold (FGS
     *     got killed, OS suspended us deeper than expected, network
     *     dropped silently).
     *
     * Used by {@link refreshSessionAfterForeground} to skip an
     * unnecessary Noise+login cycle when the foreground-service kept
     * the connection alive across the resume.
     */
    private isWebsocketLikelyHealthy(): boolean {
        if (!this.client || this.wsWatchdogLastFrameAt === 0) {
            return false;
        }
        const elapsed = Date.now() - this.wsWatchdogLastFrameAt;
        return elapsed <= WS_FRESH_FRAME_THRESHOLD_MS;
    }

    private kickPopulateState(attempt = 0): void {
        void this.populateState().catch((err: unknown) => {
            debugAuth("populateState:error", {
                attempt,
                message: errorMessage(err),
            });
            if (isDecryptMismatchError(err)) {
                void this.recoverFromLocalDecryptMismatch(attempt);
                return;
            }
            if (isUnauthorizedError(err) || isNotAuthenticatedError(err)) {
                this.setAuthStatus("unauthorized");
                void this.recoverConnection("populate-state-auth");
                return;
            }
            if (isNetworkError(err)) {
                this.setAuthStatus("offline");
                void this.recoverConnection("populate-state-network");
            }
            if (attempt >= 2 || this.populateStateAbort || !this.client) {
                return;
            }
            const backoffMs = (attempt + 1) * 1500;
            setTimeout(() => {
                this.kickPopulateState(attempt + 1);
            }, backoffMs);
        });
    }

    private async loginInternal(
        username: string,
        _password: string,
        config: BootstrapConfig,
        options: ServerOptions,
        keyStore: KeyStore,
    ): Promise<AuthResult> {
        $signedOutIntentWritable.set(false);
        this.setAuthStatus("checking");
        debugAuth("login:start", { host: options.host, username });
        let creds: null | StoredCredentials = null;
        const identifier = username.trim();
        const resolvedUsername = (): string =>
            identifier.length > 0 ? identifier : (creds?.username ?? "");
        const finishLogin = async (
            client: Client,
            loadedCreds: StoredCredentials,
        ): Promise<AuthResult> => {
            const { authErr, passkeyState } =
                await this.loginWithDeviceKeyWithPasskeyRetry(
                    client,
                    loadedCreds.username,
                    loadedCreds.deviceID,
                );
            debugAuth("login:device-key:done", {
                error: authErr?.message ?? null,
                ok: !authErr,
            });
            if (authErr) {
                if (isStaleCredentialError(authErr)) {
                    debugAuth("login:stale-credentials:clearingCredentials", {
                        status: hasHttpStatus(authErr)
                            ? authErr.response.status
                            : null,
                        username: loadedCreds.username,
                    });
                    await this.clearStoredCredentials(
                        keyStore,
                        loadedCreds.username,
                    );
                    this.setAuthStatus("unauthorized");
                    return {
                        error: "Session expired. Please sign in again.",
                        ok: false,
                        requireReauth: true,
                    };
                }
                return { error: errorMessage(authErr), ok: false };
            }

            try {
                await keyStore.save({ ...loadedCreds, token: "" });
            } catch {
                /* non-fatal token update */
            }

            if (passkeyState === "not_registered") {
                await this.registerInitialPasskeyForCurrentClient(
                    config.deviceName || "This device",
                );
            }

            await client.connect();
            $userWritable.set(client.me.user());
            this.setAuthStatus("authenticated");
            this.kickPopulateState();
            return { ok: true };
        };
        try {
            creds =
                identifier.length > 0
                    ? await keyStore.load(identifier)
                    : await keyStore.load();
            const privateKey = creds?.deviceKey ?? Client.generateSecretKey();

            await this.initClient(
                privateKey,
                resolvedUsername(),
                config,
                options,
                !creds,
            );
            debugAuth("login:initClient:ok", {
                host: options.host,
                username: identifier.length > 0 ? identifier : creds?.username,
            });
            const client = this.requireClient();

            if (!creds) {
                return {
                    error: "No local device key found for this username. Register this device first.",
                    ok: false,
                };
            }
            return await finishLogin(client, creds);
        } catch (err: unknown) {
            if (isDecryptMismatchError(err)) {
                if (creds) {
                    debugAuth("login:decrypt-mismatch:recover:start", {
                        username: creds.username,
                    });
                    try {
                        await this.initClient(
                            creds.deviceKey,
                            resolvedUsername(),
                            config,
                            options,
                            true,
                        );
                        const recovered = this.requireClient();
                        const result = await finishLogin(recovered, creds);
                        if (result.ok) {
                            debugAuth("login:decrypt-mismatch:recover:ok", {
                                username: creds.username,
                            });
                        }
                        return result;
                    } catch (recoveryErr: unknown) {
                        try {
                            await this.close();
                        } catch {
                            /* ignore close errors */
                        }
                        debugAuth("login:decrypt-mismatch:recover:failed", {
                            message: errorMessage(recoveryErr),
                            username: creds.username,
                        });
                        return {
                            error: LOCAL_DECRYPT_RECOVERY_ERROR,
                            ok: false,
                        };
                    }
                }
                return {
                    error: LOCAL_DECRYPT_RECOVERY_ERROR,
                    ok: false,
                };
            }
            if (isPasskeySetupRequiredError(err)) {
                return {
                    error: initialPasskeySetupErrorMessage(err),
                    ok: false,
                    passkeySetupRequired: true,
                };
            }
            if (isStaleCredentialError(err)) {
                this.setAuthStatus("unauthorized");
            } else if (isNetworkError(err)) {
                this.setAuthStatus("offline");
            }
            return { error: errorMessage(err), ok: false };
        }
    }

    private async loginWithDeviceKeyWithPasskeyRetry(
        client: Client,
        username: string,
        deviceID?: string,
    ): Promise<{
        authErr: Error | null;
        passkeyState: PasskeySessionState;
    }> {
        let authErr = await this.loginWithDeviceKeyWithRetry(client, deviceID);
        if (!isPasskeyRequiredError(authErr)) {
            return { authErr, passkeyState: "authenticated" };
        }

        const retryUsername = passkeyRequiredUsername(authErr) ?? username;
        debugAuth("device-login:passkey-required:retry", {
            username: retryUsername,
        });
        const passkeyState =
            await this.satisfyPasskeyForCurrentClient(retryUsername);
        authErr = await this.loginWithDeviceKeyWithRetry(client, deviceID);
        return { authErr, passkeyState };
    }

    private async loginWithDeviceKeyWithRetry(
        client: Client,
        deviceID?: string,
    ): Promise<Error | null> {
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const err = await client.loginWithDeviceKey(deviceID);
            if (!err) {
                return null;
            }
            lastErr = err;
            if (isRateLimitedError(err)) {
                this.markRateLimited("loginWithDeviceKey");
            }
            if (!isRateLimitedError(err) || attempt === 2) {
                return err;
            }
            const backoffMs = 500 * 2 ** attempt;
            await waitMs(backoffMs);
        }
        return lastErr;
    }

    private logWsState(step: string, meta?: Record<string, unknown>): void {
        if (!this.wsDebugEnabled || !this.wsDebugStateLogsEnabled) {
            return;
        }
        debugAuth(step, meta);
    }

    private markRateLimited(source: string): void {
        this.pendingRateLimitNotice = true;
        debugAuth("rate-limited", { source });
    }

    private async passkeyRestorePendingDeviceInternal(
        requestID: string,
    ): Promise<PasskeyDeviceRestoreResult> {
        const pending = this.activePendingDeviceApproval;
        if (!pending || pending.requestID !== requestID) {
            return {
                error: "No pending device enrollment is available to restore.",
                ok: false,
            };
        }
        const driver = this.passkeyCeremonyDriver;
        if (!driver) {
            return {
                error: "Passkeys aren't available on this device.",
                ok: false,
            };
        }

        let client: Client;
        try {
            client = this.requireClient();
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        }

        this.stopPendingApprovalWatcher();
        $pendingApprovalStageWritable.set("signing_in");

        let recoveredDevice: Device | null = null;
        try {
            const begin = await client.passkeys.beginAuthentication(
                pending.username,
            );
            const response = await driver.authenticate(
                begin.options as PublicKeyCredentialRequestOptionsJSON,
            );
            await client.passkeys.finishAuthentication({
                requestID: begin.requestID,
                response,
            });

            recoveredDevice =
                await client.passkeys.recoverDeviceRequest(requestID);

            await this.saveCredentials(pending.keyStore, {
                deviceID: recoveredDevice.deviceID,
                deviceKey: pending.deviceKey,
                token: "",
                username: pending.username,
            });

            let authErr = await this.loginWithDeviceKeyWithRetry(
                client,
                recoveredDevice.deviceID,
            );
            if (isPasskeyRequiredError(authErr)) {
                const retryUsername =
                    passkeyRequiredUsername(authErr) ?? pending.username;
                await this.satisfyPasskeyForCurrentClient(retryUsername);
                authErr = await this.loginWithDeviceKeyWithRetry(
                    client,
                    recoveredDevice.deviceID,
                );
            }
            if (authErr) {
                return { error: errorMessage(authErr), ok: false };
            }

            $pendingApprovalStageWritable.set("loading_account");
            await client.connect();
            $userWritable.set(client.me.user());
            this.setAuthStatus("authenticated");
            this.kickPopulateState();
            this.activePendingDeviceApproval = null;
            this.deferredDeviceApproval = null;

            return {
                ok: true,
                recoveredDeviceID: recoveredDevice.deviceID,
            };
        } catch (err: unknown) {
            return { error: errorMessage(err), ok: false };
        } finally {
            if (
                recoveredDevice === null &&
                this.activePendingDeviceApproval?.requestID === requestID
            ) {
                this.startPendingApprovalWatcher(pending);
            } else {
                $pendingApprovalStageWritable.set("idle");
            }
        }
    }

    private persistAppliedMessageEvent(msg: Message, thread: Message[]): void {
        const deleteEvent = messageDeleteEvent(msg);
        if (deleteEvent) {
            for (const targetMailID of messageDeleteEventTargetMailIDs(
                deleteEvent,
            )) {
                void this.deletePersistedMessage(targetMailID);
            }
            return;
        }
        const updateEvent = messageUpdateEvent(msg);
        if (updateEvent) {
            void this.updatePersistedMessage(
                updateEvent.targetMailID,
                updateEvent.message,
                thread.find(
                    (message) => message.mailID === updateEvent.targetMailID,
                ),
            );
        }
    }

    /**
     * Hydrate servers/channels/DM history into nanostores. Runs in the
     * background after connect so the JS thread can answer WS keepalives;
     * call {@link kickPopulateState} from login paths instead of awaiting
     * unless you truly need a barrier (e.g. resume refresh with timeout).
     */
    private async populateState(): Promise<void> {
        if (this.populateStateInFlight) {
            return this.populateStateInFlight;
        }
        const owner = this.client;
        if (!owner) {
            return;
        }
        this.populateStateAbort = false;
        const p = this.runPopulateStateBody(owner);
        this.populateStateInFlight = p;
        try {
            await p;
        } finally {
            if (this.populateStateInFlight === p) {
                this.populateStateInFlight = null;
            }
        }
    }

    private queuePendingMessageEventMessage(
        conversationKey: string,
        msg: Message,
    ): void {
        let pending = this.pendingMessageEventMessages.get(conversationKey);
        if (!pending) {
            pending = new Map();
            this.pendingMessageEventMessages.set(conversationKey, pending);
        }
        pending.delete(msg.mailID);
        pending.set(msg.mailID, {
            attempts: 0,
            message: msg,
            queuedAt: Date.now(),
        });
        trimMapStart(
            pending,
            MAX_PENDING_MESSAGE_EVENT_MESSAGES_PER_CONVERSATION,
        );
        trimMapStart(
            this.pendingMessageEventMessages,
            MAX_PENDING_MESSAGE_EVENT_CONVERSATIONS,
        );
    }

    private queuePendingReactionMessage(
        conversationKey: string,
        msg: Message,
    ): void {
        let pending = this.pendingReactionMessages.get(conversationKey);
        if (!pending) {
            pending = new Map();
            this.pendingReactionMessages.set(conversationKey, pending);
        }
        pending.delete(msg.mailID);
        pending.set(msg.mailID, {
            attempts: 0,
            message: msg,
            queuedAt: Date.now(),
        });
        trimMapStart(pending, MAX_PENDING_REACTION_MESSAGES_PER_CONVERSATION);
        trimMapStart(
            this.pendingReactionMessages,
            MAX_PENDING_REACTION_CONVERSATIONS,
        );
    }

    private async recoverConnection(
        reason: string,
    ): Promise<null | ResumeNetworkStatus> {
        if (!this.client) {
            return null;
        }
        if (this.backgroundConnectionRecoverySuspended) {
            debugAuth("connection:recover:skipped", {
                reason,
                suspended: true,
            });
            return null;
        }
        if (this.connectionRecoveryInFlight) {
            return null;
        }
        const now = Date.now();
        if (now - this.lastConnectionRecoveryAt < 5000) {
            return null;
        }
        this.connectionRecoveryInFlight = true;
        this.lastConnectionRecoveryAt = now;
        debugAuth("connection:recover:start", { reason });
        try {
            const status = await this.refreshSessionAfterForeground();
            debugAuth("connection:recover:done", { reason, status });
            if (status === "unauthorized") {
                $userWritable.set(null);
            }
            return status;
        } catch (err: unknown) {
            debugAuth("connection:recover:error", {
                error: err instanceof Error ? err.message : String(err),
                reason,
            });
            return null;
        } finally {
            this.connectionRecoveryInFlight = false;
        }
    }

    private async recoverFromLocalDecryptMismatch(
        attempt: number,
    ): Promise<void> {
        const client = this.client;
        if (!client || this.populateStateAbort) {
            return;
        }
        $historyRecoveryStatusWritable.set("recovering_local_history");
        debugAuth("populateState:decrypt-mismatch:purge-history", { attempt });
        try {
            await client.messages.purge();
        } catch (purgeErr: unknown) {
            debugAuth("populateState:decrypt-mismatch:purge-failed", {
                message: errorMessage(purgeErr),
            });
            $historyRecoveryStatusWritable.set("idle");
            return;
        }
        if (this.populateStateAbort || !this.client) {
            $historyRecoveryStatusWritable.set("idle");
            return;
        }
        setTimeout(() => {
            this.kickPopulateState(attempt + 1);
        }, 200);
    }

    private async registerInitialPasskeyForCurrentClient(
        name: string,
    ): Promise<void> {
        const driver = this.passkeyCeremonyDriver;
        if (!driver) {
            throw new Error(
                "Passkey setup is required before this account can sign in on this device.",
            );
        }
        const client = this.requireClient();
        debugAuth("passkey:registerInitial:begin", { name });
        const begin = await client.passkeys.beginRegistration(name);
        debugAuth("passkey:registerInitial:challenge", {
            hasRpID:
                typeof (
                    begin.options as {
                        rp?: { id?: unknown };
                    }
                ).rp?.id === "string",
            requestID: begin.requestID,
        });
        const response = await driver.register(
            begin.options as PublicKeyCredentialCreationOptionsJSON,
        );
        debugAuth("passkey:registerInitial:native:ok", {
            hasCredentialID: typeof response["id"] === "string",
        });
        await client.passkeys.finishRegistration({
            name,
            requestID: begin.requestID,
            response,
        });
        debugAuth("passkey:registerInitial:finish:ok", {
            requestID: begin.requestID,
        });
    }

    private async registerInternal(
        username: string,
        _password: string,
        config: BootstrapConfig,
        options: ServerOptions,
        keyStore: KeyStore,
    ): Promise<AuthResult> {
        $signedOutIntentWritable.set(false);
        $pendingApprovalStageWritable.set("idle");
        this.setAuthStatus("checking");
        debugAuth("register:start", { host: options.host, username });
        try {
            this.deferredDeviceApproval = null;
            const privateKey = Client.generateSecretKey();
            debugAuth("register:initClient:begin", { host: options.host });
            await withTimeout(
                this.initClient(privateKey, username, config, options, true),
                REGISTER_STEP_TIMEOUT_MS,
                "Signup stalled while preparing local encrypted storage.",
            );
            debugAuth("register:initClient:ok", { host: options.host });
            const client = this.requireClient();
            const hasXKeyRing = Boolean(
                (client as unknown as { xKeyRing?: unknown }).xKeyRing,
            );
            debugAuth("register:precheck", { hasXKeyRing });
            if (!hasXKeyRing) {
                return {
                    error: "Local crypto keyring did not initialize. Please retry.",
                    ok: false,
                };
            }

            debugAuth("register:http:begin", {
                endpoint: `${options.host}/register`,
            });
            // Usernames are case-insensitive at the protocol level —
            // the server canonicalizes to lowercase at registration.
            // Pre-normalizing here keeps the local view (UI state,
            // logging, error messages) consistent with what will
            // eventually round-trip back as `me.user().username`.
            const registrationUsername =
                username.trim().length > 0
                    ? username.trim().toLowerCase()
                    : generateAutoProvisionUsername();
            const [user, regErr] = await withTimeout(
                client.register(registrationUsername),
                REGISTER_STEP_TIMEOUT_MS,
                `Signup stalled before reaching server registration at ${options.host}.`,
            );
            debugAuth("register:http:done", {
                hasUser: Boolean(user),
                regErr: regErr?.message ?? null,
            });
            if (regErr || !user) {
                const pending = regErr
                    ? this.extractPendingApprovalDetails(regErr)
                    : null;
                debugAuth("register:pendingDetect", {
                    hasChallenge: pending?.challenge !== null,
                    pendingRequestID: pending?.requestID ?? null,
                    regErrName: regErr?.name ?? null,
                });
                if (pending) {
                    // Server created the enrollment row but (for libvex 6.x+
                    // servers) does not notify other devices until the user
                    // confirms on this screen — see
                    // `publishDeferredDeviceApprovalAndStartWatching`.
                    if (
                        typeof pending.challenge === "string" &&
                        pending.challenge.length > 0
                    ) {
                        this.deferredDeviceApproval = {
                            challenge: pending.challenge,
                            deviceKey: privateKey,
                            deviceName: config.deviceName || "This device",
                            keyStore,
                            requestID: pending.requestID,
                            username: registrationUsername,
                        };
                    } else {
                        this.startPendingApprovalWatcher({
                            challenge: pending.challenge,
                            deviceKey: privateKey,
                            deviceName: config.deviceName || "This device",
                            keyStore,
                            requestID: pending.requestID,
                            username: registrationUsername,
                        });
                    }
                    let pendingSignKey: string | undefined;
                    try {
                        pendingSignKey = client.getKeys().public;
                    } catch {
                        pendingSignKey = undefined;
                    }
                    return {
                        error: "Device approval requested. Confirm this new device from an existing signed-in device.",
                        ok: false,
                        pendingDeviceApproval: true,
                        pendingRequestID: pending.requestID,
                        ...(pendingSignKey !== undefined
                            ? { pendingSignKey }
                            : {}),
                        ...(pending.userID !== null
                            ? { pendingUserID: pending.userID }
                            : {}),
                    };
                }
                return {
                    error: regErr?.message ?? "Registration failed",
                    ok: false,
                };
            }

            await this.saveCredentials(keyStore, {
                deviceID: client.me.device().deviceID,
                deviceKey: privateKey,
                token: "",
                username: client.me.user().username,
            });

            try {
                await withTimeout(
                    this.registerInitialPasskeyForCurrentClient(
                        config.deviceName || "This device",
                    ),
                    PASSKEY_SETUP_TIMEOUT_MS,
                    "Signup stalled while adding a passkey.",
                );
            } catch (passkeyErr: unknown) {
                debugAuth("register:passkeySetup:failed", {
                    message: errorMessage(passkeyErr),
                });
                this.setAuthStatus("unauthorized");
                return {
                    error: initialPasskeySetupErrorMessage(passkeyErr),
                    ok: false,
                    passkeySetupRequired: true,
                };
            }

            await withTimeout(
                client.connect(),
                REGISTER_STEP_TIMEOUT_MS,
                "Signup stalled while opening realtime connection.",
            );
            debugAuth("register:connect:ok", undefined);
            $userWritable.set(client.me.user());
            this.setAuthStatus("authenticated");

            this.kickPopulateState();
            debugAuth("register:populateState:kick", undefined);
            this.deferredDeviceApproval = null;
            return { ok: true };
        } catch (err: unknown) {
            debugAuth("register:catch", {
                error: err instanceof Error ? err.message : String(err),
            });
            if (isUnauthorizedError(err)) {
                this.setAuthStatus("unauthorized");
            } else if (isNetworkError(err)) {
                this.setAuthStatus("offline");
            }
            return { error: errorMessage(err), ok: false };
        }
    }

    private rememberProcessedMessageEventMailID(mailID: string): void {
        rememberProcessedMessageEventMailID(
            this.processedMessageEventMailIDs,
            mailID,
        );
    }

    private rememberProcessedReactionMailID(mailID: string): void {
        rememberProcessedReactionMailID(this.processedReactionMailIDs, mailID);
    }

    private removeServerFromLocalState(serverID: string): void {
        const servers = new Map(Object.entries($serversWritable.get()));
        servers.delete(serverID);
        $serversWritable.set(Object.fromEntries(servers));

        const channels = new Map(Object.entries($channelsWritable.get()));
        const removedChannels = channels.get(serverID) ?? [];
        channels.delete(serverID);
        $channelsWritable.set(Object.fromEntries(channels));

        const groupMessages = new Map(
            Object.entries($groupMessagesWritable.get()),
        );
        for (const channel of removedChannels) {
            groupMessages.delete(channel.channelID);
        }
        $groupMessagesWritable.set(Object.fromEntries(groupMessages));

        const permissions = Object.fromEntries(
            Object.entries($permissionsWritable.get()).filter(
                ([, permission]) => permission.resourceID !== serverID,
            ),
        );
        $permissionsWritable.set(permissions);
    }

    private requireClient(): Client {
        if (!this.client) throw new Error("Not authenticated");
        return this.client;
    }

    private resetAll(): void {
        this.stopPendingApprovalWatcher();
        this.activePendingDeviceApproval = null;
        this.deferredDeviceApproval = null;
        this.detachWebsocketDebug();
        this.stopWebsocketWatchdog();
        this.populateStateAbort = false;
        this.populateStateInFlight = null;
        this.client = null;
        this.failedUserLookups.clear();
        this.invitePreviewCache.clear();
        $authStatusWritable.set("signed_out");
        $userWritable.set(null);
        $keyReplacedWritable.set(false);
        $pendingApprovalStageWritable.set("idle");
        $historyRecoveryStatusWritable.set("idle");
        $hydrationStatusWritable.set({
            completedSteps: 0,
            ready: false,
            stage: "idle",
            totalSteps: 0,
        });
        $avatarVersionsWritable.set({});
        this.lastDeviceAuthRefreshAttemptAt = 0;
        $familiarsWritable.set({});
        $devicesWritable.set({});
        $avatarHashWritable.set(0);
        $messagesWritable.set({});
        $groupMessagesWritable.set({});
        $dmUnreadCountsWritable.set({});
        $channelUnreadCountsWritable.set({});
        $serversWritable.set({});
        $channelsWritable.set({});
        $permissionsWritable.set({});
        $onlineListsWritable.set({});
    }

    private async runPopulateStateBody(owner: Client): Promise<void> {
        const serversAcc: Record<string, Server> = {};
        const channelsAcc: Record<string, Channel[]> = {};
        const groupMessagesAcc: Record<string, Message[]> = {};
        const permsAcc: Record<string, Permission> = {};
        const familiarsAcc: Record<string, User> = {};
        const messagesAcc: Record<string, Message[]> = {};

        const shouldStop = (): boolean =>
            this.populateStateAbort || this.client !== owner;
        const shouldPublishHydrationProgress =
            !$hydrationStatusWritable.get().ready;
        let hydrationCompletedSteps = 0;
        let hydrationTotalSteps = 0;
        const publishHydrationProgress = (
            stage:
                | "loading_channels"
                | "loading_familiars"
                | "loading_group_history"
                | "loading_sessions",
        ): void => {
            if (!shouldPublishHydrationProgress) {
                return;
            }
            $hydrationStatusWritable.set({
                completedSteps: hydrationCompletedSteps,
                ready: false,
                stage,
                totalSteps: hydrationTotalSteps,
            });
        };
        if (shouldPublishHydrationProgress) {
            $hydrationStatusWritable.set({
                completedSteps: 0,
                ready: false,
                stage: "loading_channels",
                totalSteps: 1,
            });
        }
        const publishedChannelCount = (): number =>
            Object.values(channelsAcc).reduce(
                (sum, channels) => sum + channels.length,
                0,
            );
        const publishedDmMessageCount = (): number =>
            Object.values(messagesAcc).reduce(
                (sum, msgs) => sum + msgs.length,
                0,
            );
        const mergeHydratedThread = (
            userID: string,
            hydratedMsgs: Message[],
        ): Message[] => {
            const existing = $messagesWritable.get()[userID] ?? [];
            // Keep history-first ordering while preserving any newer live WS
            // arrivals already present in store.
            return deduplicateMessages(
                [...hydratedMsgs, ...existing],
                this.processedReactionMailIDs,
                this.processedMessageEventMailIDs,
            );
        };
        const mergeHydratedDmIntoStore = (): Record<string, Message[]> => {
            const prevDm = $messagesWritable.get();
            const mergedDm: Record<string, Message[]> = { ...prevDm };
            for (const [userID, hydratedMsgs] of Object.entries(messagesAcc)) {
                mergedDm[userID] = mergeHydratedThread(userID, hydratedMsgs);
            }
            return mergedDm;
        };
        const publishFamiliarsAndMessagesProgress = (
            stage: string,
            userID?: string,
        ): void => {
            if (userID && familiarsAcc[userID]) {
                $familiarsWritable.setKey(userID, familiarsAcc[userID]);
            } else {
                $familiarsWritable.set({ ...familiarsAcc });
            }
            if (userID && messagesAcc[userID]) {
                $messagesWritable.setKey(
                    userID,
                    mergeHydratedThread(userID, messagesAcc[userID]),
                );
                this.applyPendingMessageEventMessages(
                    $messagesWritable,
                    userID,
                );
                this.applyPendingReactionMessages($messagesWritable, userID);
            } else {
                $messagesWritable.set(mergeHydratedDmIntoStore());
                for (const threadKey of Object.keys(messagesAcc)) {
                    this.applyPendingMessageEventMessages(
                        $messagesWritable,
                        threadKey,
                    );
                    this.applyPendingReactionMessages(
                        $messagesWritable,
                        threadKey,
                    );
                }
            }
            debugAuth("populateState:familiars-messages:published-progress", {
                dmMessageCount: publishedDmMessageCount(),
                dmThreadCount: Object.keys(messagesAcc).length,
                familiarCount: Object.keys(familiarsAcc).length,
                stage,
            });
        };

        let bootstrapChannelsByServer: null | Record<string, Channel[]> = null;

        const loadServer = async (server: Server): Promise<void> => {
            if (shouldStop()) {
                return;
            }
            serversAcc[server.serverID] = server;
            let channels: Channel[] = [];
            try {
                if (bootstrapChannelsByServer) {
                    channels = bootstrapChannelsByServer[server.serverID] ?? [];
                } else {
                    channels = await withTimeout(
                        owner.channels.retrieve(server.serverID),
                        8_000,
                        `populateState: channels timeout for ${server.serverID}`,
                    );
                }
            } catch (err: unknown) {
                if (isDecryptMismatchError(err)) {
                    throw err;
                }
                debugAuth("populateState:channels:failed", {
                    message: errorMessage(err),
                    serverID: server.serverID,
                });
            }
            if (shouldStop()) {
                return;
            }
            channelsAcc[server.serverID] = channels;
        };

        const loadFamiliar = async (user: User): Promise<void> => {
            if (shouldStop()) {
                return;
            }
            familiarsAcc[user.userID] = user;
            try {
                const msgs = await withTimeout(
                    owner.messages.retrieve(user.userID),
                    8_000,
                    `populateState: dm history timeout for ${user.userID}`,
                );
                if (msgs.length > 0) {
                    messagesAcc[user.userID] = deduplicateMessages(
                        msgs,
                        this.processedReactionMailIDs,
                        this.processedMessageEventMailIDs,
                    );
                }
            } catch (err: unknown) {
                if (isDecryptMismatchError(err)) {
                    throw err;
                }
                debugAuth("populateState:dm-history:failed", {
                    message: errorMessage(err),
                    userID: user.userID,
                });
            }
        };

        const withBootstrap =
            owner as unknown as ClientWithServerChannelBootstrapLike;
        const serverBootstrapPromise = async (): Promise<Server[]> => {
            if (
                typeof withBootstrap.servers?.retrieveWithChannels !==
                "function"
            ) {
                return owner.servers.retrieve();
            }
            try {
                const payload = await withTimeout(
                    withBootstrap.servers.retrieveWithChannels(),
                    8_000,
                    "populateState: server bootstrap timeout",
                );
                bootstrapChannelsByServer = payload.channelsByServer;
                return payload.servers;
            } catch (err: unknown) {
                debugAuth("populateState:server-bootstrap:failed", {
                    message: errorMessage(err),
                });
                return owner.servers.retrieve();
            }
        };

        const familiarsPromise = withTimeout(
            owner.users.familiars(),
            12_000,
            "populateState: familiars timeout",
        ).catch((err: unknown) => {
            debugAuth("populateState:familiars:failed", {
                message: errorMessage(err),
            });
            return [] as User[];
        });
        const sessionsPromise = withTimeout(
            owner.sessions.retrieve(),
            12_000,
            "populateState: sessions timeout",
        ).catch((err: unknown) => {
            debugAuth("populateState:sessions:failed", {
                message: errorMessage(err),
            });
            return [];
        });

        const [servers, perms] = await Promise.all([
            withTimeout(
                serverBootstrapPromise(),
                12_000,
                "populateState: server list timeout",
            ).catch((err: unknown) => {
                debugAuth("populateState:server-list:failed", {
                    message: errorMessage(err),
                });
                return [] as Server[];
            }),
            withTimeout(
                owner.permissions.retrieve(),
                12_000,
                "populateState: permissions timeout",
            ).catch((err: unknown) => {
                debugAuth("populateState:permissions:failed", {
                    message: errorMessage(err),
                });
                return [] as Permission[];
            }),
        ]);

        if (shouldStop()) {
            return;
        }

        for (const perm of perms) {
            permsAcc[perm.permissionID] = perm;
        }

        const currentUserID = owner.me.user().userID;
        const fetchedServerIDs = new Set(servers.map((s) => s.serverID));
        const myServerPermissionIDs = new Set(
            perms
                .filter((perm) => perm.userID === currentUserID)
                .map((perm) => perm.resourceID)
                .filter((resourceID) => fetchedServerIDs.has(resourceID)),
        );
        const shouldFilterServersByMembership = myServerPermissionIDs.size > 0;
        debugAuth("populateState:server-filter", {
            currentUserID,
            fetchedServerCount: servers.length,
            serverPermissionCount: myServerPermissionIDs.size,
            shouldFilterServersByMembership,
        });

        const visibleServers = servers.filter(
            (server) =>
                !shouldFilterServersByMembership ||
                myServerPermissionIDs.has(server.serverID),
        );
        const bootstrapChannelEstimate = visibleServers.reduce(
            (sum, server) => {
                const bootChannels =
                    bootstrapChannelsByServer?.[server.serverID];
                return sum + (bootChannels?.length ?? 0);
            },
            0,
        );
        hydrationTotalSteps = Math.max(
            1,
            1 + visibleServers.length + bootstrapChannelEstimate,
        );
        hydrationCompletedSteps = 1;
        publishHydrationProgress("loading_channels");
        for (const server of visibleServers) {
            serversAcc[server.serverID] = server;
        }
        // Publish server list early so one slow history/channel request
        // cannot leave the UI empty for account-specific bad rows.
        $serversWritable.set(serversAcc);
        if (bootstrapChannelsByServer) {
            for (const server of visibleServers) {
                channelsAcc[server.serverID] =
                    bootstrapChannelsByServer[server.serverID] ?? [];
            }
            // When the one-shot bootstrap endpoint is available, publish
            // channels immediately so UI does not wait on DM/session hydration.
            $channelsWritable.set({ ...channelsAcc });
            debugAuth("populateState:channels:published-bootstrap-early", {
                channelCount: publishedChannelCount(),
                serverCount: Object.keys(channelsAcc).length,
            });
        }
        debugAuth("populateState:servers:published-early", {
            count: Object.keys(serversAcc).length,
        });

        for (const server of visibleServers) {
            try {
                await loadServer(server);
            } catch (err: unknown) {
                if (isDecryptMismatchError(err)) {
                    throw err;
                }
                debugAuth("populateState:server-load:failed", {
                    message: errorMessage(err),
                    serverID: server.serverID,
                });
            }
            // Publish progressively: reconnects / later hydration failures
            // should not strand the UI with servers visible but no channels.
            $channelsWritable.set({ ...channelsAcc });
            debugAuth("populateState:channels:published-progress", {
                channelCount: publishedChannelCount(),
                currentServerID: server.serverID,
                serverCount: Object.keys(channelsAcc).length,
            });
            hydrationCompletedSteps += 1;
            publishHydrationProgress("loading_channels");
            await waitMs(0);
        }

        const groupChannels = Object.values(channelsAcc).flatMap(
            (list) => list,
        );
        const groupHistoryCount = groupChannels.length;
        if (groupHistoryCount > 0) {
            // When we had to fetch channels per-server (no bootstrap endpoint),
            // total channel count is unknown up front; fold it in once known.
            const visibleChannelTotalFromBootstrap = visibleServers.reduce(
                (sum, server) =>
                    sum +
                    (bootstrapChannelsByServer?.[server.serverID]?.length ?? 0),
                0,
            );
            if (visibleChannelTotalFromBootstrap === 0) {
                hydrationTotalSteps += groupHistoryCount;
            }
            publishHydrationProgress("loading_group_history");
        }

        let groupIdx = 0;
        for (const channel of groupChannels) {
            if (shouldStop()) {
                return;
            }
            const startedAt = Date.now();
            try {
                const msgs = await withTimeout(
                    owner.messages.retrieveGroup(channel.channelID),
                    8_000,
                    `populateState: group history timeout for ${channel.channelID}`,
                );
                if (msgs.length > 0) {
                    groupMessagesAcc[channel.channelID] = deduplicateMessages(
                        msgs,
                        this.processedReactionMailIDs,
                        this.processedMessageEventMailIDs,
                    );
                }
                const durationMs = Date.now() - startedAt;
                if (durationMs > 1500) {
                    debugAuth("populateState:group-history:slow", {
                        channelID: channel.channelID,
                        durationMs,
                        messageCount: msgs.length,
                    });
                }
            } catch (err: unknown) {
                if (isDecryptMismatchError(err)) {
                    throw err;
                }
                debugAuth("populateState:group-history:failed", {
                    channelID: channel.channelID,
                    message: errorMessage(err),
                });
            }
            hydrationCompletedSteps += 1;
            publishHydrationProgress("loading_group_history");
            groupIdx += 1;
            if (groupIdx % 3 === 0) {
                await waitMs(0);
            }
        }

        const [familiars, sessions] = await Promise.all([
            familiarsPromise,
            sessionsPromise,
        ]);

        const uniqueFamiliars = [
            ...new Map(familiars.map((user) => [user.userID, user])).values(),
        ];
        const sessionUserIDs = [
            ...new Set(
                sessions
                    .map((session) => session.userID)
                    .filter((userID) => userID !== currentUserID),
            ),
        ];
        hydrationTotalSteps += uniqueFamiliars.length + sessionUserIDs.length;
        publishHydrationProgress("loading_familiars");

        for (const familiar of uniqueFamiliars) {
            if (shouldStop()) {
                return;
            }
            await loadFamiliar(familiar);
            publishFamiliarsAndMessagesProgress(
                `familiars:${familiar.userID.slice(0, 8)}`,
                familiar.userID,
            );
            hydrationCompletedSteps += 1;
            publishHydrationProgress("loading_familiars");
            await waitMs(0);
        }

        // Fallback: if familiar lookup is incomplete for older accounts,
        // hydrate DM history by local session user IDs so local history is
        // still visible after login.
        let sessionIdx = 0;
        for (const userID of sessionUserIDs) {
            if (shouldStop()) {
                return;
            }
            if (messagesAcc[userID]?.length) {
                hydrationCompletedSteps += 1;
                publishHydrationProgress("loading_sessions");
                continue;
            }
            try {
                const msgs = await withTimeout(
                    owner.messages.retrieve(userID),
                    8_000,
                    `populateState: session dm history timeout for ${userID}`,
                );
                if (msgs.length > 0) {
                    messagesAcc[userID] = deduplicateMessages(
                        msgs,
                        this.processedReactionMailIDs,
                        this.processedMessageEventMailIDs,
                    );
                }
                if (!familiarsAcc[userID]) {
                    const [user] = await withTimeout(
                        owner.users.retrieve(userID),
                        8_000,
                        `populateState: familiar lookup timeout for ${userID}`,
                    );
                    if (user) {
                        familiarsAcc[userID] = user;
                    }
                }
            } catch (err: unknown) {
                if (isDecryptMismatchError(err)) {
                    throw err;
                }
                debugAuth("populateState:session-history:failed", {
                    message: errorMessage(err),
                    userID,
                });
            }
            publishFamiliarsAndMessagesProgress(
                `sessions:${userID.slice(0, 8)}`,
                userID,
            );
            hydrationCompletedSteps += 1;
            publishHydrationProgress("loading_sessions");
            sessionIdx += 1;
            if (sessionIdx % 3 === 0) {
                await waitMs(0);
            }
        }

        if (shouldStop()) {
            return;
        }

        const withList = owner as unknown as ClientWithUserDeviceListLike;
        if (typeof withList.getUserDeviceList === "function") {
            try {
                const devices =
                    (await withList.getUserDeviceList(
                        owner.me.user().userID,
                    )) ?? [];
                if (!shouldStop()) {
                    $devicesWritable.setKey(owner.me.user().userID, devices);
                }
            } catch (err: unknown) {
                debugAuth("populateState:device-list:failed", {
                    message: errorMessage(err),
                    userID: owner.me.user().userID,
                });
            }
        }

        if (shouldStop()) {
            return;
        }

        $serversWritable.set(serversAcc);
        $channelsWritable.set(channelsAcc);
        $groupMessagesWritable.set(groupMessagesAcc);
        for (const channelID of Object.keys(groupMessagesAcc)) {
            this.applyPendingMessageEventMessages(
                $groupMessagesWritable,
                channelID,
            );
            this.applyPendingReactionMessages(
                $groupMessagesWritable,
                channelID,
            );
        }
        $permissionsWritable.set(permsAcc);
        $familiarsWritable.set(familiarsAcc);
        // Merge with existing DM threads so we do not wipe in-memory
        // conversations when SQLite is empty after retention prune, when
        // `retrieve` fails, or when a peer is not yet in `familiars`.
        $messagesWritable.set(mergeHydratedDmIntoStore());
        for (const threadKey of Object.keys(messagesAcc)) {
            this.applyPendingMessageEventMessages($messagesWritable, threadKey);
            this.applyPendingReactionMessages($messagesWritable, threadKey);
        }
        debugAuth("populateState:familiars-messages:published-final", {
            dmMessageCount: publishedDmMessageCount(),
            dmThreadCount: Object.keys(messagesAcc).length,
            familiarCount: Object.keys(familiarsAcc).length,
        });
        if (shouldPublishHydrationProgress) {
            $hydrationStatusWritable.set({
                completedSteps: hydrationTotalSteps,
                ready: true,
                stage: "ready",
                totalSteps: hydrationTotalSteps,
            });
        }
        $historyRecoveryStatusWritable.set("idle");
        debugAuth("populateState:complete", {
            channelCount: Object.keys(channelsAcc).length,
            channelItemCount: publishedChannelCount(),
            dmMessageCount: publishedDmMessageCount(),
            dmThreadCount: Object.keys(messagesAcc).length,
            serverCount: Object.keys(serversAcc).length,
        });
    }

    private async satisfyPasskeyForCurrentClient(
        username: string,
    ): Promise<PasskeySessionState> {
        const driver = this.passkeyCeremonyDriver;
        if (!driver) {
            return "unavailable";
        }
        const client = this.requireClient();
        let begin: PasskeySignInBegin;
        try {
            begin = await client.passkeys.beginAuthentication(username);
        } catch (err: unknown) {
            if (isUnauthorizedError(err) || isPasskeySetupRequiredError(err)) {
                return "not_registered";
            }
            throw err;
        }
        const response = await driver.authenticate(begin.options);
        await client.passkeys.finishAuthentication({
            requestID: begin.requestID,
            response,
        });
        return "authenticated";
    }

    private async saveCredentials(
        keyStore: KeyStore,
        creds: {
            deviceID: string;
            deviceKey: string;
            token: string;
            username: string;
        },
    ): Promise<void> {
        try {
            await keyStore.save(creds);
        } catch {
            /* ignore — keystore failures are non-fatal here */
        }
    }

    private async sendMessageExtra(
        conversationKey: string,
        isGroup: boolean,
        extra: string,
        recoveryReason: string,
    ): Promise<OperationResult> {
        const send = async (): Promise<void> => {
            const client =
                this.requireClient() as unknown as ClientWithMessageExtraLike;
            if (isGroup) {
                await client.messages.group(conversationKey, "", { extra });
            } else {
                await client.messages.send(conversationKey, "", { extra });
            }
        };

        try {
            await send();
            return { ok: true };
        } catch (err: unknown) {
            if (isNetworkError(err) || isNotAuthenticatedError(err)) {
                this.resetWebsocketWatchdog();
                const recovered = await this.recoverConnection(recoveryReason);
                if (recovered === "authenticated") {
                    try {
                        await send();
                        return { ok: true };
                    } catch (retryErr: unknown) {
                        if (
                            isUnauthorizedError(retryErr) ||
                            isNotAuthenticatedError(retryErr)
                        ) {
                            this.setAuthStatus("unauthorized");
                        } else if (isNetworkError(retryErr)) {
                            this.setAuthStatus("offline");
                        }
                        return { error: errorMessage(retryErr), ok: false };
                    }
                }
            }
            return { error: errorMessage(err), ok: false };
        }
    }

    private setAuthStatus(
        status:
            | "authenticated"
            | "checking"
            | "offline"
            | "signed_out"
            | "unauthorized",
    ): void {
        if ($authStatusWritable.get() !== status) {
            $authStatusWritable.set(status);
        }
    }

    private startPendingApprovalWatcher({
        challenge,
        deviceKey,
        deviceName,
        keyStore,
        requestID,
        username,
    }: {
        challenge: null | string;
        deviceKey: string;
        deviceName: string;
        keyStore: KeyStore;
        requestID: string;
        username: string;
    }): void {
        this.stopPendingApprovalWatcher();
        this.activePendingDeviceApproval = {
            challenge,
            deviceKey,
            deviceName,
            keyStore,
            requestID,
            username,
        };
        let cancelled = false;
        this.pendingApprovalWatchCancel = () => {
            cancelled = true;
        };
        debugAuth("approvalWatcher:start", {
            hasChallenge: challenge !== null,
            requestID,
            username,
        });
        $pendingApprovalStageWritable.set("waiting");
        const run = async () => {
            for (let attempt = 0; attempt < 300; attempt++) {
                if (cancelled) return;
                await waitMs(2000);
                if (cancelled) return;
                const client = this.client;
                if (!client) {
                    debugAuth("approvalWatcher:noClient", { attempt });
                    return;
                }
                const withApprovals =
                    client as unknown as ClientWithDeviceApprovals;
                const pollPendingRegistration =
                    withApprovals.devices.pollPendingRegistration;
                const usingUnauth =
                    challenge !== null &&
                    typeof pollPendingRegistration === "function";
                let pending: DeviceApprovalRequest | null = null;
                try {
                    // Prefer the unauthenticated poll when we have a challenge
                    // — the new device has no token until approval lands, so
                    // the protected getRequest/listRequests endpoints would
                    // throw "auth event not emitted" forever.
                    if (
                        usingUnauth &&
                        typeof pollPendingRegistration === "function" &&
                        challenge !== null
                    ) {
                        pending = await pollPendingRegistration({
                            challenge,
                            requestID,
                        });
                    } else if (
                        typeof withApprovals.devices.getRequest === "function"
                    ) {
                        pending =
                            await withApprovals.devices.getRequest(requestID);
                    } else if (
                        typeof withApprovals.devices.listRequests === "function"
                    ) {
                        const requests =
                            await withApprovals.devices.listRequests();
                        pending =
                            requests.find(
                                (req) => req.requestID === requestID,
                            ) ?? null;
                    }
                    debugAuth("approvalWatcher:poll", {
                        attempt,
                        method: usingUnauth
                            ? "pollPendingRegistration"
                            : "getRequest",
                        requestID,
                        status: pending?.status ?? "null",
                    });
                } catch (err: unknown) {
                    debugAuth("approvalWatcher:pollError", {
                        attempt,
                        message: errorMessage(err),
                        method: usingUnauth
                            ? "pollPendingRegistration"
                            : "getRequest",
                    });
                    continue;
                }
                if (!pending || pending.status === "pending") {
                    continue;
                }
                if (pending.status === "approved" && pending.approvedDeviceID) {
                    debugAuth("approvalWatcher:approved", {
                        approvedDeviceID: pending.approvedDeviceID,
                        requestID,
                    });
                    this.activePendingDeviceApproval = {
                        approvedDeviceID: pending.approvedDeviceID,
                        challenge,
                        deviceKey,
                        deviceName,
                        keyStore,
                        requestID,
                        username,
                    };
                    $pendingApprovalStageWritable.set("passkey_setup");
                    this.stopPendingApprovalWatcher();
                    return;
                }
                debugAuth("approvalWatcher:terminal", {
                    status: pending.status,
                });
                $pendingApprovalStageWritable.set("idle");
                this.stopPendingApprovalWatcher();
                if (this.activePendingDeviceApproval?.requestID === requestID) {
                    this.activePendingDeviceApproval = null;
                }
                return;
            }
            debugAuth("approvalWatcher:givingUp", { requestID });
            $pendingApprovalStageWritable.set("idle");
            this.stopPendingApprovalWatcher();
            if (this.activePendingDeviceApproval?.requestID === requestID) {
                this.activePendingDeviceApproval = null;
            }
        };
        void run();
    }

    private stopPendingApprovalWatcher(): void {
        if (this.pendingApprovalWatchCancel) {
            this.pendingApprovalWatchCancel();
            this.pendingApprovalWatchCancel = null;
        }
    }

    private stopWebsocketWatchdog(): void {
        if (this.wsWatchdogInterval) {
            clearInterval(this.wsWatchdogInterval);
            this.wsWatchdogInterval = null;
        }
        this.detachWebsocketWatchdogListener();
        this.wsWatchdogLastFrameAt = 0;
    }

    private subscribe<E extends keyof ClientEvents>(
        evt: E,
        fn: ClientEvents[E],
    ): void {
        const client = this.requireClient();
        client.on(evt, fn);
        this.disposable.add(() => {
            this.client?.off(evt, fn);
        });
    }

    private subscribeToDeviceRequestQueueChanges(): void {
        const client = this.requireClient() as unknown as {
            off: (event: string, fn: () => void) => void;
            on: (event: string, fn: () => void) => void;
        };
        const onQueueChanged = () => {
            for (const listener of this.deviceRequestQueueListeners) {
                try {
                    listener();
                } catch {
                    // ignore listener errors
                }
            }
        };
        client.on("deviceRequest", onQueueChanged);
        this.disposable.add(() => {
            client.off("deviceRequest", onQueueChanged);
        });
    }

    private trackAuthFlow<T>(run: () => Promise<T>): Promise<T> {
        this.authFlowInFlightCount += 1;
        try {
            return run().finally(() => {
                this.authFlowInFlightCount = Math.max(
                    0,
                    this.authFlowInFlightCount - 1,
                );
            });
        } catch (err: unknown) {
            this.authFlowInFlightCount = Math.max(
                0,
                this.authFlowInFlightCount - 1,
            );
            throw err;
        }
    }

    private unwireEvents(): void {
        this.stopWebsocketWatchdog();
        this.disposable.dispose();
    }

    private async updatePersistedMessage(
        mailID: string,
        message: string,
        updatedMessage?: Message,
    ): Promise<void> {
        const database = (this.client as ClientWithLocalDatabaseLike | null)
            ?.database;
        const updateMessage = database?.updateMessage;
        if (typeof updateMessage === "function") {
            try {
                await updateMessage.call(database, mailID, { message });
            } catch (err: unknown) {
                debugAuth("message-edit:persist-failed", {
                    mailID,
                    message: errorMessage(err),
                });
            }
            return;
        }

        const deleteMessage = database?.deleteMessage;
        const saveMessage = database?.saveMessage;
        if (
            !updatedMessage ||
            typeof deleteMessage !== "function" ||
            typeof saveMessage !== "function"
        ) {
            debugAuth("message-edit:missing-storage", { mailID });
            return;
        }
        try {
            await deleteMessage.call(database, mailID);
            await saveMessage.call(database, updatedMessage);
        } catch (err: unknown) {
            debugAuth("message-edit:persist-failed", {
                mailID,
                message: errorMessage(err),
            });
        }
    }

    private wireEvents(): void {
        this.subscribe("connected", () => {
            this.logWsState("ws:connected");
            this.setAuthStatus("authenticated");
            this.attachWebsocketDebug();
            // The underlying socket object is swapped on every
            // (re)connect, so re-bind the watchdog listener to the
            // fresh instance.
            this.attachWebsocketWatchdog();
        });
        this.subscribe("disconnect", () => {
            this.logWsState("ws:disconnect");
            this.setAuthStatus("offline");
            if (this.backgroundConnectionRecoverySuspended) {
                debugAuth("connection:recover:skipped", {
                    reason: "disconnect",
                    suspended: true,
                });
                return;
            }
            void this.recoverConnection("disconnect");
        });
        this.subscribe("message", (msg) => {
            if (msg.group) {
                this.handleGroupMessage(msg, msg.group);
            } else {
                this.handleDirectMessage(msg);
            }
        });
        this.subscribeToDeviceRequestQueueChanges();
        // Initial bind for the socket the freshly-connected client
        // already owns (in case `connected` fired before this method
        // ran, or the SDK doesn't re-emit it for the first session).
        this.attachWebsocketWatchdog();
    }

    private wrapHttpMethodsWithTimeout(http: ClientHttpLike): void {
        const wrapMethod = (
            method: (...args: unknown[]) => Promise<unknown>,
            label: string,
        ): ((...args: unknown[]) => Promise<unknown>) => {
            return async (...args: unknown[]): Promise<unknown> => {
                return withTimeout(
                    method(...args),
                    15000,
                    `HTTP ${label} timed out before dispatch/response.`,
                );
            };
        };
        if (typeof http.get === "function") {
            const original = http.get.bind(http);
            http.get = wrapMethod(original, "GET");
        }
        if (typeof http.post === "function") {
            const original = http.post.bind(http);
            http.post = wrapMethod(original, "POST");
        }
    }
}

function applyMessageEventToThread(thread: Message[], msg: Message): Message[] {
    const deleteEvent = messageDeleteEvent(msg);
    if (deleteEvent) {
        return applyMessageDeleteEvent(thread, deleteEvent, msg.authorID);
    }
    const updateEvent = messageUpdateEvent(msg);
    if (updateEvent) {
        return applyMessageUpdateEvent(thread, updateEvent, msg.authorID);
    }
    return thread;
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function debugAuth(step: string, meta?: Record<string, unknown>): void {
    if (!shouldDebugAuth()) {
        return;
    }
    try {
        const payload = meta ? ` ${JSON.stringify(meta)}` : "";

        console.log(`[vex-auth] ${step}${payload}`);
    } catch {
        console.log(`[vex-auth] ${step}`);
    }
}

function decodeInvitePreviewResponseData(data: unknown): InvitePreview {
    const decoded = decodeMsgpackHttpData(data);
    const invite = isRecord(decoded) ? decoded["invite"] : null;
    if (!isRecord(decoded) || !isRecord(invite)) {
        throw new Error("Invalid invite preview response");
    }
    const channels = decoded["channels"];
    const server = decoded["server"];
    return {
        channels: Array.isArray(channels)
            ? (channels as unknown as Channel[])
            : [],
        invite: invite as unknown as Invite,
        server: isRecord(server) ? (server as unknown as Server) : null,
    };
}

function decodeInviteResponseData(data: unknown): Invite {
    const decoded = decodeMsgpackHttpData(data);
    if (!isRecord(decoded)) {
        throw new Error("Invalid invite response");
    }
    return decoded as unknown as Invite;
}

function decodeMsgpackHttpData(data: unknown): unknown {
    if (data instanceof Uint8Array) {
        return msgpack.decode(data);
    }
    if (data instanceof ArrayBuffer) {
        return msgpack.decode(new Uint8Array(data));
    }
    throw new Error("Expected msgpack HTTP response");
}

function deduplicateMessages(
    messages: Message[],
    processedReactionMailIDs?: Set<string>,
    processedMessageEventMailIDs?: Set<string>,
): Message[] {
    const seen = new Set<string>();
    const deduped = messages.filter((m) => {
        if (seen.has(m.mailID)) return false;
        seen.add(m.mailID);
        return true;
    });
    if (processedReactionMailIDs) {
        for (const message of deduped) {
            if (messageReactionEvent(message)) {
                rememberProcessedReactionMailID(
                    processedReactionMailIDs,
                    message.mailID,
                );
            }
        }
    }
    if (processedMessageEventMailIDs) {
        for (const message of deduped) {
            if (messageDeleteEvent(message) || messageUpdateEvent(message)) {
                rememberProcessedMessageEventMailID(
                    processedMessageEventMailIDs,
                    message.mailID,
                );
            }
        }
    }
    return foldMessageEvents(deduped);
}

function describeWsFrame(data: Uint8Array): {
    bytes: number;
    hex: string;
    text: string;
} {
    const maxHexBytes = 32;
    const maxTextChars = 120;
    const shown = data.subarray(0, maxHexBytes);
    const hex = Array.from(shown)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
    const suffix = data.length > maxHexBytes ? " ..." : "";
    let text = "";
    try {
        text = new TextDecoder().decode(data).slice(0, maxTextChars);
    } catch {
        text = "<binary>";
    }
    return {
        bytes: data.length,
        hex: `${hex}${suffix}`,
        text,
    };
}

// ── VexService ──────────────────────────────────────────────────────────────

/**
 * Extract a human-readable message from an error.
 *
 * For HTTP errors, surface the server-sent body instead of
 * the generic "Request failed with status code N". libvex configures
 * binary responses so the body
 * arrives as raw bytes regardless of `Content-Type`; spire's error
 * envelopes are JSON in practice, in one of two shapes:
 *
 *   1. Flat:    { "error": "<message>" }
 *   2. Wrapped: { "error": { "message": "<message>", "requestId": "..." } }
 *
 * Both come from spire's central error pipeline (`errors.ts`). We
 * try (1) first, fall back to (2), and finally fall back to the raw
 * decoded text or the underlying error's `.message` so that nothing
 * goes silently lost.
 *
 * Without this, server-side validation failures reach the UI as
 * "Request failed with status code 400" with no detail, which makes
 * passkey / device / message errors effectively undebuggable.
 */
function errorMessage(err: unknown): string {
    const fromBody = extractServerErrorBody(err);
    if (fromBody !== null) {
        return fromBody;
    }
    return err instanceof Error ? err.message : String(err);
}

function extractServerErrorBody(err: unknown): null | string {
    if (err == null || typeof err !== "object") return null;
    const errObj = err as { response?: unknown };
    const response = errObj.response;
    if (response == null || typeof response !== "object") return null;
    const data = (response as { data?: unknown }).data;
    if (data == null) return null;

    let bodyText: null | string = null;
    if (data instanceof ArrayBuffer) {
        bodyText = new TextDecoder().decode(data);
    } else if (
        data instanceof Uint8Array ||
        (typeof data === "object" &&
            "byteLength" in data &&
            typeof (data as { byteLength: unknown }).byteLength === "number" &&
            "buffer" in data)
    ) {
        bodyText = new TextDecoder().decode(data as Uint8Array);
    } else if (typeof data === "string") {
        bodyText = data;
    } else if (typeof data === "object") {
        return readErrorField(data) ?? null;
    }

    if (bodyText === null) return null;

    try {
        const parsed: unknown = JSON.parse(bodyText);
        const fromJson = readErrorField(parsed);
        if (fromJson !== null) return fromJson;
    } catch {
        // Body wasn't JSON; fall through and return the raw text if
        // it looks usable.
    }

    const trimmed = bodyText.trim();
    if (trimmed.length > 0 && trimmed.length < 500) {
        return trimmed;
    }
    return null;
}

function extractServerErrorPayload(
    err: unknown,
): null | Record<string, unknown> {
    if (err == null || typeof err !== "object") return null;
    const errObj = err as { response?: unknown };
    const response = errObj.response;
    if (response == null || typeof response !== "object") return null;
    const data = (response as { data?: unknown }).data;
    if (data == null) return null;

    if (
        isRecord(data) &&
        !(data instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(data)
    ) {
        return data;
    }

    let bodyText: null | string = null;
    if (data instanceof ArrayBuffer) {
        bodyText = new TextDecoder().decode(data);
    } else if (
        data instanceof Uint8Array ||
        (typeof data === "object" &&
            "byteLength" in data &&
            typeof (data as { byteLength: unknown }).byteLength === "number" &&
            "buffer" in data)
    ) {
        bodyText = new TextDecoder().decode(data as Uint8Array);
    } else if (typeof data === "string") {
        bodyText = data;
    }

    if (bodyText === null) return null;

    try {
        const parsed: unknown = JSON.parse(bodyText);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function generateAutoProvisionUsername(): string {
    const bytes = new Uint8Array(4);
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
        throw new Error("Secure random generator unavailable.");
    }
    globalThis.crypto.getRandomValues(bytes);
    const entropy = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, "0"),
    ).join("");
    return `key_${entropy}`;
}

function getClientSocket(client: Client): null | WebSocketDebugLike {
    const container = client as unknown as ClientWithSocketLike;
    const maybeSocket = container.socket;
    if (!isWebSocketDebugLike(maybeSocket)) {
        return null;
    }
    return maybeSocket;
}

function getHttpResponseData(response: unknown): unknown {
    if (!isRecord(response) || !("data" in response)) {
        throw new Error("Expected HTTP response data");
    }
    return response["data"];
}

function hasHttpStatus(err: unknown): err is HttpErrorLike {
    if (!(err instanceof Error) || !("response" in err)) return false;
    const res = (err as { response: unknown }).response;
    return (
        typeof res === "object" &&
        res !== null &&
        "status" in res &&
        typeof (res as { status: unknown }).status === "number"
    );
}

function hasNotificationSubscriptionApi(client: Client): client is Client & {
    subscribeNotifications: (
        input: PushNotificationSubscriptionInput,
    ) => Promise<NotificationSubscriptionLike>;
    unsubscribeNotifications: (subscriptionID: string) => Promise<void>;
} {
    const maybeClient =
        client as unknown as ClientWithNotificationSubscriptionsLike;
    return (
        typeof maybeClient.subscribeNotifications === "function" &&
        typeof maybeClient.unsubscribeNotifications === "function"
    );
}

function hasSyncInboxNow(client: Client): client is Client & {
    syncInboxNow: () => Promise<void>;
} {
    const maybeClient = client as unknown as ClientWithSyncInboxLike;
    return typeof maybeClient.syncInboxNow === "function";
}

function initialPasskeySetupErrorMessage(err: unknown): string {
    const message = errorMessage(err).trim();
    const retry = "Tap Retry to finish passkey setup for this account.";
    if (message.length === 0) {
        return `Passkey setup did not finish. ${retry}`;
    }
    if (
        /abort|cancel|interrupt|timed out/i.test(message) ||
        isPasskeySetupRequiredError(err)
    ) {
        return `Passkey setup did not finish. ${retry}`;
    }
    const normalizedMessage = message.replace(/\.+$/, "");
    return `Passkey setup failed: ${normalizedMessage}. ${retry}`;
}

function isDecryptMismatchError(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }
    const msg = err.message.toLowerCase();
    return (
        msg.includes("failed to decrypt sealed column value") ||
        msg.includes("couldn't decrypt messages on disk")
    );
}

function isNetworkError(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }
    return /network error/i.test(err.message);
}

function isNotAuthenticatedError(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }
    return /not authenticated|no token|login first/i.test(err.message);
}

function isNotFoundError(err: unknown): boolean {
    if (hasHttpStatus(err)) {
        return err.response.status === 404;
    }
    if (err instanceof Error) {
        return /status code 404/i.test(err.message);
    }
    return false;
}

function isPasskeyRequiredError(err: unknown): boolean {
    return (
        hasHttpStatus(err) &&
        err.response.status === 403 &&
        /passkey verification required/i.test(errorMessage(err))
    );
}

function isPasskeySetupRequiredError(err: unknown): boolean {
    if (hasHttpStatus(err) && err.response.status !== 403) {
        return false;
    }
    const message = errorMessage(err);
    return (
        /passkey/i.test(message) &&
        /register|registered|setup|set up/i.test(message) &&
        /allow|allowed|before|connect/i.test(message)
    );
}

function isRateLimitedError(err: unknown): boolean {
    if (hasHttpStatus(err)) {
        return err.response.status === 429;
    }
    if (err instanceof Error) {
        return /status code 429|too many requests/i.test(err.message);
    }
    return false;
}

function isReactNativeRuntime(): boolean {
    if (typeof navigator !== "object" || navigator === null) {
        return false;
    }
    return (
        "product" in navigator &&
        (navigator as { product?: string }).product === "ReactNative"
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * "These credentials no longer authenticate."
 *
 * Both 401 and 404 from the device-auth endpoints (`/auth/device`,
 * `/auth/device/verify`, and `whoami`) mean the same thing for the
 * caller: the stored deviceID/deviceKey on this client refers to
 * something the server will no longer let us in with. 401 is the
 * classic "token rejected" path (token expired, signature failed),
 * 404 is the "your device or its owning user has been removed
 * server-side" path. Either way the recovery is identical — drop the
 * stale keychain entry and bounce the user to the sign-in flow.
 *
 * Bundling them under one predicate keeps the auth flows in this
 * file from forgetting one of the two whenever they handle the other.
 */
function isStaleCredentialError(err: unknown): boolean {
    return isUnauthorizedError(err) || isNotFoundError(err);
}

function isUnauthorizedError(err: unknown): boolean {
    if (hasHttpStatus(err)) {
        return err.response.status === 401;
    }
    if (err instanceof Error) {
        return /status code 401/i.test(err.message);
    }
    return false;
}

function isWebSocketDebugLike(value: unknown): value is WebSocketDebugLike {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as {
        off?: unknown;
        on?: unknown;
        send?: unknown;
    };
    return (
        typeof candidate.on === "function" &&
        typeof candidate.off === "function" &&
        typeof candidate.send === "function"
    );
}

function jwtExpToEpochMs(exp: number): number {
    // JWT exp is conventionally seconds since epoch; tolerate ms values too.
    return exp > 1_000_000_000_000 ? exp : exp * 1000;
}

function looksLikeReactNativeBlobError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
        normalized.includes("arraybuffer") &&
        normalized.includes("arraybufferview") &&
        normalized.includes("blob")
    );
}

function messageEventTargetMailIDs(message: Message): string[] {
    const deleteEvent = messageDeleteEvent(message);
    if (deleteEvent) {
        return messageDeleteEventTargetMailIDs(deleteEvent);
    }
    const updateEvent = messageUpdateEvent(message);
    return updateEvent ? [updateEvent.targetMailID] : [];
}

function parseNotificationSubscription(
    value: unknown,
): NotificationSubscriptionLike {
    if (
        typeof value === "object" &&
        value !== null &&
        "subscriptionID" in value &&
        typeof (value as { subscriptionID: unknown }).subscriptionID ===
            "string"
    ) {
        return {
            subscriptionID: (value as { subscriptionID: string })
                .subscriptionID,
        };
    }
    throw new Error("Invalid push subscription response.");
}

function passkeyRequiredUsername(err: unknown): null | string {
    if (!isPasskeyRequiredError(err)) {
        return null;
    }
    const payload = extractServerErrorPayload(err);
    const username = payload?.["username"];
    if (typeof username !== "string") {
        return null;
    }
    const trimmed = username.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function readErrorField(body: unknown): null | string {
    if (body == null || typeof body !== "object") return null;
    const errorField = (body as { error?: unknown }).error;
    if (typeof errorField === "string" && errorField.length > 0) {
        return errorField;
    }
    if (errorField != null && typeof errorField === "object") {
        const message = (errorField as { message?: unknown }).message;
        if (typeof message === "string" && message.length > 0) {
            return message;
        }
    }
    return null;
}

function rememberProcessedMessageEventMailID(
    processedMessageEventMailIDs: Set<string>,
    mailID: string,
): void {
    processedMessageEventMailIDs.add(mailID);
    if (
        processedMessageEventMailIDs.size <=
        MAX_PROCESSED_MESSAGE_EVENT_MAIL_IDS
    ) {
        return;
    }
    processedMessageEventMailIDs.clear();
    processedMessageEventMailIDs.add(mailID);
}

function rememberProcessedReactionMailID(
    processedReactionMailIDs: Set<string>,
    mailID: string,
): void {
    processedReactionMailIDs.add(mailID);
    if (processedReactionMailIDs.size <= MAX_PROCESSED_REACTION_MAIL_IDS) {
        return;
    }
    processedReactionMailIDs.clear();
    processedReactionMailIDs.add(mailID);
}

async function runWithFormDataDisabled<T>(fn: () => Promise<T>): Promise<T> {
    const globalWithFormData = globalThis as {
        FormData?: unknown;
    };
    const originalFormData = globalWithFormData.FormData;
    try {
        globalWithFormData.FormData = undefined;
        return await fn();
    } finally {
        globalWithFormData.FormData = originalFormData;
    }
}

function shouldDebugAuth(): boolean {
    const g = globalThis as { __DEV__?: unknown };
    if (g.__DEV__ === true) {
        return true;
    }
    const p = globalThis as {
        process?: { env?: Record<string, string | undefined> };
    };
    return p.process?.env?.["VEX_DEBUG_AUTH"] === "1";
}

function trimMapStart<TKey, TValue>(
    map: Map<TKey, TValue>,
    maxSize: number,
): void {
    while (map.size > maxSize) {
        const first = map.keys().next();
        if (first.done) {
            return;
        }
        map.delete(first.value);
    }
}

function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(timeoutMessage));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

export const vexService = new VexService();

import type { Device, User } from "@vex-chat/libvex";

import { atom, map, readonlyType } from "nanostores";

export type AuthStatus =
    | "authenticated"
    | "checking"
    | "offline"
    | "signed_out"
    | "unauthorized";

export type HistoryRecoveryStatus = "idle" | "recovering_local_history";
export type HydrationStage =
    | "idle"
    | "loading_channels"
    | "loading_familiars"
    | "loading_group_history"
    | "loading_sessions"
    | "ready";

export interface HydrationStatus {
    completedSteps: number;
    ready: boolean;
    stage: HydrationStage;
    totalSteps: number;
}

// Sub-status for the multi-device enrollment flow on the *new* (requesting)
// device. Lets the AuthenticateScreen show distinct UI states between
// "still waiting for the existing device to approve", "approval landed —
// signing in", and "signed in — loading your account" before the
// navigator swaps to the App stack on $user.
export type PendingApprovalStage =
    | "failed"
    | "idle"
    | "loading_account"
    | "signing_in"
    | "waiting";

// ── Writable (internal — only VexService imports these) ─────────────────────

export const $userWritable = atom<null | User>(null);
export const $familiarsWritable = map<Record<string, User>>({});
export const $devicesWritable = map<Record<string, Device[]>>({});
export const $avatarHashWritable = atom<number>(0);
// Per-userID cache-bust counter. Bumped whenever we know an avatar
// has changed for that user. Used by the mobile <Avatar /> component
// to decide whether to append `?v=<n>` to the GET so React Native's
// image cache picks up the new bytes.
//
// Today we only bump it for the local user (on successful setAvatar);
// updates pushed by the server for *other* users would extend this
// map once we wire that up.
export const $avatarVersionsWritable = map<Record<string, number>>({});
export const $authStatusWritable = atom<AuthStatus>("signed_out");
export const $keyReplacedWritable = atom<boolean>(false);
// True only after an explicit user sign-out. Lets the auth UI distinguish
// "fresh boot, never tried" from "user just hit Sign Out" so we don't loop
// straight back into autoLogin from the kept keychain credentials.
export const $signedOutIntentWritable = atom<boolean>(false);
export const $pendingApprovalStageWritable = atom<PendingApprovalStage>("idle");
export const $historyRecoveryStatusWritable =
    atom<HistoryRecoveryStatus>("idle");
export const $hydrationStatusWritable = atom<HydrationStatus>({
    completedSteps: 0,
    ready: false,
    stage: "idle",
    totalSteps: 0,
});

// ── Readable (public — components subscribe to these) ───────────────────────

export const $user = readonlyType($userWritable);
export const $familiars = readonlyType($familiarsWritable);
export const $devices = readonlyType($devicesWritable);
export const $avatarHash = readonlyType($avatarHashWritable);
export const $avatarVersions = readonlyType($avatarVersionsWritable);
export const $authStatus = readonlyType($authStatusWritable);
export const $keyReplaced = readonlyType($keyReplacedWritable);
export const $signedOutIntent = readonlyType($signedOutIntentWritable);
export const $pendingApprovalStage = readonlyType(
    $pendingApprovalStageWritable,
);
export const $historyRecoveryStatus = readonlyType(
    $historyRecoveryStatusWritable,
);
export const $hydrationStatus = readonlyType($hydrationStatusWritable);

import type { CallEvent, CallSession } from "@vex-chat/libvex";

import { atom, map, readonlyType } from "nanostores";

// ── Writable (internal — only VexService imports these) ─────────────────────

export const $activeCallsWritable = map<Record<string, CallSession>>({});
export const $incomingCallsWritable = map<Record<string, CallEvent>>({});
export const $currentCallIDWritable = atom<null | string>(null);
export const $latestCallEventWritable = atom<CallEvent | null>(null);

// ── Readable (public — components subscribe to these) ───────────────────────

export const $activeCalls = readonlyType($activeCallsWritable);
export const $incomingCalls = readonlyType($incomingCallsWritable);
export const $currentCallID = readonlyType($currentCallIDWritable);
export const $latestCallEvent = readonlyType($latestCallEventWritable);

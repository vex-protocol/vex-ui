import { atom } from "nanostores";

export interface CameraCaptureResult {
    height: number;
    requestId: number;
    source: CameraCaptureSource;
    uri: string;
    width: number;
}

export type CameraCaptureSource =
    | { channelID: string; kind: "channel"; serverID: string }
    | { kind: "conversation"; userID: string };

export const $cameraCaptureResult = atom<CameraCaptureResult | null>(null);

let nextRequestId = 0;

export function clearCameraCaptureResult(): void {
    $cameraCaptureResult.set(null);
}

export function nextCameraCaptureRequestId(): number {
    nextRequestId += 1;
    return nextRequestId;
}

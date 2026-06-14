import { atom } from "nanostores";

export interface CameraCaptureResult {
    height: number;
    requestId: number;
    uri: string;
    width: number;
}

export const $cameraCaptureResult = atom<CameraCaptureResult | null>(null);

let nextRequestId = 0;

export function clearCameraCaptureResult(): void {
    $cameraCaptureResult.set(null);
}

export function nextCameraCaptureRequestId(): number {
    nextRequestId += 1;
    return nextRequestId;
}

import { xRandomBytes, XUtils } from "@vex-chat/crypto";

export function decodeVexDbAtRestKey(hex: string): Uint8Array {
    const normalized = hex.trim().toLowerCase();
    if (normalized.length % 2 !== 0 || /[^0-9a-f]/u.test(normalized)) {
        throw new Error("Expected an even-length hex string.");
    }
    const key = XUtils.decodeHex(normalized);
    if (key.length !== 32) {
        throw new Error("Stored Vex DB key is not 32 bytes.");
    }
    return key;
}

export function encodeVexDbAtRestKey(key: Uint8Array): string {
    if (key.length !== 32) {
        throw new Error("Vex DB at-rest key must be 32 bytes.");
    }
    return XUtils.encodeHex(key);
}

export function generateVexDbAtRestKey(): Uint8Array {
    return xRandomBytes(32);
}

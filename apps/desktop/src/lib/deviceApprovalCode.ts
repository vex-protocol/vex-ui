const MATCHING_CODE_LENGTH = 4;

export function matchingCodeForSignKey(signKey: null | string): string[] {
    if (signKey === null || signKey.length === 0) {
        return Array.from({ length: MATCHING_CODE_LENGTH }, () => "");
    }
    const normalized = signKey.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    const raw = normalized
        .slice(0, MATCHING_CODE_LENGTH)
        .padEnd(MATCHING_CODE_LENGTH, ".");
    return raw.split("").slice(0, MATCHING_CODE_LENGTH);
}

/** Validate untrusted chat links before handing them to a browser or the OS. */
export function normalizeExternalUrl(value: unknown): null | string {
    if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) {
        return null;
    }
    try {
        const url = new URL(value.trim());
        if (
            (url.protocol !== "http:" && url.protocol !== "https:") ||
            url.username ||
            url.password
        ) {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

import { getServerOptions } from "./config.js";

export function buildAvatarUrl(
    serverUrl: string,
    userID: string,
    version?: number,
): string {
    const trimmedServerUrl = serverUrl.trim().replace(/\/+$/, "");
    const origin = /^https?:\/\//i.test(trimmedServerUrl)
        ? trimmedServerUrl
        : `${getServerOptions().unsafeHttp ? "http" : "https"}://${trimmedServerUrl}`;
    const url = new URL(`/avatar/${encodeURIComponent(userID)}`, `${origin}/`);

    if (typeof version === "number" && version > 0) {
        url.searchParams.set("v", String(version));
    }

    return url.toString();
}

import type { IncomingMessage, ServerResponse } from "node:http";

import {
    fetchPublicPreviewHtml,
    PreviewTargetError,
} from "./lib/linkPreviewFetch";
import { sendJson } from "./lib/nodeHttp";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;

interface RateBucket {
    count: number;
    resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export default async function handler(
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        sendJson(res, 405, { error: "Method not allowed" });
        return;
    }
    if (!consumeRateLimit(clientAddress(req))) {
        res.setHeader("Retry-After", "60");
        sendJson(res, 429, { error: "Too many preview requests" });
        return;
    }

    const requestURL = new URL(
        req.url ?? "/api/link-preview",
        `http://${req.headers.host ?? "localhost"}`,
    );
    const target = requestURL.searchParams.get("url") ?? "";
    if (!target) {
        sendJson(res, 400, { error: "Invalid preview URL" });
        return;
    }

    try {
        sendJson(res, 200, await fetchPublicPreviewHtml(target));
    } catch (cause: unknown) {
        sendJson(res, cause instanceof PreviewTargetError ? 400 : 422, {
            error:
                cause instanceof PreviewTargetError
                    ? cause.message
                    : "Preview unavailable",
        });
    }
}

function consumeRateLimit(key: string): boolean {
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
        rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
        pruneRateBuckets(now);
        return true;
    }
    current.count += 1;
    return current.count <= RATE_LIMIT;
}

function pruneRateBuckets(now: number): void {
    if (rateBuckets.size < 2_000) return;
    for (const [key, bucket] of rateBuckets) {
        if (bucket.resetAt <= now) rateBuckets.delete(key);
    }
}

function clientAddress(req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return (
        first?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown"
    );
}

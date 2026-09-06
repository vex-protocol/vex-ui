/**
 * Small helpers for plain Node.js `http` handlers (no Vercel / platform-specific types).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export function redirect(
    res: ServerResponse,
    location: string,
    statusCode: number = 302,
): void {
    res.writeHead(statusCode, { Location: location });
    res.end();
}

export function sendJson(
    res: ServerResponse,
    statusCode: number,
    body: unknown,
): void {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!res.hasHeader("Cache-Control")) {
        res.setHeader("Cache-Control", "private, no-store");
    }
    res.end(JSON.stringify(body));
}

export function sendText(
    res: ServerResponse,
    statusCode: number,
    body: string,
    contentType: string = "text/plain; charset=utf-8",
): void {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", contentType);
    res.end(body);
}

export class RequestBodyTooLarge extends Error {}

/** Bound memory even for chunked requests or an incorrect Content-Length. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const limit = 16 * 1024;
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
        if (Number(req.headers["content-length"]) > limit) {
            throw new RequestBodyTooLarge("Request body is too large");
        }
        // Keep the socket available so the caller can send an error response.
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            const buffer: Buffer = Buffer.isBuffer(chunk)
                ? (chunk as Buffer)
                : Buffer.from(chunk as string);
            bytes += buffer.length;
            if (bytes > limit) {
                throw new RequestBodyTooLarge("Request body is too large");
            }
            chunks.push(buffer);
        }
        const raw = Buffer.concat(chunks, bytes).toString("utf8");
        return raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
    } finally {
        // Discard unread bytes after a rejection instead of retaining them.
        req.resume();
    }
}

export function sendJsonBodyError(res: ServerResponse, cause: unknown): void {
    const tooLarge = cause instanceof RequestBodyTooLarge;
    sendJson(res, tooLarge ? 413 : 400, {
        error: tooLarge ? "body_too_large" : "invalid_json",
    });
}

/** True when cookies should use the `Secure` flag (HTTPS). */
export function useSecureCookies(): boolean {
    return (
        process.env.NODE_ENV === "production" ||
        process.env.FORCE_SECURE_COOKIES === "1"
    );
}

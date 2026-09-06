import { EventEmitter } from "node:events";
import http, { type IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    isPublicPreviewAddress,
    fetchPublicPreviewHtml,
    PreviewTargetError,
    validatePreviewURL,
} from "./linkPreviewFetch";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function mockTransport(status: number, headers: Record<string, string>) {
    const response = Object.assign(new PassThrough(), {
        statusCode: status,
        headers,
    });
    const request = Object.assign(new EventEmitter(), {
        destroy: vi.fn((error?: Error) => {
            if (error) request.emit("error", error);
            response.destroy();
            return request;
        }),
    });
    vi.spyOn(http, "get").mockImplementation(((
        _options: unknown,
        callback: (response: IncomingMessage) => void,
    ) => {
        queueMicrotask(() => callback(response as unknown as IncomingMessage));
        return request;
    }) as unknown as typeof http.get);
    return { request, response };
}

describe("preview response resource limits", () => {
    it("cancels a non-HTML response without draining an arbitrary body", async () => {
        const { response } = mockTransport(200, {
            "content-type": "application/octet-stream",
        });
        await expect(fetchPublicPreviewHtml("http://8.8.8.8/")).rejects.toThrow(
            "not HTML",
        );
        expect(response.destroyed).toBe(true);
    });

    it("finishes at the exact size cap without waiting for another chunk", async () => {
        const { response } = mockTransport(200, {
            "content-type": "text/html",
        });
        const result = fetchPublicPreviewHtml("http://8.8.8.8/");
        response.write(Buffer.alloc(512 * 1024, "x"));
        await expect(result).resolves.toEqual({
            finalUrl: "http://8.8.8.8/",
            html: "x".repeat(512 * 1024),
        });
        expect(response.destroyed).toBe(true);
    });

    it("enforces an elapsed deadline even while the peer sends data", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { request, response } = mockTransport(200, {
            "content-type": "text/html",
        });
        const assertion = expect(
            fetchPublicPreviewHtml("http://8.8.8.8/"),
        ).rejects.toThrow("timed out");
        for (let i = 0; i < 8; i++) {
            response.write("x");
            await vi.advanceTimersByTimeAsync(1000);
        }
        await assertion;
        expect(request.destroy).toHaveBeenCalled();
    });

    it("clears the deadline after a complete response", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { request, response } = mockTransport(200, {
            "content-type": "text/html",
        });
        const result = fetchPublicPreviewHtml("http://8.8.8.8/");
        response.end("<title>Vex</title>");
        await expect(result).resolves.toMatchObject({
            html: "<title>Vex</title>",
        });
        await vi.advanceTimersByTimeAsync(8000);
        expect(request.destroy).not.toHaveBeenCalled();
    });
});

describe("validatePreviewURL", () => {
    it("accepts public HTTP URLs and removes fragments", () => {
        expect(
            validatePreviewURL(
                "https://example.com/path?q=1#private",
            ).toString(),
        ).toBe("https://example.com/path?q=1");
    });

    it.each([
        "file:///etc/passwd",
        "ftp://example.com/file",
        "http://user:password@example.com",
        "https://example.com:8443",
        "http://localhost",
        "http://service.internal",
        "http://router.local",
        "http://127.0.0.1",
        "http://[::1]",
        "http://[::ffff:127.0.0.1]",
    ])("rejects unsafe target %s", (target) => {
        expect(() => validatePreviewURL(target)).toThrow(PreviewTargetError);
    });
});

describe("isPublicPreviewAddress", () => {
    it.each([
        "0.0.0.0",
        "10.20.30.40",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.168.1.1",
        "198.51.100.9",
        "224.0.0.1",
        "::",
        "::1",
        "::ffff:8.8.8.8",
        "64:ff9b::808:808",
        "fc00::1",
        "fe80::1",
        "2001:db8::1",
    ])("blocks non-public address %s", (address) => {
        expect(isPublicPreviewAddress(address)).toBe(false);
    });

    it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
        "allows public address %s",
        (address) => {
            expect(isPublicPreviewAddress(address)).toBe(true);
        },
    );
});

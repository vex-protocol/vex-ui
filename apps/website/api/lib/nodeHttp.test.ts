import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { readJsonBody, RequestBodyTooLarge, sendJson } from "./nodeHttp";

function request(contentLength?: string): IncomingMessage {
    return Object.assign(new PassThrough(), {
        headers: { "content-length": contentLength },
    }) as unknown as IncomingMessage;
}

describe("readJsonBody", () => {
    it("reads split UTF-8 and empty bodies", async () => {
        const req = request();
        const result = readJsonBody(req);
        const body = Buffer.from('{"login":"é"}');
        req.push(body.subarray(0, 11));
        req.push(body.subarray(11));
        req.push(null);
        await expect(result).resolves.toEqual({ login: "é" });
        const empty = request();
        empty.push(null);
        await expect(readJsonBody(empty)).resolves.toEqual({});
    });

    it("rejects an oversized declared body before reading it", async () => {
        const req = request("16385");
        await expect(readJsonBody(req)).rejects.toBeInstanceOf(
            RequestBodyTooLarge,
        );
        expect(req.destroyed).toBe(false);
        req.destroy();
    });

    it.each([undefined, "1"])(
        "bounds streamed bytes independently of Content-Length %s",
        async (length) => {
            const req = request(length);
            const result = readJsonBody(req);
            const assertion =
                expect(result).rejects.toBeInstanceOf(RequestBodyTooLarge);
            req.push(Buffer.alloc(16384, " "));
            req.push(Buffer.from("x"));
            await assertion;
            expect(req.destroyed).toBe(false);
            expect(req.listenerCount("readable")).toBe(0);
            req.destroy();
        },
    );

    it("accepts exactly the byte limit", async () => {
        const req = request();
        req.push(Buffer.from('"' + "a".repeat(16382) + '"'));
        req.push(null);
        await expect(readJsonBody(req)).resolves.toHaveLength(16382);
    });

    it("rejects invalid JSON and interrupted requests", async () => {
        const invalid = request();
        invalid.push("{");
        invalid.push(null);
        await expect(readJsonBody(invalid)).rejects.toBeInstanceOf(SyntaxError);
        const aborted = request();
        const assertion = expect(readJsonBody(aborted)).rejects.toThrow(
            "aborted",
        );
        aborted.destroy(new Error("aborted"));
        await assertion;
    });
});

describe("sendJson", () => {
    it.each([false, true])(
        "preserves explicit cache policy: %s",
        (hasPolicy) => {
            const res = {
                setHeader: vi.fn(),
                hasHeader: vi.fn(() => hasPolicy),
                end: vi.fn(),
            };
            sendJson(res as unknown as ServerResponse, 200, {
                authenticated: true,
            });
            if (hasPolicy) {
                expect(res.setHeader).not.toHaveBeenCalledWith(
                    "Cache-Control",
                    expect.anything(),
                );
            } else {
                expect(res.setHeader).toHaveBeenCalledWith(
                    "Cache-Control",
                    "private, no-store",
                );
            }
        },
    );
});

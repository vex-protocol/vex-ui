import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { clientAddress } from "./link-preview";

describe("clientAddress", () => {
    it("ignores caller-controlled forwarding headers by default", () => {
        const request = mockRequest(
            {
                "x-forwarded-for": "198.51.100.10",
                "x-vercel-forwarded-for": "198.51.100.11",
                "x-vex-client-ip": "198.51.100.12",
            },
            "127.0.0.1",
        );

        expect(clientAddress(request, {})).toBe("127.0.0.1");
    });

    it("uses Vercel's platform-owned client address on Vercel", () => {
        const request = mockRequest({
            "x-forwarded-for": "198.51.100.10",
            "x-vercel-forwarded-for": "203.0.113.20",
        });

        expect(clientAddress(request, { VERCEL: "1" })).toBe("203.0.113.20");
    });

    it("supports an explicitly trusted proxy header", () => {
        const request = mockRequest({
            "x-forwarded-for": "198.51.100.10",
            "x-vex-client-ip": "203.0.113.30",
        });

        expect(clientAddress(request, { VEX_WEB_TRUST_PROXY: "1" })).toBe(
            "203.0.113.30",
        );
    });

    it("rejects ambiguous or invalid trusted header values", () => {
        const request = mockRequest(
            { "x-vex-client-ip": "203.0.113.30, 198.51.100.10" },
            "10.0.0.2",
        );

        expect(clientAddress(request, { VEX_WEB_TRUST_PROXY: "1" })).toBe(
            "10.0.0.2",
        );
    });
});

function mockRequest(
    headers: IncomingHttpHeaders,
    remoteAddress = "10.0.0.1",
): IncomingMessage {
    return { headers, socket: { remoteAddress } } as IncomingMessage;
}

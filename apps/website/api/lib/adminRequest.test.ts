import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAdminLogin, requireAdminRequest } from "./adminRequest";
import { isClaAdmin } from "./adminAuth";
import { seal } from "./siteSession";

vi.mock("./adminAuth", () => ({ isClaAdmin: vi.fn() }));

function response() {
    return {
        statusCode: 0,
        setHeader: vi.fn(),
        hasHeader: vi.fn(() => false),
        end: vi.fn(),
    };
}

function request(cookie?: string): IncomingMessage {
    return Object.assign(new PassThrough(), {
        headers: { cookie },
        method: "POST",
    }) as unknown as IncomingMessage;
}

beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-secret");
    vi.stubEnv("CLA_SESSION_SECRET", "");
    vi.mocked(isClaAdmin).mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("admin request validation", () => {
    it.each(["GET", "PUT"])(
        "rejects %s without checking membership",
        async (method) => {
            const req = request();
            req.method = method;
            const res = response();
            expect(
                await requireAdminRequest(
                    req,
                    res as unknown as ServerResponse,
                    "POST",
                ),
            ).toBeNull();
            expect(res.statusCode).toBe(405);
            expect(isClaAdmin).not.toHaveBeenCalled();
        },
    );

    it("rejects an unconfigured or unsigned request", async () => {
        const res = response();
        expect(
            await requireAdminRequest(
                request(),
                res as unknown as ServerResponse,
                "POST",
            ),
        ).toBeNull();
        expect(res.statusCode).toBe(401);
        vi.stubEnv("SESSION_SECRET", "");
        expect(
            await requireAdminRequest(
                request(),
                res as unknown as ServerResponse,
                "POST",
            ),
        ).toBeNull();
        expect(res.statusCode).toBe(503);
        expect(isClaAdmin).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        "requires current admin membership: %s",
        async (admin) => {
            const session = {
                v: 1,
                login: "maintainer",
                id: 2,
                exp: 4_000_000_000,
                oauth_access_token: "test-oauth-token",
            };
            const req = request(`gh_session=${seal("test-secret", session)}`);
            const res = response();
            vi.mocked(isClaAdmin).mockResolvedValue(admin);
            const result = await requireAdminRequest(
                req,
                res as unknown as ServerResponse,
                "POST",
            );
            expect(isClaAdmin).toHaveBeenCalledExactlyOnceWith(
                "maintainer",
                "test-oauth-token",
            );
            expect(result).toEqual(admin ? session : null);
            if (!admin) expect(res.statusCode).toBe(403);
        },
    );

    it.each(['{"login":"bad/name"}', "null", "{", '{"login":12}'])(
        "rejects invalid login body %s",
        async (body) => {
            const req = request();
            req.push(body);
            req.push(null);
            const res = response();
            expect(
                await readAdminLogin(req, res as unknown as ServerResponse),
            ).toBeNull();
            expect(res.statusCode).toBe(400);
        },
    );

    it("normalizes valid logins and sends 413 for oversized bodies", async () => {
        const req = request();
        req.push('{"login":" contributor "}');
        req.push(null);
        expect(
            await readAdminLogin(req, response() as unknown as ServerResponse),
        ).toBe("contributor");
        const large = request();
        large.push(Buffer.alloc(16385));
        large.push(null);
        const res = response();
        expect(
            await readAdminLogin(large, res as unknown as ServerResponse),
        ).toBeNull();
        expect(res.statusCode).toBe(413);
    });
});

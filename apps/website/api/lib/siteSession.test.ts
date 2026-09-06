import type { IncomingMessage } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readGithubSession } from "./ghSession";
import { sanitizeNextPath } from "./safeNextPath";
import { open, parseCookies, seal, siteOriginFromRequest } from "./siteSession";

afterEach(() => vi.unstubAllEnvs());

describe("cookie parsing", () => {
    it("ignores malformed percent escapes without discarding a valid session", () => {
        const token = seal("secret", {
            v: 1,
            login: "user",
            id: 1,
            exp: 4_000_000_000,
        });
        const req = {
            headers: { cookie: `broken=%E0%A4%A; gh_session=${token}` },
        } as IncomingMessage;
        expect(readGithubSession(req, "secret")?.login).toBe("user");
    });

    it("has no inherited cookie names or prototype setters", () => {
        expect(parseCookies(undefined).constructor).toBeUndefined();
        const cookies = parseCookies("__proto__=value; constructor=other");
        expect(Object.getPrototypeOf(cookies)).toBeNull();
        expect(cookies.__proto__).toBe("value");
        expect(cookies.constructor).toBe("other");
    });

    it("rejects tampered signatures and non-object signed payloads", () => {
        const token = seal("secret", { login: "user" });
        expect(open("wrong", token)).toBeNull();
        expect(open("secret", token + "x")).toBeNull();
        expect(
            open(
                "secret",
                seal("secret", [] as unknown as Record<string, unknown>),
            ),
        ).toBeNull();
    });

    it.each([0, 1.5, null, "4000000000"])(
        "rejects invalid session expiry %s",
        (exp) => {
            const token = seal("secret", { v: 1, login: "user", id: 1, exp });
            expect(
                readGithubSession(
                    {
                        headers: { cookie: `gh_session=${token}` },
                    } as IncomingMessage,
                    "secret",
                ),
            ).toBeNull();
        },
    );
});

describe("OAuth redirects", () => {
    it.each([
        "//evil.example",
        "/\t/evil.example",
        "/\r\nLocation:evil",
        "/\\evil.example",
        "https://evil.example",
    ])("rejects unsafe next path %s", (path) =>
        expect(sanitizeNextPath(path)).toBeUndefined(),
    );

    it("keeps a local path without its query or fragment", () => {
        expect(sanitizeNextPath("/cla-admin?test=1#section")).toBe(
            "/cla-admin",
        );
    });

    it.each(["localhost:5173", "127.0.0.1:5173", "[::1]:5173"])(
        "keeps local development on %s",
        (host) => {
            vi.stubEnv("SITE_ORIGIN", "https://vex.wtf");
            expect(
                siteOriginFromRequest({ headers: { host } } as IncomingMessage),
            ).toBe(`http://${host}`);
        },
    );

    it.each([
        "localhost:80@evil.example",
        "localhost:5173/evil",
        "localhost:bad",
        "localhost.evil.example",
    ])("does not trust a malformed local host %s", (host) => {
        vi.stubEnv("SITE_ORIGIN", "https://vex.wtf");
        expect(
            siteOriginFromRequest({ headers: { host } } as IncomingMessage),
        ).toBe("https://vex.wtf");
    });
});

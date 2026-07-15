import type { User } from "@vex-chat/libvex";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { $authStatusWritable, $userWritable } from "../domains/identity.ts";
import { vexService } from "../service.ts";

interface MockHttp {
    delete?: (...args: unknown[]) => Promise<unknown>;
    get?: (...args: unknown[]) => Promise<unknown>;
    patch?: (...args: unknown[]) => Promise<unknown>;
    post?: (...args: unknown[]) => Promise<unknown>;
    put?: (...args: unknown[]) => Promise<unknown>;
}

interface ServiceInternals {
    client: null | SessionClient;
    configureHttpForRuntime: (client: SessionClient) => void;
    resetAll: () => void;
}

interface SessionClient {
    http?: MockHttp;
    loginWithDeviceKey: ReturnType<typeof vi.fn>;
    me: {
        device: ReturnType<typeof vi.fn>;
        user: ReturnType<typeof vi.fn>;
    };
    whoami: ReturnType<typeof vi.fn>;
}

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000;
const me = { userID: "user-blood", username: "blood" } as User;
const service = vexService as unknown as ServiceInternals;

function httpError(status: number): Error & { response: { status: number } } {
    return Object.assign(
        new Error(`Request failed with status code ${String(status)}`),
        { response: { status } },
    );
}

function installClient(client: SessionClient): void {
    service.client = client;
    $userWritable.set(me);
    $authStatusWritable.set("authenticated");
}

function makeClient(overrides: Partial<SessionClient> = {}): SessionClient {
    return {
        loginWithDeviceKey: vi.fn(async () => null),
        me: {
            device: vi.fn(() => ({ deviceID: "device-blood" })),
            user: vi.fn(() => me),
        },
        whoami: vi.fn(async () => ({
            exp: (Date.now() + HOUR_MS) / 1000,
            user: me,
        })),
        ...overrides,
    };
}

describe("vexService session refresh", () => {
    beforeEach(() => {
        service.resetAll();
    });

    afterEach(() => {
        service.resetAll();
        vi.useRealTimers();
    });

    test("renews the token before its server-provided expiry", async () => {
        vi.useFakeTimers();
        const now = Date.UTC(2026, 6, 15, 12);
        vi.setSystemTime(now);
        const initialExpiry = now + HOUR_MS;
        let refreshed = false;
        const client = makeClient({
            loginWithDeviceKey: vi.fn(async () => {
                refreshed = true;
                return null;
            }),
            whoami: vi.fn(async () => ({
                exp: (refreshed ? Date.now() + HOUR_MS : initialExpiry) / 1000,
                user: me,
            })),
        });
        installClient(client);

        await expect(vexService.probeAuthSession()).resolves.toBe(
            "authenticated",
        );
        expect(client.loginWithDeviceKey).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(HOUR_MS - REFRESH_THRESHOLD_MS);

        expect(client.loginWithDeviceKey).toHaveBeenCalledOnce();
        expect(client.loginWithDeviceKey).toHaveBeenCalledWith("device-blood");
        expect(client.whoami).toHaveBeenCalledTimes(3);
        expect($authStatusWritable.get()).toBe("authenticated");
    });

    test("shares one device-key refresh across concurrent expired-token probes", async () => {
        let releaseLogin = (): void => undefined;
        const loginGate = new Promise<void>((resolve) => {
            releaseLogin = resolve;
        });
        let tokenValid = false;
        const client = makeClient({
            loginWithDeviceKey: vi.fn(async () => {
                await loginGate;
                tokenValid = true;
                return null;
            }),
            whoami: vi.fn(async () => {
                if (!tokenValid) {
                    throw httpError(401);
                }
                return { exp: (Date.now() + HOUR_MS) / 1000, user: me };
            }),
        });
        installClient(client);

        const first = vexService.probeAuthSession();
        const second = vexService.probeAuthSession();
        await vi.waitFor(() => {
            expect(client.loginWithDeviceKey).toHaveBeenCalledOnce();
        });
        releaseLogin();

        await expect(Promise.all([first, second])).resolves.toEqual([
            "authenticated",
            "authenticated",
        ]);
        expect(client.loginWithDeviceKey).toHaveBeenCalledOnce();
        expect(client.whoami).toHaveBeenCalledTimes(3);
    });

    test("refreshes once and retries concurrent authenticated HTTP requests", async () => {
        let releaseLogin = (): void => undefined;
        const loginGate = new Promise<void>((resolve) => {
            releaseLogin = resolve;
        });
        let tokenValid = false;
        const get = vi.fn(async () => {
            if (!tokenValid) {
                throw httpError(401);
            }
            return { data: "ok" };
        });
        const client = makeClient({
            http: { get },
            loginWithDeviceKey: vi.fn(async () => {
                await loginGate;
                tokenValid = true;
                return null;
            }),
            whoami: vi.fn(async () => ({
                exp: (Date.now() + HOUR_MS) / 1000,
                user: me,
            })),
        });
        installClient(client);
        service.configureHttpForRuntime(client);

        const first = client.http?.get?.("https://dev.vex.wtf/server");
        const second = client.http?.get?.("https://dev.vex.wtf/channel");
        await vi.waitFor(() => {
            expect(client.loginWithDeviceKey).toHaveBeenCalledOnce();
        });
        releaseLogin();

        await expect(Promise.all([first, second])).resolves.toEqual([
            { data: "ok" },
            { data: "ok" },
        ]);
        expect(client.loginWithDeviceKey).toHaveBeenCalledOnce();
        expect(client.whoami).toHaveBeenCalledOnce();
        expect(get).toHaveBeenCalledTimes(4);
    });

    test("does not recurse when a session-maintenance route returns 401", async () => {
        const post = vi.fn(async () => {
            throw httpError(401);
        });
        const client = makeClient({ http: { post } });
        installClient(client);
        service.configureHttpForRuntime(client);

        const maintenancePaths = [
            "/auth",
            "/auth/device",
            "/auth/device/verify",
            "/goodbye",
            "/whoami",
        ];
        for (const path of maintenancePaths) {
            await expect(
                client.http?.post?.(`https://dev.vex.wtf${path}`),
            ).rejects.toMatchObject({ response: { status: 401 } });
        }

        expect(client.loginWithDeviceKey).not.toHaveBeenCalled();
        expect(post).toHaveBeenCalledTimes(maintenancePaths.length);
    });

    test("keeps a transient refresh failure offline instead of expiring the account", async () => {
        const client = makeClient({
            loginWithDeviceKey: vi.fn(async () => new Error("Network error")),
            whoami: vi.fn(async () => {
                throw httpError(401);
            }),
        });
        installClient(client);

        await expect(vexService.probeAuthSession()).resolves.toBe("offline");

        expect(client.loginWithDeviceKey).toHaveBeenCalledOnce();
        expect($authStatusWritable.get()).toBe("offline");
        expect($userWritable.get()).toEqual(me);
    });
});

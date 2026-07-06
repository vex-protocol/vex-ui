import type { BootstrapConfig, ServerOptions } from "../service.ts";
import type { KeyStore, Storage } from "@vex-chat/libvex";

import { beforeEach, describe, expect, test, vi } from "vitest";

const libvexMock = vi.hoisted(() => ({
    create: vi.fn(),
    generateSecretKey: vi.fn(() => "generated-private-key"),
}));

vi.mock("@vex-chat/libvex", () => ({
    Client: {
        create: libvexMock.create,
        generateSecretKey: libvexMock.generateSecretKey,
    },
}));

import { vexService } from "../service.ts";

type MockClient = {
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    me: {
        device: ReturnType<typeof vi.fn>;
        user: ReturnType<typeof vi.fn>;
    };
    off: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    passkeys: {
        beginRegistration: ReturnType<typeof vi.fn>;
        finishRegistration: ReturnType<typeof vi.fn>;
    };
    register: ReturnType<typeof vi.fn>;
    xKeyRing: Record<string, never>;
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function makeClient(): MockClient {
    return {
        close: vi.fn(async () => undefined),
        connect: vi.fn(async () => undefined),
        me: {
            device: vi.fn(() => ({ deviceID: "device-blood" })),
            user: vi.fn(() => ({ userID: "user-blood", username: "blood" })),
        },
        off: vi.fn(),
        on: vi.fn(),
        passkeys: {
            beginRegistration: vi.fn(async () => ({
                options: {
                    challenge: "challenge",
                    pubKeyCredParams: [{ alg: -7, type: "public-key" }],
                    rp: { id: "api.vex.wtf", name: "Vex" },
                    user: {
                        displayName: "blood",
                        id: "user-blood",
                        name: "blood",
                    },
                },
                requestID: "passkey-request",
            })),
            finishRegistration: vi.fn(async () => ({
                createdAt: "2026-05-22T00:00:00.000Z",
                lastUsedAt: null,
                name: "test-device",
                passkeyID: "passkey-blood",
                transports: [],
                userID: "user-blood",
            })),
        },
        register: vi.fn(async () => [
            { userID: "user-blood", username: "blood" },
            null,
        ]),
        xKeyRing: {},
    };
}

function makeConfig(): BootstrapConfig {
    return {
        createStorage: vi.fn(async () => ({}) as Storage),
        deviceName: "test-device",
    };
}

function makeKeyStore(): {
    keyStore: KeyStore;
    saveCredentials: ReturnType<typeof vi.fn>;
} {
    const saveCredentials = vi.fn(async () => undefined);
    return {
        keyStore: {
            clear: vi.fn(async () => undefined),
            load: vi.fn(async () => null),
            save: saveCredentials,
        },
        saveCredentials,
    };
}

async function waitForMockCall(mock: ReturnType<typeof vi.fn>): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
        if (mock.mock.calls.length > 0) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("Expected mock to be called.");
}

describe("vexService.register password-first signup", () => {
    beforeEach(async () => {
        await vexService.close();
        vexService.setPasskeyCeremonyDriver(null);
        libvexMock.create.mockReset();
        libvexMock.generateSecretKey.mockReset();
        libvexMock.generateSecretKey.mockReturnValue("generated-private-key");
    });

    test("passes the password through and connects without initial passkey setup", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        const registerPasskey = vi.fn();
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(),
            register: registerPasskey,
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.register(
            "Blood",
            "correct horse",
            config,
            options,
            keyStore,
        );

        expect(result).toEqual({ ok: true });
        expect(client.register).toHaveBeenCalledWith("blood", "correct horse");
        expect(saveCredentials).toHaveBeenCalledWith({
            deviceID: "device-blood",
            deviceKey: "generated-private-key",
            token: "",
            username: "blood",
        });
        expect(client.passkeys.beginRegistration).not.toHaveBeenCalled();
        expect(client.passkeys.finishRegistration).not.toHaveBeenCalled();
        expect(registerPasskey).not.toHaveBeenCalled();
        expect(client.connect).toHaveBeenCalledOnce();
    });

    test("reports an auth flow while registration is in flight", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        const registration =
            deferred<[{ userID: string; username: string }, null]>();
        client.register.mockReturnValueOnce(registration.promise);
        libvexMock.create.mockResolvedValueOnce(client);

        const resultPromise = vexService.register(
            "blood",
            "correct horse",
            config,
            options,
            keyStore,
        );

        await waitForMockCall(client.register);
        expect(vexService.isAuthFlowInFlight()).toBe(true);

        registration.resolve([
            { userID: "user-blood", username: "blood" },
            null,
        ]);
        await expect(resultPromise).resolves.toEqual({ ok: true });
        expect(vexService.isAuthFlowInFlight()).toBe(false);
    });

    test("does not require a passkey ceremony driver for signup", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.register(
            "blood",
            "correct horse",
            config,
            options,
            keyStore,
        );

        expect(result).toEqual({ ok: true });
        expect(client.register).toHaveBeenCalledWith("blood", "correct horse");
        expect(client.passkeys.beginRegistration).not.toHaveBeenCalled();
        expect(client.connect).toHaveBeenCalledOnce();
        expect(saveCredentials).toHaveBeenCalledOnce();
    });

    test("surfaces a password registration error without saving credentials", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        const regErr = new Error(
            "Password is required to register a new account.",
        );
        client.register.mockResolvedValueOnce([null, regErr]);
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.register(
            "blood",
            "",
            config,
            options,
            keyStore,
        );

        expect(result).toEqual({
            error: "Password is required to register a new account.",
            ok: false,
        });
        expect(client.register).toHaveBeenCalledWith("blood", "");
        expect(saveCredentials).not.toHaveBeenCalled();
        expect(client.passkeys.beginRegistration).not.toHaveBeenCalled();
        expect(client.connect).not.toHaveBeenCalled();
    });

    test("returns connect errors without asking for a passkey", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        client.connect.mockRejectedValueOnce(new Error("network error"));
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.register(
            "blood",
            "correct horse",
            config,
            options,
            keyStore,
        );

        expect(result).toEqual({
            error: "network error",
            ok: false,
        });
        expect(client.passkeys.beginRegistration).not.toHaveBeenCalled();
        expect(client.passkeys.finishRegistration).not.toHaveBeenCalled();
        expect(client.connect).toHaveBeenCalledOnce();
        expect(saveCredentials).toHaveBeenCalledOnce();
    });
});

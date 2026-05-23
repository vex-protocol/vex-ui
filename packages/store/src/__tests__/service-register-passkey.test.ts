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

describe("vexService.register passkey setup", () => {
    beforeEach(async () => {
        await vexService.close();
        vexService.setPasskeyCeremonyDriver(null);
        libvexMock.create.mockReset();
        libvexMock.generateSecretKey.mockReset();
        libvexMock.generateSecretKey.mockReturnValue("generated-private-key");
    });

    test("keeps the new account retryable when required passkey setup fails", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        const registerPasskey = vi.fn(async () => {
            throw new Error("aborted");
        });
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(),
            register: registerPasskey,
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.register(
            "Blood",
            "",
            config,
            options,
            keyStore,
        );

        expect(result).toEqual({
            error: "Passkey setup did not finish. Tap Retry to finish passkey setup for this account.",
            ok: false,
            passkeySetupRequired: true,
        });
        expect(client.register).toHaveBeenCalledWith("blood");
        expect(saveCredentials).toHaveBeenCalledWith({
            deviceID: "device-blood",
            deviceKey: "generated-private-key",
            token: "",
            username: "blood",
        });
        expect(client.passkeys.beginRegistration).toHaveBeenCalledWith(
            "test-device",
        );
        expect(registerPasskey).toHaveBeenCalledOnce();
        expect(client.passkeys.finishRegistration).not.toHaveBeenCalled();
        expect(client.connect).not.toHaveBeenCalled();
    });

    test("can complete required passkey setup after signup already created the account", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        const response = { id: "credential-blood" };
        const registerPasskey = vi
            .fn()
            .mockRejectedValueOnce(new Error("aborted"))
            .mockResolvedValueOnce(response);
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(),
            register: registerPasskey,
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const first = await vexService.register(
            "blood",
            "",
            config,
            options,
            keyStore,
        );
        const second = await vexService.completeInitialPasskeySetup(config);

        expect(first).toMatchObject({
            ok: false,
            passkeySetupRequired: true,
        });
        expect(second).toEqual({ ok: true });
        expect(client.passkeys.beginRegistration).toHaveBeenCalledTimes(2);
        expect(client.passkeys.finishRegistration).toHaveBeenCalledWith({
            name: "test-device",
            requestID: "passkey-request",
            response,
        });
        expect(client.connect).toHaveBeenCalledOnce();
    });

    test("does not require another passkey when reconnect fails after setup retry", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        const response = { id: "credential-blood" };
        const registerPasskey = vi
            .fn()
            .mockRejectedValueOnce(new Error("aborted"))
            .mockResolvedValueOnce(response);
        client.connect.mockRejectedValueOnce(new Error("network error"));
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(),
            register: registerPasskey,
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const first = await vexService.register(
            "blood",
            "",
            config,
            options,
            keyStore,
        );
        const second = await vexService.completeInitialPasskeySetup(config);

        expect(first).toMatchObject({
            ok: false,
            passkeySetupRequired: true,
        });
        expect(second).toEqual({
            error: "network error",
            ok: false,
        });
        expect(second).not.toHaveProperty("passkeySetupRequired");
        expect(client.passkeys.beginRegistration).toHaveBeenCalledTimes(2);
        expect(client.passkeys.finishRegistration).toHaveBeenCalledWith({
            name: "test-device",
            requestID: "passkey-request",
            response,
        });
        expect(client.connect).toHaveBeenCalledOnce();
    });

    test("finishes signup when the required passkey is registered", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "api.vex.wtf" };
        const response = { id: "credential-blood" };
        const registerPasskey = vi.fn(async () => response);
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(),
            register: registerPasskey,
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.register(
            "blood",
            "",
            config,
            options,
            keyStore,
        );

        expect(result).toEqual({ ok: true });
        expect(client.passkeys.finishRegistration).toHaveBeenCalledWith({
            name: "test-device",
            requestID: "passkey-request",
            response,
        });
        expect(client.connect).toHaveBeenCalledOnce();
        expect(saveCredentials).toHaveBeenCalledOnce();
    });
});

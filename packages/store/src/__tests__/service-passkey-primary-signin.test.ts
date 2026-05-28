import type { BootstrapConfig, ServerOptions } from "../service.ts";
import type { KeyStore, Storage, StoredCredentials } from "@vex-chat/libvex";

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
    channels: { retrieve: ReturnType<typeof vi.fn> };
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    devices: {
        publishPendingRegistration: ReturnType<typeof vi.fn>;
    };
    getKeys: ReturnType<typeof vi.fn>;
    loginWithDeviceKey: ReturnType<typeof vi.fn>;
    me: {
        device: ReturnType<typeof vi.fn>;
        user: ReturnType<typeof vi.fn>;
    };
    messages: {
        purge: ReturnType<typeof vi.fn>;
        retrieve: ReturnType<typeof vi.fn>;
        retrieveGroup: ReturnType<typeof vi.fn>;
    };
    off: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    passkeys: {
        beginAuthentication: ReturnType<typeof vi.fn>;
        beginRegistration: ReturnType<typeof vi.fn>;
        finishAuthentication: ReturnType<typeof vi.fn>;
        finishRegistration: ReturnType<typeof vi.fn>;
    };
    permissions: { retrieve: ReturnType<typeof vi.fn> };
    register: ReturnType<typeof vi.fn>;
    servers: {
        retrieve: ReturnType<typeof vi.fn>;
        retrieveWithChannels: ReturnType<typeof vi.fn>;
    };
    sessions: { retrieve: ReturnType<typeof vi.fn> };
    users: {
        familiars: ReturnType<typeof vi.fn>;
        retrieve: ReturnType<typeof vi.fn>;
    };
    xKeyRing: Record<string, never>;
};

function makeClient(): MockClient {
    return {
        channels: { retrieve: vi.fn(async () => []) },
        close: vi.fn(async () => undefined),
        connect: vi.fn(async () => undefined),
        devices: {
            publishPendingRegistration: vi.fn(async () => undefined),
        },
        getKeys: vi.fn(() => ({ public: "new-device-sign-key" })),
        loginWithDeviceKey: vi.fn(async () => null),
        me: {
            device: vi.fn(() => ({ deviceID: "device-blood" })),
            user: vi.fn(() => ({ userID: "user-blood", username: "blood" })),
        },
        messages: {
            purge: vi.fn(async () => undefined),
            retrieve: vi.fn(async () => []),
            retrieveGroup: vi.fn(async () => []),
        },
        off: vi.fn(),
        on: vi.fn(),
        passkeys: {
            beginAuthentication: vi.fn(async () => ({
                options: { challenge: "passkey-challenge" },
                requestID: "passkey-request",
            })),
            beginRegistration: vi.fn(async () => ({
                options: { challenge: "registration-challenge" },
                requestID: "registration-request",
            })),
            finishAuthentication: vi.fn(async () => ({
                passkeyID: "passkey-blood",
                token: "passkey-token",
                user: { userID: "user-blood", username: "blood" },
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
        permissions: { retrieve: vi.fn(async () => []) },
        register: vi.fn(async () => [
            null,
            Object.assign(new Error("Device approval required."), {
                challenge: "a".repeat(64),
                requestID: "pending-request",
                userID: "user-blood",
            }),
        ]),
        servers: {
            retrieve: vi.fn(async () => []),
            retrieveWithChannels: vi.fn(async () => ({
                channelsByServer: {},
                servers: [],
            })),
        },
        sessions: { retrieve: vi.fn(async () => []) },
        users: {
            familiars: vi.fn(async () => []),
            retrieve: vi.fn(async () => []),
        },
        xKeyRing: {},
    };
}

function makeConfig(): BootstrapConfig {
    return {
        createStorage: vi.fn(async () => ({}) as Storage),
        deviceName: "test-device",
    };
}

function makeKeyStore(creds: null | StoredCredentials): {
    keyStore: KeyStore;
    saveCredentials: ReturnType<typeof vi.fn>;
} {
    const saveCredentials = vi.fn(async () => undefined);
    return {
        keyStore: {
            clear: vi.fn(async () => undefined),
            load: vi.fn(async () => creds),
            save: saveCredentials,
        },
        saveCredentials,
    };
}

describe("vexService passkey-primary sign-in", () => {
    beforeEach(async () => {
        await vexService.close();
        vexService.setPasskeyCeremonyDriver(null);
        libvexMock.create.mockReset();
        libvexMock.generateSecretKey.mockReset();
        libvexMock.generateSecretKey.mockReturnValue("generated-private-key");
    });

    test("uses passkey account auth before signing in a saved local device", async () => {
        const creds: StoredCredentials = {
            deviceID: "device-blood",
            deviceKey: "0".repeat(64),
            token: "old-token",
            username: "blood",
        };
        const client = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore(creds);
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const authenticate = vi.fn(async () => ({ id: "assertion" }));
        vexService.setPasskeyCeremonyDriver({
            authenticate,
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const auth = await vexService.authenticateAccountWithPasskey(
            "Blood",
            config,
            options,
            keyStore,
        );
        const finish =
            await vexService.finishPasskeyAuthenticatedDeviceSignIn(keyStore);

        expect(auth).toEqual({
            hasLocalDevice: true,
            ok: true,
            userID: "user-blood",
            username: "blood",
        });
        expect(
            (config.createStorage as ReturnType<typeof vi.fn>).mock.calls[0],
        ).toEqual([creds.deviceKey, "blood"]);
        expect(client.passkeys.beginAuthentication).toHaveBeenCalledWith(
            "blood",
        );
        expect(authenticate).toHaveBeenCalledWith({
            challenge: "passkey-challenge",
        });
        expect(client.passkeys.finishAuthentication).toHaveBeenCalledWith({
            requestID: "passkey-request",
            response: { id: "assertion" },
        });
        expect(finish).toEqual({ ok: true });
        expect(client.loginWithDeviceKey).toHaveBeenCalledWith("device-blood");
        expect(saveCredentials).toHaveBeenCalledWith({ ...creds, token: "" });
        expect(client.connect).toHaveBeenCalledOnce();
    });

    test("requests cluster approval after passkey auth when no local device key exists", async () => {
        const authClient = makeClient();
        const enrollmentClient = makeClient();
        enrollmentClient.me.device.mockReturnValue({ deviceID: "new-device" });
        const config = makeConfig();
        const { keyStore } = makeKeyStore(null);
        const options: ServerOptions = { host: "dev.vex.wtf" };
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(async () => ({ id: "assertion" })),
            register: vi.fn(),
        });
        libvexMock.create
            .mockResolvedValueOnce(authClient)
            .mockResolvedValueOnce(enrollmentClient);

        const auth = await vexService.authenticateAccountWithPasskey(
            "blood",
            config,
            options,
            keyStore,
        );
        const finish =
            await vexService.finishPasskeyAuthenticatedDeviceSignIn(keyStore);
        const approval =
            await vexService.requestDeviceApprovalForPasskeyAuthenticatedAccount(
                config,
                options,
                keyStore,
            );

        expect(auth).toMatchObject({
            hasLocalDevice: false,
            ok: true,
            username: "blood",
        });
        expect(finish).toEqual({
            needsDeviceApproval: true,
            ok: false,
            userID: "user-blood",
            username: "blood",
        });
        expect(enrollmentClient.register).toHaveBeenCalledWith("blood");
        expect(
            enrollmentClient.devices.publishPendingRegistration,
        ).toHaveBeenCalledWith({
            challenge: "a".repeat(64),
            requestID: "pending-request",
        });
        expect(approval).toMatchObject({
            ok: false,
            pendingDeviceApproval: true,
            pendingRequestID: "pending-request",
            pendingSignKey: "new-device-sign-key",
        });
    });
});

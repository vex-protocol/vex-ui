import type { BootstrapConfig, ServerOptions } from "../service.ts";
import type { KeyStore, Storage, StoredCredentials } from "@vex-chat/libvex";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
        pollPendingRegistration: ReturnType<typeof vi.fn>;
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
    requestDeviceEnrollmentWithPasskey: ReturnType<typeof vi.fn>;
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
            pollPendingRegistration: vi.fn(async () => ({
                approvedDeviceID: "new-device",
                createdAt: "2026-05-22T00:00:00.000Z",
                deviceName: "test-device",
                expiresAt: "2026-05-22T00:10:00.000Z",
                requestID: "pending-request",
                signKey: "new-device-sign-key",
                status: "approved",
                username: "blood",
            })),
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
        requestDeviceEnrollmentWithPasskey: vi.fn(async () => [
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
        vi.useRealTimers();
        await vexService.close();
        vexService.setPasskeyCeremonyDriver(null);
        libvexMock.create.mockReset();
        libvexMock.generateSecretKey.mockReset();
        libvexMock.generateSecretKey.mockReturnValue("generated-private-key");
    });

    afterEach(async () => {
        vi.clearAllTimers();
        vi.useRealTimers();
        await vexService.close();
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

    test("falls through to registration when passkey begin returns unauthorized", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore } = makeKeyStore(null);
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const authenticate = vi.fn();
        const err = Object.assign(new Error("Request failed with status 401"), {
            response: {
                data: "Not Authorized",
                status: 401,
            },
        });
        client.passkeys.beginAuthentication.mockRejectedValueOnce(err);
        vexService.setPasskeyCeremonyDriver({
            authenticate,
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const auth = await vexService.authenticateAccountWithPasskey(
            "NewBlood",
            config,
            options,
            keyStore,
        );

        expect(auth).toEqual({
            error: "Not Authorized",
            ok: false,
            shouldTryDeviceApproval: true,
            userCancelled: false,
        });
        expect(client.passkeys.beginAuthentication).toHaveBeenCalledWith(
            "newblood",
        );
        expect(authenticate).not.toHaveBeenCalled();
    });

    test("requests cluster approval after passkey auth when no local device key exists", async () => {
        const authClient = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore(null);
        const options: ServerOptions = { host: "dev.vex.wtf" };
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(async () => ({ id: "assertion" })),
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(authClient);

        const auth = await vexService.authenticateAccountWithPasskey(
            "blood",
            config,
            options,
            keyStore,
        );
        const finish =
            await vexService.finishPasskeyAuthenticatedDeviceSignIn(keyStore);
        vi.useFakeTimers();
        const approval =
            await vexService.requestDeviceApprovalForPasskeyAuthenticatedAccount(
                config,
                options,
                keyStore,
            );
        const duplicateApproval =
            await vexService.requestDeviceApprovalForPasskeyAuthenticatedAccount(
                config,
                options,
                keyStore,
            );
        await vi.advanceTimersByTimeAsync(2000);

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
        expect(libvexMock.create).toHaveBeenCalledOnce();
        expect(
            authClient.requestDeviceEnrollmentWithPasskey,
        ).toHaveBeenCalledWith("blood");
        expect(
            authClient.requestDeviceEnrollmentWithPasskey,
        ).toHaveBeenCalledOnce();
        expect(
            authClient.devices.publishPendingRegistration,
        ).toHaveBeenCalledWith({
            challenge: "a".repeat(64),
            requestID: "pending-request",
        });
        expect(
            authClient.devices.publishPendingRegistration,
        ).toHaveBeenCalledOnce();
        expect(authClient.devices.pollPendingRegistration).toHaveBeenCalledWith(
            {
                challenge: "a".repeat(64),
                requestID: "pending-request",
            },
        );
        expect(authClient.loginWithDeviceKey).toHaveBeenCalledWith(
            "new-device",
        );
        expect(saveCredentials).toHaveBeenCalledWith({
            deviceID: "new-device",
            deviceKey: "generated-private-key",
            token: "",
            username: "blood",
        });
        expect(authClient.connect).toHaveBeenCalledOnce();
        expect(approval).toMatchObject({
            ok: false,
            pendingDeviceApproval: true,
            pendingRequestID: "pending-request",
            pendingSignKey: "new-device-sign-key",
        });
        expect(duplicateApproval).toMatchObject({
            ok: false,
            pendingDeviceApproval: true,
            pendingRequestID: "pending-request",
            pendingSignKey: "new-device-sign-key",
        });
    });

    test("retries publishing an unpublished passkey approval request", async () => {
        const authClient = makeClient();
        authClient.devices.publishPendingRegistration
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(undefined);
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore(null);
        const options: ServerOptions = { host: "dev.vex.wtf" };
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(async () => ({ id: "assertion" })),
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(authClient);

        await vexService.authenticateAccountWithPasskey(
            "blood",
            config,
            options,
            keyStore,
        );
        await vexService.finishPasskeyAuthenticatedDeviceSignIn(keyStore);
        vi.useFakeTimers();

        const failed =
            await vexService.requestDeviceApprovalForPasskeyAuthenticatedAccount(
                config,
                options,
                keyStore,
            );
        const retry =
            await vexService.requestDeviceApprovalForPasskeyAuthenticatedAccount(
                config,
                options,
                keyStore,
            );
        await vi.advanceTimersByTimeAsync(2000);

        expect(failed).toEqual({
            error: "offline",
            ok: false,
        });
        expect(retry).toMatchObject({
            ok: false,
            pendingDeviceApproval: true,
            pendingRequestID: "pending-request",
            pendingSignKey: "new-device-sign-key",
        });
        expect(
            authClient.requestDeviceEnrollmentWithPasskey,
        ).toHaveBeenCalledOnce();
        expect(
            authClient.devices.publishPendingRegistration,
        ).toHaveBeenCalledTimes(2);
        expect(authClient.devices.pollPendingRegistration).toHaveBeenCalledWith(
            {
                challenge: "a".repeat(64),
                requestID: "pending-request",
            },
        );
        expect(saveCredentials).toHaveBeenCalledWith({
            deviceID: "new-device",
            deviceKey: "generated-private-key",
            token: "",
            username: "blood",
        });
    });
});

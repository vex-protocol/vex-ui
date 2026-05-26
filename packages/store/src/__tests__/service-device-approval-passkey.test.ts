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

import { $pendingApprovalStage } from "../domains/identity.ts";
import { vexService } from "../service.ts";

type MockClient = {
    channels: { retrieve: ReturnType<typeof vi.fn> };
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    devices: {
        approveRequest: ReturnType<typeof vi.fn>;
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
        finishAuthentication: ReturnType<typeof vi.fn>;
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
            approveRequest: vi.fn(async () => undefined),
            pollPendingRegistration: vi.fn(async () => ({
                approvedDeviceID: "new-device",
                createdAt: "2026-05-22T00:00:00.000Z",
                deviceName: "ios",
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
            finishAuthentication: vi.fn(async () => ({
                passkeyID: "passkey-blood",
                token: "passkey-token",
                user: { userID: "user-blood", username: "blood" },
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
        deviceName: "ios",
    };
}

function makeKeyStore(creds?: StoredCredentials): {
    keyStore: KeyStore;
    saveCredentials: ReturnType<typeof vi.fn>;
} {
    const saveCredentials = vi.fn(async () => undefined);
    return {
        keyStore: {
            clear: vi.fn(async () => undefined),
            load: vi.fn(async () => creds ?? null),
            save: saveCredentials,
        },
        saveCredentials,
    };
}

function makePasskeyRequiredError(username = "blood"): Error {
    return Object.assign(new Error("Request failed with status code 403"), {
        response: {
            data: new TextEncoder().encode(
                JSON.stringify({
                    error: "Passkey verification required.",
                    username,
                }),
            ),
            status: 403,
        },
    });
}

describe("vexService device approval passkeys", () => {
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

    test("approves a pending device request with a passkey assertion from the approving device", async () => {
        const client = makeClient();
        const creds: StoredCredentials = {
            deviceID: "device-blood",
            deviceKey: "0".repeat(64),
            token: "old-token",
            username: "blood",
        };
        const { keyStore } = makeKeyStore(creds);
        const config = makeConfig();
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const authenticate = vi.fn(async () => ({ id: "assertion" }));
        libvexMock.create.mockResolvedValueOnce(client);

        await expect(
            vexService.autoLogin(keyStore, config, options),
        ).resolves.toEqual({ ok: true });

        vexService.setPasskeyCeremonyDriver({
            authenticate,
            register: vi.fn(),
        });
        await expect(
            vexService.approveDeviceRequest("pending-request"),
        ).resolves.toEqual({ ok: true });

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
        expect(client.devices.approveRequest).toHaveBeenCalledWith(
            "pending-request",
        );
        expect(client.loginWithDeviceKey).toHaveBeenCalledTimes(2);
        expect(client.loginWithDeviceKey.mock.calls[0]).toEqual([
            "device-blood",
        ]);
        expect(client.loginWithDeviceKey.mock.calls[1]).toEqual([undefined]);
    });

    test("does not ask the newly approved device for a passkey before device-key login", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const authenticate = vi.fn(async () => ({ id: "assertion" }));
        vexService.setPasskeyCeremonyDriver({
            authenticate,
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const pending = await vexService.register(
            "Blood",
            "",
            config,
            options,
            keyStore,
        );

        expect(pending.pendingDeviceApproval).toBe(true);

        vi.useFakeTimers();
        await expect(
            vexService.publishDeferredDeviceApprovalAndStartWatching(keyStore),
        ).resolves.toEqual({ ok: true });
        await vi.advanceTimersByTimeAsync(2000);

        expect(client.devices.publishPendingRegistration).toHaveBeenCalledWith({
            challenge: "a".repeat(64),
            requestID: "pending-request",
        });
        expect(client.devices.pollPendingRegistration).toHaveBeenCalledWith({
            challenge: "a".repeat(64),
            requestID: "pending-request",
        });
        expect(client.passkeys.beginAuthentication).not.toHaveBeenCalled();
        expect(authenticate).not.toHaveBeenCalled();
        expect(saveCredentials).toHaveBeenCalledWith({
            deviceID: "new-device",
            deviceKey: "generated-private-key",
            token: "",
            username: "blood",
        });
        expect(client.loginWithDeviceKey).toHaveBeenCalledWith("new-device");
        expect(client.connect).toHaveBeenCalledOnce();
    });

    test("retries an approved new device without prompting passkey on that device", async () => {
        const client = makeClient();
        const passkeyRequired = makePasskeyRequiredError();
        client.loginWithDeviceKey
            .mockResolvedValueOnce(passkeyRequired)
            .mockResolvedValueOnce(passkeyRequired)
            .mockResolvedValueOnce(null);
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const authenticate = vi.fn(async () => ({ id: "assertion" }));
        vexService.setPasskeyCeremonyDriver({
            authenticate,
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const pending = await vexService.register(
            "Blood",
            "",
            config,
            options,
            keyStore,
        );

        expect(pending.pendingDeviceApproval).toBe(true);

        vi.useFakeTimers();
        await expect(
            vexService.publishDeferredDeviceApprovalAndStartWatching(keyStore),
        ).resolves.toEqual({ ok: true });
        await vi.advanceTimersByTimeAsync(2000);
        await vi.advanceTimersByTimeAsync(750);
        await vi.advanceTimersByTimeAsync(750);

        expect(client.passkeys.beginAuthentication).not.toHaveBeenCalled();
        expect(authenticate).not.toHaveBeenCalled();
        expect(client.loginWithDeviceKey).toHaveBeenNthCalledWith(
            1,
            "new-device",
        );
        expect(client.loginWithDeviceKey).toHaveBeenNthCalledWith(
            2,
            "new-device",
        );
        expect(client.loginWithDeviceKey).toHaveBeenNthCalledWith(
            3,
            "new-device",
        );
        expect(saveCredentials).toHaveBeenCalledWith({
            deviceID: "new-device",
            deviceKey: "generated-private-key",
            token: "",
            username: "blood",
        });
        expect(client.connect).toHaveBeenCalledOnce();
    });

    test("does not save credentials or prompt passkey when approved device-key login keeps requiring passkey", async () => {
        const client = makeClient();
        const passkeyRequired = makePasskeyRequiredError();
        client.loginWithDeviceKey.mockResolvedValue(passkeyRequired);
        const config = makeConfig();
        const { keyStore, saveCredentials } = makeKeyStore();
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const authenticate = vi.fn(async () => ({ id: "assertion" }));
        vexService.setPasskeyCeremonyDriver({
            authenticate,
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const pending = await vexService.register(
            "Blood",
            "",
            config,
            options,
            keyStore,
        );

        expect(pending.pendingDeviceApproval).toBe(true);

        vi.useFakeTimers();
        await expect(
            vexService.publishDeferredDeviceApprovalAndStartWatching(keyStore),
        ).resolves.toEqual({ ok: true });
        await vi.advanceTimersByTimeAsync(2000 + 20 * 750 + 100);

        expect(client.passkeys.beginAuthentication).not.toHaveBeenCalled();
        expect(authenticate).not.toHaveBeenCalled();
        expect(saveCredentials).not.toHaveBeenCalled();
        expect(client.connect).not.toHaveBeenCalled();
        expect($pendingApprovalStage.get()).toBe("failed");
    });
});

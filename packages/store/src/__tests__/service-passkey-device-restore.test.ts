import type { BootstrapConfig, ServerOptions } from "../service.ts";
import type { KeyStore, Storage } from "@vex-chat/libvex";

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
        approveDeviceRequest: ReturnType<typeof vi.fn>;
        beginAuthentication: ReturnType<typeof vi.fn>;
        deleteDevice: ReturnType<typeof vi.fn>;
        finishAuthentication: ReturnType<typeof vi.fn>;
        listDevices: ReturnType<typeof vi.fn>;
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
            pollPendingRegistration: vi.fn(async () => ({
                createdAt: "2026-05-22T00:00:00.000Z",
                deviceName: "android",
                expiresAt: "2026-05-22T00:10:00.000Z",
                requestID: "pending-request",
                signKey: "new-device-sign-key",
                status: "pending",
                username: "blood",
            })),
            publishPendingRegistration: vi.fn(async () => undefined),
        },
        getKeys: vi.fn(() => ({ public: "new-device-sign-key" })),
        loginWithDeviceKey: vi.fn(async () => null),
        me: {
            device: vi.fn(() => ({ deviceID: "new-device" })),
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
            approveDeviceRequest: vi.fn(async () => ({
                deleted: false,
                deviceID: "new-device",
                lastLogin: "2026-05-22T00:00:00.000Z",
                name: "android",
                owner: "user-blood",
                signKey: "new-device-sign-key",
            })),
            beginAuthentication: vi.fn(async () => ({
                options: { challenge: "passkey-challenge" },
                requestID: "passkey-request",
            })),
            deleteDevice: vi.fn(async () => undefined),
            finishAuthentication: vi.fn(async () => ({
                passkeyID: "passkey-blood",
                token: "passkey-token",
                user: { userID: "user-blood", username: "blood" },
            })),
            listDevices: vi.fn(async () => [
                {
                    deleted: false,
                    deviceID: "new-device",
                    lastLogin: "2026-05-22T00:00:00.000Z",
                    name: "android",
                    owner: "user-blood",
                    signKey: "new-device-sign-key",
                },
                {
                    deleted: false,
                    deviceID: "old-device-1",
                    lastLogin: "2026-05-21T00:00:00.000Z",
                    name: "ios",
                    owner: "user-blood",
                    signKey: "old-sign-key-1",
                },
                {
                    deleted: false,
                    deviceID: "old-device-2",
                    lastLogin: "2026-05-20T00:00:00.000Z",
                    name: "macos",
                    owner: "user-blood",
                    signKey: "old-sign-key-2",
                },
            ]),
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
        deviceName: "android",
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

describe("vexService passkey device restore", () => {
    beforeEach(async () => {
        vi.useRealTimers();
        await vexService.close();
        vexService.setPasskeyCeremonyDriver(null);
        libvexMock.create.mockReset();
        libvexMock.generateSecretKey.mockReset();
        libvexMock.generateSecretKey.mockReturnValue("generated-private-key");
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    test("approves the pending device with passkey and deletes other devices", async () => {
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

        const restored =
            await vexService.passkeyRestorePendingDevice("pending-request");

        expect(restored).toEqual({
            approvedDeviceID: "new-device",
            deletedDeviceCount: 2,
            ok: true,
        });
        expect(client.devices.publishPendingRegistration).toHaveBeenCalledWith({
            challenge: "a".repeat(64),
            requestID: "pending-request",
        });
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
        expect(client.passkeys.approveDeviceRequest).toHaveBeenCalledWith(
            "pending-request",
        );
        expect(client.passkeys.deleteDevice).toHaveBeenCalledTimes(2);
        expect(client.passkeys.deleteDevice).toHaveBeenNthCalledWith(
            1,
            "old-device-1",
        );
        expect(client.passkeys.deleteDevice).toHaveBeenNthCalledWith(
            2,
            "old-device-2",
        );
        expect(saveCredentials).toHaveBeenCalledWith({
            deviceID: "new-device",
            deviceKey: "generated-private-key",
            token: "",
            username: "blood",
        });
        expect(client.loginWithDeviceKey).toHaveBeenCalledWith("new-device");
        expect(client.connect).toHaveBeenCalledOnce();
    });

    test("resumes pending approval polling when passkey restore fails before approval", async () => {
        const client = makeClient();
        const config = makeConfig();
        const { keyStore } = makeKeyStore();
        const options: ServerOptions = { host: "dev.vex.wtf" };
        vexService.setPasskeyCeremonyDriver({
            authenticate: vi.fn(async () => {
                throw new Error("cancelled");
            }),
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(client);

        await vexService.register("Blood", "", config, options, keyStore);
        vi.useFakeTimers();
        await expect(
            vexService.publishDeferredDeviceApprovalAndStartWatching(keyStore),
        ).resolves.toEqual({ ok: true });

        const restored =
            await vexService.passkeyRestorePendingDevice("pending-request");

        expect(restored).toEqual({ error: "cancelled", ok: false });
        await vi.advanceTimersByTimeAsync(2000);
        expect(client.devices.pollPendingRegistration).toHaveBeenCalledWith({
            challenge: "a".repeat(64),
            requestID: "pending-request",
        });
        expect(client.passkeys.approveDeviceRequest).not.toHaveBeenCalled();
    });

    test("reports partial restore when old device deletion fails", async () => {
        const client = makeClient();
        client.passkeys.deleteDevice.mockImplementation(
            async (deviceID: string) => {
                if (deviceID === "old-device-1") {
                    throw new Error("delete failed");
                }
            },
        );
        const config = makeConfig();
        const { keyStore } = makeKeyStore();
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const authenticate = vi.fn(async () => ({ id: "assertion" }));
        vexService.setPasskeyCeremonyDriver({
            authenticate,
            register: vi.fn(),
        });
        libvexMock.create.mockResolvedValueOnce(client);

        await vexService.register("Blood", "", config, options, keyStore);
        vi.useFakeTimers();
        await expect(
            vexService.publishDeferredDeviceApprovalAndStartWatching(keyStore),
        ).resolves.toEqual({ ok: true });

        const restored =
            await vexService.passkeyRestorePendingDevice("pending-request");

        expect(restored).toMatchObject({
            approvedDeviceID: "new-device",
            deletedDeviceCount: 1,
            ok: false,
        });
        expect(restored.error).toContain("1 old device");
        expect(client.passkeys.deleteDevice).toHaveBeenCalledTimes(2);
        expect(client.loginWithDeviceKey).toHaveBeenCalledWith("new-device");
        expect(client.connect).toHaveBeenCalledOnce();
    });
});

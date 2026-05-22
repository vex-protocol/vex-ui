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
    loginWithDeviceKey: ReturnType<typeof vi.fn>;
    me: { user: ReturnType<typeof vi.fn> };
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
    servers: {
        retrieve: ReturnType<typeof vi.fn>;
        retrieveWithChannels: ReturnType<typeof vi.fn>;
    };
    sessions: { retrieve: ReturnType<typeof vi.fn> };
    users: {
        familiars: ReturnType<typeof vi.fn>;
        retrieve: ReturnType<typeof vi.fn>;
    };
};

type MockStorage = Storage & {
    purgeKeyData: ReturnType<typeof vi.fn>;
};

function makeClient(): MockClient {
    return {
        channels: { retrieve: vi.fn(async () => []) },
        close: vi.fn(async () => undefined),
        connect: vi.fn(async () => undefined),
        loginWithDeviceKey: vi.fn(async () => null),
        me: {
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
                options: { challenge: "challenge" },
                requestID: "passkey-request",
            })),
            finishAuthentication: vi.fn(async () => ({
                passkeyID: "passkey-blood",
                token: "passkey-token",
                user: { userID: "user-blood", username: "blood" },
            })),
        },
        permissions: { retrieve: vi.fn(async () => []) },
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
    };
}

function makeStorage(): MockStorage {
    return {
        purgeKeyData: vi.fn(async () => undefined),
    } as unknown as MockStorage;
}

describe("vexService.login decrypt-mismatch recovery", () => {
    beforeEach(async () => {
        await vexService.close();
        vexService.setPasskeyCeremonyDriver(null);
        libvexMock.create.mockReset();
        libvexMock.generateSecretKey.mockReset();
        libvexMock.generateSecretKey.mockReturnValue("generated-private-key");
    });

    test("purges local key data and retries login after sealed-column mismatch", async () => {
        const creds: StoredCredentials = {
            deviceID: "device-blood",
            deviceKey: "0".repeat(64),
            token: "old-token",
            username: "blood",
        };
        const saveCredentials = vi.fn(async () => undefined);
        const keyStore: KeyStore = {
            clear: vi.fn(async () => undefined),
            load: vi.fn(async () => creds),
            save: saveCredentials,
        };
        const firstStorage = makeStorage();
        const recoveryStorage = makeStorage();
        const createStorage = vi
            .fn<BootstrapConfig["createStorage"]>()
            .mockResolvedValueOnce(firstStorage)
            .mockResolvedValueOnce(recoveryStorage);
        const config: BootstrapConfig = {
            createStorage,
            deviceName: "test-device",
        };
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const recoveredClient = makeClient();
        const decryptError = new Error(
            "Failed to decrypt sealed column value.",
        );
        libvexMock.create
            .mockRejectedValueOnce(decryptError)
            .mockRejectedValueOnce(decryptError)
            .mockResolvedValueOnce(recoveredClient);

        const result = await vexService.login(
            "blood",
            "",
            config,
            options,
            keyStore,
        );

        expect(result).toEqual({ ok: true });
        expect(createStorage).toHaveBeenNthCalledWith(
            1,
            creds.deviceKey,
            "blood",
        );
        expect(createStorage).toHaveBeenNthCalledWith(
            2,
            creds.deviceKey,
            "blood",
        );
        expect(firstStorage.purgeKeyData).not.toHaveBeenCalled();
        expect(recoveryStorage.purgeKeyData).toHaveBeenCalledOnce();
        expect(recoveredClient.loginWithDeviceKey).toHaveBeenCalledWith(
            creds.deviceID,
        );
        expect(recoveredClient.connect).toHaveBeenCalledOnce();
        expect(saveCredentials).toHaveBeenCalledWith({ ...creds, token: "" });
    });

    test("prompts for passkey and retries when device login reports required 2FA", async () => {
        const creds: StoredCredentials = {
            deviceID: "device-blood",
            deviceKey: "0".repeat(64),
            token: "old-token",
            username: "blood",
        };
        const keyStore: KeyStore = {
            clear: vi.fn(async () => undefined),
            load: vi.fn(async () => creds),
            save: vi.fn(async () => undefined),
        };
        const createStorage = vi
            .fn<BootstrapConfig["createStorage"]>()
            .mockResolvedValue(makeStorage());
        const config: BootstrapConfig = {
            createStorage,
            deviceName: "test-device",
        };
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const client = makeClient();
        const passkeyRequired = Object.assign(
            new Error("Request failed with status code 403"),
            {
                response: {
                    data: new TextEncoder().encode(
                        JSON.stringify({
                            error: "Passkey verification required.",
                            username: "blood",
                        }),
                    ),
                    status: 403,
                },
            },
        );
        const authenticate = vi.fn(async () => ({ id: "assertion" }));
        const register = vi.fn();
        client.loginWithDeviceKey
            .mockImplementationOnce(async () => {
                vexService.setPasskeyCeremonyDriver({
                    authenticate,
                    register,
                });
                return passkeyRequired;
            })
            .mockResolvedValueOnce(null);
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.autoLogin(keyStore, config, options);

        expect(result).toEqual({ ok: true });
        expect(authenticate).toHaveBeenCalledWith({ challenge: "challenge" });
        expect(client.passkeys.beginAuthentication).toHaveBeenCalledWith(
            "blood",
        );
        expect(client.passkeys.finishAuthentication).toHaveBeenCalledWith({
            requestID: "passkey-request",
            response: { id: "assertion" },
        });
        expect(client.loginWithDeviceKey).toHaveBeenCalledTimes(2);
        expect(client.connect).toHaveBeenCalledOnce();
        expect(register).not.toHaveBeenCalled();
    });
});

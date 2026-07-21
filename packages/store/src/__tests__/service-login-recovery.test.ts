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

import { $passkeyUpgradePrompt } from "../domains/identity.ts";
import { vexService } from "../service.ts";

type MockClient = {
    channels: { retrieve: ReturnType<typeof vi.fn> };
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
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
        beginRegistration: ReturnType<typeof vi.fn>;
        finishAuthentication: ReturnType<typeof vi.fn>;
        finishRegistration: ReturnType<typeof vi.fn>;
        list: ReturnType<typeof vi.fn>;
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
        login: vi.fn(async () => ({ ok: true })),
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
            list: vi.fn(async () => [
                {
                    createdAt: "2026-05-22T00:00:00.000Z",
                    lastUsedAt: null,
                    name: "existing-passkey",
                    passkeyID: "passkey-existing",
                    transports: ["internal"],
                    userID: "user-blood",
                },
            ]),
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
        vexService.dismissPasskeyUpgradePrompt();
        vexService.setPasskeyCeremonyDriver(null);
        libvexMock.create.mockReset();
        libvexMock.generateSecretKey.mockReset();
        libvexMock.generateSecretKey.mockReturnValue("generated-private-key");
    });

    test("clears the auth-flow guard after an autoLogin key store load failure", async () => {
        const keyStore: KeyStore = {
            clear: vi.fn(async () => undefined),
            load: vi.fn(async () => {
                throw new Error("keychain unavailable");
            }),
            save: vi.fn(async () => undefined),
        };
        const config: BootstrapConfig = {
            createStorage: vi.fn(async () => makeStorage()),
            deviceName: "test-device",
        };
        const options: ServerOptions = { host: "dev.vex.wtf" };

        const result = await vexService.autoLogin(keyStore, config, options);

        expect(result).toEqual({
            error: "keychain unavailable",
            ok: false,
        });
        expect(vexService.isAuthFlowInFlight()).toBe(false);
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
            "correct-password",
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
        expect(recoveredClient.login).toHaveBeenCalledWith(
            "blood",
            "correct-password",
        );
        expect(recoveredClient.loginWithDeviceKey).not.toHaveBeenCalled();
        expect(recoveredClient.connect).toHaveBeenCalledOnce();
        expect(saveCredentials).toHaveBeenCalledWith({ ...creds, token: "" });
    });

    test("explicit login requires a password instead of using the saved device key", async () => {
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
        const config: BootstrapConfig = {
            createStorage: vi.fn(async () => makeStorage()),
            deviceName: "test-device",
        };
        const options: ServerOptions = { host: "dev.vex.wtf" };
        const client = makeClient();
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.login(
            "blood",
            "",
            config,
            options,
            keyStore,
        );

        expect(result).toEqual({
            error: "Enter your password, or use a passkey.",
            ok: false,
        });
        expect(client.login).not.toHaveBeenCalled();
        expect(client.loginWithDeviceKey).not.toHaveBeenCalled();
        expect(client.connect).not.toHaveBeenCalled();
    });

    test("offers a passkey upgrade after password login for a password-only account", async () => {
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
        const config: BootstrapConfig = {
            createStorage: vi.fn(async () => makeStorage()),
            deviceName: "Blood's Mac",
        };
        const client = makeClient();
        client.passkeys.list.mockResolvedValueOnce([]);
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.login(
            "blood",
            "correct-password",
            config,
            { host: "dev.vex.wtf" },
            keyStore,
        );

        expect(result).toEqual({ ok: true });
        await vi.waitFor(() => {
            expect($passkeyUpgradePrompt.get()).toEqual({
                deviceName: "Blood's Mac",
                reason: "password_login",
                userID: "user-blood",
            });
        });
    });

    test("does not offer another passkey after password login when one exists", async () => {
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
        const config: BootstrapConfig = {
            createStorage: vi.fn(async () => makeStorage()),
            deviceName: "Blood's Mac",
        };
        const client = makeClient();
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.login(
            "blood",
            "correct-password",
            config,
            { host: "dev.vex.wtf" },
            keyStore,
        );

        expect(result).toEqual({ ok: true });
        await vi.waitFor(() => {
            expect(client.passkeys.list).toHaveBeenCalledOnce();
        });
        expect($passkeyUpgradePrompt.get()).toBeNull();
    });

    test("keeps password login successful when passkey discovery fails", async () => {
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
        const config: BootstrapConfig = {
            createStorage: vi.fn(async () => makeStorage()),
            deviceName: "Blood's Mac",
        };
        const client = makeClient();
        client.passkeys.list.mockRejectedValueOnce(
            new Error("passkey list unavailable"),
        );
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.login(
            "blood",
            "correct-password",
            config,
            { host: "dev.vex.wtf" },
            keyStore,
        );

        expect(result).toEqual({ ok: true });
        await vi.waitFor(() => {
            expect(client.passkeys.list).toHaveBeenCalledOnce();
        });
        expect($passkeyUpgradePrompt.get()).toBeNull();
    });

    test("does not expose transport details when a password is rejected", async () => {
        const creds: StoredCredentials = {
            deviceID: "device-blood",
            deviceKey: "0".repeat(64),
            token: "",
            username: "blood",
        };
        const keyStore: KeyStore = {
            clear: vi.fn(async () => undefined),
            load: vi.fn(async () => creds),
            save: vi.fn(async () => undefined),
        };
        const config: BootstrapConfig = {
            createStorage: vi.fn(async () => makeStorage()),
            deviceName: "test-device",
        };
        const client = makeClient();
        client.login.mockResolvedValueOnce({
            error: "Unauthorized",
            ok: false,
        });
        libvexMock.create.mockResolvedValueOnce(client);

        const result = await vexService.login(
            "blood",
            "wrong-password",
            config,
            { host: "dev.vex.wtf" },
            keyStore,
        );

        expect(result).toEqual({
            error: "Incorrect username or password.",
            ok: false,
        });
        expect(client.connect).not.toHaveBeenCalled();
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
            .mockImplementationOnce(() => {
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

    test("does not ask for passkey when device login succeeds without 2FA", async () => {
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
        const authenticate = vi.fn();
        const register = vi.fn(async () => ({ id: "credential" }));
        client.loginWithDeviceKey.mockResolvedValueOnce(null);
        libvexMock.create.mockResolvedValueOnce(client);
        vexService.setPasskeyCeremonyDriver({
            authenticate,
            register,
        });

        const result = await vexService.autoLogin(keyStore, config, options);

        expect(result).toEqual({ ok: true });
        expect(authenticate).not.toHaveBeenCalled();
        expect(client.loginWithDeviceKey).toHaveBeenCalledOnce();
        expect(client.passkeys.beginAuthentication).not.toHaveBeenCalled();
        expect(client.passkeys.beginRegistration).not.toHaveBeenCalled();
        expect(register).not.toHaveBeenCalled();
        expect(client.connect).toHaveBeenCalledOnce();
    });
});

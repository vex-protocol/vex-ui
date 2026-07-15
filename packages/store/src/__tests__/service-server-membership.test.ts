import type { Channel, Message, Permission, Server } from "@vex-chat/libvex";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { $groupMessagesWritable } from "../domains/messaging.ts";
import {
    $channelsWritable,
    $permissionsWritable,
    $serversWritable,
} from "../domains/servers.ts";
import { vexService } from "../service.ts";

type TestClient = {
    channels?: {
        delete?: ReturnType<typeof vi.fn>;
        retrieve: ReturnType<typeof vi.fn>;
        update?: ReturnType<typeof vi.fn>;
    };
    close: ReturnType<typeof vi.fn>;
    invites?: {
        redeem: ReturnType<typeof vi.fn>;
    };
    me?: {
        user: ReturnType<typeof vi.fn>;
    };
    moderation?: {
        fetchPermissionList: ReturnType<typeof vi.fn>;
        kick: ReturnType<typeof vi.fn>;
        setRole?: ReturnType<typeof vi.fn>;
    };
    permissions?: {
        retrieve: ReturnType<typeof vi.fn>;
    };
    servers: {
        create?: ReturnType<typeof vi.fn>;
        iconURL?: ReturnType<typeof vi.fn>;
        leave: ReturnType<typeof vi.fn>;
        removeIcon?: ReturnType<typeof vi.fn>;
        retrieve?: ReturnType<typeof vi.fn>;
        retrieveByID?: ReturnType<typeof vi.fn>;
        setIcon?: ReturnType<typeof vi.fn>;
        update?: ReturnType<typeof vi.fn>;
    };
};

const serviceInternals = vexService as unknown as {
    client: null | TestClient;
    refreshServerState: (serverID: string) => Promise<void>;
};

function makeMessage(channelID: string, mailID: string): Message {
    return {
        authorID: "user-a",
        direction: "incoming",
        group: channelID,
        mailID,
        message: "hello",
        recipientID: "user-me",
        timestamp: "2026-01-01T00:00:00.000Z",
    } as unknown as Message;
}

async function resetMembershipState(): Promise<void> {
    await vexService.close();
    serviceInternals.client = null;
    $serversWritable.set({});
    $channelsWritable.set({});
    $permissionsWritable.set({});
    $groupMessagesWritable.set({});
}

describe("vexService.createServer", () => {
    beforeEach(resetMembershipState);

    test("creates a server and caches the owner permission", async () => {
        const server: Server = {
            name: "Blood Group",
            serverID: "server-blood",
        };
        const channel: Channel = {
            channelID: "channel-blood",
            name: "general",
            serverID: server.serverID,
        };
        const permission: Permission = {
            permissionID: "permission-owner",
            powerLevel: 100,
            resourceID: server.serverID,
            resourceType: "server",
            userID: "user-me",
        };
        const client: TestClient = {
            channels: {
                retrieve: vi.fn(async () => [channel]),
            },
            close: vi.fn(async () => undefined),
            me: {
                user: vi.fn(() => ({
                    userID: "user-me",
                    username: "me",
                })),
            },
            permissions: {
                retrieve: vi.fn(async () => [permission]),
            },
            servers: {
                create: vi.fn(async () => server),
                leave: vi.fn(async () => undefined),
            },
        };

        serviceInternals.client = client;

        const result = await vexService.createServer(server.name);

        expect(result).toEqual({
            channelID: channel.channelID,
            channelName: channel.name,
            ok: true,
            serverID: server.serverID,
            serverName: server.name,
        });
        expect(client.servers.create).toHaveBeenCalledWith(server.name);
        expect(client.channels?.retrieve).toHaveBeenCalledWith(server.serverID);
        expect(client.permissions?.retrieve).toHaveBeenCalled();
        expect($serversWritable.get()).toEqual({
            [server.serverID]: server,
        });
        expect($channelsWritable.get()).toEqual({
            [server.serverID]: [channel],
        });
        expect($permissionsWritable.get()).toEqual({
            [permission.permissionID]: permission,
        });
    });
});

describe("vexService.joinInvite", () => {
    beforeEach(resetMembershipState);

    test("joins the server and returns a navigation target", async () => {
        const server: Server = {
            name: "Blood Group",
            serverID: "server-blood",
        };
        const channel: Channel = {
            channelID: "channel-blood",
            name: "general",
            serverID: server.serverID,
        };
        const permission: Permission = {
            permissionID: "permission-blood",
            powerLevel: 10,
            resourceID: server.serverID,
            resourceType: "server",
            userID: "user-me",
        };
        const client: TestClient = {
            channels: {
                retrieve: vi.fn(async () => [channel]),
            },
            close: vi.fn(async () => undefined),
            invites: {
                redeem: vi.fn(async () => permission),
            },
            servers: {
                leave: vi.fn(async () => undefined),
                retrieveByID: vi.fn(async () => server),
            },
        };

        serviceInternals.client = client;

        const result = await vexService.joinInvite("invite-blood");

        expect(result).toEqual({
            channelID: channel.channelID,
            channelName: channel.name,
            ok: true,
            serverID: server.serverID,
            serverName: server.name,
        });
        expect(client.invites?.redeem).toHaveBeenCalledWith("invite-blood");
        expect(client.servers.retrieveByID).toHaveBeenCalledWith(
            server.serverID,
        );
        expect(client.channels?.retrieve).toHaveBeenCalledWith(server.serverID);
        expect($serversWritable.get()).toEqual({
            [server.serverID]: server,
        });
        expect($channelsWritable.get()).toEqual({
            [server.serverID]: [channel],
        });
        expect($permissionsWritable.get()).toEqual({
            [permission.permissionID]: permission,
        });
    });
});

describe("vexService server moderation", () => {
    beforeEach(resetMembershipState);

    test("fetches server permissions for owner/member labeling", async () => {
        const permission: Permission = {
            permissionID: "permission-owner",
            powerLevel: 100,
            resourceID: "server-blood",
            resourceType: "server",
            userID: "user-owner",
        };
        const client: TestClient = {
            close: vi.fn(async () => undefined),
            moderation: {
                fetchPermissionList: vi.fn(async () => [permission]),
                kick: vi.fn(async () => undefined),
            },
            servers: {
                leave: vi.fn(async () => undefined),
            },
        };

        serviceInternals.client = client;

        await expect(
            vexService.getServerPermissions("server-blood"),
        ).resolves.toEqual([permission]);
        expect(client.moderation?.fetchPermissionList).toHaveBeenCalledWith(
            "server-blood",
        );
    });

    test("kicks a member through moderation API", async () => {
        const client: TestClient = {
            close: vi.fn(async () => undefined),
            moderation: {
                fetchPermissionList: vi.fn(async () => []),
                kick: vi.fn(async () => undefined),
            },
            servers: {
                leave: vi.fn(async () => undefined),
            },
        };

        serviceInternals.client = client;

        await expect(
            vexService.kickServerMember("server-blood", "user-target"),
        ).resolves.toEqual({ ok: true });
        expect(client.moderation?.kick).toHaveBeenCalledWith(
            "user-target",
            "server-blood",
        );
    });

    test("changes a member role through moderation API", async () => {
        const permission: Permission = {
            permissionID: "permission-target",
            powerLevel: 50,
            resourceID: "server-blood",
            resourceType: "server",
            userID: "user-target",
        };
        const client: TestClient = {
            close: vi.fn(async () => undefined),
            me: {
                user: vi.fn(() => ({ userID: "user-owner" })),
            },
            moderation: {
                fetchPermissionList: vi.fn(async () => [permission]),
                kick: vi.fn(async () => undefined),
                setRole: vi.fn(async () => permission),
            },
            servers: {
                leave: vi.fn(async () => undefined),
            },
        };
        serviceInternals.client = client;

        await expect(
            vexService.updateServerMemberRole(permission.permissionID, 50),
        ).resolves.toEqual({ ok: true });
        expect(client.moderation?.setRole).toHaveBeenCalledWith(
            permission.permissionID,
            50,
        );
    });
});

describe("vexService.leaveServer", () => {
    beforeEach(resetMembershipState);

    test("leaves the server and removes local server state", async () => {
        const targetServer: Server = {
            name: "Blood Group",
            serverID: "server-blood",
        };
        const otherServer: Server = {
            name: "Other Group",
            serverID: "server-other",
        };
        const targetChannel: Channel = {
            channelID: "channel-blood",
            name: "general",
            serverID: targetServer.serverID,
        };
        const otherChannel: Channel = {
            channelID: "channel-other",
            name: "general",
            serverID: otherServer.serverID,
        };
        const targetPermission: Permission = {
            permissionID: "permission-blood",
            powerLevel: 10,
            resourceID: targetServer.serverID,
            resourceType: "server",
            userID: "user-me",
        };
        const otherPermission: Permission = {
            permissionID: "permission-other",
            powerLevel: 10,
            resourceID: otherServer.serverID,
            resourceType: "server",
            userID: "user-me",
        };
        const client: TestClient = {
            close: vi.fn(async () => undefined),
            servers: {
                leave: vi.fn(async () => undefined),
            },
        };

        serviceInternals.client = client;
        $serversWritable.set({
            [otherServer.serverID]: otherServer,
            [targetServer.serverID]: targetServer,
        });
        $channelsWritable.set({
            [otherServer.serverID]: [otherChannel],
            [targetServer.serverID]: [targetChannel],
        });
        $permissionsWritable.set({
            [otherPermission.permissionID]: otherPermission,
            [targetPermission.permissionID]: targetPermission,
        });
        $groupMessagesWritable.set({
            [otherChannel.channelID]: [
                makeMessage(otherChannel.channelID, "mail-other"),
            ],
            [targetChannel.channelID]: [
                makeMessage(targetChannel.channelID, "mail-blood"),
            ],
        });

        const result = await vexService.leaveServer(targetServer.serverID);

        expect(result).toEqual({ ok: true });
        expect(client.servers.leave).toHaveBeenCalledWith(
            targetServer.serverID,
        );
        expect($serversWritable.get()).toEqual({
            [otherServer.serverID]: otherServer,
        });
        expect($channelsWritable.get()).toEqual({
            [otherServer.serverID]: [otherChannel],
        });
        expect($permissionsWritable.get()).toEqual({
            [otherPermission.permissionID]: otherPermission,
        });
        expect($groupMessagesWritable.get()).toEqual({
            [otherChannel.channelID]: [
                makeMessage(otherChannel.channelID, "mail-other"),
            ],
        });
    });
});

describe("vexService server management", () => {
    beforeEach(resetMembershipState);

    test("updates server and channel metadata in shared state", async () => {
        const server: Server = { name: "Before", serverID: "server-edit" };
        const renamedServer: Server = { ...server, name: "After" };
        const channel: Channel = {
            channelID: "channel-edit",
            name: "general",
            serverID: server.serverID,
        };
        const renamedChannel: Channel = {
            ...channel,
            name: "announcements",
        };
        const client: TestClient = {
            channels: {
                retrieve: vi.fn(async () => [renamedChannel]),
                update: vi.fn(async () => renamedChannel),
            },
            close: vi.fn(async () => undefined),
            servers: {
                leave: vi.fn(async () => undefined),
                update: vi.fn(async () => renamedServer),
            },
        };
        serviceInternals.client = client;
        $serversWritable.set({ [server.serverID]: server });
        $channelsWritable.set({ [server.serverID]: [channel] });

        await expect(
            vexService.updateServer(server.serverID, renamedServer.name),
        ).resolves.toEqual({ ok: true });
        await expect(
            vexService.updateChannel(channel.channelID, renamedChannel.name),
        ).resolves.toEqual({ ok: true });

        expect($serversWritable.get()[server.serverID]).toEqual(renamedServer);
        expect($channelsWritable.get()[server.serverID]).toEqual([
            renamedChannel,
        ]);
    });

    test("refreshes server, channels, and current-user permissions together", async () => {
        const server: Server = { name: "Refreshed", serverID: "server-live" };
        const channel: Channel = {
            channelID: "channel-live",
            name: "news",
            serverID: server.serverID,
        };
        const permission: Permission = {
            permissionID: "permission-live",
            powerLevel: 50,
            resourceID: server.serverID,
            resourceType: "server",
            userID: "user-me",
        };
        serviceInternals.client = {
            channels: { retrieve: vi.fn(async () => [channel]) },
            close: vi.fn(async () => undefined),
            permissions: { retrieve: vi.fn(async () => [permission]) },
            servers: {
                leave: vi.fn(async () => undefined),
                retrieve: vi.fn(async () => [server]),
            },
        };

        await serviceInternals.refreshServerState(server.serverID);

        expect($serversWritable.get()).toEqual({ [server.serverID]: server });
        expect($channelsWritable.get()).toEqual({
            [server.serverID]: [channel],
        });
        expect($permissionsWritable.get()).toEqual({
            [permission.permissionID]: permission,
        });
    });
});

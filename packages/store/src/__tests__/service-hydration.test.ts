import type { Channel, Message, Server, User } from "@vex-chat/libvex";

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
    $hydrationStatusWritable,
    $userWritable,
} from "../domains/identity.ts";
import {
    $channelUnreadCountsWritable,
    $dmUnreadCountsWritable,
    $groupMessagesWritable,
    $messagesWritable,
} from "../domains/messaging.ts";
import {
    $channelsWritable,
    $onlineListsWritable,
    $permissionsWritable,
    $serversWritable,
} from "../domains/servers.ts";
import { vexService } from "../service.ts";

type HydrationClient = {
    channels: { retrieve: ReturnType<typeof vi.fn> };
    me: { user: ReturnType<typeof vi.fn> };
    messages: {
        retrieve: ReturnType<typeof vi.fn>;
        retrieveGroup: ReturnType<typeof vi.fn>;
    };
    permissions: { retrieve: ReturnType<typeof vi.fn> };
    servers: {
        retrieve: ReturnType<typeof vi.fn>;
        retrieveWithChannels: ReturnType<typeof vi.fn>;
    };
    sessions: { retrieve: ReturnType<typeof vi.fn> };
    syncInboxNow?: ReturnType<typeof vi.fn>;
    users: {
        familiars: ReturnType<typeof vi.fn>;
        retrieve: ReturnType<typeof vi.fn>;
    };
};

const me = { userID: "user-me", username: "me" } as User;
const server = { name: "Test Server", serverID: "server-1" } as Server;
const channel = {
    channelID: "channel-1",
    name: "general",
    serverID: "server-1",
} as Channel;

function makeClient(overrides: Partial<HydrationClient> = {}): HydrationClient {
    const client: HydrationClient = {
        channels: { retrieve: vi.fn(async () => []) },
        me: { user: vi.fn(() => me) },
        messages: {
            retrieve: vi.fn(async () => []),
            retrieveGroup: vi.fn(async () => []),
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
        ...overrides,
    };
    return client;
}

function makeMessage(overrides: Partial<Message>): Message {
    return {
        authorID: "user-other",
        decrypted: true,
        direction: "incoming",
        forward: false,
        group: null,
        mailID: "mail-1",
        message: "hello",
        nonce: "nonce",
        readerID: "user-me",
        recipient: "device-me",
        sender: "device-other",
        timestamp: "2026-01-01T00:00:00.000Z",
        ...overrides,
    } as Message;
}

async function populateState(): Promise<void> {
    await (
        vexService as unknown as { populateState: () => Promise<void> }
    ).populateState();
}

function resetServiceState(): void {
    const internals = vexService as unknown as {
        client: null;
        populateStateAbort: boolean;
        populateStateInFlight: null | Promise<void>;
    };
    internals.client = null;
    internals.populateStateAbort = false;
    internals.populateStateInFlight = null;

    $userWritable.set(null);
    $hydrationStatusWritable.set({
        completedSteps: 0,
        ready: false,
        stage: "idle",
        totalSteps: 0,
    });
    $messagesWritable.set({});
    $groupMessagesWritable.set({});
    $dmUnreadCountsWritable.set({});
    $channelUnreadCountsWritable.set({});
    $serversWritable.set({});
    $channelsWritable.set({});
    $permissionsWritable.set({});
    $onlineListsWritable.set({});
}

describe("vexService hydration", () => {
    beforeEach(() => {
        resetServiceState();
    });

    test("syncs the inbox during the initial progress-gated state load", async () => {
        const syncInboxNow = vi.fn(async () => {
            expect($hydrationStatusWritable.get().stage).toBe("syncing_inbox");
        });
        const client = makeClient({ syncInboxNow });
        (vexService as unknown as { client: unknown }).client = client;

        await populateState();

        expect(syncInboxNow).toHaveBeenCalledOnce();
        expect($hydrationStatusWritable.get()).toMatchObject({
            ready: true,
            stage: "ready",
        });
    });

    test("keeps group messages that arrive while hydrated history is publishing", async () => {
        const historical = makeMessage({
            group: "channel-1",
            mailID: "mail-history",
            message: "from sqlite",
        });
        const inboxMessage = makeMessage({
            group: "channel-1",
            mailID: "mail-inbox",
            message: "from inbox sync",
            timestamp: "2026-01-01T00:00:01.000Z",
        });
        $groupMessagesWritable.set({ "channel-1": [inboxMessage] });
        const client = makeClient({
            messages: {
                retrieve: vi.fn(async () => []),
                retrieveGroup: vi.fn(async () => [historical]),
            },
            servers: {
                retrieve: vi.fn(async () => [server]),
                retrieveWithChannels: vi.fn(async () => ({
                    channelsByServer: { "server-1": [channel] },
                    servers: [server],
                })),
            },
            syncInboxNow: vi.fn(async () => undefined),
        });
        (vexService as unknown as { client: unknown }).client = client;

        await populateState();

        expect(
            $groupMessagesWritable
                .get()
                ["channel-1"]?.map((message) => message.mailID),
        ).toEqual(["mail-history", "mail-inbox"]);
    });
});

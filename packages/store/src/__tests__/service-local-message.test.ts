import type { Message, User } from "@vex-chat/libvex";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { $userWritable } from "../domains/identity.ts";
import {
    $channelUnreadCountsWritable,
    $dmUnreadCountsWritable,
    $groupMessagesWritable,
    $messagesWritable,
} from "../domains/messaging.ts";
import {
    createUnicodeReactionEmoji,
    messageDeleteEvent,
    messageReactionEvent,
    messageUpdateEvent,
} from "../message-utils.ts";
import { vexService } from "../service.ts";

function installClient({
    deleteMessage = vi.fn(async (_mailID: string) => {}),
    deleteThread = vi.fn(async (_conversationKey: string) => {}),
    groupMessage = vi.fn(
        async (
            _channelID: string,
            _message: string,
            _opts?: { extra?: null | string },
        ) => {},
    ),
    saveMessage = vi.fn(async (_message: Message) => {}),
    sendMessage = vi.fn(
        async (
            _userID: string,
            _message: string,
            _opts?: { extra?: null | string },
        ) => {},
    ),
    updateMessage = vi.fn(
        async (
            _mailID: string,
            _patch: { extra?: null | string | undefined; message?: string },
        ) => true,
    ),
}: {
    deleteMessage?: (mailID: string) => Promise<void>;
    deleteThread?: (conversationKey: string) => Promise<void>;
    groupMessage?: (
        channelID: string,
        message: string,
        opts?: { extra?: null | string },
    ) => Promise<void>;
    saveMessage?: (message: Message) => Promise<void>;
    sendMessage?: (
        userID: string,
        message: string,
        opts?: { extra?: null | string },
    ) => Promise<void>;
    updateMessage?:
        | ((
              mailID: string,
              patch: { extra?: null | string | undefined; message?: string },
          ) => Promise<boolean>)
        | null;
} = {}) {
    (vexService as unknown as { client: unknown }).client = {
        database: {
            deleteMessage,
            saveMessage,
            updateMessage: updateMessage ?? undefined,
        },
        messages: {
            delete: deleteThread,
            group: groupMessage,
            send: sendMessage,
        },
    };
    return {
        deleteMessage,
        deleteThread,
        groupMessage,
        saveMessage,
        sendMessage,
        updateMessage,
    };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
    return {
        authorID: "user-a",
        direction: "incoming",
        group: null,
        mailID: "m1",
        message: "hello",
        recipientID: "me",
        timestamp: "2026-01-01T00:00:00.000Z",
        ...overrides,
    } as Message;
}

function resetClient(): void {
    (vexService as unknown as { client: null }).client = null;
}

describe("vexService.deleteLocalMessage", () => {
    beforeEach(() => {
        $messagesWritable.set({});
        $groupMessagesWritable.set({});
        $dmUnreadCountsWritable.set({});
        $channelUnreadCountsWritable.set({});
        $userWritable.set(null);
    });

    afterEach(() => {
        resetClient();
    });

    test("removes DM message by mailID", async () => {
        const { deleteMessage } = installClient();
        $messagesWritable.set({
            "user-a": [
                makeMessage(),
                makeMessage({
                    mailID: "m2",
                    message: "world",
                    timestamp: "2026-01-01T00:00:01.000Z",
                }),
            ],
        });

        const deleted = await vexService.deleteLocalMessage(
            "user-a",
            "m1",
            false,
        );

        expect(deleted).toBe(true);
        expect(deleteMessage).toHaveBeenCalledWith("m1");
        expect(
            $messagesWritable.get()["user-a"]?.map((msg) => msg.mailID),
        ).toEqual(["m2"]);
    });

    test("removes group message by mailID", async () => {
        const { deleteMessage } = installClient();
        $groupMessagesWritable.set({
            "channel-1": [
                makeMessage({
                    group: "channel-1",
                    mailID: "g1",
                    message: "first",
                }),
            ],
        });

        const deleted = await vexService.deleteLocalMessage(
            "channel-1",
            "g1",
            true,
        );

        expect(deleted).toBe(true);
        expect(deleteMessage).toHaveBeenCalledWith("g1");
        expect($groupMessagesWritable.get()["channel-1"]).toEqual([]);
    });

    test("returns false when mailID does not exist", async () => {
        const { deleteMessage } = installClient();
        $messagesWritable.set({
            "user-a": [makeMessage()],
        });

        const deleted = await vexService.deleteLocalMessage(
            "user-a",
            "missing",
            false,
        );

        expect(deleted).toBe(false);
        expect(
            $messagesWritable.get()["user-a"]?.map((msg) => msg.mailID),
        ).toEqual(["m1"]);
        expect(deleteMessage).not.toHaveBeenCalled();
    });

    test("keeps the thread when the persisted message delete fails", async () => {
        installClient({
            deleteMessage: vi.fn(async (_mailID: string) => {
                throw new Error("database locked");
            }),
        });
        $messagesWritable.set({
            "user-a": [makeMessage()],
        });

        const deleted = await vexService.deleteLocalMessage(
            "user-a",
            "m1",
            false,
        );

        expect(deleted).toBe(false);
        expect(
            $messagesWritable.get()["user-a"]?.map((msg) => msg.mailID),
        ).toEqual(["m1"]);
    });
});

describe("vexService.deleteLocalThread", () => {
    beforeEach(() => {
        $messagesWritable.set({});
        $groupMessagesWritable.set({});
        $dmUnreadCountsWritable.set({});
        $channelUnreadCountsWritable.set({});
        $userWritable.set(null);
    });

    afterEach(() => {
        resetClient();
    });

    test("removes a persisted DM thread and clears unread count", async () => {
        const { deleteThread } = installClient();
        $messagesWritable.set({
            "user-a": [makeMessage()],
            "user-b": [
                makeMessage({
                    mailID: "m2",
                }),
            ],
        });
        $dmUnreadCountsWritable.set({
            "user-a": 3,
            "user-b": 1,
        });

        const deleted = await vexService.deleteLocalThread("user-a", false);

        expect(deleted).toBe(true);
        expect(deleteThread).toHaveBeenCalledWith("user-a");
        expect($messagesWritable.get()).toEqual({
            "user-b": [
                expect.objectContaining({
                    mailID: "m2",
                }),
            ],
        });
        expect($dmUnreadCountsWritable.get()["user-a"]).toBe(0);
        expect($dmUnreadCountsWritable.get()["user-b"]).toBe(1);
    });

    test("removes a persisted group thread and clears unread count", async () => {
        const { deleteThread } = installClient();
        $groupMessagesWritable.set({
            "channel-1": [
                makeMessage({
                    group: "channel-1",
                    mailID: "g1",
                }),
            ],
        });
        $channelUnreadCountsWritable.set({
            "channel-1": 2,
        });

        const deleted = await vexService.deleteLocalThread("channel-1", true);

        expect(deleted).toBe(true);
        expect(deleteThread).toHaveBeenCalledWith("channel-1");
        expect($groupMessagesWritable.get()).toEqual({});
        expect($channelUnreadCountsWritable.get()["channel-1"]).toBe(0);
    });

    test("returns false when the thread does not exist locally", async () => {
        const { deleteThread } = installClient();

        const deleted = await vexService.deleteLocalThread("missing", false);

        expect(deleted).toBe(false);
        expect(deleteThread).not.toHaveBeenCalled();
    });
});

describe("vexService message edit and delete relay", () => {
    beforeEach(() => {
        $messagesWritable.set({});
        $groupMessagesWritable.set({});
        $dmUnreadCountsWritable.set({});
        $channelUnreadCountsWritable.set({});
        $userWritable.set({
            userID: "me",
            username: "me",
        } as User);
    });

    afterEach(() => {
        resetClient();
        $userWritable.set(null);
    });

    test("sends a DM delete event and removes the local message", async () => {
        const { deleteMessage, sendMessage } = installClient();
        $messagesWritable.set({
            "user-a": [
                makeMessage({
                    authorID: "me",
                    direction: "outgoing",
                    mailID: "m1",
                    readerID: "user-a",
                }),
            ],
        });

        const result = await vexService.deleteMessageForEveryone(
            "user-a",
            "m1",
            false,
        );

        expect(result).toEqual({ ok: true });
        expect(sendMessage).toHaveBeenCalledWith("user-a", "", {
            extra: expect.any(String) as string,
        });
        const opts = vi.mocked(sendMessage).mock.calls[0]?.[2];
        expect(messageDeleteEvent(makeMessage({ extra: opts?.extra }))).toEqual(
            {
                action: "delete",
                targetMailID: "m1",
            },
        );
        expect($messagesWritable.get()["user-a"]).toEqual([]);
        await vi.waitFor(() => {
            expect(deleteMessage).toHaveBeenCalledWith("m1");
        });
    });

    test("sends a group update event and updates the local message", async () => {
        const { groupMessage, updateMessage } = installClient();
        $groupMessagesWritable.set({
            "channel-1": [
                makeMessage({
                    authorID: "me",
                    direction: "outgoing",
                    group: "channel-1",
                    mailID: "g1",
                    message: "before",
                }),
            ],
        });

        const result = await vexService.editMessage(
            "channel-1",
            "g1",
            true,
            "after",
        );

        expect(result).toEqual({ ok: true });
        expect(groupMessage).toHaveBeenCalledWith("channel-1", "", {
            extra: expect.any(String) as string,
        });
        const opts = vi.mocked(groupMessage).mock.calls[0]?.[2];
        expect(messageUpdateEvent(makeMessage({ extra: opts?.extra }))).toEqual(
            {
                action: "update",
                message: "after",
                targetMailID: "g1",
            },
        );
        expect($groupMessagesWritable.get()["channel-1"]?.[0]?.message).toBe(
            "after",
        );
        await vi.waitFor(() => {
            expect(updateMessage).toHaveBeenCalledWith("g1", {
                message: "after",
            });
        });
    });

    test("falls back to rewriting storage when updateMessage is unavailable", async () => {
        const saveMessage = vi.fn(async (_message: Message) => {});
        const deleteMessage = vi.fn(async (_mailID: string) => {});
        installClient({
            deleteMessage,
            saveMessage,
            updateMessage: null,
        });
        $messagesWritable.set({
            "user-a": [
                makeMessage({
                    authorID: "me",
                    direction: "outgoing",
                    mailID: "m1",
                    message: "before",
                    readerID: "user-a",
                }),
            ],
        });

        const result = await vexService.editMessage(
            "user-a",
            "m1",
            false,
            "after",
        );

        expect(result).toEqual({ ok: true });
        await vi.waitFor(() => {
            expect(deleteMessage).toHaveBeenCalledWith("m1");
            expect(saveMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    mailID: "m1",
                    message: "after",
                }),
            );
        });
    });

    test("does not relay edits for messages authored by someone else", async () => {
        const { sendMessage } = installClient();
        $messagesWritable.set({
            "user-a": [makeMessage({ authorID: "user-a" })],
        });

        const result = await vexService.editMessage(
            "user-a",
            "m1",
            false,
            "nope",
        );

        expect(result.ok).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
        expect($messagesWritable.get()["user-a"]?.[0]?.message).toBe("hello");
    });
});

describe("vexService.toggleMessageReaction", () => {
    beforeEach(() => {
        $messagesWritable.set({});
        $groupMessagesWritable.set({});
        $dmUnreadCountsWritable.set({});
        $channelUnreadCountsWritable.set({});
        $userWritable.set({
            userID: "me",
            username: "me",
        } as User);
    });

    afterEach(() => {
        resetClient();
        $userWritable.set(null);
    });

    test("sends a DM reaction as encrypted message extra", async () => {
        const { sendMessage } = installClient();
        const emoji = createUnicodeReactionEmoji("👍", "thumbsup");

        const result = await vexService.toggleMessageReaction(
            "user-a",
            "m1",
            false,
            emoji,
        );

        expect(result).toEqual({ ok: true });
        expect(sendMessage).toHaveBeenCalledWith("user-a", "", {
            extra: expect.any(String) as string,
        });

        const opts = vi.mocked(sendMessage).mock.calls[0]?.[2];
        const event = messageReactionEvent(
            makeMessage({ extra: opts?.extra } as Partial<Message>),
        );
        expect(event).toEqual({
            action: "toggle",
            emoji,
            targetMailID: "m1",
        });
    });

    test("sends a group reaction as encrypted message extra", async () => {
        const { groupMessage } = installClient();
        const emoji = createUnicodeReactionEmoji("🎉", "tada");

        const result = await vexService.toggleMessageReaction(
            "channel-1",
            "g1",
            true,
            emoji,
        );

        expect(result).toEqual({ ok: true });
        expect(groupMessage).toHaveBeenCalledWith("channel-1", "", {
            extra: expect.any(String) as string,
        });
    });

    test("returns an error when no user is signed in", async () => {
        const { sendMessage } = installClient();
        $userWritable.set(null);

        const result = await vexService.toggleMessageReaction(
            "user-a",
            "m1",
            false,
            createUnicodeReactionEmoji("👍", "thumbsup"),
        );

        expect(result.ok).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

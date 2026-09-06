import type { Message } from "@vex-chat/libvex";

import { describe, expect, test } from "vitest";

import {
    applyEmoji,
    applyMessageDeleteEvent,
    applyMessageReactionEvent,
    applyMessageUpdateEvent,
    avatarHue,
    buildMessageReplyReference,
    chunkMessages,
    createDeleteBatchEventExtra,
    createDeleteEventExtra,
    createReactionEventExtra,
    createReplyExtra,
    createUnicodeReactionEmoji,
    createUpdateEventExtra,
    emojiReactionLabel,
    foldMessageEvents,
    foldMessageReactionEvents,
    formatFileAttachmentMarkdown,
    formatFileSize,
    formatTime,
    isImageType,
    messageDeleteEvent,
    messageDeleteEventTargetMailIDs,
    messageEmbed,
    messageReactionEvent,
    messageReactions,
    messageReply,
    messageReplyPreviewText,
    messageUpdateEvent,
    parseFileExtra,
    parseMessageExtra,
    parseMessageMarkdown,
    parseVexFileUrl,
    toggleMessageReactionExtra,
} from "../message-utils.ts";

// ── Test helpers ────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<Message> = {}): Message {
    return {
        authorID: "alice",
        direction: "incoming",
        extra: null,
        group: null,
        mailID: "00000000-0000-0000-0000-000000000001",
        message: "hello",
        recipientID: "bob",
        timestamp: "2026-04-10T12:00:00.000Z",
        ...overrides,
    } as Message;
}

// ── avatarHue ───────────────────────────────────────────────────────────────

describe("avatarHue", () => {
    test("returns a number in [0, 360)", () => {
        expect(avatarHue("alice")).toBeGreaterThanOrEqual(0);
        expect(avatarHue("alice")).toBeLessThan(360);
    });

    test("is deterministic — same input always produces same hue", () => {
        expect(avatarHue("alice")).toBe(avatarHue("alice"));
        expect(avatarHue("3f2ae9b8-1234-5678-9abc-000000000001")).toBe(
            avatarHue("3f2ae9b8-1234-5678-9abc-000000000001"),
        );
    });

    test("distributes distinct inputs across the hue range", () => {
        const hues = new Set<number>();
        for (let i = 0; i < 50; i++) {
            hues.add(avatarHue(`user-${i.toString()}`));
        }
        // Distinct inputs should hit at least half the buckets; anything
        // worse suggests the hash collapsed to a single hue.
        expect(hues.size).toBeGreaterThan(20);
    });

    test("handles empty string", () => {
        expect(avatarHue("")).toBe(0);
    });
});

// ── formatFileSize ──────────────────────────────────────────────────────────

describe("formatFileSize", () => {
    test("bytes under 1 KB render as 'N B'", () => {
        expect(formatFileSize(0)).toBe("0 B");
        expect(formatFileSize(1)).toBe("1 B");
        expect(formatFileSize(512)).toBe("512 B");
        expect(formatFileSize(1023)).toBe("1023 B");
    });

    test("kilobytes render with one decimal", () => {
        expect(formatFileSize(1024)).toBe("1.0 KB");
        expect(formatFileSize(1536)).toBe("1.5 KB");
        expect(formatFileSize(1024 * 1023)).toBe("1023.0 KB");
    });

    test("megabytes render with one decimal", () => {
        expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
        expect(formatFileSize(1024 * 1024 * 5.25)).toBe("5.3 MB");
    });
});

// ── isImageType ─────────────────────────────────────────────────────────────

describe("isImageType", () => {
    test("accepts image/* content types", () => {
        expect(isImageType("image/png")).toBe(true);
        expect(isImageType("image/jpeg")).toBe(true);
        expect(isImageType("image/webp")).toBe(true);
        expect(isImageType("image/gif")).toBe(true);
        expect(isImageType("Image/PNG")).toBe(true);
    });

    test("rejects non-image content types", () => {
        expect(isImageType("application/pdf")).toBe(false);
        expect(isImageType("text/plain")).toBe(false);
        expect(isImageType("video/mp4")).toBe(false);
        expect(isImageType("")).toBe(false);
    });
});

// ── parseFileExtra ──────────────────────────────────────────────────────────

describe("parseFileExtra", () => {
    test("returns null for null input", () => {
        expect(parseFileExtra(null)).toBeNull();
    });

    test("returns null for empty string", () => {
        expect(parseFileExtra("")).toBeNull();
    });

    test("returns null for malformed JSON", () => {
        expect(parseFileExtra("{not-json")).toBeNull();
    });

    test("returns null for JSON missing required fields", () => {
        expect(parseFileExtra('{"fileID": "x"}')).toBeNull();
        expect(parseFileExtra('{"fileName": "x.png"}')).toBeNull();
        expect(parseFileExtra("null")).toBeNull();
        expect(parseFileExtra("[]")).toBeNull();
    });

    test("returns null when fileID is not a string", () => {
        expect(
            parseFileExtra('{"fileID": 42, "fileName": "x.png"}'),
        ).toBeNull();
    });

    test("parses valid FileAttachment JSON", () => {
        const input = JSON.stringify({
            contentType: "image/png",
            fileID: "abc-123",
            fileName: "photo.png",
            fileSize: 2048,
        });
        const result = parseFileExtra(input);
        expect(result).toEqual({
            contentType: "image/png",
            fileID: "abc-123",
            fileName: "photo.png",
            fileSize: 2048,
        });
    });
});

describe("message embeds", () => {
    test("drops unsafe action links while preserving web actions", () => {
        const extra = JSON.stringify({
            embed: {
                actions: [
                    {
                        label: "Unsafe",
                        type: "link",
                        url: "file:///etc/passwd",
                    },
                    {
                        label: "Script",
                        type: "link",
                        url: "javascript:alert(1)",
                    },
                    {
                        label: "Web",
                        type: "link",
                        url: "https://example.com/#a",
                    },
                ],
                display: "decorate",
                kind: "test",
                title: "Links",
            },
        });
        expect(parseMessageExtra(extra).embed?.actions).toEqual([
            { label: "Web", type: "link", url: "https://example.com/#a" },
        ]);
    });
    test("parses encrypted media embed metadata", () => {
        const extra = JSON.stringify({
            embed: {
                blocks: [
                    {
                        attachment: {
                            contentType: "image/svg+xml",
                            fileID: "file-1",
                            fileName: "summary.svg",
                            fileSize: 2048,
                            key: "secret",
                        },
                        mediaType: "svg",
                        title: "Summary",
                        type: "media",
                    },
                    {
                        source: "message",
                        type: "markdown",
                    },
                ],
                display: "decorate",
                iconAttachment: {
                    contentType: "image/png",
                    fileID: "icon-1",
                    fileName: "favicon.png",
                    fileSize: 512,
                    key: "icon-secret",
                },
                kind: "git.push",
                title: "Push to master",
                version: 1,
            },
            version: 1,
        });
        const embed = messageEmbed(makeMessage({ extra } as Partial<Message>));

        expect(embed?.kind).toBe("git.push");
        expect(embed?.iconAttachment).toMatchObject({
            fileID: "icon-1",
            fileName: "favicon.png",
        });
        expect(embed?.blocks?.[0]).toMatchObject({
            mediaType: "svg",
            title: "Summary",
            type: "media",
        });
    });

    test("drops malformed embed metadata", () => {
        const extra = JSON.stringify({
            embed: {
                display: "replace",
                kind: 123,
            },
            version: 1,
        });

        expect(parseMessageExtra(extra).embed).toBeUndefined();
    });
});

describe("message replies", () => {
    test("serializes and parses reply references with compact snapshots", () => {
        const attachment = {
            contentType: "image/png",
            fileID: "file-123",
            fileName: "screen.png",
            fileSize: 2048,
            key: "secret",
        };
        const target = makeMessage({
            authorID: "bob",
            mailID: "m-target",
            message: `look at this\n\n${formatFileAttachmentMarkdown(
                attachment,
            )}`,
            timestamp: "2026-04-10T12:01:00.000Z",
        });
        const extra = createReplyExtra(target, "Bob");
        const reply = messageReply(makeMessage({ extra }));

        expect(reply).toEqual({
            targetAttachment: attachment,
            targetAuthorID: "bob",
            targetAuthorName: "Bob",
            targetMailID: "m-target",
            targetPreview: "look at this",
            targetTimestamp: "2026-04-10T12:01:00.000Z",
        });
    });

    test("uses attachment names when the target has no text preview", () => {
        const attachment = {
            contentType: "image/jpeg",
            fileID: "file-456",
            fileName: "photo.jpg",
            fileSize: 4096,
            key: "secret",
        };
        const target = makeMessage({
            mailID: "m-target",
            message: formatFileAttachmentMarkdown(attachment),
        });

        expect(buildMessageReplyReference(target).targetPreview).toBe(
            "photo.jpg",
        );
        expect(messageReplyPreviewText(target.message)).toBe("");
    });

    test("drops malformed reply metadata", () => {
        const parsed = parseMessageExtra(
            JSON.stringify({
                reply: { targetMailID: "" },
                version: 1,
            }),
        );

        expect(parsed.reply).toBeUndefined();
    });
});

// ── encrypted file markdown ────────────────────────────────────────────────

describe("encrypted file markdown", () => {
    test("formats and parses image attachment markdown", () => {
        const markdown = formatFileAttachmentMarkdown({
            contentType: "image/png",
            fileID: "file-123",
            fileName: "screen[shot].png",
            fileSize: 2048,
            key: "abc123",
        });

        expect(markdown).toContain("vex-file://file-123?");
        const nodes = parseMessageMarkdown(`look\n\n${markdown}`);
        expect(nodes).toHaveLength(2);
        expect(nodes[0]).toMatchObject({ type: "text" });
        expect(nodes[1]).toMatchObject({
            alt: "screen[shot].png",
            attachment: {
                contentType: "image/png",
                fileID: "file-123",
                fileName: "screen[shot].png",
                fileSize: 2048,
                key: "abc123",
            },
            image: true,
            type: "attachment",
        });
    });

    test("formats and parses non-image attachment markdown", () => {
        const markdown = formatFileAttachmentMarkdown({
            contentType: "application/pdf",
            fileID: "file-456",
            fileName: "report.pdf",
            fileSize: 4096,
            key: "def456",
        });

        expect(parseVexFileUrl("https://vex.wtf/file")).toBeNull();
        const nodes = parseMessageMarkdown(markdown);
        expect(nodes).toEqual([
            {
                alt: "report.pdf",
                attachment: {
                    contentType: "application/pdf",
                    fileID: "file-456",
                    fileName: "report.pdf",
                    fileSize: 4096,
                    key: "def456",
                },
                image: false,
                type: "attachment",
            },
        ]);
    });

    test("parses basic inline markdown without treating normal links as files", () => {
        const nodes = parseMessageMarkdown(
            "hello **world** from [vex](https://vex.wtf) and `code`",
        );

        expect(nodes).toEqual([
            {
                segments: [
                    { text: "hello ", type: "text" },
                    { text: "world", type: "strong" },
                    { text: " from ", type: "text" },
                    {
                        text: "vex",
                        type: "link",
                        url: "https://vex.wtf/",
                    },
                    { text: " and ", type: "text" },
                    { text: "code", type: "code" },
                ],
                type: "text",
            },
        ]);
    });

    test("linkifies bare http urls", () => {
        const nodes = parseMessageMarkdown(
            "read https://example.com/post?id=1, then reply",
        );

        expect(nodes).toEqual([
            {
                segments: [
                    { text: "read ", type: "text" },
                    {
                        text: "https://example.com/post?id=1",
                        type: "link",
                        url: "https://example.com/post?id=1",
                    },
                    { text: ", then reply", type: "text" },
                ],
                type: "text",
            },
        ]);
    });

    test.each([
        "javascript:alert(1)",
        "data:text/html,hello",
        "file:///etc/passwd",
        "vex://invite/123",
    ])("keeps unsafe markdown links as text: %s", (url) => {
        const content = `[click](${url})`;
        expect(parseMessageMarkdown(content)).toEqual([
            { segments: [{ text: content, type: "text" }], type: "text" },
        ]);
    });

    test("keeps balanced parentheses in bare urls", () => {
        const nodes = parseMessageMarkdown(
            "wiki https://example.com/Avatar_(2009_film) works",
        );

        expect(nodes).toEqual([
            {
                segments: [
                    { text: "wiki ", type: "text" },
                    {
                        text: "https://example.com/Avatar_(2009_film)",
                        type: "link",
                        url: "https://example.com/Avatar_(2009_film)",
                    },
                    { text: " works", type: "text" },
                ],
                type: "text",
            },
        ]);
    });

    test("parses fenced code blocks with language info", () => {
        const nodes = parseMessageMarkdown(
            "before\n```ts\nconst value = `hi`;\n```\nafter",
        );

        expect(nodes).toEqual([
            {
                segments: [{ text: "before\n", type: "text" }],
                type: "text",
            },
            {
                code: "const value = `hi`;",
                language: "ts",
                type: "codeBlock",
            },
            {
                segments: [{ text: "after", type: "text" }],
                type: "text",
            },
        ]);
    });

    test("only opens fenced code blocks at line starts", () => {
        const nodes = parseMessageMarkdown("foo ```bar``` baz");
        expect(nodes.some((node) => node.type === "codeBlock")).toBe(false);
    });

    test("only closes fenced code blocks on fence lines", () => {
        const nodes = parseMessageMarkdown(
            '```js\nconst fence = "```";\n```\nafter',
        );

        expect(nodes).toEqual([
            {
                code: 'const fence = "```";',
                language: "js",
                type: "codeBlock",
            },
            {
                segments: [{ text: "after", type: "text" }],
                type: "text",
            },
        ]);
    });

    test("parses unclosed one-line fence language as metadata", () => {
        expect(parseMessageMarkdown("```ts")).toEqual([
            {
                code: "",
                language: "ts",
                type: "codeBlock",
            },
        ]);
    });

    test("does not parse attachments or inline markdown inside fenced code", () => {
        const markdown = formatFileAttachmentMarkdown({
            contentType: "image/png",
            fileID: "file-123",
            fileName: "photo.png",
            fileSize: 2048,
            key: "abc123",
        });

        expect(
            parseMessageMarkdown(`\`\`\`\n**nope** ${markdown}\n\`\`\``),
        ).toEqual([
            {
                code: `**nope** ${markdown}`,
                type: "codeBlock",
            },
        ]);
    });

    test("treats malformed bracket-heavy markdown as plain text", () => {
        const text = `${"[".repeat(200)}${"[](".repeat(200)}`;
        expect(parseMessageMarkdown(text)).toEqual([
            {
                segments: [{ text, type: "text" }],
                type: "text",
            },
        ]);
    });
});

// ── chunkMessages ───────────────────────────────────────────────────────────

describe("chunkMessages", () => {
    test("returns empty array for empty input", () => {
        expect(chunkMessages([])).toEqual([]);
    });

    test("groups consecutive messages from same author into one chunk", () => {
        const msgs = [
            makeMessage({
                mailID: "1",
                timestamp: "2026-04-10T12:00:00.000Z",
            }),
            makeMessage({
                mailID: "2",
                timestamp: "2026-04-10T12:00:30.000Z",
            }),
            makeMessage({
                mailID: "3",
                timestamp: "2026-04-10T12:01:00.000Z",
            }),
        ];
        const chunks = chunkMessages(msgs);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.authorID).toBe("alice");
        expect(chunks[0]?.messages).toHaveLength(3);
        expect(chunks[0]?.firstTime).toBe("2026-04-10T12:00:00.000Z");
    });

    test("starts a new chunk when author changes", () => {
        const msgs = [
            makeMessage({
                authorID: "alice",
                mailID: "1",
                timestamp: "2026-04-10T12:00:00.000Z",
            }),
            makeMessage({
                authorID: "bob",
                mailID: "2",
                timestamp: "2026-04-10T12:00:30.000Z",
            }),
            makeMessage({
                authorID: "alice",
                mailID: "3",
                timestamp: "2026-04-10T12:01:00.000Z",
            }),
        ];
        const chunks = chunkMessages(msgs);
        expect(chunks.map((c) => c.authorID)).toEqual([
            "alice",
            "bob",
            "alice",
        ]);
        expect(chunks.every((c) => c.messages.length === 1)).toBe(true);
    });

    test("starts a new chunk after a 5-minute gap", () => {
        const msgs = [
            makeMessage({
                mailID: "1",
                timestamp: "2026-04-10T12:00:00.000Z",
            }),
            makeMessage({
                mailID: "2",
                // 5 min + 1 sec → new chunk
                timestamp: "2026-04-10T12:05:01.000Z",
            }),
        ];
        const chunks = chunkMessages(msgs);
        expect(chunks).toHaveLength(2);
    });

    test("keeps same chunk just under 5 minutes", () => {
        const msgs = [
            makeMessage({
                mailID: "1",
                timestamp: "2026-04-10T12:00:00.000Z",
            }),
            makeMessage({
                mailID: "2",
                // 4 min 59 sec → still same chunk
                timestamp: "2026-04-10T12:04:59.000Z",
            }),
        ];
        const chunks = chunkMessages(msgs);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.messages).toHaveLength(2);
    });

    test("sorts out-of-order messages before chunking", () => {
        const msgs = [
            makeMessage({
                mailID: "3",
                timestamp: "2026-04-10T12:02:00.000Z",
            }),
            makeMessage({
                mailID: "1",
                timestamp: "2026-04-10T12:00:00.000Z",
            }),
            makeMessage({
                mailID: "2",
                timestamp: "2026-04-10T12:01:00.000Z",
            }),
        ];
        const chunks = chunkMessages(msgs);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.messages.map((m) => m.mailID)).toEqual([
            "1",
            "2",
            "3",
        ]);
    });

    test("caps chunk size at MAX_CHUNK_SIZE (100 messages)", () => {
        const msgs: Message[] = [];
        for (let i = 0; i < 150; i++) {
            msgs.push(
                makeMessage({
                    mailID: i.toString(),
                    timestamp: new Date(
                        Date.UTC(2026, 3, 10, 12, 0, i),
                    ).toISOString(),
                }),
            );
        }
        const chunks = chunkMessages(msgs);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]?.messages).toHaveLength(100);
        expect(chunks[1]?.messages).toHaveLength(50);
    });
});

// ── applyEmoji ──────────────────────────────────────────────────────────────

describe("applyEmoji", () => {
    test("replaces known shortcodes", () => {
        expect(applyEmoji("good :thumbsup: yes")).toBe("good 👍 yes");
        expect(applyEmoji(":heart:")).toBe("❤️");
        expect(applyEmoji(":fire: :rocket:")).toBe("🔥 🚀");
    });

    test("leaves unknown shortcodes unchanged", () => {
        expect(applyEmoji(":not-a-real-emoji:")).toBe(":not-a-real-emoji:");
        expect(applyEmoji(":xyz123:")).toBe(":xyz123:");
    });

    test("handles empty input", () => {
        expect(applyEmoji("")).toBe("");
    });

    test("leaves text without shortcodes unchanged", () => {
        expect(applyEmoji("just regular text")).toBe("just regular text");
    });

    test(":+1: and :-1: shortcodes (GitHub convention)", () => {
        expect(applyEmoji(":+1:")).toBe("👍");
        expect(applyEmoji(":-1:")).toBe("👎");
        // Aliases still work.
        expect(applyEmoji(":thumbsup:")).toBe("👍");
        expect(applyEmoji(":thumbsdown:")).toBe("👎");
    });

    test("does not match empty shortcode `::`", () => {
        expect(applyEmoji("::")).toBe("::");
    });
});

// ── message reactions ──────────────────────────────────────────────────────

describe("message reactions", () => {
    test("toggles unicode reactions in message extra JSON", () => {
        const emoji = createUnicodeReactionEmoji("👍", "thumbsup");
        const added = toggleMessageReactionExtra(null, emoji, "alice");

        expect(parseMessageExtra(added).reactions).toEqual([
            {
                emoji,
                userIDs: ["alice"],
            },
        ]);

        const removed = toggleMessageReactionExtra(added, emoji, "alice");
        expect(removed).toBeNull();
    });

    test("keeps separate users on the same reaction", () => {
        const emoji = createUnicodeReactionEmoji("❤️", "heart");
        const alice = toggleMessageReactionExtra(null, emoji, "alice");
        const bob = toggleMessageReactionExtra(alice, emoji, "bob");

        expect(parseMessageExtra(bob).reactions?.[0]?.userIDs).toEqual([
            "alice",
            "bob",
        ]);
    });

    test("preserves custom image emoji fields for future catalogs", () => {
        const extra = JSON.stringify({
            reactions: [
                {
                    emoji: {
                        imageUrl: "https://cdn.example.test/party.png",
                        kind: "custom",
                        name: "party_blob",
                        sourceID: "emoji-123",
                    },
                    userIDs: ["alice", "alice", "bob"],
                },
            ],
            version: 1,
        });

        const parsed = parseMessageExtra(extra);
        expect(parsed.reactions).toEqual([
            {
                emoji: {
                    imageUrl: "https://cdn.example.test/party.png",
                    kind: "custom",
                    name: "party_blob",
                    sourceID: "emoji-123",
                },
                userIDs: ["alice", "bob"],
            },
        ]);
        const firstReaction = parsed.reactions?.[0];
        expect(
            firstReaction ? emojiReactionLabel(firstReaction.emoji) : null,
        ).toBe(":party_blob:");
    });

    test("reads reactions from a message extra field", () => {
        const extra = toggleMessageReactionExtra(
            null,
            createUnicodeReactionEmoji("🚀", "rocket"),
            "alice",
        );
        const msg = makeMessage({ extra } as Partial<Message>);

        expect(messageReactions(msg)).toHaveLength(1);
        expect(messageReactions(msg)[0]?.userIDs).toEqual(["alice"]);
    });

    test("serializes reaction event messages in the extra field", () => {
        const emoji = createUnicodeReactionEmoji("👀", "eyes");
        const extra = createReactionEventExtra("m-target", emoji);

        expect(
            messageReactionEvent(
                makeMessage({ extra, mailID: "m-event" } as Partial<Message>),
            ),
        ).toEqual({
            action: "toggle",
            emoji,
            targetMailID: "m-target",
        });
    });

    test("applies reaction event messages to the target message", () => {
        const emoji = createUnicodeReactionEmoji("👍", "thumbsup");
        const target = makeMessage({ mailID: "m-target" });
        const event = {
            action: "toggle",
            emoji,
            targetMailID: "m-target",
        } as const;

        const updated = applyMessageReactionEvent(
            [target],
            event,
            "alice",
        )[0] as (Message & { extra?: null | string }) | undefined;

        if (!updated) {
            throw new Error("Expected reaction event to update target");
        }
        expect(messageReactions(updated)).toEqual([
            {
                emoji,
                userIDs: ["alice"],
            },
        ]);
    });

    test("folds reaction event messages out of visible history", () => {
        const emoji = createUnicodeReactionEmoji("🎉", "tada");
        const target = makeMessage({ mailID: "m-target" });
        const eventMessage = makeMessage({
            authorID: "bob",
            extra: createReactionEventExtra("m-target", emoji),
            mailID: "m-event",
            message: "",
        } as Partial<Message>);

        const folded = foldMessageReactionEvents([target, eventMessage]);

        expect(folded).toHaveLength(1);
        expect(folded[0]?.mailID).toBe("m-target");
        expect(messageReactions(folded[0] as Message)).toEqual([
            {
                emoji,
                userIDs: ["bob"],
            },
        ]);
    });

    test("serializes and applies message update events", () => {
        const extra = createUpdateEventExtra("m-target", "edited");
        const target = makeMessage({
            authorID: "alice",
            mailID: "m-target",
            message: "original",
        });
        const event = messageUpdateEvent(
            makeMessage({ extra, mailID: "m-event" } as Partial<Message>),
        );

        expect(event).toEqual({
            action: "update",
            message: "edited",
            targetMailID: "m-target",
        });
        if (!event) {
            throw new Error("Expected update event");
        }
        expect(
            applyMessageUpdateEvent([target], event, "alice")[0]?.message,
        ).toBe("edited");
        expect(
            applyMessageUpdateEvent([target], event, "mallory")[0]?.message,
        ).toBe("original");
    });

    test("serializes and applies message delete events", () => {
        const extra = createDeleteEventExtra("m-target");
        const target = makeMessage({
            authorID: "alice",
            mailID: "m-target",
        });
        const event = messageDeleteEvent(
            makeMessage({ extra, mailID: "m-event" } as Partial<Message>),
        );

        expect(event).toEqual({
            action: "delete",
            targetMailID: "m-target",
        });
        if (!event) {
            throw new Error("Expected delete event");
        }
        expect(applyMessageDeleteEvent([target], event, "alice")).toEqual([]);
        expect(applyMessageDeleteEvent([target], event, "mallory")).toEqual([
            target,
        ]);
    });

    test("serializes and applies batched message delete events", () => {
        const extra = createDeleteBatchEventExtra([
            "m-one",
            "m-two",
            "m-one",
            "",
        ]);
        const first = makeMessage({
            authorID: "alice",
            mailID: "m-one",
        });
        const second = makeMessage({
            authorID: "alice",
            mailID: "m-two",
        });
        const otherAuthor = makeMessage({
            authorID: "bob",
            mailID: "m-three",
        });
        const event = messageDeleteEvent(
            makeMessage({ extra, mailID: "m-event" } as Partial<Message>),
        );

        expect(event).toEqual({
            action: "delete",
            targetMailIDs: ["m-one", "m-two"],
        });
        if (!event) {
            throw new Error("Expected delete event");
        }
        expect(messageDeleteEventTargetMailIDs(event)).toEqual([
            "m-one",
            "m-two",
        ]);
        expect(
            applyMessageDeleteEvent(
                [first, second, otherAuthor],
                event,
                "alice",
            ),
        ).toEqual([otherAuthor]);
    });

    test("folds edit and delete event messages out of visible history", () => {
        const keep = makeMessage({
            authorID: "alice",
            mailID: "m-keep",
            message: "before",
        });
        const remove = makeMessage({
            authorID: "alice",
            mailID: "m-remove",
            message: "gone",
        });
        const editEvent = makeMessage({
            authorID: "alice",
            extra: createUpdateEventExtra("m-keep", "after"),
            mailID: "m-edit-event",
            message: "",
        } as Partial<Message>);
        const deleteEvent = makeMessage({
            authorID: "alice",
            extra: createDeleteEventExtra("m-remove"),
            mailID: "m-delete-event",
            message: "",
        } as Partial<Message>);

        const folded = foldMessageEvents([
            keep,
            remove,
            editEvent,
            deleteEvent,
        ]);

        expect(folded).toHaveLength(1);
        expect(folded[0]?.mailID).toBe("m-keep");
        expect(folded[0]?.message).toBe("after");
    });

    test("preserves event ordering, authorization and duplicate message IDs", () => {
        const emoji = createUnicodeReactionEmoji("👍");
        const event = (authorID: string, extra: string) =>
            makeMessage({ authorID, extra, message: "" } as Partial<Message>);
        const alice = makeMessage({ mailID: "same", message: "alice" });
        const bob = makeMessage({
            authorID: "bob",
            mailID: "same",
            message: "bob",
        });
        const later = makeMessage({ mailID: "later", message: "later" });
        const inputs = [
            event("alice", createDeleteEventExtra("later")),
            alice,
            bob,
            event("mallory", createUpdateEventExtra("same", "forged")),
            event("alice", createUpdateEventExtra("same", "edited")),
            event("bob", createReactionEventExtra("same", emoji)),
            event("alice", createDeleteEventExtra("same")),
            later,
            event("bob", createReactionEventExtra("same", emoji)),
        ];
        const before = JSON.stringify(inputs);

        const folded = foldMessageEvents(inputs);

        expect(folded.map((message) => message.message)).toEqual([
            "bob",
            "later",
        ]);
        expect(messageReactions(folded[0] as Message)).toEqual([]);
        expect(folded[1]).toBe(later);
        expect(JSON.stringify(inputs)).toBe(before);
    });

    test("matches sequential event application through a mixed history", () => {
        const inputs: Message[] = [];
        let expected: Message[] = [];
        const emoji = createUnicodeReactionEmoji("🎉");
        for (let index = 0; index < 300; index++) {
            const authorID = index % 2 === 0 ? "alice" : "bob";
            const targetMailID = `m-${String(index % 37)}`;
            const next = makeMessage({ authorID, mailID: targetMailID });
            inputs.push(next);
            expected.push(next);
            const extra =
                index % 3 === 0
                    ? createDeleteEventExtra(targetMailID)
                    : index % 3 === 1
                      ? createUpdateEventExtra(targetMailID, String(index))
                      : createReactionEventExtra(targetMailID, emoji);
            const event = makeMessage({ authorID, extra } as Partial<Message>);
            inputs.push(event);
            const deletion = messageDeleteEvent(event);
            const update = messageUpdateEvent(event);
            const reaction = messageReactionEvent(event);
            if (deletion)
                expected = applyMessageDeleteEvent(
                    expected,
                    deletion,
                    authorID,
                );
            else if (update)
                expected = applyMessageUpdateEvent(expected, update, authorID);
            else if (reaction)
                expected = applyMessageReactionEvent(
                    expected,
                    reaction,
                    authorID,
                );
        }
        expect(foldMessageEvents(inputs)).toEqual(expected);
    });
});

// ── formatTime ──────────────────────────────────────────────────────────────

describe("formatTime", () => {
    test("accepts Date objects", () => {
        const result = formatTime(new Date("2026-04-10T12:00:00.000Z"));
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });

    test("accepts ISO 8601 strings", () => {
        const result = formatTime("2026-04-10T12:00:00.000Z");
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });

    test("same day renders as HH:mm only (no date prefix)", () => {
        const today = new Date();
        today.setHours(14, 30, 0, 0);
        const result = formatTime(today);
        // Locale-dependent but the string should not include a month name
        // for same-day. Matches the function's branching logic.
        expect(result).not.toMatch(
            /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/,
        );
    });

    test("earlier day includes month name", () => {
        const earlier = new Date("2026-01-15T12:00:00.000Z");
        const result = formatTime(earlier);
        // Should include "Jan" somewhere in the output
        expect(result).toMatch(/Jan/);
    });
});

import type { Message } from "@vex-chat/libvex";

import { normalizeExternalUrl } from "./external-url.ts";

// ── File attachment markdown ─────────────────────────────────────────────────

export interface EncryptedFileAttachment extends FileAttachment {
    key: string;
}

export interface FileAttachment {
    contentType: string;
    fileID: string;
    fileName: string;
    fileSize: number;
    key?: string | undefined;
}

export type MarkdownInlineSegment =
    | { text: string; type: "code" }
    | { text: string; type: "emphasis" }
    | { text: string; type: "link"; url: string }
    | { text: string; type: "strong" }
    | { text: string; type: "text" };

export interface MessageChunk {
    authorID: string;
    firstTime: string;
    messages: Message[];
}

export interface MessageDeleteEvent {
    action: "delete";
    deletedAt?: string;
    targetMailID?: string;
    targetMailIDs?: string[];
}

export interface MessageEmbed {
    actions?: MessageEmbedAction[];
    blocks?: MessageEmbedBlock[];
    display: "decorate" | "replace";
    fields?: MessageEmbedField[];
    icon?: string;
    iconAttachment?: EncryptedFileAttachment;
    kind: string;
    source?: MessageEmbedSource;
    subtitle?: string;
    suppressLinkPreview?: boolean;
    timestamp?: string;
    title: string;
    tone?: "danger" | "default" | "info" | "success" | "warning";
    version: 1;
}

export interface MessageEmbedAction {
    label: string;
    type: "link";
    url: string;
}

export type MessageEmbedBlock =
    | (MessageEmbedMediaItem & { type: "media" })
    | {
          attachment: EncryptedFileAttachment;
          role?: string;
          type: "file";
      }
    | { code: string; language?: string; type: "code" }
    | { items: MessageEmbedMediaItem[]; type: "gallery" }
    | { maxLines?: number; source?: "message"; text?: string; type: "markdown" }
    | { type: "divider" };

export interface MessageEmbedField {
    label: string;
    mono?: boolean;
    short?: boolean;
    value: string;
}

export interface MessageEmbedMediaItem {
    alt?: string;
    aspectRatio?: number;
    attachment: EncryptedFileAttachment;
    caption?: string;
    mediaType: "audio" | "file" | "image" | "svg" | "video";
    thumbnail?: EncryptedFileAttachment;
    title?: string;
}

export interface MessageEmbedSource {
    id?: string;
    mailID?: string;
    provider?: string;
    url?: string;
}

export type MessageEmoji =
    | {
          imageUrl?: string;
          kind: "custom";
          name: string;
          sourceID?: string;
      }
    | {
          kind: "unicode";
          shortcode?: string;
          value: string;
      };

export interface MessageExtra {
    [key: string]: unknown;
    embed?: MessageEmbed;
    messageDeleteEvent?: MessageDeleteEvent;
    messageUpdateEvent?: MessageUpdateEvent;
    reactionEvent?: MessageReactionEvent;
    reactions?: MessageReaction[];
    reply?: MessageReplyReference;
    version: 1;
}

export type MessageMarkdownNode =
    | {
          alt: string;
          attachment: EncryptedFileAttachment;
          image: boolean;
          type: "attachment";
      }
    | { code: string; language?: string; type: "codeBlock" }
    | { segments: MarkdownInlineSegment[]; source?: string; type: "text" };

export interface MessageReaction {
    emoji: MessageEmoji;
    userIDs: string[];
}

export interface MessageReactionEvent {
    action: "toggle";
    emoji: MessageEmoji;
    targetMailID: string;
}

export interface MessageReplyReference {
    targetAttachment?: EncryptedFileAttachment;
    targetAuthorID?: string;
    targetAuthorName?: string;
    targetMailID: string;
    targetPreview?: string;
    targetTimestamp?: string;
}

export interface MessageUpdateEvent {
    action: "update";
    editedAt?: string;
    message: string;
    targetMailID: string;
}

interface AttachmentMarkdownMatch extends MarkdownLinkMatch {
    attachment: EncryptedFileAttachment;
}

interface CodeFenceMatch {
    code: string;
    end: number;
    language?: string;
    start: number;
}

interface MarkdownLinkMatch {
    end: number;
    image: boolean;
    label: string;
    start: number;
    url: string;
}

type MessageWithClientExtra = Message & { extra?: null | string | undefined };

// ── Avatar hue ───────────────────────────────────────────────────────────────

/** Deterministic hue (0–359) from any string (userID, serverID, etc.) for avatar backgrounds. */
export function avatarHue(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
}

export function buildMessageReplyReference(
    target: MessageWithClientExtra,
    targetAuthorName?: string,
): MessageReplyReference {
    const targetAttachment = messageFirstAttachment(target.message);
    const preview =
        messageReplyPreviewText(target.message) ||
        targetAttachment?.fileName ||
        "Message";
    return {
        ...(targetAttachment ? { targetAttachment } : {}),
        targetAuthorID: target.authorID,
        ...(targetAuthorName ? { targetAuthorName } : {}),
        targetMailID: target.mailID,
        targetPreview: preview,
        targetTimestamp: target.timestamp,
    };
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return String(bytes) + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function isImageType(contentType: string): boolean {
    return contentType.toLowerCase().startsWith("image/");
}

// ── File attachment parsing ──────────────────────────────────────────────────

const VEX_FILE_SCHEME = "vex-file://";

const MESSAGE_EXTRA_VERSION = 1;
const MESSAGE_REPLY_PREVIEW_MAX = 280;
const INLINE_BARE_URL_RE = /^https?:\/\/[^\s<>\[\]{}"']+/i;

export function applyMessageDeleteEvent(
    messages: Message[],
    event: MessageDeleteEvent,
    actorUserID: string,
): Message[] {
    const targetMailIDs = new Set(messageDeleteEventTargetMailIDs(event));
    if (targetMailIDs.size === 0) {
        return messages;
    }
    let changed = false;
    const nextMessages = messages.filter((message) => {
        if (
            !targetMailIDs.has(message.mailID) ||
            message.authorID !== actorUserID
        ) {
            return true;
        }
        changed = true;
        return false;
    });
    return changed ? nextMessages : messages;
}

export function applyMessageReactionEvent(
    messages: Message[],
    event: MessageReactionEvent,
    actorUserID: string,
): Message[] {
    return mapChangedMessages(messages, (message) =>
        message.mailID === event.targetMailID
            ? reactToMessage(message, event, actorUserID)
            : message,
    );
}

export function applyMessageUpdateEvent(
    messages: Message[],
    event: MessageUpdateEvent,
    actorUserID: string,
): Message[] {
    return mapChangedMessages(messages, (message) =>
        message.mailID === event.targetMailID
            ? updateMessage(message, event, actorUserID)
            : message,
    );
}

export function createDeleteBatchEventExtra(targetMailIDs: string[]): string {
    return (
        serializeMessageExtra({
            messageDeleteEvent: {
                action: "delete",
                targetMailIDs,
            },
            version: MESSAGE_EXTRA_VERSION,
        }) ?? JSON.stringify({ version: MESSAGE_EXTRA_VERSION })
    );
}

export function createDeleteEventExtra(targetMailID: string): string {
    return (
        serializeMessageExtra({
            messageDeleteEvent: {
                action: "delete",
                targetMailID,
            },
            version: MESSAGE_EXTRA_VERSION,
        }) ?? JSON.stringify({ version: MESSAGE_EXTRA_VERSION })
    );
}

export function createReactionEventExtra(
    targetMailID: string,
    emoji: MessageEmoji,
): string {
    return (
        serializeMessageExtra({
            reactionEvent: {
                action: "toggle",
                emoji,
                targetMailID,
            },
            version: MESSAGE_EXTRA_VERSION,
        }) ?? JSON.stringify({ version: MESSAGE_EXTRA_VERSION })
    );
}

export function createReplyExtra(
    target: MessageWithClientExtra,
    targetAuthorName?: string,
    currentExtra?: null | string,
): string {
    return (
        createReplyReferenceExtra(
            buildMessageReplyReference(target, targetAuthorName),
            currentExtra,
        ) ?? JSON.stringify({ version: MESSAGE_EXTRA_VERSION })
    );
}

export function createReplyReferenceExtra(
    reply: MessageReplyReference,
    currentExtra?: null | string,
): null | string {
    return serializeMessageExtra({
        ...parseMessageExtra(currentExtra),
        reply,
        version: MESSAGE_EXTRA_VERSION,
    });
}

export function createUnicodeReactionEmoji(
    value: string,
    shortcode?: string,
): MessageEmoji {
    return {
        kind: "unicode",
        ...(shortcode ? { shortcode } : {}),
        value,
    };
}

export function createUpdateEventExtra(
    targetMailID: string,
    message: string,
): string {
    return (
        serializeMessageExtra({
            messageUpdateEvent: {
                action: "update",
                message,
                targetMailID,
            },
            version: MESSAGE_EXTRA_VERSION,
        }) ?? JSON.stringify({ version: MESSAGE_EXTRA_VERSION })
    );
}

export function emojiReactionKey(emoji: MessageEmoji): string {
    if (emoji.kind === "custom") {
        return `custom:${emoji.sourceID ?? emoji.name}`;
    }
    return `unicode:${emoji.value}`;
}

export function emojiReactionLabel(emoji: MessageEmoji): string {
    if (emoji.kind === "custom") {
        return emoji.name.startsWith(":") ? emoji.name : `:${emoji.name}:`;
    }
    return emoji.value;
}

export function foldMessageEvents(messages: Message[]): Message[] {
    // Index mutable slots so events touch only their targets. The timeline keeps
    // arrival order (including duplicate IDs), without mutating input messages.
    type MessageSlot = { message: Message | null };
    const timeline: MessageSlot[] = [];
    const targetsByID = new Map<string, MessageSlot[]>();
    for (const message of messages) {
        const {
            messageDeleteEvent: deleteEvent,
            messageUpdateEvent: updateEvent,
            reactionEvent,
        } = parseMessageExtra((message as MessageWithClientExtra).extra);
        const event = deleteEvent ?? updateEvent ?? reactionEvent;
        if (!event) {
            const slot = { message };
            timeline.push(slot);
            const targets = targetsByID.get(message.mailID);
            if (targets) targets.push(slot);
            else targetsByID.set(message.mailID, [slot]);
            continue;
        }

        const targetIDs = deleteEvent
            ? messageDeleteEventTargetMailIDs(deleteEvent)
            : [event.targetMailID];
        for (const targetID of targetIDs) {
            if (!targetID) continue;
            const targets = targetsByID.get(targetID);
            if (!targets) continue;
            for (const slot of targets) {
                if (!slot.message) continue;
                if (deleteEvent) {
                    if (slot.message.authorID === message.authorID) {
                        slot.message = null;
                    }
                } else if (updateEvent) {
                    slot.message = updateMessage(
                        slot.message,
                        updateEvent,
                        message.authorID,
                    );
                } else if (reactionEvent) {
                    slot.message = reactToMessage(
                        slot.message,
                        reactionEvent,
                        message.authorID,
                    );
                }
            }
            if (deleteEvent) {
                const remaining = targets.filter((slot) => slot.message);
                if (remaining.length) targetsByID.set(targetID, remaining);
                else targetsByID.delete(targetID);
            }
        }
    }
    return timeline.flatMap((slot) => (slot.message ? [slot.message] : []));
}

export function foldMessageReactionEvents(messages: Message[]): Message[] {
    return foldMessageEvents(messages);
}

export function formatFileAttachmentMarkdown(
    attachment: EncryptedFileAttachment,
): string {
    const params = new URLSearchParams();
    params.set("key", attachment.key);
    params.set("name", attachment.fileName);
    params.set("type", attachment.contentType);
    params.set("size", String(Math.max(0, attachment.fileSize)));

    const url = `${VEX_FILE_SCHEME}${encodeURIComponent(
        attachment.fileID,
    )}?${params.toString()}`;
    const label = escapeMarkdownLabel(attachment.fileName);
    if (isImageType(attachment.contentType)) {
        return `![${label}](${url})`;
    }
    return `[${label}](${url})`;
}

export function messageDeleteEvent(
    message: MessageWithClientExtra,
): MessageDeleteEvent | null {
    return parseMessageExtra(message.extra).messageDeleteEvent ?? null;
}

export function messageDeleteEventTargetMailIDs(
    event: MessageDeleteEvent,
): string[] {
    const targetMailIDs: string[] = [];
    const seen = new Set<string>();
    const add = (targetMailID: string | undefined): void => {
        if (!targetMailID || seen.has(targetMailID)) {
            return;
        }
        seen.add(targetMailID);
        targetMailIDs.push(targetMailID);
    };
    add(event.targetMailID);
    for (const targetMailID of event.targetMailIDs ?? []) {
        add(targetMailID);
    }
    return targetMailIDs;
}

export function messageEmbed(
    message: MessageWithClientExtra,
): MessageEmbed | null {
    return parseMessageExtra(message.extra).embed ?? null;
}

export function messageFirstAttachment(
    content: string,
): EncryptedFileAttachment | undefined {
    return parseMessageMarkdown(content).find(
        (node): node is Extract<MessageMarkdownNode, { type: "attachment" }> =>
            node.type === "attachment",
    )?.attachment;
}

export function messageReactionEvent(
    message: MessageWithClientExtra,
): MessageReactionEvent | null {
    return parseMessageExtra(message.extra).reactionEvent ?? null;
}

export function messageReactions(
    message: MessageWithClientExtra,
): MessageReaction[] {
    return parseMessageExtra(message.extra).reactions ?? [];
}

export function messageReply(
    message: MessageWithClientExtra,
): MessageReplyReference | null {
    return parseMessageExtra(message.extra).reply ?? null;
}

export function messageReplyPreviewText(content: string): string {
    const text = parseMessageMarkdown(content)
        .flatMap((node) =>
            node.type === "text"
                ? node.segments.map((segment) => segment.text)
                : [],
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    return truncateReplyPreview(text);
}

export function messageUpdateEvent(
    message: MessageWithClientExtra,
): MessageUpdateEvent | null {
    return parseMessageExtra(message.extra).messageUpdateEvent ?? null;
}

export function parseFileExtra(extra: null | string): FileAttachment | null {
    if (!extra) return null;
    try {
        const obj: unknown = JSON.parse(extra);
        if (
            typeof obj === "object" &&
            obj !== null &&
            "fileID" in obj &&
            typeof (obj as FileAttachment).fileID === "string" &&
            "fileName" in obj &&
            typeof (obj as FileAttachment).fileName === "string"
        ) {
            return obj as FileAttachment;
        }
    } catch {
        /* not file JSON */
    }
    return null;
}

export function parseMessageExtra(
    extra: null | string | undefined,
): MessageExtra {
    if (!extra) {
        return { version: MESSAGE_EXTRA_VERSION };
    }

    try {
        const raw: unknown = JSON.parse(extra);
        if (!isRecord(raw)) {
            return { version: MESSAGE_EXTRA_VERSION };
        }

        const embed = parseMessageEmbed(raw["embed"]);
        const messageDelete = parseMessageDeleteEvent(
            raw["messageDeleteEvent"],
        );
        const messageUpdate = parseMessageUpdateEvent(
            raw["messageUpdateEvent"],
        );
        const reactionEvent = parseMessageReactionEvent(raw["reactionEvent"]);
        const reply = parseMessageReplyReference(raw["reply"]);
        const rest = { ...raw };
        delete rest["embed"];
        delete rest["messageDeleteEvent"];
        delete rest["messageUpdateEvent"];
        delete rest["reactionEvent"];
        delete rest["reactions"];
        delete rest["reply"];
        delete rest["version"];
        return {
            ...rest,
            ...(embed ? { embed } : {}),
            ...(messageDelete ? { messageDeleteEvent: messageDelete } : {}),
            ...(messageUpdate ? { messageUpdateEvent: messageUpdate } : {}),
            ...(reactionEvent ? { reactionEvent } : {}),
            reactions: parseMessageReactions(raw["reactions"]),
            ...(reply ? { reply } : {}),
            version: MESSAGE_EXTRA_VERSION,
        };
    } catch {
        return { version: MESSAGE_EXTRA_VERSION };
    }
}

export function parseMessageMarkdown(content: string): MessageMarkdownNode[] {
    const nodes: MessageMarkdownNode[] = [];
    let cursor = 0;
    let searchStart = 0;

    while (searchStart < content.length) {
        const attachmentMatch = findNextAttachmentMarkdownLink(
            content,
            searchStart,
        );
        const codeFenceMatch = findNextCodeFence(content, searchStart);
        if (!attachmentMatch && !codeFenceMatch) {
            break;
        }

        if (
            codeFenceMatch &&
            (!attachmentMatch || codeFenceMatch.start < attachmentMatch.start)
        ) {
            pushTextNode(nodes, content.slice(cursor, codeFenceMatch.start));
            nodes.push({
                code: codeFenceMatch.code,
                ...(codeFenceMatch.language
                    ? { language: codeFenceMatch.language }
                    : {}),
                type: "codeBlock",
            });
            cursor = codeFenceMatch.end;
            searchStart = codeFenceMatch.end;
            continue;
        }

        if (!attachmentMatch) {
            break;
        }

        pushTextNode(nodes, content.slice(cursor, attachmentMatch.start));
        nodes.push({
            alt: attachmentMatch.label,
            attachment: attachmentMatch.attachment,
            image:
                attachmentMatch.image ||
                isImageType(attachmentMatch.attachment.contentType),
            type: "attachment",
        });
        cursor = attachmentMatch.end;
        searchStart = attachmentMatch.end;
    }

    pushTextNode(nodes, content.slice(cursor));
    return nodes;
}

export function parseVexFileUrl(url: string): EncryptedFileAttachment | null {
    if (!url.startsWith(VEX_FILE_SCHEME)) {
        return null;
    }

    const rest = url.slice(VEX_FILE_SCHEME.length);
    const queryStart = rest.indexOf("?");
    const encodedFileID = queryStart === -1 ? rest : rest.slice(0, queryStart);
    const query = queryStart === -1 ? "" : rest.slice(queryStart + 1);

    let fileID: string;
    try {
        fileID = decodeURIComponent(encodedFileID).trim();
    } catch {
        return null;
    }

    const params = new URLSearchParams(query);
    const key = params.get("key")?.trim() ?? "";
    const fileName = params.get("name")?.trim() ?? "";
    const contentType =
        params.get("type")?.trim() || "application/octet-stream";
    const rawSize = Number(params.get("size") ?? "0");
    const fileSize =
        Number.isFinite(rawSize) && rawSize >= 0 ? Math.round(rawSize) : 0;

    if (!fileID || !key || !fileName) {
        return null;
    }

    return {
        contentType,
        fileID,
        fileName,
        fileSize,
        key,
    };
}

export function serializeMessageExtra(extra: MessageExtra): null | string {
    const normalized = normalizeMessageExtra(extra);
    if (
        Object.keys(normalized).length === 1 &&
        normalized.version === MESSAGE_EXTRA_VERSION
    ) {
        return null;
    }
    return JSON.stringify(normalized);
}

export function toggleMessageReactionExtra(
    currentExtra: null | string | undefined,
    emoji: MessageEmoji,
    userID: string,
): null | string {
    const extra = parseMessageExtra(currentExtra);
    const reactions = [...(extra.reactions ?? [])];
    const key = emojiReactionKey(emoji);
    const existingIndex = reactions.findIndex(
        (reaction) => emojiReactionKey(reaction.emoji) === key,
    );

    if (existingIndex === -1) {
        reactions.push({ emoji, userIDs: [userID] });
    } else {
        const reaction = reactions[existingIndex];
        if (!reaction) {
            return serializeMessageExtra(extra);
        }
        const userIDs = reaction.userIDs.includes(userID)
            ? reaction.userIDs.filter((id) => id !== userID)
            : [...reaction.userIDs, userID];
        if (userIDs.length === 0) {
            reactions.splice(existingIndex, 1);
        } else {
            reactions[existingIndex] = {
                ...reaction,
                userIDs,
            };
        }
    }

    const nextExtra: MessageExtra = { ...extra };
    if (reactions.length > 0) {
        nextExtra.reactions = reactions;
    } else {
        delete nextExtra.reactions;
    }
    return serializeMessageExtra(nextExtra);
}

function copyBoolean(
    target: object,
    source: Record<string, unknown>,
    key: string,
): void {
    const value = source[key];
    if (typeof value === "boolean") {
        Reflect.set(target, key, value);
    }
}

function copyNumber(
    target: object,
    source: Record<string, unknown>,
    key: string,
): void {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        Reflect.set(target, key, value);
    }
}

function copyString(
    target: object,
    source: Record<string, unknown>,
    key: string,
): void {
    const value = source[key];
    if (typeof value === "string") {
        Reflect.set(target, key, value);
    }
}

function copyTrimmedString(
    target: object,
    source: Record<string, unknown>,
    key: string,
): void {
    const value = source[key];
    if (typeof value !== "string") {
        return;
    }
    const trimmed = value.trim();
    if (trimmed) {
        Reflect.set(target, key, trimmed);
    }
}

function escapeMarkdownLabel(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
}

function findClosingCodeFence(
    source: string,
    start: number,
): null | { end: number; start: number } {
    let lineStart = start;
    while (lineStart < source.length) {
        const lineEnd = source.indexOf("\n", lineStart);
        const end = lineEnd === -1 ? source.length : lineEnd;
        const line = source.slice(lineStart, end);
        const fenceStart = line.search(/```/);
        if (
            fenceStart !== -1 &&
            isFenceLinePrefix(line.slice(0, fenceStart)) &&
            /^[ \t]*$/.test(line.slice(fenceStart + 3))
        ) {
            return {
                end: lineEnd === -1 ? source.length : lineEnd + 1,
                start: lineStart + fenceStart,
            };
        }
        if (lineEnd === -1) {
            return null;
        }
        lineStart = lineEnd + 1;
    }
    return null;
}

function findMarkdownLabelEnd(source: string, start: number): number {
    let escaped = false;
    for (let index = start; index < source.length; index++) {
        const char = source[index];
        if (char === "\n") {
            return -1;
        }
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === "]") {
            return index;
        }
    }
    return -1;
}

function findMarkdownLinkEnd(source: string, start: number): number {
    let depth = 0;
    for (let index = start; index < source.length; index++) {
        const char = source[index];
        if (char === "\n") {
            return -1;
        }
        if (char === "(") {
            depth++;
            continue;
        }
        if (char === ")") {
            if (depth === 0) {
                return index;
            }
            depth--;
        }
    }
    return -1;
}

function findNextAttachmentMarkdownLink(
    source: string,
    start: number,
): AttachmentMarkdownMatch | null {
    let searchStart = start;
    while (searchStart < source.length) {
        const match = findNextMarkdownLink(source, searchStart);
        if (!match) {
            return null;
        }
        const attachment = parseVexFileUrl(match.url);
        if (attachment) {
            return { ...match, attachment };
        }
        searchStart = match.end;
    }
    return null;
}

function findNextCodeFence(
    source: string,
    start: number,
): CodeFenceMatch | null {
    let searchStart = start;
    while (searchStart < source.length) {
        const open = source.indexOf("```", searchStart);
        if (open === -1) {
            return null;
        }
        const lineStart = source.lastIndexOf("\n", open - 1) + 1;
        if (!isFenceLinePrefix(source.slice(lineStart, open))) {
            searchStart = open + 3;
            continue;
        }

        const infoStart = open + 3;
        const lineEnd = source.indexOf("\n", infoStart);
        if (lineEnd === -1) {
            return {
                code: "",
                end: source.length,
                ...normalizeCodeBlockLanguage(source.slice(infoStart)),
                start: lineStart,
            };
        }

        const close = findClosingCodeFence(source, lineEnd + 1);
        const codeEnd = close?.start ?? source.length;
        return {
            code: trimCodeFenceText(source.slice(lineEnd + 1, codeEnd)),
            end: close?.end ?? source.length,
            ...normalizeCodeBlockLanguage(source.slice(infoStart, lineEnd)),
            start: lineStart,
        };
    }
    return null;
}

function findNextMarkdownLink(
    source: string,
    start: number,
): MarkdownLinkMatch | null {
    let index = start;
    while (index < source.length) {
        const char = source[index];
        const image = char === "!" && source[index + 1] === "[";
        const open = image ? index + 1 : char === "[" ? index : -1;
        if (open === -1) {
            index++;
            continue;
        }

        const labelEnd = findMarkdownLabelEnd(source, open + 1);
        if (labelEnd === -1) {
            index = open + 1;
            continue;
        }
        if (source[labelEnd + 1] !== "(") {
            index = labelEnd + 1;
            continue;
        }

        const urlStart = labelEnd + 2;
        const urlEnd = findMarkdownLinkEnd(source, urlStart);
        if (urlEnd === -1) {
            index = urlStart;
            continue;
        }

        const url = source.slice(urlStart, urlEnd).trim();
        if (!url) {
            index = urlEnd + 1;
            continue;
        }

        return {
            end: urlEnd + 1,
            image,
            label: unescapeMarkdownLabel(source.slice(open + 1, labelEnd)),
            start: image ? index : open,
            url,
        };
    }

    return null;
}

function hasBalancedParens(value: string): boolean {
    let balance = 0;
    for (const char of value) {
        if (char === "(") {
            balance++;
        } else if (char === ")") {
            balance--;
        }
    }
    return balance === 0;
}

function isEmbedTone(
    value: unknown,
): value is NonNullable<MessageEmbed["tone"]> {
    return (
        value === "danger" ||
        value === "default" ||
        value === "info" ||
        value === "success" ||
        value === "warning"
    );
}

function isFenceLinePrefix(value: string): boolean {
    return /^[ \t]{0,3}$/.test(value);
}

function isMessageEmbedMediaType(
    value: unknown,
): value is MessageEmbedMediaItem["mediaType"] {
    return (
        value === "audio" ||
        value === "file" ||
        value === "image" ||
        value === "svg" ||
        value === "video"
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapChangedMessages(
    messages: Message[],
    transform: (message: Message) => Message,
): Message[] {
    let changed = false;
    const next = messages.map((message) => {
        const updated = transform(message);
        changed ||= updated !== message;
        return updated;
    });
    return changed ? next : messages;
}

function matchBareUrlAt(text: string, index: number): null | string {
    const previous = text[index - 1];
    if (previous && /[A-Za-z0-9@._~:/?#\[\]!$&'()*+,;=%-]/.test(previous)) {
        return null;
    }
    const match = INLINE_BARE_URL_RE.exec(text.slice(index));
    if (!match?.[0]) {
        return null;
    }
    return trimInlineUrl(match[0]);
}

function normalizeCodeBlockLanguage(value: string): { language?: string } {
    const language = value.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!language || language.length > 64 || !/^[\w#+.-]+$/.test(language)) {
        return {};
    }
    return { language };
}

function normalizeMessageExtra(extra: MessageExtra): MessageExtra {
    const normalized: MessageExtra = {
        ...extra,
        version: MESSAGE_EXTRA_VERSION,
    };
    const reactions = parseMessageReactions(normalized.reactions);
    const embed = parseMessageEmbed(normalized.embed);
    const messageDeleteEvent = parseMessageDeleteEvent(
        normalized.messageDeleteEvent,
    );
    const messageUpdateEvent = parseMessageUpdateEvent(
        normalized.messageUpdateEvent,
    );
    const reactionEvent = parseMessageReactionEvent(normalized.reactionEvent);
    const reply = parseMessageReplyReference(normalized.reply);
    if (embed) {
        normalized.embed = embed;
    } else {
        delete normalized.embed;
    }
    if (messageDeleteEvent) {
        normalized.messageDeleteEvent = messageDeleteEvent;
    } else {
        delete normalized.messageDeleteEvent;
    }
    if (messageUpdateEvent) {
        normalized.messageUpdateEvent = messageUpdateEvent;
    } else {
        delete normalized.messageUpdateEvent;
    }
    if (reactionEvent) {
        normalized.reactionEvent = reactionEvent;
    } else {
        delete normalized.reactionEvent;
    }
    if (reply) {
        normalized.reply = reply;
    } else {
        delete normalized.reply;
    }
    if (reactions.length > 0) {
        normalized.reactions = reactions;
    } else {
        delete normalized.reactions;
    }
    return normalized;
}

function parseAttachmentExtra(value: unknown): EncryptedFileAttachment | null {
    if (!isRecord(value)) return null;
    const { contentType, fileID, fileName, fileSize, key } = value;
    if (
        typeof contentType !== "string" ||
        typeof fileID !== "string" ||
        typeof fileName !== "string" ||
        typeof fileSize !== "number" ||
        !Number.isFinite(fileSize) ||
        typeof key !== "string"
    ) {
        return null;
    }
    return {
        contentType,
        fileID,
        fileName,
        fileSize: Math.max(0, Math.round(fileSize)),
        key,
    };
}

function parseInlineMarkdown(text: string): MarkdownInlineSegment[] {
    const segments: MarkdownInlineSegment[] = [];
    let cursor = 0;
    let index = 0;

    const pushPlain = (end: number): void => {
        if (end <= cursor) return;
        pushSegment(segments, {
            text: text.slice(cursor, end),
            type: "text",
        });
    };

    while (index < text.length) {
        const char = text[index];
        const next = text[index + 1];

        if (char === "`") {
            const close = text.indexOf("`", index + 1);
            if (close > index + 1) {
                pushPlain(index);
                pushSegment(segments, {
                    text: text.slice(index + 1, close),
                    type: "code",
                });
                index = close + 1;
                cursor = index;
                continue;
            }
        }

        if (char === "*" && next === "*") {
            const close = text.indexOf("**", index + 2);
            if (close > index + 2) {
                pushPlain(index);
                pushSegment(segments, {
                    text: text.slice(index + 2, close),
                    type: "strong",
                });
                index = close + 2;
                cursor = index;
                continue;
            }
        }

        if (char === "*") {
            const close = text.indexOf("*", index + 1);
            if (close > index + 1) {
                pushPlain(index);
                pushSegment(segments, {
                    text: text.slice(index + 1, close),
                    type: "emphasis",
                });
                index = close + 1;
                cursor = index;
                continue;
            }
        }

        if (char === "[") {
            const labelEnd = findMarkdownLabelEnd(text, index + 1);
            if (labelEnd > index + 1 && text[labelEnd + 1] === "(") {
                const urlEnd = findMarkdownLinkEnd(text, labelEnd + 2);
                if (urlEnd > labelEnd + 2) {
                    const url = normalizeExternalUrl(
                        text.slice(labelEnd + 2, urlEnd),
                    );
                    if (url) {
                        pushPlain(index);
                        pushSegment(segments, {
                            text: unescapeMarkdownLabel(
                                text.slice(index + 1, labelEnd),
                            ),
                            type: "link",
                            url,
                        });
                        index = urlEnd + 1;
                        cursor = index;
                        continue;
                    }
                }
            }
        }

        const bareUrl = matchBareUrlAt(text, index);
        const externalUrl = normalizeExternalUrl(bareUrl);
        if (bareUrl && externalUrl) {
            pushPlain(index);
            pushSegment(segments, {
                text: bareUrl,
                type: "link",
                url: externalUrl,
            });
            index += bareUrl.length;
            cursor = index;
            continue;
        }

        index++;
    }

    pushPlain(text.length);
    if (segments.length === 0) {
        return [{ text, type: "text" }];
    }
    return segments;
}

function parseMessageDeleteEvent(
    value: unknown,
): MessageDeleteEvent | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    if (value["action"] !== "delete") {
        return undefined;
    }
    const targetMailID =
        typeof value["targetMailID"] === "string" &&
        value["targetMailID"] !== ""
            ? value["targetMailID"]
            : undefined;
    const targetMailIDs = parseMessageDeleteTargets(value["targetMailIDs"]);
    if (!targetMailID && targetMailIDs.length === 0) {
        return undefined;
    }
    const event: MessageDeleteEvent = {
        action: "delete",
        ...(targetMailID ? { targetMailID } : {}),
        ...(targetMailIDs.length > 0 ? { targetMailIDs } : {}),
    };
    copyString(event, value, "deletedAt");
    return event;
}

function parseMessageDeleteTargets(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const targets: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== "string" || item === "" || seen.has(item)) {
            continue;
        }
        seen.add(item);
        targets.push(item);
    }
    return targets;
}

function parseMessageEmbed(value: unknown): MessageEmbed | null {
    if (!isRecord(value)) return null;
    const display = value["display"];
    const kind = value["kind"];
    const title = value["title"];
    if (
        (display !== "decorate" && display !== "replace") ||
        typeof kind !== "string" ||
        typeof title !== "string"
    ) {
        return null;
    }
    const embed: MessageEmbed = {
        display,
        kind,
        title,
        version: MESSAGE_EXTRA_VERSION,
    };
    copyString(embed, value, "icon");
    const iconAttachment = parseAttachmentExtra(value["iconAttachment"]);
    if (iconAttachment) embed.iconAttachment = iconAttachment;
    copyString(embed, value, "subtitle");
    copyBoolean(embed, value, "suppressLinkPreview");
    copyString(embed, value, "timestamp");
    if (isEmbedTone(value["tone"])) {
        embed.tone = value["tone"];
    }
    const actions = parseMessageEmbedActions(value["actions"]);
    if (actions.length > 0) embed.actions = actions;
    const blocks = parseMessageEmbedBlocks(value["blocks"]);
    if (blocks.length > 0) embed.blocks = blocks;
    const fields = parseMessageEmbedFields(value["fields"]);
    if (fields.length > 0) embed.fields = fields;
    const source = parseMessageEmbedSource(value["source"]);
    if (source) embed.source = source;
    return embed;
}

function parseMessageEmbedAction(value: unknown): MessageEmbedAction | null {
    if (
        !isRecord(value) ||
        value["type"] !== "link" ||
        typeof value["label"] !== "string"
    ) {
        return null;
    }
    const url = normalizeExternalUrl(value["url"]);
    if (!url) return null;
    return {
        label: value["label"],
        type: "link",
        url,
    };
}

function parseMessageEmbedActions(value: unknown): MessageEmbedAction[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        const action = parseMessageEmbedAction(item);
        return action ? [action] : [];
    });
}

function parseMessageEmbedBlock(value: unknown): MessageEmbedBlock | null {
    if (!isRecord(value)) return null;
    switch (value["type"]) {
        case "code":
            return parseMessageEmbedCodeBlock(value);
        case "divider":
            return { type: "divider" };
        case "file":
            return parseMessageEmbedFileBlock(value);
        case "gallery":
            return parseMessageEmbedGalleryBlock(value);
        case "markdown":
            return parseMessageEmbedMarkdownBlock(value);
        case "media":
            return parseMessageEmbedMediaBlock(value);
        default:
            return null;
    }
}

function parseMessageEmbedBlocks(value: unknown): MessageEmbedBlock[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        const block = parseMessageEmbedBlock(item);
        return block ? [block] : [];
    });
}

function parseMessageEmbedCodeBlock(
    value: Record<string, unknown>,
): MessageEmbedBlock | null {
    if (typeof value["code"] !== "string") return null;
    const block: MessageEmbedBlock = {
        code: value["code"],
        type: "code",
    };
    copyString(block, value, "language");
    return block;
}

function parseMessageEmbedField(value: unknown): MessageEmbedField | null {
    if (
        !isRecord(value) ||
        typeof value["label"] !== "string" ||
        typeof value["value"] !== "string"
    ) {
        return null;
    }
    const field: MessageEmbedField = {
        label: value["label"],
        value: value["value"],
    };
    copyBoolean(field, value, "mono");
    copyBoolean(field, value, "short");
    return field;
}

function parseMessageEmbedFields(value: unknown): MessageEmbedField[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        const field = parseMessageEmbedField(item);
        return field ? [field] : [];
    });
}

function parseMessageEmbedFileBlock(
    value: Record<string, unknown>,
): MessageEmbedBlock | null {
    const attachment = parseAttachmentExtra(value["attachment"]);
    if (!attachment) return null;
    const block: MessageEmbedBlock = {
        attachment,
        type: "file",
    };
    copyString(block, value, "role");
    return block;
}

function parseMessageEmbedGalleryBlock(
    value: Record<string, unknown>,
): MessageEmbedBlock | null {
    if (!Array.isArray(value["items"])) return null;
    const items = value["items"].flatMap((item) => {
        const media = parseMessageEmbedMediaItem(item);
        return media ? [media] : [];
    });
    return items.length > 0 ? { items, type: "gallery" } : null;
}

function parseMessageEmbedMarkdownBlock(
    value: Record<string, unknown>,
): MessageEmbedBlock | null {
    const text = value["text"];
    const source = value["source"];
    if (
        text !== undefined &&
        typeof text !== "string" &&
        source !== "message"
    ) {
        return null;
    }
    if (text === undefined && source !== "message") return null;
    const block: MessageEmbedBlock = { type: "markdown" };
    copyNumber(block, value, "maxLines");
    if (source === "message") block.source = "message";
    if (typeof text === "string") block.text = text;
    return block;
}

function parseMessageEmbedMediaBlock(
    value: Record<string, unknown>,
): MessageEmbedBlock | null {
    const media = parseMessageEmbedMediaItem(value);
    return media ? { ...media, type: "media" } : null;
}

function parseMessageEmbedMediaItem(
    value: unknown,
): MessageEmbedMediaItem | null {
    if (!isRecord(value) || !isMessageEmbedMediaType(value["mediaType"])) {
        return null;
    }
    const attachment = parseAttachmentExtra(value["attachment"]);
    if (!attachment) return null;
    const media: MessageEmbedMediaItem = {
        attachment,
        mediaType: value["mediaType"],
    };
    copyString(media, value, "alt");
    copyNumber(media, value, "aspectRatio");
    copyString(media, value, "caption");
    copyString(media, value, "title");
    const thumbnail = parseAttachmentExtra(value["thumbnail"]);
    if (thumbnail) media.thumbnail = thumbnail;
    return media;
}

function parseMessageEmbedSource(value: unknown): MessageEmbedSource | null {
    if (!isRecord(value)) return null;
    const source: MessageEmbedSource = {};
    copyString(source, value, "id");
    copyString(source, value, "mailID");
    copyString(source, value, "provider");
    copyString(source, value, "url");
    return Object.keys(source).length > 0 ? source : null;
}

function parseMessageEmoji(value: unknown): MessageEmoji | null {
    if (!isRecord(value)) {
        return null;
    }

    if (value["kind"] === "unicode" && typeof value["value"] === "string") {
        const shortcode = value["shortcode"];
        return {
            kind: "unicode",
            ...(typeof shortcode === "string" && shortcode !== ""
                ? { shortcode }
                : {}),
            value: value["value"],
        };
    }

    if (value["kind"] === "custom" && typeof value["name"] === "string") {
        const imageUrl = value["imageUrl"];
        const sourceID = value["sourceID"];
        return {
            kind: "custom",
            name: value["name"],
            ...(typeof imageUrl === "string" && imageUrl !== ""
                ? { imageUrl }
                : {}),
            ...(typeof sourceID === "string" && sourceID !== ""
                ? { sourceID }
                : {}),
        };
    }

    return null;
}

function parseMessageReactionEvent(
    value: unknown,
): MessageReactionEvent | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const emoji = parseMessageEmoji(value["emoji"]);
    if (
        value["action"] !== "toggle" ||
        !emoji ||
        typeof value["targetMailID"] !== "string" ||
        value["targetMailID"] === ""
    ) {
        return undefined;
    }
    return {
        action: "toggle",
        emoji,
        targetMailID: value["targetMailID"],
    };
}

function parseMessageReactions(value: unknown): MessageReaction[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const reactions: MessageReaction[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!isRecord(item)) {
            continue;
        }
        const emoji = parseMessageEmoji(item["emoji"]);
        if (!emoji) {
            continue;
        }
        const userIDs = Array.isArray(item["userIDs"])
            ? item["userIDs"].filter(
                  (id): id is string => typeof id === "string" && id !== "",
              )
            : [];
        const uniqueUserIDs = [...new Set(userIDs)];
        if (uniqueUserIDs.length === 0) {
            continue;
        }

        const key = emojiReactionKey(emoji);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        reactions.push({ emoji, userIDs: uniqueUserIDs });
    }
    return reactions;
}

function parseMessageReplyReference(
    value: unknown,
): MessageReplyReference | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const targetMailID =
        typeof value["targetMailID"] === "string"
            ? value["targetMailID"].trim()
            : "";
    if (!targetMailID) {
        return undefined;
    }

    const reply: MessageReplyReference = { targetMailID };
    const targetAttachment = parseAttachmentExtra(value["targetAttachment"]);
    if (targetAttachment) {
        reply.targetAttachment = targetAttachment;
    }
    copyTrimmedString(reply, value, "targetAuthorID");
    copyTrimmedString(reply, value, "targetAuthorName");
    copyTrimmedString(reply, value, "targetTimestamp");

    const targetPreview =
        typeof value["targetPreview"] === "string"
            ? truncateReplyPreview(value["targetPreview"].replace(/\s+/g, " "))
            : "";
    if (targetPreview) {
        reply.targetPreview = targetPreview;
    }
    return reply;
}

function parseMessageUpdateEvent(
    value: unknown,
): MessageUpdateEvent | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    if (
        value["action"] !== "update" ||
        typeof value["message"] !== "string" ||
        typeof value["targetMailID"] !== "string" ||
        value["targetMailID"] === ""
    ) {
        return undefined;
    }
    const event: MessageUpdateEvent = {
        action: "update",
        message: value["message"],
        targetMailID: value["targetMailID"],
    };
    copyString(event, value, "editedAt");
    return event;
}

function pushSegment(
    segments: MarkdownInlineSegment[],
    segment: MarkdownInlineSegment,
): void {
    const previous = segments[segments.length - 1];
    if (segment.type === "text" && previous?.type === "text") {
        previous.text += segment.text;
        return;
    }
    segments.push(segment);
}

function pushTextNode(nodes: MessageMarkdownNode[], text: string): void {
    if (text.length === 0) return;
    const node: MessageMarkdownNode = {
        segments: parseInlineMarkdown(text),
        type: "text",
    };
    Object.defineProperty(node, "source", {
        enumerable: false,
        value: text,
    });
    nodes.push(node);
}

function reactToMessage(
    message: MessageWithClientExtra,
    event: MessageReactionEvent,
    actorUserID: string,
): Message {
    return {
        ...message,
        extra: toggleMessageReactionExtra(
            message.extra,
            event.emoji,
            actorUserID,
        ),
    } as Message;
}

function trimCodeFenceText(value: string): string {
    return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function trimInlineUrl(value: string): string {
    let next = value;
    while (/[),.!?;:]$/.test(next)) {
        const last = next.at(-1);
        if (last === ")" && hasBalancedParens(next)) {
            break;
        }
        next = next.slice(0, -1);
    }
    return next;
}

function truncateReplyPreview(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= MESSAGE_REPLY_PREVIEW_MAX) {
        return trimmed;
    }
    return `${trimmed.slice(0, MESSAGE_REPLY_PREVIEW_MAX - 3).trimEnd()}...`;
}

function unescapeMarkdownLabel(value: string): string {
    return value.replace(/\\([\\[\]])/g, "$1");
}

function updateMessage(
    message: Message,
    event: MessageUpdateEvent,
    actorUserID: string,
): Message {
    return message.authorID === actorUserID && message.message !== event.message
        ? { ...message, message: event.message }
        : message;
}

// ── Message chunking ─────────────────────────────────────────────────────────

const CHUNK_GAP_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CHUNK_SIZE = 100;

/**
 * Groups messages by sender into display chunks.
 * Starts a new chunk on: different sender, >5 min gap, or 100 message cap.
 */
export function chunkMessages(messages: Message[]): MessageChunk[] {
    const sorted = messages
        .map((message) => ({ message, time: Date.parse(message.timestamp) }))
        .sort((a, b) => a.time - b.time);
    const chunks: MessageChunk[] = [];
    let previousTime = NaN;

    for (const { message: msg, time } of sorted) {
        const last = chunks[chunks.length - 1];

        const sameAuthor = last?.authorID === msg.authorID;
        const withinGap = time - previousTime < CHUNK_GAP_MS;
        const notFull = (last?.messages.length ?? 0) < MAX_CHUNK_SIZE;

        if (last && sameAuthor && withinGap && notFull) {
            last.messages.push(msg);
        } else {
            chunks.push({
                authorID: msg.authorID,
                firstTime: msg.timestamp,
                messages: [msg],
            });
        }
        previousTime = time;
    }

    return chunks;
}

// ── Emoji shortcodes ────────────────────────────────────────────────────────

const EMOJI: Record<string, string> = {
    "-1": "👎",
    "+1": "👍",
    angry: "😠",
    check: "✅",
    clap: "👏",
    confused: "😕",
    cool: "😎",
    cry: "😢",
    dizzy: "😵",
    eyes: "👀",
    fire: "🔥",
    grin: "😁",
    heart: "❤️",
    joy: "😂",
    laugh: "😂",
    muscle: "💪",
    ok: "👌",
    pray: "🙏",
    rocket: "🚀",
    shrug: "🤷",
    smile: "😊",
    star: "⭐",
    tada: "🎉",
    think: "🤔",
    thumbsdown: "👎",
    thumbsup: "👍",
    wave: "👋",
    x: "❌",
    zzz: "😴",
};

/** Replaces :shortcode: with emoji characters. Accepts word-char or
 * leading `+`/`-` (so `:+1:` and `:-1:` work alongside `:thumbsup:`).
 * Leading `-` is placed first in the character class so it's treated
 * as a literal, not a range. */
export function applyEmoji(text: string): string {
    return text.replace(
        /:([-+\w][-+\w]*):/g,
        (m, name: string) => EMOJI[name] ?? m,
    );
}

// ── Date formatting ─────────────────────────────────────────────────────────

/**
 * Formats a timestamp for display.
 * Accepts a Date object or an ISO 8601 string.
 * Same day → "HH:mm". Earlier → "MMM D HH:mm".
 */
export function formatTime(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hhmm = d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
    if (sameDay) return hhmm;
    return (
        d.toLocaleDateString([], { day: "numeric", month: "short" }) +
        " " +
        hhmm
    );
}

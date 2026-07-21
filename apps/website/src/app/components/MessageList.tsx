import type { Message } from "@vex-chat/libvex";
import type { MessageEmoji } from "@vex-chat/store";

import {
    Copy,
    CornerUpLeft,
    Ellipsis,
    MessageCircle,
    Pencil,
    ShieldX,
    SmilePlus,
    Trash2,
} from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
    chunkMessages,
    createUnicodeReactionEmoji,
    emojiReactionLabel,
    formatTime,
    messageReactions,
    messageReply,
} from "@vex-chat/store";

import { Avatar } from "./Avatar";
import { MessageContent } from "./MessageContent";

const MESSAGE_PAGE_SIZE = 250;
const QUICK_REACTIONS = [
    "\u{1F44D}",
    "\u{2764}\u{FE0F}",
    "\u{1F602}",
    "\u{1F389}",
    "\u{1F440}",
].map((value) => createUnicodeReactionEmoji(value));

interface MessageListProps {
    contextKey: string;
    currentUserID: string;
    messages: Message[];
    onDeleteForEveryone: (message: Message) => void;
    onDeleteForMe: (message: Message) => void;
    onEdit: (message: Message) => void;
    onReply: (message: Message) => void;
    onToggleReaction: (message: Message, emoji: MessageEmoji) => void;
    usernames: Record<string, string>;
}

export function MessageList({
    contextKey,
    currentUserID,
    messages,
    onDeleteForEveryone,
    onDeleteForMe,
    onEdit,
    onReply,
    onToggleReaction,
    usernames,
}: MessageListProps) {
    const [visibleLimit, setVisibleLimit] = useState(MESSAGE_PAGE_SIZE);
    const [reactionPicker, setReactionPicker] = useState("");
    const [actionMenu, setActionMenu] = useState("");
    const [highlighted, setHighlighted] = useState("");
    const containerRef = useRef<HTMLDivElement | null>(null);
    const messageElements = useRef(new Map<string, HTMLDivElement>());
    const autoScroll = useRef(true);
    const previousContext = useRef(contextKey);
    const previousMessageCount = useRef(0);
    const visibleMessages = useMemo(
        () =>
            messages.length > visibleLimit
                ? messages.slice(messages.length - visibleLimit)
                : messages,
        [messages, visibleLimit],
    );
    const chunks = useMemo(
        () => chunkMessages(visibleMessages),
        [visibleMessages],
    );
    const messageByID = useMemo(
        () => new Map(messages.map((message) => [message.mailID, message])),
        [messages],
    );
    const hiddenCount = Math.max(0, messages.length - visibleMessages.length);

    useEffect(() => {
        if (previousContext.current !== contextKey) {
            previousContext.current = contextKey;
            previousMessageCount.current = 0;
            autoScroll.current = true;
            setVisibleLimit(MESSAGE_PAGE_SIZE);
            setReactionPicker("");
            setActionMenu("");
            window.requestAnimationFrame(() => scrollToBottom());
        }
    }, [contextKey]);

    useEffect(() => {
        const grew = messages.length > previousMessageCount.current;
        previousMessageCount.current = messages.length;
        if (grew) window.requestAnimationFrame(() => scrollToBottom());
    }, [messages.length]);

    function scrollToBottom() {
        const container = containerRef.current;
        if (container && autoScroll.current) {
            container.scrollTop = container.scrollHeight;
        }
    }

    function handleScroll() {
        const container = containerRef.current;
        if (!container) return;
        autoScroll.current =
            container.scrollHeight -
                container.scrollTop -
                container.clientHeight <
            120;
    }

    function loadOlder() {
        const container = containerRef.current;
        if (!container || hiddenCount === 0) return;
        const previousHeight = container.scrollHeight;
        setVisibleLimit((current) => current + MESSAGE_PAGE_SIZE);
        window.requestAnimationFrame(() => {
            container.scrollTop += container.scrollHeight - previousHeight;
        });
    }

    function scrollToMessage(mailID: string) {
        const element = messageElements.current.get(mailID);
        if (element) {
            showMessage(element, mailID);
            return;
        }
        if (hiddenCount === 0) return;
        setVisibleLimit(messages.length);
        window.requestAnimationFrame(() => {
            const revealed = messageElements.current.get(mailID);
            if (revealed) showMessage(revealed, mailID);
        });
    }

    function showMessage(element: HTMLDivElement, mailID: string) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlighted(mailID);
        window.setTimeout(() => setHighlighted(""), 1600);
    }

    return (
        <div
            aria-label="Messages"
            aria-live="polite"
            className="message-list"
            ref={containerRef}
            role="log"
            onScroll={handleScroll}
        >
            {messages.length === 0 ? (
                <div className="message-list__empty">
                    <span>
                        <MessageCircle size={23} />
                    </span>
                    <strong>Start the conversation</strong>
                    <small>Messages sent here are end-to-end encrypted.</small>
                </div>
            ) : null}
            {hiddenCount > 0 ? (
                <button
                    className="message-list__older"
                    type="button"
                    onClick={loadOlder}
                >
                    Load {Math.min(hiddenCount, MESSAGE_PAGE_SIZE)} older
                    messages
                </button>
            ) : null}
            {chunks.map((chunk) => {
                const authorName =
                    usernames[chunk.authorID] ?? chunk.authorID.slice(0, 8);
                return (
                    <section
                        className="message-chunk"
                        key={`${chunk.authorID}:${chunk.messages[0]?.mailID ?? chunk.firstTime}`}
                    >
                        <Avatar
                            name={authorName}
                            size={36}
                            userID={chunk.authorID}
                        />
                        <div className="message-chunk__body">
                            <header className="message-chunk__meta">
                                <strong>{authorName}</strong>
                                <time dateTime={chunk.firstTime}>
                                    {formatTime(chunk.firstTime)}
                                </time>
                            </header>
                            {chunk.messages.map((message) => {
                                const isOwn =
                                    message.authorID === currentUserID;
                                const reply = messageReply(message);
                                const target = reply
                                    ? messageByID.get(reply.targetMailID)
                                    : null;
                                const reactions = messageReactions(message);
                                const pickerOpen =
                                    reactionPicker === message.mailID;
                                return (
                                    <div
                                        className={
                                            highlighted === message.mailID
                                                ? "message-row is-highlighted"
                                                : "message-row"
                                        }
                                        key={message.mailID}
                                        ref={(element) => {
                                            if (element) {
                                                messageElements.current.set(
                                                    message.mailID,
                                                    element,
                                                );
                                            } else {
                                                messageElements.current.delete(
                                                    message.mailID,
                                                );
                                            }
                                        }}
                                    >
                                        {reply ? (
                                            <button
                                                className="message-reply-reference"
                                                disabled={!target}
                                                title={
                                                    target
                                                        ? undefined
                                                        : "Original message is no longer available"
                                                }
                                                type="button"
                                                onClick={
                                                    target
                                                        ? () =>
                                                              scrollToMessage(
                                                                  reply.targetMailID,
                                                              )
                                                        : undefined
                                                }
                                            >
                                                <CornerUpLeft size={13} />
                                                <strong>
                                                    {target
                                                        ? (usernames[
                                                              target.authorID
                                                          ] ??
                                                          target.authorID.slice(
                                                              0,
                                                              8,
                                                          ))
                                                        : (reply.targetAuthorName ??
                                                          "Message")}
                                                </strong>
                                                <span>
                                                    {target?.message ||
                                                        reply.targetPreview ||
                                                        reply.targetAttachment
                                                            ?.fileName ||
                                                        "Original message"}
                                                </span>
                                            </button>
                                        ) : null}
                                        <div className="message-row__actions">
                                            <ActionButton
                                                className="message-action--quick"
                                                icon={
                                                    <CornerUpLeft size={14} />
                                                }
                                                label="Reply"
                                                onClick={() => onReply(message)}
                                            />
                                            <ActionButton
                                                className="message-action--quick"
                                                icon={<SmilePlus size={14} />}
                                                label="Add reaction"
                                                onClick={() =>
                                                    setReactionPicker(
                                                        pickerOpen
                                                            ? ""
                                                            : message.mailID,
                                                    )
                                                }
                                            />
                                            {isOwn ? (
                                                <ActionButton
                                                    className="message-action--quick"
                                                    icon={<Pencil size={14} />}
                                                    label="Edit message"
                                                    onClick={() =>
                                                        onEdit(message)
                                                    }
                                                />
                                            ) : null}
                                            <ActionButton
                                                className="message-action--more"
                                                icon={<Ellipsis size={15} />}
                                                label="More message actions"
                                                onClick={() => {
                                                    setReactionPicker("");
                                                    setActionMenu(
                                                        actionMenu ===
                                                            message.mailID
                                                            ? ""
                                                            : message.mailID,
                                                    );
                                                }}
                                            />
                                        </div>
                                        {actionMenu === message.mailID ? (
                                            <div
                                                className="message-action-menu"
                                                role="menu"
                                            >
                                                <button
                                                    role="menuitem"
                                                    type="button"
                                                    onClick={() => {
                                                        setActionMenu("");
                                                        onReply(message);
                                                    }}
                                                >
                                                    <CornerUpLeft size={14} />
                                                    Reply
                                                </button>
                                                <button
                                                    role="menuitem"
                                                    type="button"
                                                    onClick={() => {
                                                        setActionMenu("");
                                                        setReactionPicker(
                                                            message.mailID,
                                                        );
                                                    }}
                                                >
                                                    <SmilePlus size={14} /> Add
                                                    reaction
                                                </button>
                                                <button
                                                    role="menuitem"
                                                    type="button"
                                                    onClick={() => {
                                                        setActionMenu("");
                                                        void navigator.clipboard.writeText(
                                                            message.message,
                                                        );
                                                    }}
                                                >
                                                    <Copy size={14} /> Copy text
                                                </button>
                                                {isOwn ? (
                                                    <button
                                                        role="menuitem"
                                                        type="button"
                                                        onClick={() => {
                                                            setActionMenu("");
                                                            onEdit(message);
                                                        }}
                                                    >
                                                        <Pencil size={14} />{" "}
                                                        Edit
                                                    </button>
                                                ) : null}
                                                <button
                                                    className="is-danger"
                                                    role="menuitem"
                                                    type="button"
                                                    onClick={() => {
                                                        setActionMenu("");
                                                        onDeleteForMe(message);
                                                    }}
                                                >
                                                    <Trash2 size={14} /> Delete
                                                    from this browser
                                                </button>
                                                {isOwn ? (
                                                    <button
                                                        className="is-danger"
                                                        role="menuitem"
                                                        type="button"
                                                        onClick={() => {
                                                            setActionMenu("");
                                                            onDeleteForEveryone(
                                                                message,
                                                            );
                                                        }}
                                                    >
                                                        <ShieldX size={14} />
                                                        Delete for everyone
                                                    </button>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {pickerOpen ? (
                                            <div
                                                className="message-reaction-picker"
                                                role="menu"
                                            >
                                                {QUICK_REACTIONS.map(
                                                    (emoji) => (
                                                        <button
                                                            aria-label={`React ${emojiReactionLabel(emoji)}`}
                                                            key={emojiReactionLabel(
                                                                emoji,
                                                            )}
                                                            role="menuitem"
                                                            type="button"
                                                            onClick={() => {
                                                                setReactionPicker(
                                                                    "",
                                                                );
                                                                onToggleReaction(
                                                                    message,
                                                                    emoji,
                                                                );
                                                            }}
                                                        >
                                                            {emojiReactionLabel(
                                                                emoji,
                                                            )}
                                                        </button>
                                                    ),
                                                )}
                                            </div>
                                        ) : null}
                                        {!message.decrypted ? (
                                            <div
                                                className="message-decrypt-error"
                                                role="alert"
                                            >
                                                <strong>
                                                    Message could not be
                                                    decrypted
                                                </strong>
                                                <span>
                                                    This device could not open
                                                    the encrypted payload.
                                                </span>
                                            </div>
                                        ) : (
                                            <MessageContent
                                                content={message.message}
                                                extra={message.extra}
                                            />
                                        )}
                                        {reactions.length ? (
                                            <div className="message-reactions">
                                                {reactions.map((reaction) => {
                                                    const active =
                                                        reaction.userIDs.includes(
                                                            currentUserID,
                                                        );
                                                    return (
                                                        <button
                                                            aria-pressed={
                                                                active
                                                            }
                                                            className={
                                                                active
                                                                    ? "is-active"
                                                                    : undefined
                                                            }
                                                            key={emojiReactionLabel(
                                                                reaction.emoji,
                                                            )}
                                                            title={reaction.userIDs
                                                                .map(
                                                                    (userID) =>
                                                                        usernames[
                                                                            userID
                                                                        ] ??
                                                                        userID.slice(
                                                                            0,
                                                                            8,
                                                                        ),
                                                                )
                                                                .join(", ")}
                                                            type="button"
                                                            onClick={() =>
                                                                onToggleReaction(
                                                                    message,
                                                                    reaction.emoji,
                                                                )
                                                            }
                                                        >
                                                            <span>
                                                                {emojiReactionLabel(
                                                                    reaction.emoji,
                                                                )}
                                                            </span>
                                                            <small>
                                                                {
                                                                    reaction
                                                                        .userIDs
                                                                        .length
                                                                }
                                                            </small>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function ActionButton({
    className = "",
    danger = false,
    icon,
    label,
    onClick,
}: {
    className?: string;
    danger?: boolean;
    icon: preact.ComponentChildren;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            aria-label={label}
            className={`message-action${danger ? " is-danger" : ""}${className ? ` ${className}` : ""}`}
            title={label}
            type="button"
            onClick={onClick}
        >
            {icon}
        </button>
    );
}

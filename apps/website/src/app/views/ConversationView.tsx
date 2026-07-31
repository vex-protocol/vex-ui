import type { Message, User } from "@vex-chat/libvex";
import type { MessageEmoji } from "@vex-chat/store";

import {
    ArrowLeft,
    Ellipsis,
    Hash,
    Phone,
    Settings2,
    Trash2,
    Users,
    X,
} from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
    $channels,
    $currentCallID,
    $familiars,
    $groupMessages,
    $messages,
    $servers,
    $user,
    buildMessageReplyReference,
    createReplyReferenceExtra,
    formatFileAttachmentMarkdown,
    vexService,
} from "@vex-chat/store";

import { Avatar } from "../components/Avatar";
import {
    MessageComposer,
    type MessageComposerSendContext,
} from "../components/MessageComposer";
import { MessageList } from "../components/MessageList";
import { productFeatures } from "../lib/features";
import { navigate, serverSettingsPath, type WebRoute } from "../lib/router";
import { useStoreValue } from "../lib/useStoreValue";

const drafts = new Map<string, string>();
const draftVersions = new Map<string, number>();
const MAX_DRAFTS = 100;

function writeDraft(contextKey: string, value: string) {
    draftVersions.set(contextKey, (draftVersions.get(contextKey) ?? 0) + 1);
    if (value) {
        drafts.delete(contextKey);
        drafts.set(contextKey, value);
        while (drafts.size > MAX_DRAFTS) {
            const oldest = drafts.keys().next().value;
            if (typeof oldest !== "string") break;
            drafts.delete(oldest);
        }
    } else {
        drafts.delete(contextKey);
    }
}

type ConversationRoute = Extract<WebRoute, { kind: "channel" | "dm" }>;

export function ConversationView({ route }: { route: ConversationRoute }) {
    const currentUser = useStoreValue($user);
    const familiars = useStoreValue($familiars);
    const servers = useStoreValue($servers);
    const channels = useStoreValue($channels);
    const directMessages = useStoreValue($messages);
    const groupMessages = useStoreValue($groupMessages);
    const currentCallID = useStoreValue($currentCallID);
    const isGroup = route.kind === "channel";
    const conversationKey =
        route.kind === "channel" ? route.channelID : route.userID;
    const contextKey = `${isGroup ? "channel" : "dm"}:${conversationKey}`;
    const messages = isGroup
        ? (groupMessages[conversationKey] ?? [])
        : (directMessages[conversationKey] ?? []);
    const [members, setMembers] = useState<User[]>([]);
    const [resolvedPeer, setResolvedPeer] = useState<User | null>(null);
    const [membersOpen, setMembersOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [text, setText] = useState(() => drafts.get(contextKey) ?? "");
    const [editing, setEditing] = useState<Message | null>(null);
    const [replying, setReplying] = useState<Message | null>(null);
    const [sending, setSending] = useState(false);
    const [callStarting, setCallStarting] = useState(false);
    const [error, setError] = useState("");
    const contextKeyRef = useRef(contextKey);
    contextKeyRef.current = contextKey;

    const channel =
        route.kind === "channel"
            ? channels[route.serverID]?.find(
                  (candidate) => candidate.channelID === route.channelID,
              )
            : null;
    const server = route.kind === "channel" ? servers[route.serverID] : null;
    const peer =
        route.kind === "dm" ? (familiars[route.userID] ?? resolvedPeer) : null;
    const title = channel?.name ?? peer?.username ?? "Conversation";
    const usernameMap = useMemo(() => {
        const map: Record<string, string> = {};
        if (currentUser) map[currentUser.userID] = currentUser.username;
        for (const member of members) map[member.userID] = member.username;
        if (peer) map[peer.userID] = peer.username;
        return map;
    }, [currentUser, members, peer]);
    const replyingReference = replying
        ? buildMessageReplyReference(
              replying,
              usernameMap[replying.authorID] ?? replying.authorID.slice(0, 8),
          )
        : null;
    const latestMessageID = messages[messages.length - 1]?.mailID;

    useEffect(() => {
        const nextText = drafts.get(contextKey) ?? "";
        setText(nextText);
        setEditing(null);
        setReplying(null);
        setError("");
        setMenuOpen(false);
        setMembersOpen(false);
    }, [contextKey]);

    useEffect(() => {
        void latestMessageID;
        vexService.markRead(conversationKey);
    }, [conversationKey, latestMessageID]);

    useEffect(() => {
        if (route.kind !== "channel") {
            setMembers([]);
            return;
        }
        let active = true;
        void vexService
            .getChannelMembers(route.channelID)
            .then((next) => {
                if (active) setMembers(next);
            })
            .catch(() => {
                if (active) setMembers([]);
            });
        return () => {
            active = false;
        };
    }, [route.kind, route.kind === "channel" ? route.channelID : ""]);

    useEffect(() => {
        if (route.kind !== "dm" || familiars[route.userID]) {
            setResolvedPeer(null);
            return;
        }
        let active = true;
        void vexService.lookupUser(route.userID).then((found) => {
            if (active) setResolvedPeer(found);
        });
        return () => {
            active = false;
        };
    }, [familiars, route.kind, route.kind === "dm" ? route.userID : ""]);

    function updateText(next: string) {
        setText(next);
        writeDraft(contextKey, next);
    }

    async function send(
        content: string,
        attachment: File | undefined,
        sendContext: MessageComposerSendContext,
    ): Promise<boolean> {
        if (!currentUser || sending) return false;
        const pendingContext = contextKey;
        const pendingDraftVersion = draftVersions.get(pendingContext) ?? 0;
        const pendingEdit = editing;
        const pendingReply = sendContext.replyingTo;
        setSending(true);
        setError("");
        try {
            if (pendingEdit) {
                const result = await vexService.editMessage(
                    conversationKey,
                    pendingEdit.mailID,
                    isGroup,
                    content,
                );
                if (!result.ok) {
                    setError(result.error ?? "Could not edit the message.");
                    return false;
                }
                const draftUnchanged =
                    (draftVersions.get(pendingContext) ?? 0) ===
                    pendingDraftVersion;
                if (draftUnchanged) {
                    writeDraft(pendingContext, "");
                }
                if (
                    draftUnchanged &&
                    contextKeyRef.current === pendingContext
                ) {
                    setEditing((current) =>
                        current?.mailID === pendingEdit.mailID ? null : current,
                    );
                    setText("");
                }
                return true;
            }

            if (!sendContext.preserveComposerContext) {
                setReplying(null);
            }
            let body = content;
            if (attachment) {
                const uploaded = await vexService.uploadFileAttachment({
                    contentType: attachment.type || "application/octet-stream",
                    data: new Uint8Array(await attachment.arrayBuffer()),
                    fileName: attachment.name || `attachment-${Date.now()}`,
                    fileSize: attachment.size,
                });
                if (!uploaded.ok || !uploaded.attachment) {
                    setError(uploaded.error ?? "Could not upload the file.");
                    return false;
                }
                const markdown = formatFileAttachmentMarkdown(
                    uploaded.attachment,
                );
                body = body ? `${body}\n\n${markdown}` : markdown;
            }

            const extra = pendingReply
                ? createReplyReferenceExtra(pendingReply)
                : undefined;
            const options = extra ? { extra } : undefined;
            const result = isGroup
                ? await vexService.sendGroupMessage(
                      conversationKey,
                      body,
                      options,
                  )
                : await vexService.sendDM(conversationKey, body, options);
            if (!result.ok) {
                setError(result.error ?? "Could not send the message.");
                return false;
            }
            return true;
        } catch (cause: unknown) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : "Could not send the message.",
            );
            return false;
        } finally {
            setSending(false);
        }
    }

    function editMessage(message: Message) {
        setError("");
        setReplying(null);
        setEditing(message);
        updateText(message.message);
    }

    function replyToMessage(message: Message) {
        setError("");
        setEditing(null);
        setReplying(message);
    }

    function deleteForMe(message: Message) {
        if (!window.confirm("Delete this message from this browser?")) return;
        void vexService
            .deleteLocalMessage(conversationKey, message.mailID, isGroup)
            .then((deleted) => {
                if (!deleted) setError("Could not delete the local message.");
            });
    }

    function deleteForEveryone(message: Message) {
        if (!window.confirm("Delete this message for everyone?")) return;
        void vexService
            .deleteMessageForEveryone(conversationKey, message.mailID, isGroup)
            .then((result) => {
                if (!result.ok) {
                    setError(result.error ?? "Could not delete the message.");
                }
            });
    }

    function toggleReaction(message: Message, emoji: MessageEmoji) {
        void vexService
            .toggleMessageReaction(
                conversationKey,
                message.mailID,
                isGroup,
                emoji,
            )
            .then((result) => {
                if (!result.ok) {
                    setError(result.error ?? "Could not update the reaction.");
                }
            });
    }

    async function startVoiceCall() {
        if (route.kind !== "dm" || currentCallID || callStarting) return;
        setError("");
        setCallStarting(true);
        try {
            const { voiceCallEngine } = await import("../lib/voiceCallEngine");
            await voiceCallEngine.startDmCall(route.userID, peer?.username);
        } catch (cause: unknown) {
            setError(
                cause instanceof Error && cause.message
                    ? cause.message
                    : "Could not start the voice call.",
            );
        } finally {
            setCallStarting(false);
        }
    }

    function deleteThread(everyone: boolean) {
        const prompt = everyone
            ? "Delete your messages for everyone and remove this local conversation?"
            : "Delete this conversation from this browser?";
        if (!window.confirm(prompt)) return;
        setMenuOpen(false);
        if (everyone) {
            void vexService
                .deleteThreadForEveryone(conversationKey, false)
                .then((result) => {
                    if (!result.ok) {
                        setError(
                            result.error ??
                                "Could not delete the conversation.",
                        );
                    }
                });
            return;
        }
        void vexService.deleteLocalThread(conversationKey, false).then((ok) => {
            if (!ok) setError("Could not delete the local conversation.");
        });
    }

    return (
        <section
            className={
                membersOpen && isGroup
                    ? "conversation-view has-members"
                    : "conversation-view"
            }
        >
            <div className="conversation-main">
                <header className="conversation-header">
                    <button
                        aria-label="Back"
                        className="conversation-header__back"
                        title="Back"
                        type="button"
                        onClick={() =>
                            navigate(
                                isGroup
                                    ? `/app/server/${route.kind === "channel" ? route.serverID : ""}`
                                    : "/app/dms",
                            )
                        }
                    >
                        <ArrowLeft size={19} />
                    </button>
                    {peer ? (
                        <Avatar
                            name={peer.username}
                            size={32}
                            userID={peer.userID}
                        />
                    ) : (
                        <span className="conversation-header__hash">
                            <Hash size={18} />
                        </span>
                    )}
                    <span className="conversation-header__copy">
                        <strong>{title}</strong>
                        <small>
                            {isGroup
                                ? (server?.name ?? "Group")
                                : "Direct message"}
                        </small>
                    </span>
                    <div className="conversation-header__actions">
                        {isGroup ? (
                            <>
                                <button
                                    aria-label={
                                        membersOpen
                                            ? "Hide members"
                                            : "Show members"
                                    }
                                    aria-pressed={membersOpen}
                                    className={
                                        membersOpen ? "is-active" : undefined
                                    }
                                    title={
                                        membersOpen
                                            ? "Hide members"
                                            : "Show members"
                                    }
                                    type="button"
                                    onClick={() =>
                                        setMembersOpen((open) => !open)
                                    }
                                >
                                    <Users size={18} />
                                    {members.length ? (
                                        <span>{members.length}</span>
                                    ) : null}
                                </button>
                                <button
                                    aria-label="Group settings"
                                    title="Group settings"
                                    type="button"
                                    onClick={() =>
                                        navigate(
                                            serverSettingsPath(
                                                route.kind === "channel"
                                                    ? route.serverID
                                                    : "",
                                            ),
                                        )
                                    }
                                >
                                    <Settings2 size={18} />
                                </button>
                            </>
                        ) : (
                            <>
                                {productFeatures.voiceCalling ? (
                                    <button
                                        aria-label="Start voice call"
                                        disabled={
                                            Boolean(currentCallID) ||
                                            callStarting
                                        }
                                        title="Start voice call"
                                        type="button"
                                        onClick={() => void startVoiceCall()}
                                    >
                                        <Phone size={18} />
                                    </button>
                                ) : null}
                                <button
                                    aria-expanded={menuOpen}
                                    aria-label="Conversation options"
                                    title="Conversation options"
                                    type="button"
                                    onClick={() => setMenuOpen((open) => !open)}
                                >
                                    <Ellipsis size={19} />
                                </button>
                            </>
                        )}
                        {menuOpen ? (
                            <div className="conversation-menu" role="menu">
                                <button
                                    role="menuitem"
                                    type="button"
                                    onClick={() => deleteThread(false)}
                                >
                                    <Trash2 size={15} /> Delete from this
                                    browser
                                </button>
                                <button
                                    className="is-danger"
                                    role="menuitem"
                                    type="button"
                                    onClick={() => deleteThread(true)}
                                >
                                    <Trash2 size={15} /> Delete my messages for
                                    everyone
                                </button>
                            </div>
                        ) : null}
                    </div>
                </header>
                <MessageList
                    contextKey={contextKey}
                    currentUserID={currentUser?.userID ?? ""}
                    key={contextKey}
                    messages={messages}
                    usernames={usernameMap}
                    onDeleteForEveryone={deleteForEveryone}
                    onDeleteForMe={deleteForMe}
                    onEdit={editMessage}
                    onReply={replyToMessage}
                    onToggleReaction={toggleReaction}
                />
                {error ? (
                    <div className="conversation-error" role="alert">
                        <span>{error}</span>
                        <button
                            aria-label="Dismiss error"
                            title="Dismiss"
                            type="button"
                            onClick={() => setError("")}
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : null}
                <MessageComposer
                    contextKey={contextKey}
                    disabled={!currentUser}
                    editing={Boolean(editing)}
                    placeholder={
                        isGroup ? `Message #${title}` : `Message ${title}`
                    }
                    replyingTo={replyingReference}
                    sending={sending}
                    value={text}
                    onCancelEdit={() => {
                        setEditing(null);
                        updateText("");
                    }}
                    onCancelReply={() => setReplying(null)}
                    onChange={updateText}
                    onSend={send}
                />
            </div>
            {membersOpen && isGroup ? (
                <aside className="member-panel" aria-label="Members">
                    <header>
                        <strong>Members</strong>
                        <button
                            aria-label="Close members"
                            title="Close"
                            type="button"
                            onClick={() => setMembersOpen(false)}
                        >
                            <X size={15} />
                        </button>
                    </header>
                    <div className="member-panel__list">
                        {members.map((member) => (
                            <button
                                key={member.userID}
                                type="button"
                                onClick={() =>
                                    navigate(`/app/dm/${member.userID}`)
                                }
                            >
                                <Avatar
                                    name={member.username}
                                    size={30}
                                    userID={member.userID}
                                />
                                <span>{member.username}</span>
                            </button>
                        ))}
                    </div>
                </aside>
            ) : null}
        </section>
    );
}

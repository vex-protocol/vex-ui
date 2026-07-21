import type { User } from "@vex-chat/libvex";

import {
    ArrowLeft,
    FileText,
    Hash,
    LoaderCircle,
    Search,
    Send,
    Share2,
    X,
} from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import {
    $channels,
    $familiars,
    $messages,
    $servers,
    formatFileAttachmentMarkdown,
    formatFileSize,
    vexService,
} from "@vex-chat/store";

import { Avatar } from "../components/Avatar";
import { ServerIcon } from "../components/ServerIcon";
import { channelPath, dmPath, navigate } from "../lib/router";
import {
    deletePendingShare,
    loadPendingShare,
    pendingShareFile,
    sharedText,
    type PendingShareFile,
} from "../lib/shareTarget";
import { useStoreValue } from "../lib/useStoreValue";

type ShareDestination =
    | {
          key: string;
          kind: "channel";
          channelID: string;
          channelName: string;
          serverID: string;
          serverName: string;
      }
    | { key: string; kind: "dm"; user: User };

export function ShareComposerView() {
    const familiars = useStoreValue($familiars);
    const messages = useStoreValue($messages);
    const servers = useStoreValue($servers);
    const channels = useStoreValue($channels);
    const [pendingID, setPendingID] = useState("");
    const [content, setContent] = useState("");
    const [files, setFiles] = useState<PendingShareFile[]>([]);
    const [query, setQuery] = useState("");
    const [selectedKey, setSelectedKey] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const destinations = useMemo<ShareDestination[]>(() => {
        const direct = Object.values(familiars)
            .sort(
                (a, b) =>
                    lastMessageTime(messages[b.userID]) -
                        lastMessageTime(messages[a.userID]) ||
                    a.username.localeCompare(b.username),
            )
            .map((user) => ({
                key: `dm:${user.userID}`,
                kind: "dm" as const,
                user,
            }));
        const group = Object.values(servers)
            .sort((a, b) => a.name.localeCompare(b.name))
            .flatMap((server) =>
                (channels[server.serverID] ?? [])
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((channel) => ({
                        channelID: channel.channelID,
                        channelName: channel.name,
                        key: `channel:${server.serverID}:${channel.channelID}`,
                        kind: "channel" as const,
                        serverID: server.serverID,
                        serverName: server.name,
                    })),
            );
        return [...direct, ...group];
    }, [channels, familiars, messages, servers]);
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = destinations.filter((destination) =>
        destinationLabel(destination).toLowerCase().includes(normalizedQuery),
    );
    const selected =
        destinations.find(({ key }) => key === selectedKey) ?? null;

    useEffect(() => {
        let active = true;
        const parameters = new URLSearchParams(window.location.search);
        const id = parameters.get("id")?.trim() ?? "";
        setPendingID(id);
        setError("");
        if (!id) {
            setContent(
                sharedText(
                    parameters.get("title") ?? "",
                    parameters.get("text") ?? "",
                    parameters.get("url") ?? "",
                ),
            );
            setLoading(false);
            if (parameters.get("error")) {
                setError("The browser could not import this shared item.");
            }
            return;
        }
        void loadPendingShare(id)
            .then((share) => {
                if (!active) return;
                if (!share) {
                    setError("This shared item is no longer available.");
                    return;
                }
                setContent(sharedText(share.title, share.text, share.url));
                setFiles(share.files);
            })
            .catch(() => {
                if (active) setError("The shared item could not be opened.");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!selectedKey && destinations[0]) {
            setSelectedKey(destinations[0].key);
        }
    }, [destinations, selectedKey]);

    async function sendShare() {
        if (!selected || sending || (!content.trim() && files.length === 0)) {
            return;
        }
        setSending(true);
        setError("");
        try {
            const attachmentMarkdown: string[] = [];
            for (const storedFile of files) {
                const file = pendingShareFile(storedFile);
                const uploaded = await vexService.uploadFileAttachment({
                    contentType: file.type || "application/octet-stream",
                    data: new Uint8Array(await file.arrayBuffer()),
                    fileName: file.name,
                    fileSize: file.size,
                });
                if (!uploaded.ok || !uploaded.attachment) {
                    setError(
                        uploaded.error ?? `Could not upload ${file.name}.`,
                    );
                    return;
                }
                attachmentMarkdown.push(
                    formatFileAttachmentMarkdown(uploaded.attachment),
                );
            }

            const trimmedContent = content.trim();
            const payload = [trimmedContent, ...attachmentMarkdown]
                .filter(Boolean)
                .join("\n\n");
            const result =
                selected.kind === "dm"
                    ? await vexService.sendDM(selected.user.userID, payload)
                    : await vexService.sendGroupMessage(
                          selected.channelID,
                          payload,
                      );
            if (!result.ok) {
                setError(result.error ?? "The shared item could not be sent.");
                return;
            }

            if (pendingID) await deletePendingShare(pendingID).catch(() => {});
            navigate(
                selected.kind === "dm"
                    ? dmPath(selected.user.userID)
                    : channelPath(selected.serverID, selected.channelID),
                true,
            );
        } catch (cause: unknown) {
            setError(
                cause instanceof Error && cause.message
                    ? cause.message
                    : "The shared item could not be sent.",
            );
        } finally {
            setSending(false);
        }
    }

    const directDestinations = filtered.filter(
        (destination) => destination.kind === "dm",
    );
    const channelDestinations = filtered.filter(
        (destination) => destination.kind === "channel",
    );

    return (
        <section className="share-page">
            <header className="standalone-topbar">
                <button
                    aria-label="Back"
                    title="Back"
                    type="button"
                    onClick={() => navigate("/app/home")}
                >
                    <ArrowLeft size={19} />
                </button>
                <span>
                    <strong>Share to Vex</strong>
                    <small>End-to-end encrypted</small>
                </span>
            </header>
            <div className="share-page__body">
                <header className="share-page__intro">
                    <span>
                        <Share2 size={21} />
                    </span>
                    <div>
                        <h1>Choose a conversation</h1>
                        <p>Select where this shared item should be sent.</p>
                    </div>
                </header>

                {loading ? (
                    <div className="share-page__loading">
                        <LoaderCircle className="spin" size={18} />
                        Opening shared item
                    </div>
                ) : (
                    <>
                        <section className="share-compose">
                            <label>
                                <span>Message</span>
                                <textarea
                                    maxLength={20_000}
                                    placeholder="Add a message"
                                    rows={4}
                                    value={content}
                                    onInput={(event) =>
                                        setContent(event.currentTarget.value)
                                    }
                                />
                            </label>
                            {files.length ? (
                                <div className="share-files">
                                    {files.map((file, index) => (
                                        <div
                                            key={`${file.fileName}:${file.lastModified}:${index}`}
                                        >
                                            <span>
                                                <FileText size={17} />
                                            </span>
                                            <span>
                                                <strong>{file.fileName}</strong>
                                                <small>
                                                    {formatFileSize(
                                                        file.data.size,
                                                    )}
                                                </small>
                                            </span>
                                            <button
                                                aria-label={`Remove ${file.fileName}`}
                                                disabled={sending}
                                                title="Remove"
                                                type="button"
                                                onClick={() =>
                                                    setFiles((current) =>
                                                        current.filter(
                                                            (_, itemIndex) =>
                                                                itemIndex !==
                                                                index,
                                                        ),
                                                    )
                                                }
                                            >
                                                <X size={15} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </section>

                        <div className="share-search">
                            <Search size={16} />
                            <input
                                aria-label="Search conversations"
                                placeholder="Search conversations"
                                value={query}
                                onInput={(event) =>
                                    setQuery(event.currentTarget.value)
                                }
                            />
                            {query ? (
                                <button
                                    aria-label="Clear search"
                                    title="Clear search"
                                    type="button"
                                    onClick={() => setQuery("")}
                                >
                                    <X size={14} />
                                </button>
                            ) : null}
                        </div>

                        <div className="share-destinations">
                            {directDestinations.length ? (
                                <ShareDestinationSection
                                    destinations={directDestinations}
                                    label="Direct messages"
                                    selectedKey={selectedKey}
                                    servers={servers}
                                    onSelect={setSelectedKey}
                                />
                            ) : null}
                            {channelDestinations.length ? (
                                <ShareDestinationSection
                                    destinations={channelDestinations}
                                    label="Channels"
                                    selectedKey={selectedKey}
                                    servers={servers}
                                    onSelect={setSelectedKey}
                                />
                            ) : null}
                            {!filtered.length ? (
                                <div className="share-destinations__empty">
                                    No matching conversations
                                </div>
                            ) : null}
                        </div>
                    </>
                )}

                {error ? (
                    <div className="status status--error" role="alert">
                        {error}
                    </div>
                ) : null}
                <footer className="share-page__actions">
                    <button
                        className="button button--primary"
                        disabled={
                            loading ||
                            sending ||
                            !selected ||
                            (!content.trim() && files.length === 0)
                        }
                        type="button"
                        onClick={() => void sendShare()}
                    >
                        {sending ? (
                            <LoaderCircle className="spin" size={16} />
                        ) : (
                            <Send size={16} />
                        )}
                        {sending
                            ? "Sending"
                            : selected
                              ? `Send to ${shortDestinationLabel(selected)}`
                              : "Choose a conversation"}
                    </button>
                </footer>
            </div>
        </section>
    );
}

function ShareDestinationSection({
    destinations,
    label,
    onSelect,
    selectedKey,
    servers,
}: {
    destinations: ShareDestination[];
    label: string;
    onSelect: (key: string) => void;
    selectedKey: string;
    servers: ReturnType<typeof $servers.get>;
}) {
    return (
        <section>
            <h2>{label}</h2>
            {destinations.map((destination) => (
                <button
                    aria-pressed={selectedKey === destination.key}
                    className={
                        selectedKey === destination.key ? "is-selected" : ""
                    }
                    key={destination.key}
                    type="button"
                    onClick={() => onSelect(destination.key)}
                >
                    {destination.kind === "dm" ? (
                        <Avatar
                            name={destination.user.username}
                            size={34}
                            userID={destination.user.userID}
                        />
                    ) : servers[destination.serverID] ? (
                        <ServerIcon
                            server={servers[destination.serverID]}
                            size={34}
                        />
                    ) : (
                        <span className="share-destination__icon">
                            <Hash size={17} />
                        </span>
                    )}
                    <span>
                        <strong>{shortDestinationLabel(destination)}</strong>
                        <small>
                            {destination.kind === "dm"
                                ? "Direct message"
                                : destination.serverName}
                        </small>
                    </span>
                    {destination.kind === "channel" ? <Hash size={15} /> : null}
                </button>
            ))}
        </section>
    );
}

function destinationLabel(destination: ShareDestination): string {
    return destination.kind === "dm"
        ? destination.user.username
        : `${destination.serverName} ${destination.channelName}`;
}

function shortDestinationLabel(destination: ShareDestination): string {
    return destination.kind === "dm"
        ? destination.user.username
        : `#${destination.channelName}`;
}

function lastMessageTime(messages: { timestamp: string }[] | undefined) {
    const value = messages?.at(-1)?.timestamp;
    const timestamp = value ? new Date(value).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
}

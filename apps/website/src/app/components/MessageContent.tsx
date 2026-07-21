import type {
    EncryptedFileAttachment,
    MessageEmbed,
    MessageEmbedBlock,
    MessageEmbedMediaItem,
    MessageMarkdownNode,
} from "@vex-chat/store";

import { AlertCircle, Download, FileText, LoaderCircle } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import {
    applyEmoji,
    formatFileSize,
    messageEmbed,
    parseMessageMarkdown,
    vexService,
} from "@vex-chat/store";

import { LinkPreviewCard } from "./LinkPreviewCard";

interface MessageContentProps {
    content: string;
    extra?: null | string;
}

export function MessageContent({ content, extra }: MessageContentProps) {
    const embed = messageEmbed({ extra } as never);
    const nodes = parseMessageMarkdown(content);
    const embedConsumesMessage = Boolean(
        embed?.blocks?.some(
            (block) => block.type === "markdown" && block.source === "message",
        ),
    );
    const showMessage =
        !embed || (embed.display !== "replace" && !embedConsumesMessage);

    return (
        <div className="message-rich-content">
            {embed ? <MessageEmbedView embed={embed} source={content} /> : null}
            {showMessage
                ? nodes.map((node, index) => (
                      <MessageMarkdownView
                          key={messageNodeKey(node, index)}
                          node={node}
                      />
                  ))
                : null}
            {!embed?.suppressLinkPreview ? (
                <LinkPreviewCard content={content} />
            ) : null}
        </div>
    );
}

function MessageMarkdownView({ node }: { node: MessageMarkdownNode }) {
    if (node.type === "attachment") {
        return <AttachmentView attachment={node.attachment} />;
    }
    if (node.type === "codeBlock") {
        return (
            <pre className="message-code-block">
                <code>{node.code}</code>
            </pre>
        );
    }
    return (
        <p className="message-text">
            {node.segments.map((segment, index) => {
                const text = applyEmoji(segment.text);
                if (segment.type === "strong") {
                    return <strong key={index}>{text}</strong>;
                }
                if (segment.type === "emphasis") {
                    return <em key={index}>{text}</em>;
                }
                if (segment.type === "code") {
                    return <code key={index}>{text}</code>;
                }
                if (segment.type === "link") {
                    const url = safeExternalURL(segment.url);
                    return url ? (
                        <a
                            href={url}
                            key={index}
                            rel="noreferrer noopener"
                            target="_blank"
                        >
                            {text}
                        </a>
                    ) : (
                        <span key={index}>{text}</span>
                    );
                }
                return <span key={index}>{text}</span>;
            })}
        </p>
    );
}

function MessageEmbedView({
    embed,
    source,
}: {
    embed: MessageEmbed;
    source: string;
}) {
    return (
        <section
            className={`message-embed message-embed--${embed.tone ?? "default"}`}
        >
            <header className="message-embed__header">
                <strong>{embed.title}</strong>
                {embed.subtitle ? <span>{embed.subtitle}</span> : null}
            </header>
            {embed.fields?.length ? (
                <dl className="message-embed__fields">
                    {embed.fields.map((field, index) => (
                        <div key={`${field.label}:${index}`}>
                            <dt>{field.label}</dt>
                            <dd className={field.mono ? "is-mono" : undefined}>
                                {field.value}
                            </dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            {embed.blocks?.map((block, index) => (
                <MessageEmbedBlockView
                    block={block}
                    key={`${block.type}:${index}`}
                    source={source}
                />
            ))}
            {embed.actions?.length ? (
                <footer className="message-embed__actions">
                    {embed.actions.map((action, index) => {
                        const url = safeExternalURL(action.url);
                        return url ? (
                            <a
                                href={url}
                                key={`${action.label}:${index}`}
                                rel="noreferrer noopener"
                                target="_blank"
                            >
                                {action.label}
                            </a>
                        ) : null;
                    })}
                </footer>
            ) : null}
        </section>
    );
}

function MessageEmbedBlockView({
    block,
    source,
}: {
    block: MessageEmbedBlock;
    source: string;
}) {
    if (block.type === "divider") {
        return <hr className="message-embed__divider" />;
    }
    if (block.type === "code") {
        return (
            <pre className="message-code-block">
                <code>{block.code}</code>
            </pre>
        );
    }
    if (block.type === "file") {
        return <AttachmentView attachment={block.attachment} />;
    }
    if (block.type === "media") {
        return <EmbedMedia item={block} />;
    }
    if (block.type === "gallery") {
        return (
            <div className="message-embed__gallery">
                {block.items.map((item, index) => (
                    <EmbedMedia
                        item={item}
                        key={`${item.attachment.fileID}:${index}`}
                    />
                ))}
            </div>
        );
    }
    const markdown = block.source === "message" ? source : (block.text ?? "");
    return (
        <div className="message-embed__markdown">
            {parseMessageMarkdown(markdown).map((node, index) => (
                <MessageMarkdownView
                    key={messageNodeKey(node, index)}
                    node={node}
                />
            ))}
        </div>
    );
}

function EmbedMedia({ item }: { item: MessageEmbedMediaItem }) {
    return (
        <figure className="message-embed__media">
            <AttachmentView attachment={item.attachment} />
            {item.caption ? <figcaption>{item.caption}</figcaption> : null}
        </figure>
    );
}

function AttachmentView({
    attachment,
}: {
    attachment: EncryptedFileAttachment;
}) {
    const [url, setURL] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const urlRef = useRef("");
    const inFlight = useRef<Promise<string> | null>(null);
    const mounted = useRef(true);
    const previewKind = attachmentPreviewKind(attachment.contentType);

    async function retrieve(): Promise<string> {
        if (urlRef.current) return urlRef.current;
        if (inFlight.current) return inFlight.current;
        setLoading(true);
        setError("");
        const pending = vexService
            .downloadFileAttachment(attachment)
            .then((result) => {
                if (!result.ok || !result.data) {
                    throw new Error(result.error ?? "Could not download file.");
                }
                const bytes = new Uint8Array(result.data.byteLength);
                bytes.set(result.data);
                const nextURL = URL.createObjectURL(
                    new Blob([bytes.buffer], {
                        type:
                            attachment.contentType ||
                            "application/octet-stream",
                    }),
                );
                if (!mounted.current) {
                    URL.revokeObjectURL(nextURL);
                    return "";
                }
                urlRef.current = nextURL;
                setURL(nextURL);
                return nextURL;
            })
            .catch((cause: unknown) => {
                const message =
                    cause instanceof Error
                        ? cause.message
                        : "Could not download file.";
                if (mounted.current) setError(message);
                throw cause;
            })
            .finally(() => {
                if (mounted.current) {
                    inFlight.current = null;
                    setLoading(false);
                }
            });
        inFlight.current = pending;
        return pending;
    }

    useEffect(() => {
        mounted.current = true;
        if (previewKind) void retrieve().catch(() => undefined);
        return () => {
            mounted.current = false;
            if (urlRef.current) URL.revokeObjectURL(urlRef.current);
            urlRef.current = "";
        };
    }, [attachment.fileID, attachment.key, previewKind]);

    async function download() {
        try {
            const href = await retrieve();
            const anchor = document.createElement("a");
            anchor.href = href;
            anchor.download = attachment.fileName;
            anchor.click();
        } catch {
            // Inline status already explains the failure.
        }
    }

    if (url && previewKind === "image") {
        return (
            <figure className="message-attachment message-attachment--image">
                <img alt={attachment.fileName} loading="lazy" src={url} />
                <figcaption>
                    <span>{attachment.fileName}</span>
                    <button
                        aria-label={`Download ${attachment.fileName}`}
                        title="Download"
                        type="button"
                        onClick={() => void download()}
                    >
                        <Download size={15} />
                    </button>
                </figcaption>
            </figure>
        );
    }
    if (url && previewKind === "audio") {
        return (
            <div className="message-attachment message-attachment--media">
                <span>{attachment.fileName}</span>
                <audio controls preload="metadata" src={url} />
            </div>
        );
    }
    if (url && previewKind === "video") {
        return (
            <figure className="message-attachment message-attachment--video">
                <video controls preload="metadata" src={url} />
                <figcaption>{attachment.fileName}</figcaption>
            </figure>
        );
    }
    return (
        <button
            className="message-attachment message-attachment--file"
            disabled={loading}
            type="button"
            onClick={() => void download()}
        >
            <span className="message-attachment__icon">
                {loading ? (
                    <LoaderCircle className="spin" size={19} />
                ) : error ? (
                    <AlertCircle size={19} />
                ) : (
                    <FileText size={19} />
                )}
            </span>
            <span className="message-attachment__copy">
                <strong>{attachment.fileName}</strong>
                <small>
                    {error ||
                        `${formatFileSize(attachment.fileSize)} - Download`}
                </small>
            </span>
            <Download size={17} />
        </button>
    );
}

function messageNodeKey(node: MessageMarkdownNode, index: number): string {
    return node.type === "attachment"
        ? `${node.type}:${node.attachment.fileID}:${node.attachment.key}`
        : `${node.type}:${index}`;
}

function attachmentPreviewKind(
    contentType: string,
): "audio" | "image" | "video" | null {
    const normalized = contentType.toLowerCase();
    if (normalized.startsWith("image/") && normalized !== "image/svg+xml") {
        return "image";
    }
    if (normalized.startsWith("audio/")) return "audio";
    if (normalized.startsWith("video/")) return "video";
    return null;
}

function safeExternalURL(value: string): string | null {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

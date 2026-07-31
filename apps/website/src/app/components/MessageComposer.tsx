import type {
    ComposerRecoveryDraft,
    MessageReplyReference,
} from "@vex-chat/store";

import {
    CircleAlert,
    CornerUpLeft,
    FileText,
    Mic,
    Paperclip,
    Pencil,
    RotateCcw,
    Send,
    X,
} from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ComposerRecoveryQueue, formatFileSize } from "@vex-chat/store";

import { VoiceMemoRecorder } from "./VoiceMemoRecorder";

export interface MessageComposerSendContext {
    preserveComposerContext: boolean;
    replyingTo: MessageReplyReference | null;
}

interface MessageComposerProps {
    contextKey: string;
    disabled?: boolean;
    editing?: boolean;
    onCancelEdit: () => void;
    onCancelReply: () => void;
    onChange: (value: string) => void;
    onSend: (
        content: string,
        attachment: File | undefined,
        context: MessageComposerSendContext,
    ) => Promise<boolean>;
    placeholder: string;
    replyingTo?: MessageReplyReference | null;
    sending?: boolean;
    value: string;
}

const failedSends = new ComposerRecoveryQueue<
    File,
    MessageReplyReference | null
>();

export function MessageComposer({
    contextKey,
    disabled = false,
    editing = false,
    onCancelEdit,
    onCancelReply,
    onChange,
    onSend,
    placeholder,
    replyingTo = null,
    sending = false,
    value,
}: MessageComposerProps) {
    const [attachment, setAttachmentState] = useState<File | null>(null);
    const [previewURL, setPreviewURL] = useState("");
    const [dragActive, setDragActive] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [voiceMemoOpen, setVoiceMemoOpen] = useState(false);
    const [recordingError, setRecordingError] = useState("");
    const [failedSendVersion, setFailedSendVersion] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const previousContext = useRef(contextKey);
    const mountedRef = useRef(true);
    const busy = sending || submitting;
    const recoverableSends = useMemo(
        () => failedSends.get(contextKey),
        [contextKey, failedSendVersion],
    );
    const voiceMemoSupported =
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof globalThis.MediaRecorder === "function";
    const canSend =
        Boolean(value.trim() || attachment) &&
        !disabled &&
        !busy &&
        !voiceMemoOpen;

    useEffect(() => {
        resizeTextarea();
    }, [value]);

    useEffect(() => {
        if (previousContext.current !== contextKey) {
            previousContext.current = contextKey;
            setVoiceMemoOpen(false);
            setRecordingError("");
            clearAttachment();
        }
    }, [contextKey]);

    useEffect(() => {
        if (!editing) return;
        setVoiceMemoOpen(false);
        if (attachment) clearAttachment();
    }, [attachment, editing]);

    useEffect(
        () => () => {
            if (previewURL) URL.revokeObjectURL(previewURL);
        },
        [previewURL],
    );

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    function resizeTextarea() {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
    }

    function setAttachment(file: File) {
        clearAttachment();
        const normalized = normalizeFile(file);
        setAttachmentState(normalized);
        if (
            (normalized.type.startsWith("image/") &&
                normalized.type !== "image/svg+xml") ||
            normalized.type.startsWith("audio/")
        ) {
            setPreviewURL(URL.createObjectURL(normalized));
        }
    }

    function clearAttachment() {
        if (previewURL) URL.revokeObjectURL(previewURL);
        setPreviewURL("");
        setAttachmentState(null);
    }

    function refreshRecoverableSends() {
        if (mountedRef.current) {
            setFailedSendVersion((version) => version + 1);
        }
    }

    function dismissRecoverableSend(id: number) {
        if (failedSends.remove(contextKey, id)) refreshRecoverableSends();
    }

    async function retryRecoverableSend(
        draft: ComposerRecoveryDraft<File, MessageReplyReference | null>,
    ) {
        if (busy || editing) return;
        setSubmitting(true);
        try {
            const sent = await onSend(draft.value.trim(), draft.attachment, {
                preserveComposerContext: true,
                replyingTo: draft.metadata,
            });
            if (sent && failedSends.remove(contextKey, draft.id)) {
                refreshRecoverableSends();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function submit() {
        const pendingValue = value;
        const content = value.trim();
        const pendingAttachment = attachment ?? undefined;
        const pendingContext = contextKey;
        const pendingReply = replyingTo;
        const wasEditing = editing;
        if (
            (!content && !pendingAttachment) ||
            disabled ||
            busy ||
            voiceMemoOpen
        ) {
            return;
        }
        setSubmitting(true);
        if (!wasEditing) {
            onChange("");
            clearAttachment();
            window.requestAnimationFrame(() => {
                resizeTextarea();
                textareaRef.current?.focus();
            });
        }
        try {
            const sent = await onSend(content, pendingAttachment, {
                preserveComposerContext: false,
                replyingTo: pendingReply,
            });
            if (!sent) {
                if (!wasEditing) {
                    failedSends.add(pendingContext, {
                        attachment: pendingAttachment,
                        metadata: pendingReply,
                        value: pendingValue,
                    });
                    refreshRecoverableSends();
                }
                window.requestAnimationFrame(() => {
                    resizeTextarea();
                    textareaRef.current?.focus();
                });
                return;
            }
        } finally {
            setSubmitting(false);
        }
    }

    function handlePaste(event: ClipboardEvent) {
        const file = firstFile(event.clipboardData);
        if (!file || editing || voiceMemoOpen) return;
        event.preventDefault();
        setAttachment(file);
    }

    return (
        <section className="message-composer">
            {recoverableSends.map((draft) => (
                <div className="composer-recovery" key={draft.id} role="status">
                    <CircleAlert size={17} />
                    <span>
                        <strong>Message not sent</strong>
                        <small>
                            {composerRecoveryPreview(
                                draft.value,
                                draft.attachment,
                            )}
                        </small>
                    </span>
                    <button
                        aria-label="Retry unsent message"
                        disabled={busy || editing}
                        title="Retry"
                        type="button"
                        onClick={() => void retryRecoverableSend(draft)}
                    >
                        <RotateCcw size={15} />
                    </button>
                    <button
                        aria-label="Dismiss unsent message"
                        disabled={busy}
                        title="Dismiss"
                        type="button"
                        onClick={() => dismissRecoverableSend(draft.id)}
                    >
                        <X size={15} />
                    </button>
                </div>
            ))}
            {replyingTo && !editing ? (
                <div className="composer-context">
                    <CornerUpLeft size={15} />
                    <span>
                        <strong>
                            {replyingTo.targetAuthorName ??
                                replyingTo.targetAuthorID?.slice(0, 8) ??
                                "Message"}
                        </strong>
                        <small>
                            {replyingTo.targetPreview ??
                                replyingTo.targetAttachment?.fileName ??
                                "Original message"}
                        </small>
                    </span>
                    <button
                        aria-label="Cancel reply"
                        disabled={busy}
                        title="Cancel reply"
                        type="button"
                        onClick={onCancelReply}
                    >
                        <X size={15} />
                    </button>
                </div>
            ) : null}
            {editing ? (
                <div className="composer-context">
                    <Pencil size={15} />
                    <span>
                        <strong>Editing message</strong>
                        <small>Enter to save, Escape to cancel</small>
                    </span>
                    <button
                        aria-label="Cancel edit"
                        disabled={busy}
                        title="Cancel edit"
                        type="button"
                        onClick={onCancelEdit}
                    >
                        <X size={15} />
                    </button>
                </div>
            ) : null}
            {attachment ? (
                <div
                    className={
                        attachment.type.startsWith("audio/")
                            ? "composer-attachment composer-attachment--audio"
                            : "composer-attachment"
                    }
                >
                    {previewURL && attachment.type.startsWith("image/") ? (
                        <img alt="" src={previewURL} />
                    ) : previewURL && attachment.type.startsWith("audio/") ? (
                        <audio controls preload="metadata" src={previewURL} />
                    ) : (
                        <span className="composer-attachment__icon">
                            <FileText size={20} />
                        </span>
                    )}
                    <span>
                        <strong>{attachment.name}</strong>
                        <small>{formatFileSize(attachment.size)}</small>
                    </span>
                    <button
                        aria-label="Remove attachment"
                        disabled={busy}
                        title="Remove attachment"
                        type="button"
                        onClick={clearAttachment}
                    >
                        <X size={15} />
                    </button>
                </div>
            ) : null}
            {voiceMemoOpen ? (
                <VoiceMemoRecorder
                    onCancel={() => setVoiceMemoOpen(false)}
                    onError={setRecordingError}
                    onRecorded={(file) => {
                        setRecordingError("");
                        setVoiceMemoOpen(false);
                        setAttachment(file);
                    }}
                />
            ) : null}
            {recordingError ? (
                <div className="composer-recording-error" role="alert">
                    <span>{recordingError}</span>
                    <button
                        aria-label="Dismiss recording error"
                        title="Dismiss"
                        type="button"
                        onClick={() => setRecordingError("")}
                    >
                        <X size={14} />
                    </button>
                </div>
            ) : null}
            <div
                aria-label="Message composer"
                className={
                    dragActive ? "composer-input is-dragging" : "composer-input"
                }
                role="group"
                onDragLeave={() => setDragActive(false)}
                onDragOver={(event) => {
                    if (
                        !hasFile(event.dataTransfer) ||
                        editing ||
                        voiceMemoOpen
                    ) {
                        return;
                    }
                    event.preventDefault();
                    setDragActive(true);
                }}
                onDrop={(event) => {
                    const file = firstFile(event.dataTransfer);
                    setDragActive(false);
                    if (!file || editing || voiceMemoOpen) return;
                    event.preventDefault();
                    setAttachment(file);
                }}
            >
                <input
                    aria-hidden="true"
                    className="composer-file-input"
                    ref={fileInputRef}
                    tabIndex={-1}
                    type="file"
                    onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) setAttachment(file);
                        event.currentTarget.value = "";
                    }}
                />
                <button
                    aria-label="Attach file"
                    disabled={disabled || busy || editing || voiceMemoOpen}
                    title="Attach file"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Paperclip size={18} />
                </button>
                <textarea
                    aria-label="Message input"
                    disabled={disabled || (editing && busy)}
                    placeholder={placeholder}
                    ref={textareaRef}
                    rows={1}
                    value={value}
                    onInput={(event) => {
                        onChange(event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            if (editing) onCancelEdit();
                            else if (replyingTo) onCancelReply();
                            return;
                        }
                        if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !event.isComposing
                        ) {
                            event.preventDefault();
                            void submit();
                        }
                    }}
                    onPaste={handlePaste}
                />
                {voiceMemoSupported ? (
                    <button
                        aria-label="Record voice message"
                        disabled={
                            disabled ||
                            busy ||
                            editing ||
                            Boolean(attachment) ||
                            voiceMemoOpen
                        }
                        title="Record voice message"
                        type="button"
                        onClick={() => {
                            setRecordingError("");
                            setVoiceMemoOpen(true);
                        }}
                    >
                        <Mic size={18} />
                    </button>
                ) : null}
                <button
                    aria-label={editing ? "Save message" : "Send message"}
                    className="composer-send"
                    disabled={!canSend}
                    title={editing ? "Save message" : "Send message"}
                    type="button"
                    onClick={() => void submit()}
                >
                    {editing ? <Pencil size={17} /> : <Send size={17} />}
                </button>
            </div>
        </section>
    );
}

function firstFile(data: DataTransfer | null): File | null {
    if (!data) return null;
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) return file;
    }
    return data.files?.[0] ?? null;
}

function hasFile(data: DataTransfer | null): boolean {
    if (!data) return false;
    return (
        Array.from(data.items ?? []).some((item) => item.kind === "file") ||
        Array.from(data.types ?? []).includes("Files")
    );
}

function normalizeFile(file: File): File {
    if (file.name) return file;
    return new File([file], `attachment-${Date.now()}`, {
        lastModified: file.lastModified,
        type: file.type,
    });
}

function composerRecoveryPreview(
    value: string,
    attachment: File | undefined,
): string {
    const text = value.trim().replace(/\s+/g, " ");
    if (text && attachment) return `${text} - ${attachment.name}`;
    return text || attachment?.name || "Attachment";
}

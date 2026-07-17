<script lang="ts">
    import { tick } from "svelte";

    import { FileText, Paperclip, Pencil, Send, X } from "@lucide/svelte";

    let {
        contextKey,
        disabled,
        editing,
        onCancelEdit,
        onChange,
        onSend,
        placeholder,
        sending,
        value: controlledValue,
    }: {
        contextKey?: string;
        disabled?: boolean;
        editing?: boolean;
        onCancelEdit?: () => void;
        onChange?: (value: string) => void;
        onSend: (content: string, attachment?: File) => unknown;
        placeholder?: string;
        sending?: boolean;
        value?: string;
    } = $props();

    let draftValue = $state("");
    let textareaEl: HTMLTextAreaElement | null = $state(null);
    let fileInputEl: HTMLInputElement | null = $state(null);
    let attachment: File | null = $state(null);
    let previewUrl: null | string = $state(null);
    let dragActive = $state(false);
    let submitting = $state(false);
    let attachmentContext: string | undefined = $state(undefined);
    const value = $derived(controlledValue ?? draftValue);
    const busy = $derived(sending === true || submitting);

    function setValue(next: string): void {
        if (controlledValue !== undefined) {
            onChange?.(next);
            return;
        }
        draftValue = next;
    }

    function autoResize(): void {
        if (!textareaEl) return;
        textareaEl.style.height = "auto";
        // 6 rows x 24px line-height = 144px max
        textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 144)}px`;
    }

    function handleKeyDown(e: KeyboardEvent): void {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void send();
        }
    }

    async function send(): Promise<void> {
        const trimmed = value.trim();
        const pendingAttachment = attachment ?? undefined;
        if ((!trimmed && !pendingAttachment) || disabled || busy) return;
        submitting = true;
        try {
            const sent = await onSend(trimmed, pendingAttachment);
            if (sent === false) return;
            setValue("");
            clearAttachment();
            if (textareaEl) textareaEl.style.height = "auto";
            await tick();
            textareaEl?.focus();
        } finally {
            submitting = false;
        }
    }

    function openFilePicker(): void {
        fileInputEl?.click();
    }

    function handleFileSelect(e: Event): void {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        setAttachment(file);
        // Reset input so the same file can be re-selected
        input.value = "";
    }

    function handlePaste(e: ClipboardEvent): void {
        const file = firstFileFromTransfer(e.clipboardData);
        if (!file) return;
        e.preventDefault();
        setAttachment(file);
    }

    function handleDragOver(e: DragEvent): void {
        if (!hasFileTransfer(e.dataTransfer)) return;
        e.preventDefault();
        dragActive = true;
    }

    function handleDrop(e: DragEvent): void {
        const file = firstFileFromTransfer(e.dataTransfer);
        dragActive = false;
        if (!file) return;
        e.preventDefault();
        setAttachment(file);
    }

    function setAttachment(file: File): void {
        clearAttachment();
        attachment = normalizeFile(file);
        if (attachment.type.startsWith("image/")) {
            previewUrl = URL.createObjectURL(attachment);
        }
    }

    function clearAttachment(): void {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        attachment = null;
        previewUrl = null;
    }

    $effect(() => {
        if (editing && attachment) {
            clearAttachment();
        }
    });

    $effect(() => {
        if (contextKey === attachmentContext) return;
        attachmentContext = contextKey;
        clearAttachment();
    });

    function formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function firstFileFromTransfer(data: DataTransfer | null): File | null {
        if (!data) return null;
        for (const item of Array.from(data.items ?? [])) {
            if (item.kind !== "file") continue;
            const file = item.getAsFile();
            if (file) return file;
        }
        return data.files?.[0] ?? null;
    }

    function hasFileTransfer(data: DataTransfer | null): boolean {
        if (!data) return false;
        if (Array.from(data.items ?? []).some((item) => item.kind === "file")) {
            return true;
        }
        return Array.from(data.types ?? []).includes("Files");
    }

    function normalizeFile(file: File): File {
        if (file.name) return file;
        const extension = fileExtensionForType(file.type);
        return new File([file], `pasted-file-${Date.now()}.${extension}`, {
            lastModified: file.lastModified,
            type: file.type,
        });
    }

    function fileExtensionForType(contentType: string): string {
        if (contentType === "image/jpeg") return "jpg";
        if (contentType === "image/png") return "png";
        if (contentType === "image/gif") return "gif";
        if (contentType === "image/webp") return "webp";
        return "bin";
    }
</script>

<div class="chat-input">
    {#if editing}
        <div class="chat-input__editing">
            <span class="chat-input__editing-icon"><Pencil size={15} /></span>
            <span class="chat-input__editing-label">Editing message</span>
            <button
                class="chat-input__preview-remove"
                onclick={onCancelEdit}
                disabled={disabled || busy}
                title="Cancel edit"
                aria-label="Cancel edit"><X size={15} /></button
            >
        </div>
    {/if}

    {#if attachment}
        <div class="chat-input__preview">
            {#if previewUrl}
                <img
                    src={previewUrl}
                    alt={attachment.name}
                    class="chat-input__preview-img"
                />
            {:else}
                <span class="chat-input__preview-icon"
                    ><FileText size={22} /></span
                >
            {/if}
            <div class="chat-input__preview-info">
                <span class="chat-input__preview-name">{attachment.name}</span>
                <span class="chat-input__preview-size"
                    >{formatSize(attachment.size)}</span
                >
            </div>
            <button
                class="chat-input__preview-remove"
                onclick={clearAttachment}
                disabled={disabled || busy}
                title="Remove attachment"
                aria-label="Remove attachment"><X size={15} /></button
            >
        </div>
    {/if}

    <div
        class="chat-input__wrap"
        class:chat-input__wrap--drag={dragActive}
        ondragover={handleDragOver}
        ondragleave={() => {
            dragActive = false;
        }}
        ondrop={handleDrop}
        role="group"
        aria-label="Message composer"
    >
        <textarea
            bind:this={textareaEl}
            {value}
            rows={1}
            {placeholder}
            disabled={disabled || busy}
            onkeydown={handleKeyDown}
            onpaste={handlePaste}
            oninput={(event) => {
                setValue((event.currentTarget as HTMLTextAreaElement).value);
                autoResize();
            }}
            class="chat-input__textarea"
            aria-label="Message input"
        ></textarea>
        <div class="chat-input__icons">
            <input
                bind:this={fileInputEl}
                type="file"
                class="chat-input__file-input"
                onchange={handleFileSelect}
                tabindex={-1}
                aria-hidden="true"
            />
            <button
                class="chat-input__icon"
                title="Attach file"
                aria-label="Attach file"
                onclick={openFilePicker}
                disabled={disabled || busy || editing}
            >
                <Paperclip size={18} />
            </button>
            {#if value.trim() || attachment}
                <button
                    class="chat-input__send"
                    onclick={() => {
                        void send();
                    }}
                    disabled={(!value.trim() && !attachment) ||
                        disabled ||
                        busy}
                    aria-label="Send message"
                    title="Send"><Send size={17} /></button
                >
            {/if}
        </div>
    </div>
</div>

<style>
    .chat-input {
        padding: 8px 18px 14px;
        background: var(--bg-primary);
        flex-shrink: 0;
    }

    .chat-input__preview {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        margin-bottom: 6px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 6px;
    }

    .chat-input__editing {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        margin-bottom: 6px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 6px;
    }

    .chat-input__editing-icon {
        display: grid;
        place-items: center;
        color: var(--accent-text);
    }

    .chat-input__editing-label {
        flex: 1;
        min-width: 0;
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
    }

    .chat-input__preview-img {
        width: 48px;
        height: 48px;
        object-fit: cover;
        border-radius: 4px;
        flex-shrink: 0;
    }

    .chat-input__preview-icon {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--text-faint);
    }

    .chat-input__preview-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .chat-input__preview-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .chat-input__preview-size {
        font-size: 11px;
        color: var(--text-muted);
    }

    .chat-input__preview-remove {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: var(--text-muted);
        flex-shrink: 0;
    }

    .chat-input__preview-remove:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .chat-input__file-input {
        display: none;
    }

    .chat-input__wrap {
        min-height: 48px;
        display: flex;
        align-items: flex-end;
        background: var(--bg-surface);
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        transition:
            border-color 0.15s,
            box-shadow 0.15s;
    }

    .chat-input__wrap:focus-within {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-soft);
    }

    .chat-input__wrap--drag {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent);
    }

    .chat-input__textarea {
        flex: 1;
        resize: none;
        line-height: 21px;
        min-height: 46px;
        padding: 12px 12px 10px;
        background: transparent;
        border: none;
        color: var(--text-primary);
        font-size: 13px;
        font-family: inherit;
        max-height: 144px;
        overflow-y: auto;
        width: auto;
    }

    .chat-input__textarea:focus {
        outline: none;
    }

    .chat-input__textarea:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .chat-input__icons {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 7px 6px 2px;
        flex-shrink: 0;
    }

    .chat-input__icon {
        width: 34px;
        height: 34px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
    }

    .chat-input__icon:not(:disabled):hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .chat-input__icon:disabled {
        cursor: default;
    }

    .chat-input__send {
        width: 34px;
        height: 34px;
        border-radius: 7px;
        background: var(--accent);
        color: var(--on-accent);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition:
            background 0.15s,
            transform 0.15s;
    }

    .chat-input__send:not(:disabled):hover {
        background: var(--accent-hover);
        transform: translateY(-1px);
    }

    .chat-input__send:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }
</style>

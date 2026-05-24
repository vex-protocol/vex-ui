<script lang="ts">
    import type { Message } from "@vex-chat/libvex";

    import { buildMessageBodyWithAttachment } from "../lib/attachments.js";
    import ChatInput from "../lib/ChatInput.svelte";
    // Route: /messaging/:userID
    import MessageBox from "../lib/MessageBox.svelte";
    import { familiars, messages, vexService } from "../lib/store/index.js";

    let { params }: { params: Record<string, string> } = $props();

    const targetUserID = $derived(params.userID ?? "");

    // Clear unread count when viewing this conversation
    $effect(() => {
        if (targetUserID) vexService.markRead(targetUserID);
    });
    const threadMessages = $derived($messages[targetUserID] ?? []);
    const targetUsername = $derived(
        $familiars[targetUserID]?.username ?? targetUserID.slice(0, 8),
    );
    const usernameMap = $derived({ [targetUserID]: targetUsername });

    let sending = $state(false);
    let sendError = $state("");
    let composerValue = $state("");
    let editingMessage: Message | null = $state(null);
    let showFingerprint = $state(false);
    let fingerprint = $state("");
    let _theirSignKey = $state("");

    // Fetch the recipient's signKey and compute the fingerprint
    $effect(() => {
        if (!targetUserID) return;
        // TODO: fetchKeyBundle and getFingerprint not yet exposed in public API
        void targetUserID;
    });

    // TODO: verified key UI removed — needs secure storage re-implementation

    async function handleSend(content: string, attachment?: File) {
        if (sending) return;
        sending = true;
        sendError = "";
        try {
            if (editingMessage) {
                const pendingEdit = editingMessage;
                const result = await vexService.editMessage(
                    targetUserID,
                    pendingEdit.mailID,
                    false,
                    content,
                );
                if (!result.ok) {
                    sendError = result.error ?? "Failed to edit message";
                    composerValue = content;
                    editingMessage = pendingEdit;
                    return;
                }
                editingMessage = null;
                composerValue = "";
                return;
            }

            const body = await buildMessageBodyWithAttachment(
                vexService,
                content,
                attachment,
            );
            if (!body.ok) {
                sendError = body.error;
                return;
            }

            const result = await vexService.sendDM(targetUserID, body.body);
            if (!result.ok) {
                sendError = result.error ?? "Failed to send";
            }
        } catch (err: unknown) {
            sendError = err instanceof Error ? err.message : "Failed to send";
        } finally {
            sending = false;
        }
    }

    function handleDeleteMessageForEveryone(message: Message): void {
        void vexService
            .deleteMessageForEveryone(targetUserID, message.mailID, false)
            .then((result) => {
                if (!result.ok) {
                    sendError =
                        result.error ?? "Failed to delete message for everyone";
                }
            });
    }

    function handleDeleteMessageForMe(message: Message): void {
        void vexService
            .deleteLocalMessage(targetUserID, message.mailID, false)
            .then((deleted) => {
                if (!deleted) {
                    sendError = "Failed to delete local message";
                }
            });
    }

    function handleDeleteThreadForEveryone(): void {
        if (
            !window.confirm(
                `Delete your messages with ${targetUsername} for everyone and remove local history?`,
            )
        ) {
            return;
        }
        void vexService
            .deleteThreadForEveryone(targetUserID, false)
            .then((result) => {
                if (!result.ok) {
                    sendError = result.error ?? "Failed to delete conversation";
                    return;
                }
                if (!result.localDeleted) {
                    sendError =
                        "Remote delete sent, but local history was not removed";
                }
            });
    }

    function handleDeleteThreadForMe(): void {
        if (
            !window.confirm(
                `Delete local messages with ${targetUsername} on this device?`,
            )
        ) {
            return;
        }
        void vexService
            .deleteLocalThread(targetUserID, false)
            .then((deleted) => {
                if (!deleted) {
                    sendError = "Failed to delete local conversation";
                }
            });
    }

    function handleEditMessage(message: Message): void {
        sendError = "";
        editingMessage = message;
        composerValue = message.message;
    }
</script>

<div class="dm-pane">
    <header class="dm-pane__header">
        <span class="dm-pane__title">@{targetUsername}</span>
        <div class="dm-pane__actions">
            {#if fingerprint}
                <button
                    class="dm-pane__action dm-pane__shield"
                    title="Session fingerprint"
                    aria-label="Session fingerprint"
                    onclick={() => {
                        showFingerprint = !showFingerprint;
                    }}
                >
                    🟡
                </button>
            {/if}
            <button class="dm-pane__action" title="Search" aria-label="Search"
                >🔍</button
            >
            <button
                class="dm-pane__action dm-pane__action--danger dm-pane__action--text"
                title="Delete local conversation"
                aria-label="Delete local conversation"
                onclick={handleDeleteThreadForMe}>Delete for me</button
            >
            <button
                class="dm-pane__action dm-pane__action--danger dm-pane__action--text"
                title="Delete your messages for everyone"
                aria-label="Delete your messages for everyone"
                onclick={handleDeleteThreadForEveryone}
                >Delete for everyone</button
            >
        </div>
    </header>

    <!-- TODO: fingerprint verification panel — needs secure storage for verified keys -->

    <MessageBox
        messages={threadMessages}
        onDeleteMessageForEveryone={handleDeleteMessageForEveryone}
        onDeleteMessageForMe={handleDeleteMessageForMe}
        onEditMessage={handleEditMessage}
        usernames={usernameMap}
    />

    {#if sendError}
        <div class="dm-pane__error">{sendError}</div>
    {/if}

    <ChatInput
        onSend={handleSend}
        onChange={(value: string) => {
            composerValue = value;
        }}
        onCancelEdit={() => {
            editingMessage = null;
            composerValue = "";
        }}
        editing={editingMessage !== null}
        {sending}
        value={composerValue}
        placeholder="Send a direct message…"
    />
</div>

<style>
    .dm-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-primary);
    }

    .dm-pane__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
        background: var(--bg-secondary);
        flex-shrink: 0;
    }

    .dm-pane__title {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .dm-pane__actions {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .dm-pane__action {
        width: 32px;
        height: 32px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: var(--text-secondary);
        transition:
            background 0.1s,
            color 0.1s;
        filter: grayscale(1);
        opacity: 0.6;
    }

    .dm-pane__action:hover {
        background: var(--bg-hover);
        opacity: 1;
    }

    .dm-pane__action--danger:hover {
        color: #ff7a7a;
    }

    .dm-pane__action--text {
        width: auto;
        padding: 0 8px;
        font-size: 12px;
        filter: none;
        white-space: nowrap;
    }

    .dm-pane__shield {
        filter: none;
        opacity: 1;
    }

    .dm-pane__shield--verified {
        filter: none;
        opacity: 1;
    }

    .fingerprint-panel {
        padding: 12px 16px;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
    }

    .fingerprint-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
    }

    .fingerprint-panel__title {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
    }

    .fingerprint-panel__close {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: var(--text-muted);
    }

    .fingerprint-panel__close:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .dm-pane__error {
        padding: 6px 16px;
        background: color-mix(in srgb, var(--danger) 15%, transparent);
        color: var(--danger);
        font-size: 12px;
        flex-shrink: 0;
    }
</style>

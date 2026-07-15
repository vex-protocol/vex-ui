<script lang="ts">
    import type { Message } from "@vex-chat/libvex";

    import { Ellipsis, Phone, Trash2 } from "@lucide/svelte";

    import { buildMessageBodyWithAttachment } from "../lib/attachments.js";
    import Avatar from "../lib/Avatar.svelte";
    import ChatInput from "../lib/ChatInput.svelte";
    import {
        clearComposerDraft,
        readComposerDraft,
        writeComposerDraft,
    } from "../lib/composerDrafts.js";
    import { getServerUrl } from "../lib/config.js";
    import { productFeatures } from "../lib/features.js";
    // Route: /messaging/:userID
    import MessageBox from "../lib/MessageBox.svelte";
    import { familiars, messages, vexService } from "../lib/store/index.js";
    import {
        voiceCallEngine,
        $voiceCallState as voiceCallState,
    } from "../lib/voiceCallEngine.js";

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
    let activeDraftKey = $state("");
    let editingMessage: Message | null = $state(null);
    let calling = $state(false);
    let menuOpen = $state(false);

    $effect(() => {
        const nextKey = `dm:${targetUserID}`;
        if (nextKey === activeDraftKey) return;
        activeDraftKey = nextKey;
        composerValue = readComposerDraft(nextKey);
        editingMessage = null;
    });

    async function handleSend(
        content: string,
        attachment?: File,
    ): Promise<boolean> {
        if (sending) return false;
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
                    return false;
                }
                editingMessage = null;
                composerValue = "";
                return true;
            }

            const body = await buildMessageBodyWithAttachment(
                vexService,
                content,
                attachment,
            );
            if (!body.ok) {
                sendError = body.error;
                return false;
            }

            const result = await vexService.sendDM(targetUserID, body.body);
            if (!result.ok) {
                sendError = result.error ?? "Failed to send";
                return false;
            }
            return true;
        } catch (err: unknown) {
            sendError = err instanceof Error ? err.message : "Failed to send";
            return false;
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

    function updateComposer(value: string): void {
        composerValue = value;
        writeComposerDraft(activeDraftKey, value);
    }

    function handleStartVoiceCall(): void {
        if (
            !productFeatures.voiceCalling ||
            calling ||
            !targetUserID ||
            $voiceCallState.phase !== "idle"
        ) {
            return;
        }
        calling = true;
        sendError = "";
        void voiceCallEngine
            .startDmCall(targetUserID, targetUsername)
            .catch((err: unknown) => {
                sendError =
                    err instanceof Error
                        ? err.message
                        : "Failed to start voice call";
            })
            .finally(() => {
                calling = false;
            });
    }
</script>

<div class="dm-pane">
    <header class="dm-pane__header">
        <div class="dm-pane__identity">
            <Avatar
                userID={targetUserID}
                name={targetUsername}
                serverUrl={getServerUrl()}
                size={34}
            />
            <span>
                <strong>{targetUsername}</strong>
                <small>Direct message</small>
            </span>
        </div>
        <div class="dm-pane__actions">
            {#if productFeatures.voiceCalling}
                <button
                    class="dm-pane__action"
                    title="Start voice call"
                    aria-label="Start voice call"
                    disabled={calling || $voiceCallState.phase !== "idle"}
                    onclick={handleStartVoiceCall}
                >
                    <Phone size={18} />
                </button>
            {/if}
            <button
                class="dm-pane__action"
                title="Conversation options"
                aria-label="Conversation options"
                aria-expanded={menuOpen}
                onclick={() => (menuOpen = !menuOpen)}
            >
                <Ellipsis size={20} />
            </button>
            {#if menuOpen}
                <div class="dm-pane__menu" role="menu">
                    <button
                        role="menuitem"
                        onclick={() => {
                            menuOpen = false;
                            handleDeleteThreadForMe();
                        }}
                    >
                        <Trash2 size={15} />
                        Delete from this device
                    </button>
                    <button
                        class="dm-pane__menu-danger"
                        role="menuitem"
                        onclick={() => {
                            menuOpen = false;
                            handleDeleteThreadForEveryone();
                        }}
                    >
                        <Trash2 size={15} />
                        Delete my messages for everyone
                    </button>
                </div>
            {/if}
        </div>
    </header>

    {#if menuOpen}
        <button
            class="dm-pane__backdrop"
            type="button"
            aria-label="Close conversation options"
            onclick={() => (menuOpen = false)}
        ></button>
    {/if}

    <MessageBox
        contextKey={activeDraftKey}
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
        contextKey={activeDraftKey}
        onSend={handleSend}
        onChange={updateComposer}
        onCancelEdit={() => {
            editingMessage = null;
            composerValue = "";
            clearComposerDraft(activeDraftKey);
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
        position: relative;
        z-index: 2;
        height: var(--topbar-height);
        flex: 0 0 var(--topbar-height);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px 0 16px;
        border-bottom: 1px solid var(--border);
        background: color-mix(
            in srgb,
            var(--bg-primary) 92%,
            var(--bg-secondary)
        );
    }

    .dm-pane__identity {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 9px;
    }

    .dm-pane__identity > span {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .dm-pane__identity strong,
    .dm-pane__identity small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dm-pane__identity strong {
        font-family: var(--font-heading);
        font-size: 14px;
    }

    .dm-pane__identity small {
        color: var(--text-faint);
        font-size: 10px;
    }

    .dm-pane__actions {
        display: flex;
        align-items: center;
        gap: 3px;
    }

    .dm-pane__action {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
    }

    .dm-pane__action:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .dm-pane__action:disabled {
        cursor: not-allowed;
        opacity: 0.35;
    }

    .dm-pane__menu {
        position: absolute;
        z-index: 102;
        top: calc(100% + 6px);
        right: 12px;
        width: 250px;
        padding: 5px;
        border: 1px solid var(--border-strong);
        border-radius: 7px;
        background: var(--bg-elevated);
        box-shadow: var(--shadow-menu);
    }

    .dm-pane__menu button {
        width: 100%;
        min-height: 36px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 9px;
        border-radius: 5px;
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
        text-align: left;
    }

    .dm-pane__menu button:hover {
        background: var(--bg-hover);
    }

    .dm-pane__menu .dm-pane__menu-danger {
        color: var(--danger);
    }

    .dm-pane__backdrop {
        position: fixed;
        z-index: 1;
        inset: 0;
        width: 100%;
        height: 100%;
        cursor: default;
    }

    .dm-pane__error {
        flex-shrink: 0;
        padding: 7px 16px;
        border-bottom: 1px solid
            color-mix(in srgb, var(--danger) 30%, transparent);
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: #ffb4b2;
        font-size: 11px;
    }
</style>

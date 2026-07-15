<script lang="ts">
    import type { Message } from "@vex-chat/libvex";

    import { buildMessageBodyWithAttachment } from "../lib/attachments.js";
    import ChatInput from "../lib/ChatInput.svelte";
    import {
        clearComposerDraft,
        readComposerDraft,
        writeComposerDraft,
    } from "../lib/composerDrafts.js";
    // Route: /server/:serverID/:channelID
    import MessageBox from "../lib/MessageBox.svelte";
    import {
        channels,
        groupMessages,
        user,
        vexService,
    } from "../lib/store/index.js";

    let { params }: { params: Record<string, string> } = $props();

    const serverID = $derived(params.serverID ?? "");
    const channelID = $derived(params.channelID ?? "");
    const channelMessages = $derived($groupMessages[channelID] ?? []);
    const channelName = $derived(
        $channels[serverID]?.find((c) => c.channelID === channelID)?.name ??
            channelID.slice(0, 8),
    );

    let sending = $state(false);
    let sendError = $state("");
    let composerValue = $state("");
    let activeDraftKey = $state("");
    let editingMessage: Message | null = $state(null);
    let usernames: Record<string, string> = $state({});

    $effect(() => {
        const nextKey = `channel:${channelID}`;
        if (nextKey === activeDraftKey) return;
        activeDraftKey = nextKey;
        composerValue = readComposerDraft(nextKey);
        editingMessage = null;
    });

    // Load channel members to resolve userIDs → usernames.
    // Re-runs when channelID or channels change (serverChange notify triggers $channels update).
    $effect(() => {
        if (!channelID) return;
        void $channels[serverID]; // reactive dep — re-fetch members when server membership changes
        vexService
            .getChannelMembers(channelID)
            .then((members) => {
                const map: Record<string, string> = {};
                for (const m of members) map[m.userID] = m.username;
                usernames = map;
            })
            .catch(() => {});
    });

    async function handleSend(
        content: string,
        attachment?: File,
    ): Promise<boolean> {
        if (!$user || sending) return false;
        sending = true;
        sendError = "";
        try {
            if (editingMessage) {
                const pendingEdit = editingMessage;
                const result = await vexService.editMessage(
                    channelID,
                    pendingEdit.mailID,
                    true,
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

            const result = await vexService.sendGroupMessage(
                channelID,
                body.body,
            );
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
            .deleteMessageForEveryone(channelID, message.mailID, true)
            .then((result) => {
                if (!result.ok) {
                    sendError =
                        result.error ?? "Failed to delete message for everyone";
                }
            });
    }

    function handleDeleteMessageForMe(message: Message): void {
        void vexService
            .deleteLocalMessage(channelID, message.mailID, true)
            .then((deleted) => {
                if (!deleted) {
                    sendError = "Failed to delete local message";
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
</script>

<div class="channel-pane">
    <header class="channel-pane__header">
        <div class="channel-pane__title-group">
            <span class="channel-pane__hash">#</span>
            <span class="channel-pane__name">{channelName}</span>
        </div>
    </header>

    <MessageBox
        contextKey={activeDraftKey}
        messages={channelMessages}
        onDeleteMessageForEveryone={handleDeleteMessageForEveryone}
        onDeleteMessageForMe={handleDeleteMessageForMe}
        onEditMessage={handleEditMessage}
        {usernames}
    />

    {#if sendError}
        <div class="channel-pane__error">{sendError}</div>
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
        disabled={!$user}
        editing={editingMessage !== null}
        {sending}
        value={composerValue}
        placeholder="Message #{channelName}"
    />
</div>

<style>
    .channel-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-primary);
    }

    .channel-pane__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
        background: var(--bg-secondary);
        flex-shrink: 0;
    }

    .channel-pane__title-group {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .channel-pane__hash {
        color: var(--text-muted);
        font-size: 18px;
        font-weight: 400;
        line-height: 1;
    }

    .channel-pane__name {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .channel-pane__error {
        padding: 6px 16px;
        background: color-mix(in srgb, var(--warning) 15%, transparent);
        color: var(--warning);
        font-size: 12px;
        flex-shrink: 0;
    }
</style>

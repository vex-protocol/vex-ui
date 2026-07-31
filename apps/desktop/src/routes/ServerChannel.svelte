<script lang="ts">
    import type { Message } from "@vex-chat/libvex";

    import { Hash, Settings2, Users } from "@lucide/svelte";

    import { buildMessageBodyWithAttachment } from "../lib/attachments.js";
    import ChatInput from "../lib/ChatInput.svelte";
    import {
        clearComposerDraft,
        readComposerDraft,
        writeComposerDraft,
    } from "../lib/composerDrafts.js";
    // Route: /server/:serverID/:channelID
    import MessageBox from "../lib/MessageBox.svelte";
    import ServerSettingsModal from "../lib/ServerSettingsModal.svelte";
    import {
        channels,
        groupMessages,
        servers,
        user,
        vexService,
    } from "../lib/store/index.js";
    import { memberPanelOpen } from "../lib/stores/layout.js";

    let { params }: { params: Record<string, string> } = $props();

    const serverID = $derived(params.serverID ?? "");
    const channelID = $derived(params.channelID ?? "");
    const channelMessages = $derived($groupMessages[channelID] ?? []);
    const channelName = $derived(
        $channels[serverID]?.find((c) => c.channelID === channelID)?.name ??
            channelID.slice(0, 8),
    );
    const serverName = $derived($servers[serverID]?.name ?? "Group");

    let sending = $state(false);
    let sendError = $state("");
    let composerValue = $state("");
    let activeDraftKey = $state("");
    let editingMessage: Message | null = $state(null);
    let usernames: Record<string, string> = $state({});
    let showSettings = $state(false);

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
        attachment: File | undefined,
    ): Promise<boolean> {
        if (!$user || sending) return false;
        const pendingEdit = editingMessage;
        const pendingChannelID = channelID;
        sending = true;
        sendError = "";
        try {
            if (pendingEdit) {
                const result = await vexService.editMessage(
                    pendingChannelID,
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
                pendingChannelID,
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
            <span class="channel-pane__hash"><Hash size={20} /></span>
            <span class="channel-pane__title-copy">
                <strong>{channelName}</strong>
                <small>{serverName}</small>
            </span>
        </div>
        <div class="channel-pane__actions">
            <button
                class:channel-pane__action--active={$memberPanelOpen}
                type="button"
                title={$memberPanelOpen ? "Hide members" : "Show members"}
                aria-label={$memberPanelOpen ? "Hide members" : "Show members"}
                aria-pressed={$memberPanelOpen}
                onclick={() => memberPanelOpen.set(!$memberPanelOpen)}
            >
                <Users size={19} />
                {#if Object.keys(usernames).length > 0}
                    <span>{Object.keys(usernames).length}</span>
                {/if}
            </button>
            <button
                type="button"
                title="Group settings"
                aria-label="Group settings"
                onclick={() => (showSettings = true)}
            >
                <Settings2 size={19} />
            </button>
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

{#if showSettings}
    <ServerSettingsModal {serverID} onclose={() => (showSettings = false)} />
{/if}

<style>
    .channel-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-primary);
    }

    .channel-pane__header {
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

    .channel-pane__title-group {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 9px;
    }

    .channel-pane__hash {
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
        display: grid;
        place-items: center;
        border-radius: 6px;
        background: var(--bg-surface);
        color: var(--text-faint);
    }

    .channel-pane__title-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .channel-pane__title-copy strong,
    .channel-pane__title-copy small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .channel-pane__title-copy strong {
        color: var(--text-primary);
        font-family: var(--font-heading);
        font-size: 14px;
    }

    .channel-pane__title-copy small {
        color: var(--text-faint);
        font-size: 10px;
    }

    .channel-pane__actions {
        display: flex;
        align-items: center;
        gap: 3px;
    }

    .channel-pane__actions button {
        min-width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 0 8px;
        border-radius: 6px;
        color: var(--text-muted);
    }

    .channel-pane__actions button:hover,
    .channel-pane__actions .channel-pane__action--active {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .channel-pane__actions button span {
        font-size: 10px;
        font-weight: 700;
    }

    .channel-pane__error {
        flex-shrink: 0;
        padding: 7px 16px;
        border-bottom: 1px solid
            color-mix(in srgb, var(--danger) 30%, transparent);
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: #ffb4b2;
        font-size: 11px;
    }
</style>

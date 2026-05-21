<script lang="ts">
    import { push } from "svelte-spa-router";

    import { buildMessageBodyWithAttachment } from "../lib/attachments.js";
    import {
        channels,
        familiars,
        servers,
        vexService,
    } from "../lib/store/index.js";

    let target = $state("");
    let message = $state("");
    let file: File | undefined = $state();
    let sending = $state(false);
    let error = $state("");
    let sent = $state(false);

    const dmTargets = $derived(Object.values($familiars));
    const channelTargets = $derived(
        Object.values($servers).flatMap((server) =>
            ($channels[server.serverID] ?? []).map((channel) => ({
                channel,
                server,
            })),
        ),
    );

    function handleFile(e: Event): void {
        file = (e.target as HTMLInputElement).files?.[0];
    }

    async function send(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        if (sending || !target) return;
        sending = true;
        error = "";
        sent = false;
        try {
            const body = await buildMessageBodyWithAttachment(
                vexService,
                message,
                file,
            );
            if (!body.ok) {
                error = body.error;
                return;
            }
            const [kind, id] = target.split(":");
            const result =
                kind === "dm"
                    ? await vexService.sendDM(id, body.body)
                    : await vexService.sendGroupMessage(id, body.body);
            if (!result.ok) {
                error = result.error ?? "Failed to send.";
                return;
            }
            sent = true;
            message = "";
            file = undefined;
        } catch (err: unknown) {
            error = err instanceof Error ? err.message : "Failed to send.";
        } finally {
            sending = false;
        }
    }

    function formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
</script>

<div class="desktop-page">
    <header class="desktop-page__header">
        <div class="desktop-page__heading">
            <button
                class="desktop-page__back"
                onclick={() => void push("/home")}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">Share Composer</h1>
                <p class="desktop-page__subtitle">
                    Send text or a file to a DM or channel.
                </p>
            </div>
        </div>
    </header>

    <main class="desktop-page__body">
        {#if error}
            <div class="desktop-status desktop-status--error">{error}</div>
        {/if}
        {#if sent}
            <div class="desktop-status desktop-status--success">Sent.</div>
        {/if}

        <section class="desktop-section">
            <h2 class="desktop-section__title">Compose</h2>
            <form
                class="desktop-row desktop-row--column share-form"
                onsubmit={send}
            >
                <label class="desktop-row__label" for="share-target"
                    >Target</label
                >
                <select
                    id="share-target"
                    bind:value={target}
                    disabled={sending}
                >
                    <option value="">Choose a destination</option>
                    {#if dmTargets.length > 0}
                        <optgroup label="Direct messages">
                            {#each dmTargets as familiar (familiar.userID)}
                                <option value={`dm:${familiar.userID}`}>
                                    @{familiar.username}
                                </option>
                            {/each}
                        </optgroup>
                    {/if}
                    {#if channelTargets.length > 0}
                        <optgroup label="Channels">
                            {#each channelTargets as item (item.channel.channelID)}
                                <option
                                    value={`channel:${item.channel.channelID}`}
                                >
                                    {item.server.name} / #{item.channel.name}
                                </option>
                            {/each}
                        </optgroup>
                    {/if}
                </select>

                <label class="desktop-row__label" for="share-message">
                    Message
                </label>
                <textarea
                    id="share-message"
                    bind:value={message}
                    rows="6"
                    placeholder="Write a message..."
                    disabled={sending}
                ></textarea>

                <label class="desktop-row__label" for="share-file">
                    Attachment
                </label>
                <input id="share-file" type="file" onchange={handleFile} />
                {#if file}
                    <span class="desktop-muted">
                        Attached {file.name} ({formatSize(file.size)})
                    </span>
                {/if}

                <button
                    class="desktop-button desktop-button--primary share-form__send"
                    type="submit"
                    disabled={sending || !target || (!message.trim() && !file)}
                >
                    {sending ? "Sending..." : "Send"}
                </button>
            </form>
        </section>
    </main>
</div>

<style>
    .share-form {
        align-items: stretch;
        gap: 10px;
    }

    select {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-surface);
        color: var(--text-primary);
        padding: 8px 10px;
        font: inherit;
    }

    .share-form__send {
        align-self: flex-start;
    }
</style>

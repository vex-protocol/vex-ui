<script lang="ts">
    import { push } from "svelte-spa-router";

    import { parseInviteID } from "@vex-chat/store";

    import { ImagePlus, Link, Plus, X } from "@lucide/svelte";

    import { vexService } from "./store/index.js";

    let {
        initialMode = "create",
        onclose,
    }: {
        initialMode?: "create" | "join";
        onclose: () => void;
    } = $props();

    let mode: "create" | "join" = $derived(initialMode);
    let name = $state("");
    let invite = $state("");
    let iconFile: File | null = $state(null);
    let iconPreview = $state("");
    let fileInput: HTMLInputElement | null = $state(null);
    let error = $state("");
    let submitting = $state(false);

    function focusOnMount(node: HTMLElement): void {
        node.focus();
    }

    function chooseIcon(event: Event): void {
        const file = (event.currentTarget as HTMLInputElement).files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            error = "Choose an image file.";
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            error = "Group icons must be 5 MB or smaller.";
            return;
        }
        if (iconPreview) URL.revokeObjectURL(iconPreview);
        iconFile = file;
        iconPreview = URL.createObjectURL(file);
        error = "";
    }

    function clearIcon(): void {
        if (iconPreview) URL.revokeObjectURL(iconPreview);
        iconFile = null;
        iconPreview = "";
        if (fileInput) fileInput.value = "";
    }

    async function submitCreate(event: Event): Promise<void> {
        event.preventDefault();
        const serverName = name.trim();
        if (!serverName || submitting) return;
        submitting = true;
        error = "";
        try {
            const result = await vexService.createServer(serverName);
            if (!result.ok || !result.serverID) {
                error = result.error ?? "Could not create this group.";
                return;
            }
            if (iconFile) {
                const iconResult = await vexService.setServerIcon(
                    result.serverID,
                    new Uint8Array(await iconFile.arrayBuffer()),
                );
                if (!iconResult.ok) {
                    error =
                        iconResult.error ??
                        "The group icon could not be uploaded.";
                    await vexService.deleteServer(result.serverID);
                    return;
                }
            }
            const destination = result.channelID
                ? `/server/${result.serverID}/${result.channelID}`
                : `/server/${result.serverID}/`;
            clearIcon();
            onclose();
            void push(destination);
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Could not create this group.";
        } finally {
            submitting = false;
        }
    }

    async function submitJoin(event: Event): Promise<void> {
        event.preventDefault();
        const inviteID = parseInviteID(invite);
        if (!inviteID || submitting) {
            error = "Enter a valid invite link or code.";
            return;
        }
        submitting = true;
        error = "";
        try {
            const result = await vexService.joinInvite(inviteID);
            if (!result.ok || !result.serverID) {
                error = result.error ?? "Could not join this group.";
                return;
            }
            onclose();
            void push(
                result.channelID
                    ? `/server/${result.serverID}/${result.channelID}`
                    : `/server/${result.serverID}/`,
            );
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Could not join this group.";
        } finally {
            submitting = false;
        }
    }

    function setMode(nextMode: "create" | "join"): void {
        mode = nextMode;
        error = "";
        requestAnimationFrame(() => {
            document
                .querySelector<HTMLInputElement>(
                    nextMode === "create" ? "#group-name" : "#invite-code",
                )
                ?.focus();
        });
    }

    function handleClose(): void {
        clearIcon();
        onclose();
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") handleClose();
    }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="group-dialog-layer">
    <button
        class="group-dialog-layer__backdrop"
        type="button"
        aria-label="Close group dialog"
        onclick={handleClose}
    ></button>
    <section class="group-dialog" role="dialog" aria-modal="true">
        <header class="group-dialog__header">
            <div>
                <span>New group</span>
                <h2>{mode === "create" ? "Create a group" : "Join a group"}</h2>
            </div>
            <button
                class="group-dialog__close"
                type="button"
                title="Close"
                aria-label="Close"
                onclick={handleClose}
            >
                <X size={19} />
            </button>
        </header>

        <div class="group-dialog__tabs" role="tablist">
            <button
                class:group-dialog__tab--active={mode === "create"}
                role="tab"
                aria-selected={mode === "create"}
                onclick={() => setMode("create")}
            >
                <Plus size={16} />
                Create
            </button>
            <button
                class:group-dialog__tab--active={mode === "join"}
                role="tab"
                aria-selected={mode === "join"}
                onclick={() => setMode("join")}
            >
                <Link size={16} />
                Join with invite
            </button>
        </div>

        {#if mode === "create"}
            <form class="group-dialog__form" onsubmit={submitCreate}>
                <div class="group-dialog__intro">
                    <strong>Start a private space for your people.</strong>
                    <p>Every new group begins with a #general channel.</p>
                </div>

                <div class="group-dialog__identity">
                    <input
                        bind:this={fileInput}
                        class="visually-hidden"
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/apng,image/avif,image/webp"
                        onchange={chooseIcon}
                    />
                    <button
                        class="group-dialog__icon"
                        class:group-dialog__icon--image={Boolean(iconPreview)}
                        type="button"
                        title="Choose group icon"
                        onclick={() => fileInput?.click()}
                    >
                        {#if iconPreview}
                            <img src={iconPreview} alt="Selected group icon" />
                        {:else}
                            <ImagePlus size={24} />
                            <span>Add icon</span>
                        {/if}
                    </button>
                    <label class="group-dialog__field" for="group-name">
                        <span>Group name</span>
                        <input
                            use:focusOnMount
                            id="group-name"
                            type="text"
                            bind:value={name}
                            placeholder="Field Operations"
                            maxlength={100}
                            disabled={submitting}
                            autocomplete="off"
                        />
                    </label>
                </div>

                <p class="group-dialog__privacy">
                    Groups are invite-only. You can create reusable links after
                    setup.
                </p>

                {#if error}
                    <p class="group-dialog__error" role="alert">{error}</p>
                {/if}

                <div class="group-dialog__actions">
                    <button
                        class="group-dialog__cancel"
                        type="button"
                        disabled={submitting}
                        onclick={handleClose}>Cancel</button
                    >
                    <button
                        class="group-dialog__submit"
                        type="submit"
                        disabled={!name.trim() || submitting}
                    >
                        {submitting ? "Creating..." : "Create group"}
                    </button>
                </div>
            </form>
        {:else}
            <form class="group-dialog__form" onsubmit={submitJoin}>
                <div class="group-dialog__intro">
                    <strong>Use an invite from someone you trust.</strong>
                    <p>Paste the full Vex invite link or its invite code.</p>
                </div>
                <label class="group-dialog__field" for="invite-code">
                    <span>Invite link or code</span>
                    <input
                        use:focusOnMount
                        id="invite-code"
                        type="text"
                        bind:value={invite}
                        placeholder="https://vex.wtf/invite/..."
                        disabled={submitting}
                        autocomplete="off"
                    />
                </label>

                {#if error}
                    <p class="group-dialog__error" role="alert">{error}</p>
                {/if}

                <div class="group-dialog__actions">
                    <button
                        class="group-dialog__cancel"
                        type="button"
                        disabled={submitting}
                        onclick={handleClose}>Cancel</button
                    >
                    <button
                        class="group-dialog__submit"
                        type="submit"
                        disabled={!invite.trim() || submitting}
                    >
                        {submitting ? "Joining..." : "Join group"}
                    </button>
                </div>
            </form>
        {/if}
    </section>
</div>

<style>
    .group-dialog-layer {
        position: fixed;
        z-index: 180;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
    }

    .group-dialog-layer__backdrop {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(3px);
    }

    .group-dialog {
        position: relative;
        z-index: 1;
        width: min(480px, 100%);
        overflow: hidden;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        background: var(--bg-primary);
        box-shadow: var(--shadow-menu);
    }

    .group-dialog__header {
        height: 70px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px;
        border-bottom: 1px solid var(--border);
        background: var(--bg-secondary);
    }

    .group-dialog__header span {
        display: block;
        margin-bottom: 3px;
        color: var(--text-faint);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .group-dialog__header h2 {
        font-family: var(--font-heading);
        font-size: 19px;
    }

    .group-dialog__close {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 6px;
        color: var(--text-muted);
    }

    .group-dialog__close:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .group-dialog__tabs {
        display: flex;
        padding: 10px 16px 0;
        border-bottom: 1px solid var(--border);
    }

    .group-dialog__tabs button {
        min-height: 39px;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 0 13px;
        border-bottom: 2px solid transparent;
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 700;
    }

    .group-dialog__tabs button:hover {
        color: var(--text-primary);
    }

    .group-dialog__tabs .group-dialog__tab--active {
        border-bottom-color: var(--accent);
        color: var(--text-primary);
    }

    .group-dialog__form {
        padding: 24px 24px 20px;
    }

    .group-dialog__intro {
        margin-bottom: 22px;
    }

    .group-dialog__intro strong {
        display: block;
        margin-bottom: 4px;
        font-size: 14px;
    }

    .group-dialog__intro p,
    .group-dialog__privacy {
        color: var(--text-muted);
        font-size: 12px;
        line-height: 1.5;
    }

    .group-dialog__identity {
        display: flex;
        align-items: flex-end;
        gap: 14px;
    }

    .group-dialog__icon {
        width: 80px;
        height: 80px;
        flex: 0 0 80px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 5px;
        overflow: hidden;
        border: 1px dashed var(--border-strong);
        border-radius: 8px;
        background: var(--bg-surface);
        color: var(--text-faint);
    }

    .group-dialog__icon:hover {
        border-color: var(--accent);
        color: var(--text-secondary);
    }

    .group-dialog__icon span {
        font-size: 10px;
        font-weight: 700;
    }

    .group-dialog__icon--image {
        border-style: solid;
    }

    .group-dialog__icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .group-dialog__field {
        display: block;
        flex: 1;
    }

    .group-dialog__field > span {
        display: block;
        margin-bottom: 7px;
        color: var(--text-muted);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .group-dialog__privacy {
        margin: 14px 0 4px;
    }

    .group-dialog__error {
        margin-top: 12px;
        padding: 8px 10px;
        border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: #ffb4b2;
        font-size: 11px;
        line-height: 1.4;
    }

    .group-dialog__actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 24px;
    }

    .group-dialog__actions button {
        min-height: 38px;
        padding: 0 15px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
    }

    .group-dialog__cancel {
        color: var(--text-muted);
    }

    .group-dialog__cancel:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .group-dialog__submit {
        background: var(--accent);
        color: var(--on-accent);
    }

    .group-dialog__submit:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .group-dialog__submit:disabled {
        opacity: 0.45;
    }

    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
    }
</style>

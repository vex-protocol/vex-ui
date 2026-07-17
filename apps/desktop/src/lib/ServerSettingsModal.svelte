<script lang="ts">
    import type { Permission, User } from "@vex-chat/libvex";

    import { push } from "svelte-spa-router";

    import {
        Camera,
        Check,
        Hash,
        Link,
        LogOut,
        Pencil,
        Plus,
        Trash2,
        X,
    } from "@lucide/svelte";

    import Avatar from "./Avatar.svelte";
    import { getServerUrl } from "./config.js";
    import InviteModal from "./InviteModal.svelte";
    import ServerIcon from "./ServerIcon.svelte";
    import {
        channels as channelsStore,
        permissions,
        servers,
        user,
        vexService,
    } from "./store/index.js";

    let {
        onclose,
        serverID,
    }: {
        onclose: () => void;
        serverID: string;
    } = $props();

    type Tab = "channels" | "members" | "overview";

    const server = $derived($servers[serverID]);
    const channels = $derived($channelsStore[serverID] ?? []);
    const myPower = $derived(
        Math.max(
            0,
            ...Object.values($permissions)
                .filter(
                    (permission) =>
                        permission.resourceID === serverID &&
                        permission.userID === $user?.userID,
                )
                .map((permission) => permission.powerLevel),
        ),
    );
    const canManage = $derived(myPower >= 50);
    const isOwner = $derived(myPower >= 100);

    let tab: Tab = $state("overview");
    let name = $state("");
    let busy = $state(false);
    let error = $state("");
    let success = $state("");
    let iconInput: HTMLInputElement | null = $state(null);
    let showInvites = $state(false);

    let newChannelName = $state("");
    let editingChannelID = $state("");
    let editingChannelName = $state("");

    let members: User[] = $state([]);
    let memberPermissions: Permission[] = $state([]);
    let membersLoading = $state(false);
    let permissionsLoading = $state(true);
    const ownerCount = $derived(
        memberPermissions.filter(
            (permission) =>
                permission.resourceID === serverID &&
                permission.powerLevel >= 100,
        ).length,
    );
    const canLeave = $derived(
        !isOwner || (!permissionsLoading && ownerCount > 1),
    );

    $effect(() => {
        if (server && name === "") name = server.name;
    });

    $effect(() => {
        const requestedServerID = serverID;
        let active = true;
        permissionsLoading = true;
        void vexService
            .getServerPermissions(requestedServerID)
            .then((nextPermissions) => {
                if (active) memberPermissions = nextPermissions;
            })
            .catch((err: unknown) => {
                if (active) {
                    error =
                        err instanceof Error
                            ? err.message
                            : "Could not load group roles.";
                }
            })
            .finally(() => {
                if (active) permissionsLoading = false;
            });
        return () => {
            active = false;
        };
    });

    $effect(() => {
        if (tab !== "members" || channels.length === 0) return;
        const channelID = channels[0]?.channelID;
        if (!channelID) return;
        let active = true;
        membersLoading = true;
        void vexService
            .getChannelMembers(channelID)
            .then((nextMembers) => {
                if (!active) return;
                members = nextMembers;
            })
            .catch((err: unknown) => {
                if (active) {
                    error =
                        err instanceof Error
                            ? err.message
                            : "Could not load members.";
                }
            })
            .finally(() => {
                if (active) membersLoading = false;
            });
        return () => {
            active = false;
        };
    });

    function clearStatus(): void {
        error = "";
        success = "";
    }

    async function saveName(): Promise<void> {
        const nextName = name.trim();
        if (!server || !canManage || !nextName || nextName === server.name) {
            return;
        }
        busy = true;
        clearStatus();
        const result = await vexService.updateServer(serverID, nextName);
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not rename this group.";
            return;
        }
        success = "Group name updated.";
    }

    async function uploadIcon(event: Event): Promise<void> {
        const file = (event.currentTarget as HTMLInputElement).files?.[0];
        if (!file || !canManage) return;
        if (!file.type.startsWith("image/")) {
            error = "Choose an image file.";
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            error = "Group icons must be 5 MB or smaller.";
            return;
        }
        busy = true;
        clearStatus();
        const result = await vexService.setServerIcon(
            serverID,
            new Uint8Array(await file.arrayBuffer()),
        );
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not upload this icon.";
            return;
        }
        success = "Group icon updated.";
        if (iconInput) iconInput.value = "";
    }

    async function removeIcon(): Promise<void> {
        if (!server?.icon || !canManage) return;
        busy = true;
        clearStatus();
        const result = await vexService.removeServerIcon(serverID);
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not remove this icon.";
            return;
        }
        success = "Group icon removed.";
    }

    async function createChannel(): Promise<void> {
        const nextName = newChannelName.trim();
        if (!canManage || !nextName || busy) return;
        busy = true;
        clearStatus();
        const result = await vexService.createChannel(nextName, serverID);
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not create this channel.";
            return;
        }
        newChannelName = "";
        success = `#${nextName} created.`;
    }

    function beginRenameChannel(channelID: string, channelName: string): void {
        editingChannelID = channelID;
        editingChannelName = channelName;
        clearStatus();
    }

    async function saveChannelName(): Promise<void> {
        const nextName = editingChannelName.trim();
        if (!editingChannelID || !nextName || busy) return;
        busy = true;
        clearStatus();
        const result = await vexService.updateChannel(
            editingChannelID,
            nextName,
        );
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not rename this channel.";
            return;
        }
        editingChannelID = "";
        editingChannelName = "";
        success = "Channel renamed.";
    }

    async function deleteChannel(
        channelID: string,
        channelName: string,
    ): Promise<void> {
        if (
            !canManage ||
            channels.length <= 1 ||
            busy ||
            !window.confirm(
                `Delete #${channelName}? Message history in it will be removed.`,
            )
        ) {
            return;
        }
        busy = true;
        clearStatus();
        const result = await vexService.deleteChannel(channelID, serverID);
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not delete this channel.";
            return;
        }
        success = `#${channelName} deleted.`;
    }

    function permissionFor(userID: string): Permission | undefined {
        return memberPermissions.find(
            (permission) => permission.userID === userID,
        );
    }

    async function removeMember(member: User): Promise<void> {
        const targetPower = permissionFor(member.userID)?.powerLevel ?? 0;
        if (
            busy ||
            member.userID === $user?.userID ||
            myPower <= targetPower ||
            !window.confirm(
                `Remove ${member.username} from ${server?.name ?? "this group"}?`,
            )
        ) {
            return;
        }
        busy = true;
        clearStatus();
        const result = await vexService.kickServerMember(
            serverID,
            member.userID,
        );
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not remove this member.";
            return;
        }
        members = members.filter(
            (candidate) => candidate.userID !== member.userID,
        );
        success = `${member.username} removed.`;
    }

    async function updateMemberRole(
        member: User,
        permission: Permission,
        powerLevel: 0 | 50 | 100,
    ): Promise<void> {
        if (!isOwner || member.userID === $user?.userID || busy) return;
        if (
            powerLevel === 100 &&
            !window.confirm(
                `Make ${member.username} an owner? Owners can manage roles and permanently delete this group.`,
            )
        ) {
            return;
        }
        busy = true;
        clearStatus();
        const result = await vexService.updateServerMemberRole(
            permission.permissionID,
            powerLevel,
        );
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not update this member's role.";
            return;
        }
        memberPermissions = memberPermissions.map((candidate) =>
            candidate.permissionID === permission.permissionID
                ? { ...candidate, powerLevel }
                : candidate,
        );
        success = `${member.username}'s role updated.`;
    }

    async function leaveServer(): Promise<void> {
        if (
            !canLeave ||
            busy ||
            !window.confirm(
                `Leave ${server?.name ?? "this group"}? You will need another invite to return.`,
            )
        ) {
            return;
        }
        busy = true;
        const result = await vexService.leaveServer(serverID);
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not leave this group.";
            return;
        }
        onclose();
        void push("/home");
    }

    async function deleteServer(): Promise<void> {
        if (
            !isOwner ||
            busy ||
            !window.confirm(
                `Permanently delete ${server?.name ?? "this group"}? This cannot be undone.`,
            )
        ) {
            return;
        }
        busy = true;
        const result = await vexService.deleteServer(serverID);
        busy = false;
        if (!result.ok) {
            error = result.error ?? "Could not delete this group.";
            return;
        }
        onclose();
        void push("/home");
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") onclose();
    }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="settings-layer">
    <button
        class="settings-layer__backdrop"
        type="button"
        aria-label="Close group settings"
        onclick={onclose}
    ></button>
    <section class="settings" role="dialog" aria-modal="true">
        <header class="settings__header">
            {#if server}
                <ServerIcon {server} size={38} />
            {/if}
            <div class="settings__heading">
                <span class="settings__eyebrow">Group settings</span>
                <h2>{server?.name ?? "Group"}</h2>
            </div>
            <button
                class="icon-button"
                type="button"
                title="Close"
                aria-label="Close group settings"
                onclick={onclose}
            >
                <X size={19} />
            </button>
        </header>

        <div class="settings__body">
            <nav class="settings__tabs" aria-label="Group settings sections">
                <button
                    class:settings__tab--active={tab === "overview"}
                    class="settings__tab"
                    onclick={() => (tab = "overview")}>Overview</button
                >
                <button
                    class:settings__tab--active={tab === "channels"}
                    class="settings__tab"
                    onclick={() => (tab = "channels")}>Channels</button
                >
                <button
                    class:settings__tab--active={tab === "members"}
                    class="settings__tab"
                    onclick={() => (tab = "members")}>Members</button
                >
            </nav>

            <main class="settings__content">
                {#if error}
                    <div class="status status--error" role="alert">{error}</div>
                {:else if success}
                    <div class="status status--success">{success}</div>
                {/if}

                {#if tab === "overview"}
                    <div class="section-heading">
                        <h3>Overview</h3>
                        <p>The identity people see throughout Vex.</p>
                    </div>

                    {#if server}
                        <div class="icon-editor">
                            <ServerIcon {server} size={88} />
                            <div class="icon-editor__actions">
                                <input
                                    bind:this={iconInput}
                                    class="visually-hidden"
                                    type="file"
                                    accept="image/jpeg,image/png,image/gif,image/apng,image/avif,image/webp"
                                    onchange={uploadIcon}
                                />
                                <button
                                    class="button button--secondary"
                                    type="button"
                                    disabled={!canManage || busy}
                                    onclick={() => iconInput?.click()}
                                >
                                    <Camera size={16} />
                                    {server.icon ? "Change icon" : "Add icon"}
                                </button>
                                {#if server.icon}
                                    <button
                                        class="button button--quiet"
                                        type="button"
                                        disabled={!canManage || busy}
                                        onclick={() => void removeIcon()}
                                        >Remove</button
                                    >
                                {/if}
                                <p>Square images work best. Maximum 5 MB.</p>
                            </div>
                        </div>
                    {/if}

                    <label class="field">
                        <span>Group name</span>
                        <div class="field__row">
                            <input
                                bind:value={name}
                                disabled={!canManage || busy}
                                maxlength={100}
                                autocomplete="off"
                            />
                            <button
                                class="button button--primary"
                                type="button"
                                disabled={!canManage ||
                                    busy ||
                                    !name.trim() ||
                                    name.trim() === server?.name}
                                onclick={() => void saveName()}>Save</button
                            >
                        </div>
                    </label>

                    <div class="action-row">
                        <div>
                            <strong>Invite people</strong>
                            <span>Create and manage reusable invite links.</span
                            >
                        </div>
                        <button
                            class="button button--secondary"
                            type="button"
                            onclick={() => (showInvites = true)}
                        >
                            <Link size={16} />
                            Manage invites
                        </button>
                    </div>

                    <div class="danger-zone">
                        <div class="action-row">
                            <div>
                                <strong>Leave group</strong>
                                <span
                                    >{isOwner && !canLeave
                                        ? permissionsLoading
                                            ? "Checking group ownership..."
                                            : "Add another owner before leaving."
                                        : "You will need an invite to return."}</span
                                >
                            </div>
                            <button
                                class="button button--danger-quiet"
                                type="button"
                                disabled={!canLeave || busy}
                                onclick={() => void leaveServer()}
                            >
                                <LogOut size={16} />
                                Leave
                            </button>
                        </div>
                        {#if isOwner}
                            <div class="action-row">
                                <div>
                                    <strong>Delete group</strong>
                                    <span
                                        >Permanently removes every channel and
                                        invite.</span
                                    >
                                </div>
                                <button
                                    class="button button--danger"
                                    type="button"
                                    disabled={busy}
                                    onclick={() => void deleteServer()}
                                >
                                    <Trash2 size={16} />
                                    Delete group
                                </button>
                            </div>
                        {/if}
                    </div>
                {:else if tab === "channels"}
                    <div class="section-heading section-heading--row">
                        <div>
                            <h3>Channels</h3>
                            <p>Keep conversations focused and easy to find.</p>
                        </div>
                    </div>

                    {#if canManage}
                        <form
                            class="create-row"
                            onsubmit={(event) => {
                                event.preventDefault();
                                void createChannel();
                            }}
                        >
                            <div class="input-with-icon">
                                <Hash size={16} />
                                <input
                                    bind:value={newChannelName}
                                    placeholder="new-channel"
                                    maxlength={100}
                                    disabled={busy}
                                    autocomplete="off"
                                />
                            </div>
                            <button
                                class="button button--primary"
                                type="submit"
                                disabled={busy || !newChannelName.trim()}
                            >
                                <Plus size={16} />
                                Create
                            </button>
                        </form>
                    {/if}

                    <div class="rows">
                        {#each channels as channel (channel.channelID)}
                            <div class="channel-row">
                                {#if editingChannelID === channel.channelID}
                                    <div
                                        class="input-with-icon channel-row__edit"
                                    >
                                        <Hash size={16} />
                                        <input
                                            bind:value={editingChannelName}
                                            maxlength={100}
                                            disabled={busy}
                                        />
                                    </div>
                                    <button
                                        class="icon-button"
                                        type="button"
                                        title="Save channel name"
                                        aria-label="Save channel name"
                                        disabled={!editingChannelName.trim() ||
                                            busy}
                                        onclick={() => void saveChannelName()}
                                    >
                                        <Check size={17} />
                                    </button>
                                    <button
                                        class="icon-button"
                                        type="button"
                                        title="Cancel"
                                        aria-label="Cancel rename"
                                        onclick={() => (editingChannelID = "")}
                                    >
                                        <X size={17} />
                                    </button>
                                {:else}
                                    <Hash class="channel-row__hash" size={17} />
                                    <span class="channel-row__name"
                                        >{channel.name}</span
                                    >
                                    {#if canManage}
                                        <button
                                            class="icon-button"
                                            type="button"
                                            title="Rename channel"
                                            aria-label={`Rename ${channel.name}`}
                                            onclick={() =>
                                                beginRenameChannel(
                                                    channel.channelID,
                                                    channel.name,
                                                )}
                                        >
                                            <Pencil size={16} />
                                        </button>
                                        <button
                                            class="icon-button icon-button--danger"
                                            type="button"
                                            title={channels.length <= 1
                                                ? "Every group needs one channel"
                                                : "Delete channel"}
                                            aria-label={`Delete ${channel.name}`}
                                            disabled={channels.length <= 1 ||
                                                busy}
                                            onclick={() =>
                                                void deleteChannel(
                                                    channel.channelID,
                                                    channel.name,
                                                )}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    {/if}
                                {/if}
                            </div>
                        {/each}
                    </div>
                {:else}
                    <div class="section-heading">
                        <h3>Members</h3>
                        <p>{members.length} people currently have access.</p>
                    </div>
                    <div class="rows">
                        {#if membersLoading && members.length === 0}
                            <div class="empty-row">Loading members...</div>
                        {:else}
                            {#each members as member (member.userID)}
                                {@const memberPermission = permissionFor(
                                    member.userID,
                                )}
                                {@const memberPower =
                                    memberPermission?.powerLevel ?? 0}
                                <div class="member-row">
                                    <Avatar
                                        userID={member.userID}
                                        name={member.username}
                                        serverUrl={getServerUrl()}
                                        size={34}
                                    />
                                    <div class="member-row__identity">
                                        <strong>{member.username}</strong>
                                        <span
                                            >{memberPower >= 100
                                                ? "Owner"
                                                : memberPower >= 50
                                                  ? "Moderator"
                                                  : "Member"}</span
                                        >
                                    </div>
                                    {#if member.userID === $user?.userID}
                                        <span class="member-row__you">You</span>
                                    {:else if isOwner && memberPermission}
                                        <select
                                            class="member-role"
                                            aria-label={`Role for ${member.username}`}
                                            disabled={busy}
                                            value={memberPower}
                                            onchange={(event) => {
                                                const powerLevel = Number(
                                                    event.currentTarget.value,
                                                ) as 0 | 50 | 100;
                                                if (
                                                    powerLevel !== memberPower
                                                ) {
                                                    void updateMemberRole(
                                                        member,
                                                        memberPermission,
                                                        powerLevel,
                                                    );
                                                }
                                            }}
                                        >
                                            <option value={0}>Member</option>
                                            <option value={50}>Moderator</option
                                            >
                                            <option value={100}>Owner</option>
                                        </select>
                                    {/if}
                                    {#if member.userID !== $user?.userID && myPower > memberPower}
                                        <button
                                            class="button button--danger-quiet"
                                            type="button"
                                            disabled={busy}
                                            onclick={() =>
                                                void removeMember(member)}
                                            >Remove</button
                                        >
                                    {/if}
                                </div>
                            {/each}
                        {/if}
                    </div>
                {/if}
            </main>
        </div>
    </section>
</div>

{#if showInvites}
    <InviteModal
        {serverID}
        serverName={server?.name}
        onclose={() => (showInvites = false)}
    />
{/if}

<style>
    .settings-layer {
        position: fixed;
        inset: 0;
        z-index: 200;
        display: grid;
        place-items: center;
        padding: 24px;
    }

    .settings-layer__backdrop {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(3px);
    }

    .settings {
        position: relative;
        z-index: 1;
        width: min(820px, 100%);
        height: min(650px, 100%);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        background: var(--bg-primary);
        box-shadow: var(--shadow-menu);
    }

    .settings__header {
        height: 68px;
        flex: 0 0 68px;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 18px;
        border-bottom: 1px solid var(--border);
        background: var(--bg-secondary);
    }

    .settings__heading {
        min-width: 0;
        flex: 1;
    }

    .settings__heading h2 {
        overflow: hidden;
        color: var(--text-primary);
        font-family: var(--font-heading);
        font-size: 17px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .settings__eyebrow {
        display: block;
        margin-bottom: 2px;
        color: var(--text-faint);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .settings__body {
        min-height: 0;
        flex: 1;
        display: flex;
    }

    .settings__tabs {
        width: 176px;
        flex: 0 0 176px;
        padding: 14px 10px;
        border-right: 1px solid var(--border);
        background: var(--bg-secondary);
    }

    .settings__tab {
        width: 100%;
        padding: 9px 10px;
        border-radius: 6px;
        color: var(--text-muted);
        font-size: 13px;
        font-weight: 600;
        text-align: left;
    }

    .settings__tab:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .settings__tab--active {
        background: var(--bg-selected);
        color: var(--text-primary);
    }

    .settings__content {
        min-width: 0;
        flex: 1;
        overflow-y: auto;
        padding: 28px 32px 36px;
    }

    .section-heading {
        margin-bottom: 22px;
    }

    .section-heading h3 {
        margin-bottom: 4px;
        font-family: var(--font-heading);
        font-size: 22px;
    }

    .section-heading p,
    .icon-editor__actions p {
        color: var(--text-muted);
        font-size: 12px;
        line-height: 1.5;
    }

    .section-heading--row {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .status {
        margin-bottom: 18px;
        padding: 9px 11px;
        border: 1px solid;
        border-radius: 6px;
        font-size: 12px;
    }

    .status--error {
        border-color: color-mix(in srgb, var(--danger) 45%, transparent);
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: #ffb4b2;
    }

    .status--success {
        border-color: color-mix(in srgb, var(--success) 45%, transparent);
        background: color-mix(in srgb, var(--success) 10%, transparent);
        color: #6ee7c5;
    }

    .icon-editor {
        display: flex;
        align-items: center;
        gap: 18px;
        margin-bottom: 24px;
    }

    .icon-editor__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .icon-editor__actions p {
        width: 100%;
    }

    .field {
        display: block;
        margin-bottom: 28px;
    }

    .field > span {
        display: block;
        margin-bottom: 7px;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .field__row,
    .create-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .button {
        min-height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 0 13px;
        border: 1px solid transparent;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
    }

    .button:disabled,
    .icon-button:disabled {
        opacity: 0.4;
    }

    .button--primary {
        background: var(--accent);
        color: var(--on-accent);
    }

    .button--primary:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .button--secondary {
        border-color: var(--border-strong);
        background: var(--bg-surface);
        color: var(--text-secondary);
    }

    .button--secondary:hover:not(:disabled),
    .button--quiet:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .button--quiet {
        color: var(--text-muted);
    }

    .button--danger {
        background: var(--danger);
        color: #fff;
    }

    .button--danger-quiet {
        border-color: color-mix(in srgb, var(--danger) 40%, transparent);
        color: var(--danger);
    }

    .button--danger-quiet:hover:not(:disabled) {
        background: color-mix(in srgb, var(--danger) 12%, transparent);
    }

    .icon-button {
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
        display: grid;
        place-items: center;
        border-radius: 6px;
        color: var(--text-muted);
    }

    .icon-button:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .icon-button--danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--danger) 12%, transparent);
        color: var(--danger);
    }

    .action-row {
        min-height: 64px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 13px 0;
        border-top: 1px solid var(--border);
    }

    .action-row > div {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .action-row strong {
        font-size: 13px;
    }

    .action-row span {
        color: var(--text-muted);
        font-size: 12px;
        line-height: 1.4;
    }

    .danger-zone {
        margin-top: 20px;
        border-top: 1px solid
            color-mix(in srgb, var(--danger) 38%, var(--border));
    }

    .create-row {
        margin-bottom: 16px;
    }

    .input-with-icon {
        min-width: 0;
        flex: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        padding-left: 10px;
        border: 1px solid var(--border-strong);
        border-radius: 6px;
        background: var(--bg-surface);
        color: var(--text-faint);
    }

    .input-with-icon:focus-within {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-soft);
    }

    .input-with-icon input {
        border: 0;
        background: transparent;
        box-shadow: none;
        padding-left: 0;
    }

    .rows {
        border-top: 1px solid var(--border);
    }

    .channel-row,
    .member-row,
    .empty-row {
        min-height: 54px;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 8px 4px;
        border-bottom: 1px solid var(--border);
    }

    .channel-row :global(.channel-row__hash) {
        color: var(--text-faint);
    }

    .channel-row__name {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        color: var(--text-secondary);
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .channel-row__edit {
        min-width: 120px;
    }

    .member-row__identity {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .member-row__identity strong {
        overflow: hidden;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .member-row__identity span,
    .member-row__you,
    .empty-row {
        color: var(--text-muted);
        font-size: 11px;
    }

    .member-row__you {
        padding: 3px 7px;
        border-radius: 4px;
        background: var(--bg-surface);
    }

    .member-role {
        width: 112px;
        min-height: 32px;
        padding: 0 28px 0 9px;
        border: 1px solid var(--border-strong);
        border-radius: 6px;
        background: var(--bg-surface);
        color: var(--text-secondary);
        font-size: 11px;
    }

    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
    }

    @media (max-width: 720px) {
        .settings-layer {
            padding: 10px;
        }

        .settings__tabs {
            width: 132px;
            flex-basis: 132px;
        }

        .settings__content {
            padding: 22px 20px 30px;
        }

        .action-row {
            align-items: flex-start;
            flex-direction: column;
            gap: 10px;
        }
    }
</style>

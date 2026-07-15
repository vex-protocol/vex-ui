<script lang="ts">
    import type { Permission, User } from "@vex-chat/libvex";

    import { X } from "@lucide/svelte";

    import MemberRow from "./MembersPanelMemberRow.svelte";
    import {
        user as currentUser,
        permissions,
        vexService,
    } from "./store/index.js";
    import { memberPanelOpen } from "./stores/layout.js";

    let { channelID, serverID }: { channelID?: string; serverID?: string } =
        $props();

    const ONLINE_THRESHOLD = 1000 * 60 * 5; // 5 minutes

    let members: User[] = $state([]);
    let serverPermissions: Permission[] = $state([]);
    let kickingUserID: null | string = $state(null);
    let loading = $state(false);
    let error = $state("");

    function isOnline(user: User): boolean {
        if (!user.lastSeen) return false;
        return (
            Date.now() - new Date(user.lastSeen).getTime() < ONLINE_THRESHOLD
        );
    }

    const ownerUserIDs = $derived(
        new Set(
            [...serverPermissions, ...Object.values($permissions)]
                .filter(
                    (permission) =>
                        permission.resourceID === serverID &&
                        permission.resourceType === "server" &&
                        permission.powerLevel >= 100,
                )
                .map((permission) => permission.userID),
        ),
    );
    const myServerPowerLevel = $derived(
        Math.max(
            0,
            ...serverPermissions
                .filter(
                    (permission) =>
                        permission.resourceID === serverID &&
                        permission.resourceType === "server" &&
                        permission.userID === $currentUser?.userID,
                )
                .map((permission) => permission.powerLevel),
            ...Object.values($permissions)
                .filter(
                    (permission) =>
                        permission.resourceID === serverID &&
                        permission.resourceType === "server" &&
                        permission.userID === $currentUser?.userID,
                )
                .map((permission) => permission.powerLevel),
        ),
    );
    const canKickMembers = $derived(myServerPowerLevel >= 100);
    const owners = $derived(
        sortMembers(
            members.filter((member) => ownerUserIDs.has(member.userID)),
            ownerUserIDs,
            isOnline,
        ),
    );
    const online = $derived(
        sortMembers(
            members.filter(
                (member) =>
                    !ownerUserIDs.has(member.userID) && isOnline(member),
            ),
            ownerUserIDs,
            isOnline,
        ),
    );
    const offline = $derived(
        sortMembers(
            members.filter(
                (member) =>
                    !ownerUserIDs.has(member.userID) && !isOnline(member),
            ),
            ownerUserIDs,
            isOnline,
        ),
    );

    async function refreshMembers(
        cid: string,
        sid: string | undefined,
    ): Promise<void> {
        const [nextMembers, nextPermissions] = await Promise.all([
            vexService.getChannelMembers(cid),
            sid
                ? vexService
                      .getServerPermissions(sid)
                      .catch((): Permission[] => [])
                : Promise.resolve([]),
        ]);
        members = nextMembers;
        serverPermissions = nextPermissions;
    }

    async function kickMember(member: User): Promise<void> {
        if (
            !serverID ||
            !canKickMembers ||
            kickingUserID !== null ||
            ownerUserIDs.has(member.userID) ||
            member.userID === $currentUser?.userID
        ) {
            return;
        }
        if (!window.confirm(`Remove ${member.username} from this group?`)) {
            return;
        }

        kickingUserID = member.userID;
        error = "";
        try {
            const result = await vexService.kickServerMember(
                serverID,
                member.userID,
            );
            if (!result.ok) {
                error = result.error ?? "Could not remove this member.";
                return;
            }
            members = members.filter((item) => item.userID !== member.userID);
            if (channelID) {
                await refreshMembers(channelID, serverID);
            }
        } finally {
            kickingUserID = null;
        }
    }

    function sortMembers(
        source: User[],
        owners: Set<string>,
        onlineCheck: (member: User) => boolean,
    ): User[] {
        return [...source].sort((a, b) => {
            const ownerDelta =
                Number(owners.has(b.userID)) - Number(owners.has(a.userID));
            if (ownerDelta !== 0) return ownerDelta;
            const onlineDelta = Number(onlineCheck(b)) - Number(onlineCheck(a));
            if (onlineDelta !== 0) return onlineDelta;
            return a.username.localeCompare(b.username);
        });
    }

    // Fetch on mount and when channelID changes, poll every 30s.
    $effect(() => {
        const cid = channelID;
        const sid = serverID;
        if (!cid) return;

        let active = true;
        loading = true;

        refreshMembers(cid, sid)
            .then(() => {
                if (active) {
                    loading = false;
                    error = "";
                }
            })
            .catch((err: unknown) => {
                if (active) {
                    loading = false;
                    error =
                        err instanceof Error
                            ? err.message
                            : "Could not load members.";
                }
            });

        const interval = setInterval(() => {
            void refreshMembers(cid, sid).catch(() => {});
        }, 30_000);

        return () => {
            active = false;
            clearInterval(interval);
        };
    });
</script>

<aside class="members-panel" aria-label="Members">
    <div class="members-panel__header">
        <div>
            <span class="members-panel__eyebrow">Group</span>
            <span class="members-panel__title">Members · {members.length}</span>
        </div>
        <button
            type="button"
            title="Hide members"
            aria-label="Hide members"
            onclick={() => memberPanelOpen.set(false)}
        >
            <X size={17} />
        </button>
    </div>

    <div class="members-panel__list">
        {#if error}
            <div class="members-panel__error" role="alert">{error}</div>
        {/if}

        {#if owners.length > 0}
            <div class="members-panel__section-label">Owner</div>
            {#each owners as user (user.userID)}
                <MemberRow
                    {user}
                    owner={true}
                    online={isOnline(user)}
                    canKick={false}
                    kicking={false}
                    onKick={kickMember}
                />
            {/each}
        {/if}

        {#if online.length > 0}
            <div class="members-panel__section-label">
                Online — {online.length}
            </div>
            {#each online as user (user.userID)}
                <MemberRow
                    {user}
                    owner={false}
                    online={true}
                    canKick={canKickMembers &&
                        user.userID !== $currentUser?.userID &&
                        kickingUserID === null}
                    kicking={kickingUserID === user.userID}
                    onKick={kickMember}
                />
            {/each}
        {/if}

        {#if offline.length > 0}
            <div class="members-panel__section-label">
                Offline — {offline.length}
            </div>
            {#each offline as user (user.userID)}
                <MemberRow
                    {user}
                    owner={false}
                    online={false}
                    canKick={canKickMembers &&
                        user.userID !== $currentUser?.userID &&
                        kickingUserID === null}
                    kicking={kickingUserID === user.userID}
                    onKick={kickMember}
                />
            {/each}
        {/if}

        {#if loading && members.length === 0}
            <div class="members-panel__empty">
                <p class="members-panel__empty-text">Loading members...</p>
            </div>
        {/if}
    </div>
</aside>

<style>
    .members-panel {
        width: 100%;
        min-width: 0;
        flex: 1;
        background: var(--bg-secondary);
        border-left: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .members-panel__header {
        height: var(--topbar-height);
        flex: 0 0 var(--topbar-height);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px 0 14px;
        border-bottom: 1px solid var(--border);
    }

    .members-panel__header > div {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .members-panel__header button {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 6px;
        color: var(--text-faint);
    }

    .members-panel__header button:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .members-panel__title {
        font-family: var(--font-heading);
        font-size: 13px;
        font-weight: 700;
        color: var(--text-secondary);
    }

    .members-panel__eyebrow {
        color: var(--text-faint);
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .members-panel__list {
        flex: 1;
        overflow-y: auto;
        padding: 4px 8px;
    }

    .members-panel__section-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
        color: var(--text-muted);
        padding: 12px 4px 4px;
    }

    .members-panel__error {
        margin: 7px 4px 2px;
        padding: 7px 8px;
        border: 1px solid color-mix(in srgb, var(--danger) 32%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: var(--danger);
        font-size: 11px;
        line-height: 1.4;
    }

    .members-panel__empty {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
    }

    .members-panel__empty-text {
        font-size: 12px;
        color: var(--text-muted);
        text-align: center;
        font-style: italic;
    }
</style>

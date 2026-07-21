import type { Invite, Permission, User } from "@vex-chat/libvex";

import {
    ArrowLeft,
    Camera,
    Check,
    Clipboard,
    Hash,
    Link,
    LoaderCircle,
    LogOut,
    Pencil,
    Plus,
    Trash2,
    X,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import {
    $channels,
    $servers,
    $user,
    formatInviteLink,
    vexService,
} from "@vex-chat/store";

import { Avatar } from "../components/Avatar";
import { ServerIcon } from "../components/ServerIcon";
import { channelPath, navigate } from "../lib/router";
import { useStoreValue } from "../lib/useStoreValue";

type ServerSettingsTab = "channels" | "invites" | "members" | "overview";

export function ServerManagementView({ serverID }: { serverID: string }) {
    const currentUser = useStoreValue($user);
    const servers = useStoreValue($servers);
    const channelsByServer = useStoreValue($channels);
    const server = servers[serverID];
    const channels = channelsByServer[serverID] ?? [];
    const [tab, setTab] = useState<ServerSettingsTab>("overview");
    const [name, setName] = useState(server?.name ?? "");
    const [newChannelName, setNewChannelName] = useState("");
    const [editingChannelID, setEditingChannelID] = useState("");
    const [editingChannelName, setEditingChannelName] = useState("");
    const [members, setMembers] = useState<User[]>([]);
    const [memberPermissions, setMemberPermissions] = useState<Permission[]>(
        [],
    );
    const [invites, setInvites] = useState<Invite[]>([]);
    const [loadingPermissions, setLoadingPermissions] = useState(true);
    const [loadingSection, setLoadingSection] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [copiedInviteID, setCopiedInviteID] = useState("");
    const iconInput = useRef<HTMLInputElement | null>(null);
    const myPower = Math.max(
        0,
        ...memberPermissions
            .filter(
                (permission) =>
                    permission.resourceID === serverID &&
                    permission.userID === currentUser?.userID,
            )
            .map((permission) => permission.powerLevel),
    );
    const canManage = myPower >= 50;
    const isOwner = myPower >= 100;
    const ownerCount = memberPermissions.filter(
        (permission) =>
            permission.resourceID === serverID && permission.powerLevel >= 100,
    ).length;
    const canLeave = !isOwner || (!loadingPermissions && ownerCount > 1);

    useEffect(() => setName(server?.name ?? ""), [server?.name]);

    useEffect(() => {
        let active = true;
        setLoadingPermissions(true);
        void vexService
            .getServerPermissions(serverID)
            .then((permissions) => {
                if (active) setMemberPermissions(permissions);
            })
            .catch((cause: unknown) => {
                if (active)
                    setError(errorMessage(cause, "Could not load roles."));
            })
            .finally(() => {
                if (active) setLoadingPermissions(false);
            });
        return () => {
            active = false;
        };
    }, [serverID]);

    useEffect(() => {
        if (tab !== "members" || !channels[0]) return;
        let active = true;
        setLoadingSection(true);
        void vexService
            .getChannelMembers(channels[0].channelID)
            .then((next) => {
                if (active) setMembers(next);
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(errorMessage(cause, "Could not load members."));
                }
            })
            .finally(() => {
                if (active) setLoadingSection(false);
            });
        return () => {
            active = false;
        };
    }, [channels, tab]);

    useEffect(() => {
        if (tab !== "invites") return;
        let active = true;
        setLoadingSection(true);
        void vexService
            .getInvites(serverID)
            .then((next) => {
                if (active) setInvites(next);
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(errorMessage(cause, "Could not load invites."));
                }
            })
            .finally(() => {
                if (active) setLoadingSection(false);
            });
        return () => {
            active = false;
        };
    }, [serverID, tab]);

    if (!server) {
        return (
            <section className="settings-page settings-page--missing">
                <h1>Group not found</h1>
                <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => navigate("/app/servers")}
                >
                    <ArrowLeft size={16} /> Back
                </button>
            </section>
        );
    }

    function clearFeedback() {
        setError("");
        setSuccess("");
    }

    async function saveName() {
        const nextName = name.trim();
        if (!nextName || !canManage || nextName === server?.name) return;
        setBusy(true);
        clearFeedback();
        const result = await vexService.updateServer(serverID, nextName);
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not rename this group.");
            return;
        }
        setSuccess("Group name updated.");
    }

    async function uploadIcon(file: File | undefined) {
        if (!file || !canManage) return;
        clearFeedback();
        if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
            setError("Choose a JPEG, PNG, GIF, AVIF, or WebP image.");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setError("Group icons must be 5 MB or smaller.");
            return;
        }
        setBusy(true);
        const result = await vexService.setServerIcon(
            serverID,
            new Uint8Array(await file.arrayBuffer()),
        );
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not update the group icon.");
            return;
        }
        setSuccess("Group icon updated.");
        if (iconInput.current) iconInput.current.value = "";
    }

    async function removeIcon() {
        if (!server.icon || !canManage) return;
        setBusy(true);
        clearFeedback();
        const result = await vexService.removeServerIcon(serverID);
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not remove the group icon.");
            return;
        }
        setSuccess("Group icon removed.");
    }

    async function createChannel(event: SubmitEvent) {
        event.preventDefault();
        const nextName = newChannelName.trim();
        if (!nextName || !canManage) return;
        setBusy(true);
        clearFeedback();
        const result = await vexService.createChannel(nextName, serverID);
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not create the channel.");
            return;
        }
        setNewChannelName("");
        setSuccess(`#${nextName} created.`);
    }

    async function saveChannelName() {
        const nextName = editingChannelName.trim();
        if (!nextName || !editingChannelID) return;
        setBusy(true);
        clearFeedback();
        const result = await vexService.updateChannel(
            editingChannelID,
            nextName,
        );
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not rename the channel.");
            return;
        }
        setEditingChannelID("");
        setEditingChannelName("");
        setSuccess("Channel renamed.");
    }

    async function deleteChannel(channelID: string, channelName: string) {
        if (
            !canManage ||
            channels.length <= 1 ||
            !window.confirm(`Delete #${channelName} and its local history?`)
        ) {
            return;
        }
        setBusy(true);
        clearFeedback();
        const result = await vexService.deleteChannel(channelID, serverID);
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not delete the channel.");
            return;
        }
        setSuccess(`#${channelName} deleted.`);
    }

    function permissionFor(userID: string) {
        return memberPermissions.find(
            (permission) =>
                permission.resourceID === serverID &&
                permission.userID === userID,
        );
    }

    async function updateRole(
        member: User,
        permission: Permission,
        powerLevel: 0 | 50 | 100,
    ) {
        if (!isOwner || member.userID === currentUser?.userID) return;
        if (
            powerLevel === 100 &&
            !window.confirm(
                `Make ${member.username} an owner? Owners can delete this group.`,
            )
        ) {
            return;
        }
        setBusy(true);
        clearFeedback();
        const result = await vexService.updateServerMemberRole(
            permission.permissionID,
            powerLevel,
        );
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not update the member's role.");
            return;
        }
        setMemberPermissions((current) =>
            current.map((candidate) =>
                candidate.permissionID === permission.permissionID
                    ? { ...candidate, powerLevel }
                    : candidate,
            ),
        );
        setSuccess(`${member.username}'s role updated.`);
    }

    async function removeMember(member: User) {
        const targetPower = permissionFor(member.userID)?.powerLevel ?? 0;
        if (
            member.userID === currentUser?.userID ||
            myPower <= targetPower ||
            !window.confirm(`Remove ${member.username} from ${server.name}?`)
        ) {
            return;
        }
        setBusy(true);
        clearFeedback();
        const result = await vexService.kickServerMember(
            serverID,
            member.userID,
        );
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not remove the member.");
            return;
        }
        setMembers((current) =>
            current.filter((candidate) => candidate.userID !== member.userID),
        );
        setSuccess(`${member.username} removed.`);
    }

    async function createInvite() {
        setBusy(true);
        clearFeedback();
        try {
            const invite = await vexService.createInvite(serverID, "1h");
            setInvites((current) => [invite, ...current]);
            setSuccess("Invite created.");
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Could not create an invite."));
        } finally {
            setBusy(false);
        }
    }

    function copyInvite(inviteID: string) {
        void navigator.clipboard.writeText(formatInviteLink(inviteID));
        setCopiedInviteID(inviteID);
        window.setTimeout(() => setCopiedInviteID(""), 1800);
    }

    async function leaveGroup() {
        if (
            !canLeave ||
            !window.confirm(
                `Leave ${server.name}? You will need another invite to return.`,
            )
        ) {
            return;
        }
        setBusy(true);
        const result = await vexService.leaveServer(serverID);
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not leave the group.");
            return;
        }
        navigate("/app/home", true);
    }

    async function deleteGroup() {
        if (
            !isOwner ||
            !window.confirm(
                `Permanently delete ${server.name}? This cannot be undone.`,
            )
        ) {
            return;
        }
        setBusy(true);
        const result = await vexService.deleteServer(serverID);
        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Could not delete the group.");
            return;
        }
        navigate("/app/home", true);
    }

    return (
        <section className="settings-page server-settings-page">
            <header className="settings-page__topbar">
                <button
                    aria-label="Back to group"
                    title="Back to group"
                    type="button"
                    onClick={() => {
                        const first = channels[0];
                        navigate(
                            first
                                ? channelPath(serverID, first.channelID)
                                : `/app/server/${serverID}`,
                        );
                    }}
                >
                    <ArrowLeft size={18} />
                </button>
                <ServerIcon server={server} size={34} />
                <span>
                    <small>Group settings</small>
                    <strong>{server.name}</strong>
                </span>
            </header>
            <div className="settings-page__layout">
                <nav className="settings-nav" aria-label="Group settings">
                    {(
                        [
                            ["overview", "Overview"],
                            ["channels", "Channels"],
                            ["members", "Members"],
                            ["invites", "Invites"],
                        ] as const
                    ).map(([id, label]) => (
                        <button
                            aria-current={tab === id ? "page" : undefined}
                            className={tab === id ? "is-active" : undefined}
                            key={id}
                            type="button"
                            onClick={() => {
                                clearFeedback();
                                setTab(id);
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
                <main className="settings-content">
                    {error ? (
                        <div className="status status--error" role="alert">
                            {error}
                        </div>
                    ) : success ? (
                        <div className="status status--notice" role="status">
                            {success}
                        </div>
                    ) : null}
                    {tab === "overview" ? (
                        <>
                            <SettingsHeading
                                description="The identity people see throughout Vex."
                                title="Overview"
                            />
                            <div className="server-icon-editor">
                                <ServerIcon server={server} size={82} />
                                <div>
                                    <input
                                        accept="image/jpeg,image/png,image/gif,image/avif,image/webp"
                                        className="visually-hidden"
                                        ref={iconInput}
                                        type="file"
                                        onChange={(event) =>
                                            void uploadIcon(
                                                event.currentTarget.files?.[0],
                                            )
                                        }
                                    />
                                    <button
                                        className="button button--secondary"
                                        disabled={!canManage || busy}
                                        type="button"
                                        onClick={() =>
                                            iconInput.current?.click()
                                        }
                                    >
                                        <Camera size={16} />
                                        {server.icon
                                            ? "Change icon"
                                            : "Add icon"}
                                    </button>
                                    {server.icon ? (
                                        <button
                                            className="settings-text-action"
                                            disabled={!canManage || busy}
                                            type="button"
                                            onClick={() => void removeIcon()}
                                        >
                                            Remove icon
                                        </button>
                                    ) : null}
                                    <small>Square images, up to 5 MB.</small>
                                </div>
                            </div>
                            <label className="settings-field">
                                <span>Group name</span>
                                <div>
                                    <input
                                        autoComplete="off"
                                        disabled={!canManage || busy}
                                        maxLength={100}
                                        value={name}
                                        onInput={(event) =>
                                            setName(event.currentTarget.value)
                                        }
                                    />
                                    <button
                                        className="button button--primary"
                                        disabled={
                                            !canManage ||
                                            busy ||
                                            !name.trim() ||
                                            name.trim() === server.name
                                        }
                                        type="button"
                                        onClick={() => void saveName()}
                                    >
                                        Save
                                    </button>
                                </div>
                            </label>
                            <div className="settings-danger-zone">
                                <SettingsActionRow
                                    action={
                                        <button
                                            className="button button--secondary is-danger"
                                            disabled={!canLeave || busy}
                                            type="button"
                                            onClick={() => void leaveGroup()}
                                        >
                                            <LogOut size={16} /> Leave
                                        </button>
                                    }
                                    description={
                                        isOwner && !canLeave
                                            ? "Add another owner before leaving."
                                            : "You will need an invite to return."
                                    }
                                    title="Leave group"
                                />
                                {isOwner ? (
                                    <SettingsActionRow
                                        action={
                                            <button
                                                className="button button--secondary is-danger"
                                                disabled={busy}
                                                type="button"
                                                onClick={() =>
                                                    void deleteGroup()
                                                }
                                            >
                                                <Trash2 size={16} /> Delete
                                            </button>
                                        }
                                        description="Permanently removes every channel and invite."
                                        title="Delete group"
                                    />
                                ) : null}
                            </div>
                        </>
                    ) : tab === "channels" ? (
                        <>
                            <SettingsHeading
                                description="Keep conversations focused and easy to find."
                                title="Channels"
                            />
                            {canManage ? (
                                <form
                                    className="settings-create-row"
                                    onSubmit={createChannel}
                                >
                                    <Hash size={16} />
                                    <input
                                        autoComplete="off"
                                        disabled={busy}
                                        maxLength={100}
                                        placeholder="new-channel"
                                        value={newChannelName}
                                        onInput={(event) =>
                                            setNewChannelName(
                                                event.currentTarget.value,
                                            )
                                        }
                                    />
                                    <button
                                        className="button button--primary"
                                        disabled={
                                            busy || !newChannelName.trim()
                                        }
                                    >
                                        <Plus size={16} /> Create
                                    </button>
                                </form>
                            ) : null}
                            <div className="settings-rows">
                                {channels.map((channel) => (
                                    <div
                                        className="settings-channel-row"
                                        key={channel.channelID}
                                    >
                                        {editingChannelID ===
                                        channel.channelID ? (
                                            <>
                                                <Hash size={16} />
                                                <input
                                                    autoFocus
                                                    disabled={busy}
                                                    maxLength={100}
                                                    value={editingChannelName}
                                                    onInput={(event) =>
                                                        setEditingChannelName(
                                                            event.currentTarget
                                                                .value,
                                                        )
                                                    }
                                                />
                                                <IconButton
                                                    disabled={
                                                        busy ||
                                                        !editingChannelName.trim()
                                                    }
                                                    icon={<Check size={16} />}
                                                    label="Save channel name"
                                                    onClick={() =>
                                                        void saveChannelName()
                                                    }
                                                />
                                                <IconButton
                                                    icon={<X size={16} />}
                                                    label="Cancel rename"
                                                    onClick={() =>
                                                        setEditingChannelID("")
                                                    }
                                                />
                                            </>
                                        ) : (
                                            <>
                                                <Hash size={16} />
                                                <button
                                                    className="settings-row-link"
                                                    type="button"
                                                    onClick={() =>
                                                        navigate(
                                                            channelPath(
                                                                serverID,
                                                                channel.channelID,
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {channel.name}
                                                </button>
                                                {canManage ? (
                                                    <>
                                                        <IconButton
                                                            icon={
                                                                <Pencil
                                                                    size={15}
                                                                />
                                                            }
                                                            label={`Rename ${channel.name}`}
                                                            onClick={() => {
                                                                setEditingChannelID(
                                                                    channel.channelID,
                                                                );
                                                                setEditingChannelName(
                                                                    channel.name,
                                                                );
                                                            }}
                                                        />
                                                        <IconButton
                                                            danger
                                                            disabled={
                                                                busy ||
                                                                channels.length <=
                                                                    1
                                                            }
                                                            icon={
                                                                <Trash2
                                                                    size={15}
                                                                />
                                                            }
                                                            label={`Delete ${channel.name}`}
                                                            onClick={() =>
                                                                void deleteChannel(
                                                                    channel.channelID,
                                                                    channel.name,
                                                                )
                                                            }
                                                        />
                                                    </>
                                                ) : null}
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : tab === "members" ? (
                        <>
                            <SettingsHeading
                                description={`${members.length} people currently have access.`}
                                title="Members"
                            />
                            {loadingSection && !members.length ? (
                                <SettingsLoading />
                            ) : (
                                <div className="settings-rows">
                                    {members.map((member) => {
                                        const permission = permissionFor(
                                            member.userID,
                                        );
                                        const power =
                                            permission?.powerLevel ?? 0;
                                        return (
                                            <div
                                                className="settings-member-row"
                                                key={member.userID}
                                            >
                                                <Avatar
                                                    name={member.username}
                                                    size={34}
                                                    userID={member.userID}
                                                />
                                                <span>
                                                    <strong>
                                                        {member.username}
                                                    </strong>
                                                    <small>
                                                        {roleName(power)}
                                                    </small>
                                                </span>
                                                {member.userID ===
                                                currentUser?.userID ? (
                                                    <small>You</small>
                                                ) : isOwner && permission ? (
                                                    <select
                                                        aria-label={`Role for ${member.username}`}
                                                        disabled={busy}
                                                        value={power}
                                                        onChange={(event) =>
                                                            void updateRole(
                                                                member,
                                                                permission,
                                                                Number(
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                ) as
                                                                    | 0
                                                                    | 50
                                                                    | 100,
                                                            )
                                                        }
                                                    >
                                                        <option value={0}>
                                                            Member
                                                        </option>
                                                        <option value={50}>
                                                            Moderator
                                                        </option>
                                                        <option value={100}>
                                                            Owner
                                                        </option>
                                                    </select>
                                                ) : null}
                                                {member.userID !==
                                                    currentUser?.userID &&
                                                myPower > power ? (
                                                    <button
                                                        className="settings-text-action is-danger"
                                                        disabled={busy}
                                                        type="button"
                                                        onClick={() =>
                                                            void removeMember(
                                                                member,
                                                            )
                                                        }
                                                    >
                                                        Remove
                                                    </button>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <SettingsHeading
                                description="Reusable links for inviting people to this group."
                                title="Invites"
                            />
                            <button
                                className="button button--primary"
                                disabled={busy || !canManage}
                                type="button"
                                onClick={() => void createInvite()}
                            >
                                <Link size={16} /> Create one-hour invite
                            </button>
                            {loadingSection && !invites.length ? (
                                <SettingsLoading />
                            ) : (
                                <div className="settings-rows settings-invites">
                                    {invites.map((invite) => (
                                        <div
                                            className="settings-invite-row"
                                            key={invite.inviteID}
                                        >
                                            <Link size={16} />
                                            <span>
                                                <code>
                                                    {formatInviteLink(
                                                        invite.inviteID,
                                                    )}
                                                </code>
                                                <small>
                                                    Expires{" "}
                                                    {formatDate(
                                                        invite.expiration,
                                                    )}
                                                </small>
                                            </span>
                                            <button
                                                className="button button--secondary"
                                                type="button"
                                                onClick={() =>
                                                    copyInvite(invite.inviteID)
                                                }
                                            >
                                                <Clipboard size={15} />
                                                {copiedInviteID ===
                                                invite.inviteID
                                                    ? "Copied"
                                                    : "Copy"}
                                            </button>
                                        </div>
                                    ))}
                                    {!invites.length ? (
                                        <p>No active invites.</p>
                                    ) : null}
                                </div>
                            )}
                        </>
                    )}
                </main>
            </div>
        </section>
    );
}

function IconButton({
    danger = false,
    disabled = false,
    icon,
    label,
    onClick,
}: {
    danger?: boolean;
    disabled?: boolean;
    icon: preact.ComponentChildren;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            aria-label={label}
            className={
                danger
                    ? "settings-icon-button is-danger"
                    : "settings-icon-button"
            }
            disabled={disabled}
            title={label}
            type="button"
            onClick={onClick}
        >
            {icon}
        </button>
    );
}

function SettingsActionRow({
    action,
    description,
    title,
}: {
    action: preact.ComponentChildren;
    description: string;
    title: string;
}) {
    return (
        <div className="settings-action-row">
            <span>
                <strong>{title}</strong>
                <small>{description}</small>
            </span>
            {action}
        </div>
    );
}

function SettingsHeading({
    description,
    title,
}: {
    description: string;
    title: string;
}) {
    return (
        <header className="settings-heading">
            <h1>{title}</h1>
            <p>{description}</p>
        </header>
    );
}

function SettingsLoading() {
    return (
        <div className="settings-loading">
            <LoaderCircle className="spin" size={17} /> Loading
        </div>
    );
}

function roleName(power: number): string {
    if (power >= 100) return "Owner";
    if (power >= 50) return "Moderator";
    return "Member";
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}

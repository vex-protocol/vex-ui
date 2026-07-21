import type { InvitePreview } from "@vex-chat/store";

import {
    ArrowLeft,
    Check,
    Clock3,
    Copy,
    Hash,
    Link,
    LoaderCircle,
    Share2,
    Users,
} from "lucide-preact";
import { useEffect, useState } from "preact/hooks";

import {
    $channels,
    $servers,
    formatInviteLink,
    vexService,
} from "@vex-chat/store";

import { ServerIcon } from "../components/ServerIcon";
import { channelPath, navigate } from "../lib/router";
import { useStoreValue } from "../lib/useStoreValue";

interface InviteState {
    error: string;
    inviteID: string;
    loading: boolean;
    preview: InvitePreview | null;
}

export function InviteView({ inviteID }: { inviteID: string }) {
    const servers = useStoreValue($servers);
    const channels = useStoreValue($channels);
    const [state, setState] = useState<InviteState>({
        error: "",
        inviteID,
        loading: true,
        preview: null,
    });
    const [joining, setJoining] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let active = true;
        setState({ error: "", inviteID, loading: true, preview: null });
        void vexService
            .previewInvite(inviteID)
            .then((preview) => {
                if (!active) return;
                setState({
                    error: preview
                        ? ""
                        : "This invite could not be found or has expired.",
                    inviteID,
                    loading: false,
                    preview,
                });
            })
            .catch((cause: unknown) => {
                if (!active) return;
                setState({
                    error: errorMessage(cause, "Could not load this invite."),
                    inviteID,
                    loading: false,
                    preview: null,
                });
            });
        return () => {
            active = false;
        };
    }, [inviteID]);

    const current = state.inviteID === inviteID ? state : null;
    const preview = current?.preview ?? null;
    const serverID = preview?.server?.serverID ?? preview?.invite.serverID;
    const joinedServer = serverID ? servers[serverID] : undefined;
    const inviteURL = formatInviteLink(inviteID);

    function openGroup() {
        if (!serverID) return;
        const first = channels[serverID]?.[0];
        navigate(
            first
                ? channelPath(serverID, first.channelID)
                : `/app/server/${encodeURIComponent(serverID)}`,
            true,
        );
    }

    async function joinGroup() {
        if (!preview || joining) return;
        setJoining(true);
        setState((value) => ({ ...value, error: "" }));
        try {
            const result = await vexService.joinInvite(inviteID);
            if (!result.ok || !result.serverID) {
                setState((value) => ({
                    ...value,
                    error: result.error ?? "Could not join this group.",
                }));
                return;
            }
            navigate(
                result.channelID
                    ? channelPath(result.serverID, result.channelID)
                    : `/app/server/${encodeURIComponent(result.serverID)}`,
                true,
            );
        } catch (cause: unknown) {
            setState((value) => ({
                ...value,
                error: errorMessage(cause, "Could not join this group."),
            }));
        } finally {
            setJoining(false);
        }
    }

    async function shareInvite() {
        const shareData = {
            text: preview?.server?.name
                ? `Join ${preview.server.name} on Vex`
                : "Join this group on Vex",
            title: "Vex group invite",
            url: inviteURL,
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
                return;
            }
            await navigator.clipboard.writeText(inviteURL);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch (cause: unknown) {
            if (cause instanceof DOMException && cause.name === "AbortError")
                return;
            setState((value) => ({
                ...value,
                error: "Could not share this invite from the browser.",
            }));
        }
    }

    async function copyInvite() {
        try {
            await navigator.clipboard.writeText(inviteURL);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            setState((value) => ({
                ...value,
                error: "Could not copy this invite from the browser.",
            }));
        }
    }

    return (
        <section className="invite-page">
            <header className="standalone-topbar">
                <button
                    aria-label="Back to groups"
                    title="Back to groups"
                    type="button"
                    onClick={() => navigate("/app/servers")}
                >
                    <ArrowLeft size={18} />
                </button>
                <span>
                    <small>Invite preview</small>
                    <strong>{preview?.server?.name ?? "Group invite"}</strong>
                </span>
            </header>

            <div className="invite-page__body">
                {current?.loading ? (
                    <div className="invite-page__loading">
                        <LoaderCircle className="spin" size={24} />
                        <span>Loading invite details</span>
                    </div>
                ) : preview ? (
                    <>
                        <header className="invite-page__intro">
                            {preview.server ? (
                                <ServerIcon server={preview.server} size={72} />
                            ) : (
                                <span className="invite-page__fallback-icon">
                                    <Link size={27} />
                                </span>
                            )}
                            <span>You've been invited to</span>
                            <h1>{preview.server?.name ?? "a Vex group"}</h1>
                            <p>Review the details before joining.</p>
                        </header>

                        <dl className="invite-metadata">
                            <div>
                                <dt>
                                    <Hash size={16} /> Channels
                                </dt>
                                <dd>{channelSummary(preview)}</dd>
                            </div>
                            <div>
                                <dt>
                                    <Clock3 size={16} /> Expires
                                </dt>
                                <dd>
                                    {formatExpiration(
                                        preview.invite.expiration,
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>
                                    <Users size={16} /> Created by
                                </dt>
                                <dd>
                                    {preview.invite.owner ||
                                        "Group administrator"}
                                </dd>
                            </div>
                        </dl>

                        <div className="invite-code-row">
                            <span>
                                <small>Invite code</small>
                                <code>{inviteID}</code>
                            </span>
                            <button
                                aria-label="Copy invite link"
                                className="settings-icon-button"
                                title="Copy invite link"
                                type="button"
                                onClick={() => void copyInvite()}
                            >
                                {copied ? (
                                    <Check size={16} />
                                ) : (
                                    <Copy size={16} />
                                )}
                            </button>
                        </div>

                        {current?.error ? (
                            <div className="status status--error" role="alert">
                                {current.error}
                            </div>
                        ) : null}

                        <div className="invite-page__actions">
                            <button
                                className="button button--secondary"
                                type="button"
                                onClick={() => void shareInvite()}
                            >
                                <Share2 size={16} /> Share
                            </button>
                            {joinedServer ? (
                                <button
                                    className="button button--primary"
                                    type="button"
                                    onClick={openGroup}
                                >
                                    Open group
                                </button>
                            ) : (
                                <button
                                    className="button button--primary"
                                    disabled={joining}
                                    type="button"
                                    onClick={() => void joinGroup()}
                                >
                                    {joining ? (
                                        <LoaderCircle
                                            className="spin"
                                            size={16}
                                        />
                                    ) : (
                                        <Link size={16} />
                                    )}
                                    {joining ? "Joining" : "Join group"}
                                </button>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="invite-page__empty">
                        <span className="invite-page__fallback-icon">
                            <Link size={27} />
                        </span>
                        <h1>Invite unavailable</h1>
                        <p>
                            {current?.error ||
                                "This invite could not be found or has expired."}
                        </p>
                        <button
                            className="button button--secondary"
                            type="button"
                            onClick={() => navigate("/app/servers")}
                        >
                            Enter another invite
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
}

function channelSummary(preview: InvitePreview): string {
    if (!preview.channels.length) return "No channels listed";
    const names = preview.channels
        .slice(0, 4)
        .map((channel) => `#${channel.name}`)
        .join(", ");
    const remaining = preview.channels.length - 4;
    return remaining > 0 ? `${names} +${remaining} more` : names;
}

function formatExpiration(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unavailable";
    return date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}

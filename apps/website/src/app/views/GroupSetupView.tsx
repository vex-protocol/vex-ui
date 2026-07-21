import {
    ArrowLeft,
    Camera,
    Hash,
    Link,
    LoaderCircle,
    Plus,
    X,
} from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { parseInviteID, vexService } from "@vex-chat/store";

import { channelPath, navigate } from "../lib/router";

const MAX_ICON_BYTES = 5 * 1024 * 1024;

export function GroupSetupView() {
    const [mode, setMode] = useState<"create" | "join">("create");
    const [name, setName] = useState("");
    const [invite, setInvite] = useState("");
    const [icon, setIcon] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const iconInput = useRef<HTMLInputElement | null>(null);
    const iconURL = useMemo(
        () => (icon ? URL.createObjectURL(icon) : ""),
        [icon],
    );

    useEffect(
        () => () => {
            if (iconURL) URL.revokeObjectURL(iconURL);
        },
        [iconURL],
    );

    function selectIcon(file: File | undefined) {
        setError("");
        if (!file) return;
        if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
            setError("Choose a JPEG, PNG, GIF, AVIF, or WebP image.");
            return;
        }
        if (file.size > MAX_ICON_BYTES) {
            setError("Group icons must be 5 MB or smaller.");
            return;
        }
        setIcon(file);
    }

    async function createGroup(event: SubmitEvent) {
        event.preventDefault();
        const normalizedName = name.trim();
        if (!normalizedName || busy) return;
        setBusy(true);
        setError("");
        try {
            const result = await vexService.createServer(normalizedName);
            if (!result.ok || !result.serverID) {
                setError(result.error ?? "Could not create this group.");
                return;
            }

            if (icon) {
                const iconResult = await vexService.setServerIcon(
                    result.serverID,
                    new Uint8Array(await icon.arrayBuffer()),
                );
                if (!iconResult.ok) {
                    await vexService.deleteServer(result.serverID);
                    setError(
                        iconResult.error ??
                            "The icon could not be saved, so the group was not created.",
                    );
                    return;
                }
            }

            navigate(
                result.channelID
                    ? channelPath(result.serverID, result.channelID)
                    : `/app/server/${encodeURIComponent(result.serverID)}`,
                true,
            );
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Could not create this group."));
        } finally {
            setBusy(false);
        }
    }

    function previewInvite(event: SubmitEvent) {
        event.preventDefault();
        const inviteID = parseInviteID(invite);
        if (!inviteID) {
            setError("Enter a valid Vex invite link or code.");
            return;
        }
        setError("");
        navigate(`/app/invite/${encodeURIComponent(inviteID)}`);
    }

    return (
        <section className="group-setup-page">
            <header className="standalone-topbar">
                <button
                    aria-label="Back to Home"
                    title="Back to Home"
                    type="button"
                    onClick={() => navigate("/app/home")}
                >
                    <ArrowLeft size={18} />
                </button>
                <span>
                    <small>Groups</small>
                    <strong>Create or join</strong>
                </span>
            </header>

            <div className="group-setup-page__body">
                <header className="group-setup-page__intro">
                    <span>New group</span>
                    <h1>Start somewhere new</h1>
                    <p>
                        Create a private space for your people, or review an
                        invite before joining an existing group.
                    </p>
                </header>

                <div className="segmented-control" role="tablist">
                    <button
                        aria-selected={mode === "create"}
                        className={mode === "create" ? "is-active" : undefined}
                        role="tab"
                        type="button"
                        onClick={() => {
                            setMode("create");
                            setError("");
                        }}
                    >
                        <Plus size={16} /> Create group
                    </button>
                    <button
                        aria-selected={mode === "join"}
                        className={mode === "join" ? "is-active" : undefined}
                        role="tab"
                        type="button"
                        onClick={() => {
                            setMode("join");
                            setError("");
                        }}
                    >
                        <Link size={16} /> Join with invite
                    </button>
                </div>

                {error ? (
                    <div className="status status--error" role="alert">
                        {error}
                    </div>
                ) : null}

                {mode === "create" ? (
                    <form className="group-setup-form" onSubmit={createGroup}>
                        <div className="group-icon-picker">
                            <input
                                accept="image/jpeg,image/png,image/gif,image/avif,image/webp"
                                className="visually-hidden"
                                ref={iconInput}
                                type="file"
                                onChange={(event) =>
                                    selectIcon(event.currentTarget.files?.[0])
                                }
                            />
                            <button
                                aria-label={
                                    icon
                                        ? "Change group icon"
                                        : "Add group icon"
                                }
                                className="group-icon-picker__stage"
                                disabled={busy}
                                title={
                                    icon
                                        ? "Change group icon"
                                        : "Add group icon"
                                }
                                type="button"
                                onClick={() => iconInput.current?.click()}
                            >
                                {iconURL ? (
                                    <img
                                        alt="Selected group icon"
                                        src={iconURL}
                                    />
                                ) : (
                                    <Camera size={25} />
                                )}
                            </button>
                            <span>
                                <strong>Group icon</strong>
                                <small>Optional, square image up to 5 MB</small>
                            </span>
                            {icon ? (
                                <button
                                    aria-label="Remove selected icon"
                                    className="settings-icon-button"
                                    title="Remove selected icon"
                                    type="button"
                                    onClick={() => {
                                        setIcon(null);
                                        if (iconInput.current)
                                            iconInput.current.value = "";
                                    }}
                                >
                                    <X size={16} />
                                </button>
                            ) : null}
                        </div>

                        <label className="settings-field">
                            <span>Group name</span>
                            <input
                                autoFocus
                                autoComplete="off"
                                disabled={busy}
                                maxLength={100}
                                placeholder="Design team"
                                value={name}
                                onInput={(event) =>
                                    setName(event.currentTarget.value)
                                }
                            />
                        </label>

                        <div className="group-setup-form__note">
                            <Hash size={16} />
                            <span>
                                A general channel is created automatically. You
                                can add more channels and members afterward.
                            </span>
                        </div>

                        <button
                            className="button button--primary button--wide"
                            disabled={busy || !name.trim()}
                        >
                            {busy ? (
                                <LoaderCircle className="spin" size={17} />
                            ) : (
                                <Plus size={17} />
                            )}
                            {busy ? "Creating group" : "Create group"}
                        </button>
                    </form>
                ) : (
                    <form className="group-setup-form" onSubmit={previewInvite}>
                        <label className="settings-field">
                            <span>Invite link or code</span>
                            <input
                                autoFocus
                                autoCapitalize="none"
                                autoComplete="off"
                                placeholder="https://vex.wtf/invite/..."
                                spellcheck={false}
                                value={invite}
                                onInput={(event) =>
                                    setInvite(event.currentTarget.value)
                                }
                            />
                        </label>
                        <p className="group-setup-form__help">
                            Vex will show the group name, channels, and expiry
                            before anything is joined.
                        </p>
                        <button
                            className="button button--primary button--wide"
                            disabled={!invite.trim()}
                        >
                            <Link size={17} /> Review invite
                        </button>
                    </form>
                )}
            </div>
        </section>
    );
}

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}

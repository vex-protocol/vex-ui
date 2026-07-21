import { $avatarVersions, avatarHue } from "@vex-chat/store";

import { useState } from "preact/hooks";

import { buildAvatarURL } from "../lib/config";
import { useStoreValue } from "../lib/useStoreValue";

interface AvatarProps {
    name?: string;
    size?: number;
    userID: string;
}

export function Avatar({ name = "", size = 34, userID }: AvatarProps) {
    const versions = useStoreValue($avatarVersions);
    const version = versions[userID] ?? 0;
    const failureKey = `${userID}:${version}`;
    const [failed, setFailed] = useState("");
    const initials = avatarInitials(name || userID);

    return (
        <span
            className="web-avatar"
            style={{
                "--avatar-hue": String(avatarHue(userID)),
                "--avatar-size": `${size}px`,
            }}
            title={name || undefined}
        >
            {failed !== failureKey ? (
                <img
                    alt=""
                    src={buildAvatarURL(userID, version)}
                    onError={() => setFailed(failureKey)}
                />
            ) : (
                <span aria-hidden="true">{initials}</span>
            )}
        </span>
    );
}

function avatarInitials(value: string): string {
    const words = value.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) return "?";
    return words
        .slice(0, 2)
        .map((word) => word[0] ?? "")
        .join("")
        .toUpperCase();
}

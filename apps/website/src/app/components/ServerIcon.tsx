import type { Server } from "@vex-chat/libvex";

import { useState } from "preact/hooks";

import { vexService } from "@vex-chat/store";

interface ServerIconProps {
    server: Server;
    size?: number;
}

export function ServerIcon({ server, size = 40 }: ServerIconProps) {
    const [failedIconID, setFailedIconID] = useState("");
    const iconURL =
        server.icon && failedIconID !== server.icon
            ? vexService.getServerIconURL(server.icon)
            : "";
    const initials = server.name
        .trim()
        .split(/\s+/u)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toUpperCase();

    return (
        <span
            className="web-server-icon"
            style={{ "--server-icon-size": `${size}px` }}
        >
            {iconURL ? (
                <img
                    alt=""
                    src={iconURL}
                    onError={() => setFailedIconID(server.icon ?? "")}
                />
            ) : (
                <span aria-hidden="true">{initials || "?"}</span>
            )}
        </span>
    );
}

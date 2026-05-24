export interface PendingNotificationRouteTap {
    data: Record<string, unknown>;
    dedupeKey?: string | undefined;
    syncFirst: boolean;
}

const pendingRouteTapQueue: PendingNotificationRouteTap[] = [];

export function dequeuePendingNotificationRoute():
    | PendingNotificationRouteTap
    | undefined {
    return pendingRouteTapQueue.shift();
}

/**
 * Queued from `notifee.onBackgroundEvent` in `index.js` (Android) when the user
 * taps a message notification while the JS engine is not yet interactive.
 */
export function enqueueNotificationRouteFromAndroidBackground(data: {
    [key: string]: number | object | string;
}): void {
    const kind = data["kind"];
    if (kind !== "dm" && kind !== "group") {
        return;
    }
    enqueuePendingNotificationRoute(normalizeAndroidMessageRouteData(data), {
        dedupeKey:
            typeof data["mailID"] === "string" ? data["mailID"] : undefined,
        syncFirst: true,
    });
}

export function enqueuePendingNotificationRoute(
    data: Record<string, unknown>,
    options: { dedupeKey?: string | undefined; syncFirst?: boolean } = {},
): void {
    const dedupeKey =
        options.dedupeKey ??
        (typeof data["mailID"] === "string" ? data["mailID"] : undefined);
    if (dedupeKey) {
        const idx = pendingRouteTapQueue.findIndex(
            (p) => p.dedupeKey === dedupeKey,
        );
        if (idx >= 0) {
            pendingRouteTapQueue.splice(idx, 1);
        }
    }
    if (dedupeKey !== undefined) {
        pendingRouteTapQueue.push({
            data,
            dedupeKey,
            syncFirst: options.syncFirst === true,
        });
    } else {
        pendingRouteTapQueue.push({
            data,
            syncFirst: options.syncFirst === true,
        });
    }
}

export function normalizeAndroidMessageRouteData(raw: {
    [key: string]: unknown;
}): Record<string, unknown> {
    const kind = stringifyRouteField(raw["kind"]);
    const authorID = stringifyRouteField(raw["authorID"]);
    const out: Record<string, unknown> = { authorID, kind };
    if (raw["event"] != null) {
        out["event"] = stringifyRouteField(raw["event"]);
    }
    if (raw["mailID"] != null) {
        out["mailID"] = stringifyRouteField(raw["mailID"]);
    }
    if (kind === "group") {
        out["channelID"] = stringifyRouteField(raw["channelID"]);
        out["serverID"] = stringifyRouteField(raw["serverID"]);
    }
    return out;
}

export function pendingNotificationRouteCount(): number {
    return pendingRouteTapQueue.length;
}

export function requeuePendingNotificationRoute(
    route: PendingNotificationRouteTap,
): void {
    pendingRouteTapQueue.unshift(route);
}

function stringifyRouteField(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === "boolean") {
        return String(value);
    }
    return "";
}

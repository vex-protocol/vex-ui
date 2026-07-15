import { getServerOptions, getServerUrl } from "./config";

export interface ConnectedServerInfo {
    baseUrl: string;
    checkedAt: string;
    error?: string | undefined;
    health?: {
        dbReady?: boolean | undefined;
        latencyMs: number;
        ok?: boolean | undefined;
    };
    host: string;
    status?: {
        canary?: boolean | undefined;
        checkDurationMs?: number | undefined;
        ok?: boolean | undefined;
        version?: string | undefined;
    };
}

const SERVER_INFO_TIMEOUT_MS = 6000;
const publicServerFetch = globalThis.fetch.bind(globalThis);

export async function fetchConnectedServerInfo(): Promise<ConnectedServerInfo> {
    const host = getServerUrl();
    const options = getServerOptions();
    const baseUrl = `${options.unsafeHttp ? "http" : "https"}://${host}`;
    const checkedAt = new Date().toISOString();
    const headers = jsonHeaders(options.devApiKey);

    const [healthResult, statusResult] = await Promise.allSettled([
        timedJson(`${baseUrl}/healthz`, headers),
        timedJson(`${baseUrl}/status`, headers),
    ]);

    const health =
        healthResult.status === "fulfilled"
            ? parseHealth(healthResult.value)
            : undefined;
    const status =
        statusResult.status === "fulfilled"
            ? parseStatus(statusResult.value)
            : undefined;

    const errors = [
        healthResult.status === "rejected"
            ? errorMessage(healthResult.reason)
            : undefined,
        statusResult.status === "rejected"
            ? errorMessage(statusResult.reason)
            : undefined,
    ].filter((value): value is string => value != null);

    return {
        baseUrl,
        checkedAt,
        ...(errors.length > 0 && health == null && status == null
            ? { error: errors.join("; ") }
            : {}),
        ...(health != null ? { health } : {}),
        host,
        ...(status != null ? { status } : {}),
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value != null
        ? (value as Record<string, unknown>)
        : {};
}

function boolField(
    record: Record<string, unknown>,
    field: string,
): boolean | undefined {
    return typeof record[field] === "boolean" ? record[field] : undefined;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function jsonHeaders(devApiKey: string | undefined): Record<string, string> {
    return {
        Accept: "application/json",
        ...(devApiKey ? { "x-dev-api-key": devApiKey } : {}),
    };
}

function numberField(
    record: Record<string, unknown>,
    field: string,
): number | undefined {
    return typeof record[field] === "number" && Number.isFinite(record[field])
        ? record[field]
        : undefined;
}

function parseHealth(result: {
    data: unknown;
    valueLatencyMs: number;
}): ConnectedServerInfo["health"] {
    const record = asRecord(result.data);
    return {
        dbReady: boolField(record, "dbReady"),
        latencyMs: result.valueLatencyMs,
        ok: boolField(record, "ok"),
    };
}

function parseStatus(result: {
    data: unknown;
    valueLatencyMs: number;
}): ConnectedServerInfo["status"] {
    const record = asRecord(result.data);
    return {
        canary: boolField(record, "canary"),
        checkDurationMs: numberField(record, "checkDurationMs"),
        ok: boolField(record, "ok"),
        version: stringField(record, "version"),
    };
}

function stringField(
    record: Record<string, unknown>,
    field: string,
): string | undefined {
    const value = record[field];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}

async function timedJson(
    url: string,
    headers: Record<string, string>,
): Promise<{ data: unknown; valueLatencyMs: number }> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, SERVER_INFO_TIMEOUT_MS);
    try {
        const response = await publicServerFetch(url, {
            headers,
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${String(response.status)}`);
        }
        return {
            data: await response.json(),
            valueLatencyMs: Date.now() - started,
        };
    } finally {
        clearTimeout(timeout);
    }
}

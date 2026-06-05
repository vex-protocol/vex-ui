/**
 * Desktop (Tauri) platform configuration.
 *
 * Constructs a BootstrapConfig for the Vex store using:
 * - Storage:   Kysely + kysely-dialect-tauri + @tauri-apps/plugin-sql
 * - deviceName: navigator.platform
 */
import type { Storage } from "@vex-chat/libvex";
import type { BootstrapConfig } from "@vex-chat/store";

import { MemoryStorage } from "@vex-chat/store";

import { getServerIdentity, isLocalDevServer } from "./config.js";

export function desktopConfig(): BootstrapConfig {
    return {
        allowInsecureLocalPasskeyBypass: isLocalDevServer(),
        async createStorage(
            privateKey: string,
            username: string,
        ): Promise<Storage> {
            const atRestAes = deriveAtRestAesKey(privateKey);
            if (!isTauriRuntime()) {
                const storage = new MemoryStorage(atRestAes);
                await storage.init();
                return storage;
            }

            const { Kysely } = await import("kysely");
            const { TauriSqliteDialect } = await import("kysely-dialect-tauri");
            const { default: Database } =
                await import("@tauri-apps/plugin-sql");
            const { SqliteStorage } =
                await import("@vex-chat/libvex/storage/sqlite");

            const dbName = scopedDbName(username);
            const db = new Kysely({
                dialect: new TauriSqliteDialect({
                    database: () => Database.load(`sqlite:${dbName}`),
                }),
            });
            // ClientDatabase type lives behind libvex's internal schema
            // module and isn't re-exported from the sqlite subpath; cast
            // via `never` to satisfy the Kysely<ClientDatabase> parameter
            // without pulling in an internal import.
            const storage = new SqliteStorage(db as never, atRestAes);
            await storage.init();
            return storage;
        },
        // navigator.platform is formally deprecated but the modern
        // replacement (navigator.userAgentData.platform) is Chromium-
        // only and missing on Safari/WebKit and all iOS browsers.
        // Tauri's WebView is OS-specific so coverage gaps are real.
        // Keeping .platform until there's a universally supported
        // alternative — the value is purely informational for the
        // device name surface.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        deviceName: navigator.platform,
    };
}

function decodeHex(hex: string): Uint8Array {
    const normalized = hex.trim().toLowerCase();
    const evenHex = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
    const out = new Uint8Array(evenHex.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        const start = i * 2;
        out[i] = Number.parseInt(evenHex.slice(start, start + 2), 16);
    }
    return out;
}

function deriveAtRestAesKey(privateKeyHex: string): Uint8Array {
    const raw = decodeHex(privateKeyHex);
    if (raw.length === 32) {
        return raw;
    }
    if (raw.length > 32) {
        return raw.subarray(0, 32);
    }
    const out = new Uint8Array(32);
    out.set(raw);
    return out;
}

function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function sanitize(s: string): string {
    return s
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-");
}

function scopedDbName(username: string): string {
    return `vex-client.${sanitize(getServerIdentity())}.${sanitize(username)}.db`;
}

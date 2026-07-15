/**
 * Desktop (Tauri) platform configuration.
 *
 * Constructs a BootstrapConfig for the Vex store using:
 * - Storage:   Kysely + kysely-dialect-tauri + @tauri-apps/plugin-sql
 * - deviceName: navigator.platform
 */
import type { Storage } from "@vex-chat/libvex";
import type { BootstrapConfig } from "@vex-chat/store";

import {
    decodeVexDbAtRestKey,
    encodeVexDbAtRestKey,
    generateVexDbAtRestKey,
    MemoryStorage,
} from "@vex-chat/store";

import { getServerIdentity } from "./config.js";

const DB_KEY_SERVICE_PREFIX = "com.vex-chat.desktop.db-key";
const ephemeralDbKeys = new Map<string, Uint8Array>();

export async function clearDesktopDatabaseKey(username: string): Promise<void> {
    const key = databaseKeyID(username);
    ephemeralDbKeys.delete(key);
    if (!isTauriRuntime()) return;
    const keyring = await import("tauri-plugin-keyring-api");
    try {
        await keyring.deletePassword(databaseKeyServiceName(), username);
    } catch {
        // The key may already be absent.
    }
}

export function desktopConfig(): BootstrapConfig {
    return {
        async createStorage(
            _privateKey: string,
            username: string,
        ): Promise<Storage> {
            const atRestAes = await resolveDesktopDatabaseKey(username);
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

function databaseKeyID(username: string): string {
    return `${sanitize(getServerIdentity())}\0${username}`;
}

function databaseKeyServiceName(): string {
    return `${DB_KEY_SERVICE_PREFIX}.${sanitize(getServerIdentity())}`;
}

function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function resolveDesktopDatabaseKey(
    username: string,
): Promise<Uint8Array> {
    const id = databaseKeyID(username);
    if (!isTauriRuntime()) {
        const existing = ephemeralDbKeys.get(id);
        if (existing) return existing;
        const generated = generateVexDbAtRestKey();
        ephemeralDbKeys.set(id, generated);
        return generated;
    }

    const keyring = await import("tauri-plugin-keyring-api");
    const service = databaseKeyServiceName();
    const stored = await keyring.getPassword(service, username);
    if (stored) {
        try {
            return decodeVexDbAtRestKey(stored);
        } catch {
            throw new Error("Stored local database key is invalid.");
        }
    }

    const generated = generateVexDbAtRestKey();
    await keyring.setPassword(
        service,
        username,
        encodeVexDbAtRestKey(generated),
    );
    return generated;
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

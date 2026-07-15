import type { KeyStore, StoredCredentials } from "@vex-chat/libvex";

import { getDesktopAppEnvironment, getServerIdentity } from "./config.js";
import {
    deleteKeyringPassword,
    getKeyringPassword,
    setKeyringPassword,
} from "./nativeKeyring.js";
import { clearDesktopDatabaseKey } from "./platform.js";

const SERVICE_PREFIX =
    getDesktopAppEnvironment() === "development"
        ? "com.vex-chat.desktop.dev"
        : "com.vex-chat.desktop";
const ACTIVE_USER_LS_PREFIX = "vex-active-user";
const STABLE_KEYRING_SCHEMA = "signed-v1";

/**
 * KeyStore backed by OS native credential stores via tauri-plugin-keyring.
 *
 * macOS: Keychain Services
 * Windows: Credential Manager
 * Linux: Secret Service (GNOME Keyring / KWallet)
 *
 * Credentials are scoped by server host — switching between prod/local/etc
 * uses isolated keychain slots, so a deviceKey registered against one
 * server never clobbers another's.
 */
class KeyringKeyStore implements KeyStore {
    private credsCache = new Map<string, StoredCredentials>();

    async clear(username: string): Promise<void> {
        for (const service of serviceNames()) {
            this.credsCache.delete(this.cacheKey(service, username));
            try {
                await deleteKeyringPassword(service, username);
            } catch {
                /* may not exist or may already be inaccessible */
            }
        }
        if (this.getActiveUser() === username) {
            localStorage.removeItem(activeUserKey());
        }
        await clearDesktopDatabaseKey(username);
    }

    deactivate(): Promise<void> {
        localStorage.removeItem(activeUserKey());
        return Promise.resolve();
    }

    async load(username?: string): Promise<null | StoredCredentials> {
        const service = serviceName();
        const user = username ?? this.getActiveUser();
        if (!user) return null;

        const key = this.cacheKey(service, user);
        const cached = this.credsCache.get(key);
        if (cached) return cached;

        let raw = await getKeyringPassword(service, user);
        let migrated = false;
        if (!raw) {
            raw = await getKeyringPassword(legacyServiceName(), user);
            migrated = raw !== null;
        }
        if (!raw) return null;
        let parsed: StoredCredentials;
        try {
            parsed = JSON.parse(raw) as StoredCredentials;
        } catch {
            return null;
        }
        if (migrated) {
            await setKeyringPassword(service, user, raw);
        }
        this.credsCache.set(key, parsed);
        return parsed;
    }

    async loadActive(): Promise<null | StoredCredentials> {
        return this.load();
    }

    async save(creds: StoredCredentials): Promise<void> {
        const service = serviceName();
        const key = this.cacheKey(service, creds.username);
        const existing = this.credsCache.get(key);
        const serialized = JSON.stringify(creds);

        if (existing && JSON.stringify(existing) === serialized) {
            if (this.getActiveUser() !== creds.username) {
                localStorage.setItem(activeUserKey(), creds.username);
            }
            return;
        }

        this.credsCache.set(key, creds);
        localStorage.setItem(activeUserKey(), creds.username);

        await setKeyringPassword(service, creds.username, serialized);
    }

    private cacheKey(service: string, username: string): string {
        return `${service}\u0000${username}`;
    }

    private getActiveUser(): null | string {
        return localStorage.getItem(activeUserKey());
    }
}

function activeUserKey(): string {
    return `${ACTIVE_USER_LS_PREFIX}.${scopeFromHost(getServerIdentity())}`;
}

function legacyServiceName(): string {
    return `${SERVICE_PREFIX}.${scopeFromHost(getServerIdentity())}`;
}

/**
 * Sanitize a host string into a stable identifier for scoping keychain and
 * localStorage keys. Strips protocol + trailing slashes, lowercases, and
 * replaces everything outside [a-z0-9._-] with a single dash so the result
 * is safe for use as part of a macOS Keychain service name and a
 * localStorage key.
 */
function scopeFromHost(host: string): string {
    return host
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-");
}

function serviceName(): string {
    return `${SERVICE_PREFIX}.${STABLE_KEYRING_SCHEMA}.${scopeFromHost(getServerIdentity())}`;
}

function serviceNames(): string[] {
    return [serviceName(), legacyServiceName()];
}

// ── Browser-only stores ─────────────────────────────────────────────────────

const LS_PREFIX = "vex-ks";

/**
 * Production browser builds must never persist identity keys in web storage.
 * Desktop releases use the OS keychain; this store only keeps a non-Tauri
 * session usable until the tab closes.
 */
class EphemeralKeyStore implements KeyStore {
    private activeUser: null | string = null;
    private credentials = new Map<string, StoredCredentials>();

    async clear(username: string): Promise<void> {
        this.credentials.delete(username);
        if (this.activeUser === username) this.activeUser = null;
        await clearDesktopDatabaseKey(username);
    }

    deactivate(): Promise<void> {
        this.activeUser = null;
        return Promise.resolve();
    }

    load(username?: string): Promise<null | StoredCredentials> {
        const user = username ?? this.activeUser;
        return Promise.resolve(
            user ? (this.credentials.get(user) ?? null) : null,
        );
    }

    loadActive(): Promise<null | StoredCredentials> {
        return this.load();
    }

    save(creds: StoredCredentials): Promise<void> {
        this.credentials.set(creds.username, creds);
        this.activeUser = creds.username;
        return Promise.resolve();
    }
}

class LocalStorageKeyStore implements KeyStore {
    async clear(username: string): Promise<void> {
        const scope = scopeFromHost(getServerIdentity());
        localStorage.removeItem(`${LS_PREFIX}.${scope}.${username}`);
        if (localStorage.getItem(activeUserKey()) === username) {
            localStorage.removeItem(activeUserKey());
        }
        await clearDesktopDatabaseKey(username);
    }

    deactivate(): Promise<void> {
        localStorage.removeItem(activeUserKey());
        return Promise.resolve();
    }

    load(username?: string): Promise<null | StoredCredentials> {
        const scope = scopeFromHost(getServerIdentity());
        const user = username ?? localStorage.getItem(activeUserKey());
        if (!user) return Promise.resolve(null);
        const raw = localStorage.getItem(`${LS_PREFIX}.${scope}.${user}`);
        if (!raw) return Promise.resolve(null);
        try {
            return Promise.resolve(JSON.parse(raw) as StoredCredentials);
        } catch {
            return Promise.resolve(null);
        }
    }

    loadActive(): Promise<null | StoredCredentials> {
        return this.load();
    }

    save(creds: StoredCredentials): Promise<void> {
        const scope = scopeFromHost(getServerIdentity());
        localStorage.setItem(
            `${LS_PREFIX}.${scope}.${creds.username}`,
            JSON.stringify(creds),
        );
        localStorage.setItem(activeUserKey(), creds.username);
        return Promise.resolve();
    }
}

// ── Export ───────────────────────────────────────────────────────────────────

/** Uses the OS keychain in Tauri; browser persistence is development-only. */
export const keyStore: KeyStore & {
    deactivate(): Promise<void>;
    loadActive(): Promise<null | StoredCredentials>;
} =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
        ? new KeyringKeyStore()
        : import.meta.env.DEV
          ? new LocalStorageKeyStore()
          : new EphemeralKeyStore();

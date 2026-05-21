import type { KeyStore, StoredCredentials } from "@vex-chat/libvex";

import { getServerIdentity } from "./config.js";

const SERVICE_PREFIX = "com.vex-chat.desktop";
const ACTIVE_USER_LS_PREFIX = "vex-active-user";
const KNOWN_USERS_LS_PREFIX = "vex-known-users";

export interface KnownAccount {
    username: string;
}

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
    private keyring: null | typeof import("tauri-plugin-keyring-api") = null;

    async clear(username: string): Promise<void> {
        const kr = await this.getKeyring();
        const service = serviceName();
        this.credsCache.delete(this.cacheKey(service, username));
        try {
            await kr.deletePassword(service, username);
        } catch {
            /* may not exist */
        }
        if (this.getActiveUser() === username) {
            localStorage.removeItem(activeUserKey());
        }
        removeKnownAccount(username);
    }

    async load(username?: string): Promise<null | StoredCredentials> {
        const service = serviceName();
        const user = username ?? this.getActiveUser();
        if (!user) return null;

        const key = this.cacheKey(service, user);
        const cached = this.credsCache.get(key);
        if (cached) return cached;

        const kr = await this.getKeyring();
        const raw = await kr.getPassword(service, user);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw) as StoredCredentials;
            this.credsCache.set(key, parsed);
            return parsed;
        } catch {
            return null;
        }
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
            addKnownAccount(creds.username);
            return;
        }

        this.credsCache.set(key, creds);
        localStorage.setItem(activeUserKey(), creds.username);
        addKnownAccount(creds.username);

        const kr = await this.getKeyring();
        await kr.setPassword(service, creds.username, serialized);
    }

    private cacheKey(service: string, username: string): string {
        return `${service}\u0000${username}`;
    }

    private getActiveUser(): null | string {
        return localStorage.getItem(activeUserKey());
    }

    private async getKeyring() {
        if (!this.keyring) {
            this.keyring = await import("tauri-plugin-keyring-api");
        }
        return this.keyring;
    }
}

function activeUserKey(): string {
    return `${ACTIVE_USER_LS_PREFIX}.${scopeFromHost(getServerIdentity())}`;
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
    return `${SERVICE_PREFIX}.${scopeFromHost(getServerIdentity())}`;
}

// ── localStorage fallback (dev mode without Tauri runtime) ──────────────────

const LS_PREFIX = "vex-ks";

class LocalStorageKeyStore implements KeyStore {
    clear(username: string): Promise<void> {
        const scope = scopeFromHost(getServerIdentity());
        localStorage.removeItem(`${LS_PREFIX}.${scope}.${username}`);
        if (localStorage.getItem(activeUserKey()) === username) {
            localStorage.removeItem(activeUserKey());
        }
        removeKnownAccount(username);
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
        addKnownAccount(creds.username);
        return Promise.resolve();
    }
}

// ── Export ───────────────────────────────────────────────────────────────────

/** Uses OS keychain via tauri-plugin-keyring in Tauri, falls back to localStorage in dev browser. */
export const keyStore: KeyStore & {
    loadActive(): Promise<null | StoredCredentials>;
} =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
        ? new KeyringKeyStore()
        : new LocalStorageKeyStore();

export function clearActiveUsername(): Promise<void> {
    localStorage.removeItem(activeUserKey());
    return Promise.resolve();
}

export async function clearCredentials(username: string): Promise<void> {
    await keyStore.clear(username);
}

export async function listKnownAccounts(): Promise<KnownAccount[]> {
    const known = readKnownUsernames();
    const accounts: KnownAccount[] = [];
    for (const username of known) {
        try {
            const creds = await keyStore.load(username);
            if (creds) {
                accounts.push({ username });
            } else {
                removeKnownAccount(username);
            }
        } catch {
            removeKnownAccount(username);
        }
    }
    return accounts.sort((a, b) => a.username.localeCompare(b.username));
}

export async function setActiveUsername(username: string): Promise<void> {
    const creds = await keyStore.load(username);
    if (!creds) {
        removeKnownAccount(username);
        throw new Error(`No saved credentials for @${username}.`);
    }
    localStorage.setItem(activeUserKey(), username);
    addKnownAccount(username);
}

function addKnownAccount(username: string): void {
    const normalized = username.trim();
    if (!normalized) return;
    const users = readKnownUsernames();
    if (!users.includes(normalized)) {
        writeKnownUsernames([...users, normalized]);
    }
}

function knownUsersKey(): string {
    return `${KNOWN_USERS_LS_PREFIX}.${scopeFromHost(getServerIdentity())}`;
}

function readKnownUsernames(): string[] {
    const raw = localStorage.getItem(knownUsersKey());
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

function removeKnownAccount(username: string): void {
    writeKnownUsernames(
        readKnownUsernames().filter((known) => known !== username),
    );
}

function writeKnownUsernames(usernames: string[]): void {
    localStorage.setItem(
        knownUsersKey(),
        JSON.stringify(Array.from(new Set(usernames)).sort()),
    );
}

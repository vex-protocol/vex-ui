import type { KeyStore, StoredCredentials } from "@vex-chat/libvex";

import * as SecureStore from "expo-secure-store";

import { getServerUrl } from "./config";
import { clearLocalDatabaseKeyMaterial } from "./platform";

/*
 * Multi-account credential store.
 *
 * SecureStore layout, scoped by server host so prod / staging / local
 * never alias each other:
 *
 *   vex-device-credentials.{host}.{username} → JSON StoredCredentials (libvex shape; we
 *                                              additionally tolerate an extra `userID`
 *                                              field to power the account selector)
 *   vex-user-id.{host}.{username}            → bare string userID (parallel write so we
 *                                              can populate this *after* libvex saves
 *                                              creds, since libvex's StoredCredentials
 *                                              shape is fixed)
 *   vex-active-user.{host}                   → bare string username (the auto-login target)
 *   vex-known-users.{host}                   → JSON string[] (every account ever signed in
 *                                              on this device that hasn't been explicitly
 *                                              removed; used to render the picker)
 *   vex-device-credentials.{host}            → legacy host-scoped slot (pre-multi-account)
 *
 * SecureStore has no enumeration API on either platform, so the index file is the only
 * way the picker can know what accounts exist.
 */

const CREDS_KEY_PREFIX = "vex-device-credentials";
const ACTIVE_USER_KEY_PREFIX = "vex-active-user";
const KNOWN_USERS_KEY_PREFIX = "vex-known-users";
const USER_ID_KEY_PREFIX = "vex-user-id";

export interface KnownAccount {
    deviceID: string;
    userID: null | string;
    username: string;
}

/**
 * Remove every credential slot this build knows how to discover for the
 * current server host. Useful as an account-picker escape hatch when iOS
 * Keychain items survive an uninstall/reinstall cycle.
 */
export async function clearAllCredentials(): Promise<void> {
    const users = new Set(await readKnownUsers());
    const active = await loadActiveUsername();
    if (active) {
        users.add(active);
    }
    const legacy = await readLegacyCredentials();
    if (legacy?.username) {
        users.add(legacy.username);
    }
    for (const user of users) {
        await SecureStore.deleteItemAsync(credsKeyForUser(user));
        await SecureStore.deleteItemAsync(userIDKeyForUser(user));
        await clearLocalDatabaseKeyMaterial(user);
    }
    await SecureStore.deleteItemAsync(activeUserKey());
    await SecureStore.deleteItemAsync(knownUsersKey());
    await SecureStore.deleteItemAsync(legacyCredsKey());
}

/**
 * Remove credentials for a specific user (or, when no username is passed, the
 * currently active user). This deletes their device-key slot, their userID
 * cache, local DB key material, and the active-user pointer if it currently
 * points at them.
 *
 * NOTE: Most caller-driven "switch account" flows should NOT use this — they
 * should leave key material alone and just flip the active pointer with
 * {@link setActiveUsername}. This function is the explicit "remove from this
 * device" path.
 */
export async function clearCredentials(username?: string): Promise<void> {
    const user = username ?? (await loadActiveUsername());
    if (!user) {
        await SecureStore.deleteItemAsync(activeUserKey());
        await SecureStore.deleteItemAsync(legacyCredsKey());
        return;
    }
    await SecureStore.deleteItemAsync(credsKeyForUser(user));
    await SecureStore.deleteItemAsync(userIDKeyForUser(user));
    await clearLocalDatabaseKeyMaterial(user);
    await removeFromKnownUsers(user);
    const active = await loadActiveUsername();
    if (active === user) {
        await SecureStore.deleteItemAsync(activeUserKey());
    }
    const legacy = await readLegacyCredentials();
    if (legacy?.username === user) {
        await SecureStore.deleteItemAsync(legacyCredsKey());
    }
}

/**
 * Hydrate every account that has credential material stored on this device.
 * Used by the account selector to render its rows.
 */
export async function listKnownAccounts(): Promise<KnownAccount[]> {
    const usernames = await readKnownUsers();
    if (usernames.length === 0) {
        // Backfill path: a device that signed in before the multi-account
        // index existed will have credentials but an empty index. Pull
        // whatever's at the active slot or the legacy slot and re-anchor it.
        const fallback = await loadCredentials();
        if (fallback) {
            await addToKnownUsers(fallback.username);
            return [
                {
                    deviceID: fallback.deviceID,
                    userID: await readUserID(fallback.username),
                    username: fallback.username,
                },
            ];
        }
        return [];
    }
    const accounts: KnownAccount[] = [];
    for (const username of usernames) {
        const creds = await readCredentialsForUser(username);
        if (!creds) {
            // Index pointed to a slot whose blob got nuked elsewhere — drop
            // the orphan entry so the picker doesn't show a row that can't
            // be tapped.
            await removeFromKnownUsers(username);
            continue;
        }
        accounts.push({
            deviceID: creds.deviceID,
            userID: await readUserID(username),
            username: creds.username,
        });
    }
    return accounts;
}

export async function loadActiveUsername(): Promise<null | string> {
    const raw = await SecureStore.getItemAsync(activeUserKey());
    if (!raw) return null;
    return raw;
}

export async function loadCredentials(
    username?: string,
): Promise<null | StoredCredentials> {
    const user = username ?? (await loadActiveUsername());
    if (user) {
        const creds = await readCredentialsForUser(user);
        if (creds) {
            return creds;
        }
    }
    // Legacy fallback: older builds used a single host-scoped slot.
    const legacy = await readLegacyCredentials();
    if (!legacy) {
        return null;
    }
    if (user && legacy.username !== user) {
        return null;
    }
    await saveCredentials(legacy);
    return legacy;
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
    await SecureStore.setItemAsync(
        credsKeyForUser(creds.username),
        JSON.stringify(creds),
    );
    await SecureStore.setItemAsync(activeUserKey(), creds.username);
    await addToKnownUsers(creds.username);
    await SecureStore.deleteItemAsync(legacyCredsKey());
}

/**
 * Switch the auto-login target. Does NOT touch any credential blobs — only
 * flips the pointer. This is the safe "switch account" primitive.
 */
export async function setActiveUsername(username: string): Promise<void> {
    await SecureStore.setItemAsync(activeUserKey(), username);
}

/**
 * Persist the userID for a given username. Called from the app side after
 * login lands a `$user` value, so the account selector can render real
 * avatars without needing an authenticated client.
 */
export async function setUserIDForUsername(
    username: string,
    userID: string,
): Promise<void> {
    await SecureStore.setItemAsync(userIDKeyForUser(username), userID);
}

function activeUserKey(): string {
    return `${ACTIVE_USER_KEY_PREFIX}.${scopeFromHost(getServerUrl())}`;
}

async function addToKnownUsers(username: string): Promise<void> {
    const users = await readKnownUsers();
    if (users.includes(username)) {
        return;
    }
    users.push(username);
    await writeKnownUsers(users);
}

function credsKeyForUser(username: string): string {
    return `${CREDS_KEY_PREFIX}.${scopeFromHost(getServerUrl())}.${scopeFromHost(
        username,
    )}`;
}

function knownUsersKey(): string {
    return `${KNOWN_USERS_KEY_PREFIX}.${scopeFromHost(getServerUrl())}`;
}

function legacyCredsKey(): string {
    return `${CREDS_KEY_PREFIX}.${scopeFromHost(getServerUrl())}`;
}

async function readCredentialsForUser(
    username: string,
): Promise<null | StoredCredentials> {
    const raw = await SecureStore.getItemAsync(credsKeyForUser(username));
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
        if (
            typeof parsed.deviceID === "string" &&
            typeof parsed.deviceKey === "string" &&
            typeof parsed.username === "string"
        ) {
            return parsed as StoredCredentials;
        }
    } catch {
        // fall through to cleanup below
    }
    // Corrupted keystore payloads can happen on Android restore/migration.
    // Drop the bad slot so bootstrap can prompt a clean sign-in path.
    await SecureStore.deleteItemAsync(credsKeyForUser(username));
    await SecureStore.deleteItemAsync(userIDKeyForUser(username));
    await removeFromKnownUsers(username);
    const active = await loadActiveUsername();
    if (active === username) {
        await SecureStore.deleteItemAsync(activeUserKey());
    }
    return null;
}

async function readKnownUsers(): Promise<string[]> {
    const raw = await SecureStore.getItemAsync(knownUsersKey());
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (
            Array.isArray(parsed) &&
            parsed.every((item) => typeof item === "string")
        ) {
            return parsed;
        }
    } catch {
        /* fall through — corrupted index, treat as empty */
    }
    return [];
}

async function readLegacyCredentials(): Promise<null | StoredCredentials> {
    const raw = await SecureStore.getItemAsync(legacyCredsKey());
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw) as StoredCredentials;
    } catch {
        return null;
    }
}

async function readUserID(username: string): Promise<null | string> {
    const raw = await SecureStore.getItemAsync(userIDKeyForUser(username));
    return raw ?? null;
}

async function removeFromKnownUsers(username: string): Promise<void> {
    const users = await readKnownUsers();
    const next = users.filter((u) => u !== username);
    if (next.length === users.length) {
        return;
    }
    if (next.length === 0) {
        await SecureStore.deleteItemAsync(knownUsersKey());
        return;
    }
    await writeKnownUsers(next);
}

/**
 * Sanitize a host string into a stable identifier for scoping the
 * SecureStore key. expo-secure-store only allows [A-Za-z0-9._-]; strip
 * protocol and replace everything else with dashes.
 */
function scopeFromHost(host: string): string {
    return host
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-");
}

function userIDKeyForUser(username: string): string {
    return `${USER_ID_KEY_PREFIX}.${scopeFromHost(getServerUrl())}.${scopeFromHost(
        username,
    )}`;
}

async function writeKnownUsers(users: string[]): Promise<void> {
    await SecureStore.setItemAsync(knownUsersKey(), JSON.stringify(users));
}

/**
 * KeyStore adapter for expo-secure-store.
 * Uses iOS Keychain / Android Keystore under the hood.
 * Credentials are scoped by server host so switching between
 * prod/staging/local uses isolated slots.
 */
export const keychainKeyStore: KeyStore = {
    async clear(username: string): Promise<void> {
        await clearCredentials(username);
    },
    async load(username?: string): Promise<null | StoredCredentials> {
        return loadCredentials(username);
    },
    async save(creds: StoredCredentials): Promise<void> {
        await saveCredentials(creds);
    },
};

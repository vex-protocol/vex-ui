import type { KeyStore, StoredCredentials } from "@vex-chat/libvex";

import { xHash, XUtils } from "@vex-chat/crypto";
import { generateVexDbAtRestKey } from "@vex-chat/store";

import { deleteDB, openDB, type DBSchema } from "idb";

const VAULT_DATABASE = "vex-web-vault-v1";
const MASTER_KEY_ID = "origin-master-key";

interface AccountRecord {
    id: string;
    scope: string;
    updatedAt: string;
    username: string;
}

interface ActiveAccountRecord {
    scope: string;
    username: string;
}

interface BrowserVaultSchema extends DBSchema {
    accounts: {
        indexes: { scope: string };
        key: string;
        value: AccountRecord;
    };
    activeAccounts: {
        key: string;
        value: ActiveAccountRecord;
    };
    credentials: {
        key: string;
        value: VaultEnvelope;
    };
    keys: {
        key: string;
        value: CryptoKey;
    };
    secrets: {
        key: string;
        value: VaultEnvelope;
    };
}

interface VaultEnvelope {
    ciphertext: ArrayBuffer;
    iv: Uint8Array;
}

let vaultPromise: ReturnType<typeof openVault> | null = null;
let masterKeyPromise: Promise<CryptoKey> | null = null;

export interface BrowserAccount {
    updatedAt: string;
    username: string;
}

export interface BrowserKeyStore extends KeyStore {
    deactivate(scope?: string): Promise<void>;
    listAccounts(): Promise<BrowserAccount[]>;
    loadActive(): Promise<null | StoredCredentials>;
}

export function browserDatabaseName(scope: string, username: string): string {
    const digest = xHash(
        XUtils.decodeUTF8(`vex:web-db:v1\0${scope}\0${username}`),
    );
    return `vex-web-${digest.slice(0, 32)}`;
}

export function createBrowserKeyStore(getScope: () => string): BrowserKeyStore {
    return new EncryptedBrowserKeyStore(getScope);
}

export async function getBrowserDatabaseKey(
    scope: string,
    username: string,
): Promise<Uint8Array> {
    const id = accountID(scope, username);
    const vault = await getVault();
    const keyID = `database:${id}`;
    const existing = await vault.get("secrets", keyID);
    if (existing) {
        const decoded = await decryptJson<{ key: string }>(keyID, existing);
        const key = XUtils.decodeHex(decoded.key);
        if (key.length !== 32) {
            throw new Error("Stored browser database key is invalid.");
        }
        return key;
    }

    const key = generateVexDbAtRestKey();
    const envelope = await encryptJson(keyID, { key: XUtils.encodeHex(key) });
    const transaction = vault.transaction("secrets", "readwrite");
    const store = transaction.objectStore("secrets");
    const stored = await store.get(keyID);
    if (stored) {
        await transaction.done;
        const decoded = await decryptJson<{ key: string }>(keyID, stored);
        const storedKey = XUtils.decodeHex(decoded.key);
        if (storedKey.length !== 32) {
            throw new Error("Stored browser database key is invalid.");
        }
        return storedKey;
    }
    await store.add(envelope, keyID);
    await transaction.done;
    return key;
}

async function clearBrowserAccount(scope: string, username: string) {
    const vault = await getVault();
    const id = accountID(scope, username);
    const active = await vault.get("activeAccounts", scope);
    const tx = vault.transaction(
        ["accounts", "activeAccounts", "credentials", "secrets"],
        "readwrite",
    );
    await Promise.all([
        tx.objectStore("accounts").delete(id),
        tx.objectStore("credentials").delete(`credentials:${id}`),
        tx.objectStore("secrets").delete(`database:${id}`),
        ...(active?.username === username
            ? [tx.objectStore("activeAccounts").delete(scope)]
            : []),
    ]);
    await tx.done;
    await deleteDB(browserDatabaseName(scope, username));
}

class EncryptedBrowserKeyStore implements BrowserKeyStore {
    constructor(private readonly getScope: () => string) {}

    clear(username: string): Promise<void> {
        return clearBrowserAccount(this.scope(), normalizeUsername(username));
    }

    async deactivate(scope = this.scope()): Promise<void> {
        const vault = await getVault();
        await vault.delete("activeAccounts", normalizeScope(scope));
    }

    async listAccounts(): Promise<BrowserAccount[]> {
        const vault = await getVault();
        const records = await vault.getAllFromIndex(
            "accounts",
            "scope",
            this.scope(),
        );
        return records
            .map(({ updatedAt, username }) => ({ updatedAt, username }))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async load(username?: string): Promise<null | StoredCredentials> {
        const vault = await getVault();
        const scope = this.scope();
        const active = username
            ? normalizeUsername(username)
            : (await vault.get("activeAccounts", scope))?.username;
        if (!active) return null;
        const id = accountID(scope, active);
        const envelope = await vault.get("credentials", `credentials:${id}`);
        if (!envelope) return null;
        try {
            const credentials = await decryptJson<StoredCredentials>(
                `credentials:${id}`,
                envelope,
            );
            return isStoredCredentials(credentials) ? credentials : null;
        } catch {
            return null;
        }
    }

    loadActive(): Promise<null | StoredCredentials> {
        return this.load();
    }

    async save(credentials: StoredCredentials): Promise<void> {
        const scope = this.scope();
        const username = normalizeUsername(credentials.username);
        const normalized = { ...credentials, username };
        const id = accountID(scope, username);
        const vault = await getVault();
        const encryptedCredentials = await encryptJson(
            `credentials:${id}`,
            normalized,
        );
        const tx = vault.transaction(
            ["accounts", "activeAccounts", "credentials"],
            "readwrite",
        );
        await Promise.all([
            tx
                .objectStore("credentials")
                .put(encryptedCredentials, `credentials:${id}`),
            tx.objectStore("accounts").put({
                id,
                scope,
                updatedAt: new Date().toISOString(),
                username,
            }),
            tx.objectStore("activeAccounts").put({ scope, username }),
        ]);
        await tx.done;
    }

    private scope(): string {
        return normalizeScope(this.getScope());
    }
}

function accountID(scope: string, username: string): string {
    return `${normalizeScope(scope)}\0${normalizeUsername(username)}`;
}

async function decryptJson<T>(id: string, envelope: VaultEnvelope): Promise<T> {
    const key = await getMasterKey();
    const additionalData = arrayBuffer(XUtils.decodeUTF8(id));
    const iv = arrayBuffer(envelope.iv);
    const plaintext = await crypto.subtle.decrypt(
        {
            additionalData,
            iv,
            name: "AES-GCM",
        },
        key,
        envelope.ciphertext,
    );
    return JSON.parse(XUtils.encodeUTF8(new Uint8Array(plaintext))) as T;
}

async function encryptJson(id: string, value: unknown): Promise<VaultEnvelope> {
    const key = await getMasterKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const additionalData = arrayBuffer(XUtils.decodeUTF8(id));
    const plaintext = arrayBuffer(XUtils.decodeUTF8(JSON.stringify(value)));
    const ciphertext = await crypto.subtle.encrypt(
        {
            additionalData,
            iv: arrayBuffer(iv),
            name: "AES-GCM",
        },
        key,
        plaintext,
    );
    return { ciphertext, iv };
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
}

function getMasterKey(): Promise<CryptoKey> {
    masterKeyPromise ??= loadOrCreateMasterKey().catch((error: unknown) => {
        masterKeyPromise = null;
        throw error;
    });
    return masterKeyPromise;
}

async function loadOrCreateMasterKey(): Promise<CryptoKey> {
    const vault = await getVault();
    const existing = await vault.get("keys", MASTER_KEY_ID);
    if (existing) return existing;
    const generated = await crypto.subtle.generateKey(
        { length: 256, name: "AES-GCM" },
        false,
        ["decrypt", "encrypt"],
    );
    const transaction = vault.transaction("keys", "readwrite");
    const store = transaction.objectStore("keys");
    const stored = await store.get(MASTER_KEY_ID);
    if (stored) {
        await transaction.done;
        return stored;
    }
    await store.add(generated, MASTER_KEY_ID);
    await transaction.done;
    return generated;
}

function getVault() {
    vaultPromise ??= openVault();
    return vaultPromise;
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<StoredCredentials>;
    return (
        typeof candidate.deviceID === "string" &&
        typeof candidate.deviceKey === "string" &&
        typeof candidate.username === "string" &&
        (candidate.token === undefined || typeof candidate.token === "string")
    );
}

function normalizeScope(value: string): string {
    return value
        .trim()
        .replace(/^https?:\/\//iu, "")
        .replace(/\/+$/u, "")
        .toLowerCase();
}

function normalizeUsername(value: string): string {
    return value.trim().toLowerCase();
}

function openVault() {
    return openDB<BrowserVaultSchema>(VAULT_DATABASE, 1, {
        upgrade(database) {
            const accounts = database.createObjectStore("accounts", {
                keyPath: "id",
            });
            accounts.createIndex("scope", "scope");
            database.createObjectStore("activeAccounts", {
                keyPath: "scope",
            });
            database.createObjectStore("credentials");
            database.createObjectStore("keys");
            database.createObjectStore("secrets");
        },
    });
}

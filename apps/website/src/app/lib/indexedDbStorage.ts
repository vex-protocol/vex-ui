import type {
    Device,
    Message,
    MessageUpdatePatch,
    PreKeysCrypto,
    Session,
    SessionCrypto,
    Storage,
    UnsavedPreKey,
} from "@vex-chat/libvex";
import type { PreKeysSQL } from "@vex-chat/types";

import {
    xBoxKeyPairFromSecret,
    xHMAC,
    xMakeNonce,
    xSecretboxAsync,
    xSecretboxOpenAsync,
    XUtils,
} from "@vex-chat/crypto";
import { effectiveMessageRetentionHintDays } from "@vex-chat/libvex";

import EventEmitter from "eventemitter3";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface CipherRow {
    ciphertext: Uint8Array;
    id: string;
    nonce: Uint8Array;
}

interface MessageRow extends CipherRow {
    conversation: string;
    timestamp: string;
}

interface PreKeyRow extends CipherRow {
    kind: "one-time" | "signed";
}

interface SessionRow extends CipherRow {
    device: string;
    publicKey: string;
}

interface VexBrowserDatabase extends DBSchema {
    devices: {
        key: string;
        value: CipherRow;
    };
    messages: {
        indexes: { conversation: string; timestamp: string };
        key: string;
        value: MessageRow;
    };
    metadata: {
        key: string;
        value: CipherRow;
    };
    prekeys: {
        indexes: { kind: "one-time" | "signed" };
        key: string;
        value: PreKeyRow;
    };
    sessions: {
        indexes: { device: string; publicKey: string };
        key: string;
        value: SessionRow;
    };
}

interface StoredPreKey {
    index: number;
    privateKey: string;
    publicKey: string;
    signature: string;
}

interface SealedValue<T> {
    id: string;
    value: T;
}

export class IndexedDBStorage extends EventEmitter implements Storage {
    public ready = false;

    private database: IDBPDatabase<VexBrowserDatabase> | null = null;
    private readonly databaseName: string;
    private readonly encryptionKey: Uint8Array;

    constructor(databaseName: string, encryptionKey: Uint8Array) {
        super();
        if (encryptionKey.length !== 32) {
            throw new Error("IndexedDBStorage requires a 32-byte at-rest key.");
        }
        this.databaseName = databaseName;
        this.encryptionKey = new Uint8Array(encryptionKey);
    }

    close(): Promise<void> {
        this.database?.close();
        this.database = null;
        this.ready = false;
        return Promise.resolve();
    }

    async deleteHistory(channelOrUserID: string): Promise<void> {
        const database = this.requireDatabase();
        const conversation = this.lookup("conversation", channelOrUserID);
        const keys = await database.getAllKeysFromIndex(
            "messages",
            "conversation",
            conversation,
        );
        const transaction = database.transaction("messages", "readwrite");
        await Promise.all(
            keys.map((key) => transaction.objectStore("messages").delete(key)),
        );
        await transaction.done;
    }

    async deleteMessage(mailID: string): Promise<void> {
        await this.requireDatabase().delete(
            "messages",
            this.lookup("message", mailID),
        );
    }

    async deleteOneTimeKey(index: number): Promise<void> {
        await this.requireDatabase().delete(
            "prekeys",
            this.lookup("prekey:one-time", String(index)),
        );
    }

    async getAllSessions(): Promise<Session[]> {
        const rows = await this.requireDatabase().getAll("sessions");
        return Promise.all(rows.map((row) => this.open<Session>(row.id, row)));
    }

    async getDevice(deviceID: string): Promise<Device | null> {
        const id = this.lookup("device", deviceID);
        const row = await this.requireDatabase().get("devices", id);
        return row ? this.open<Device>(id, row) : null;
    }

    getGroupHistory(channelID: string): Promise<Message[]> {
        return this.getConversationHistory(channelID);
    }

    getMessageHistory(userID: string): Promise<Message[]> {
        return this.getConversationHistory(userID);
    }

    async getOneTimeKey(index: number): Promise<null | PreKeysCrypto> {
        const id = this.lookup("prekey:one-time", String(index));
        const row = await this.requireDatabase().get("prekeys", id);
        if (!row) return null;
        return this.storedPreKeyToCrypto(
            await this.open<StoredPreKey>(id, row),
        );
    }

    async getPreKeys(): Promise<null | PreKeysCrypto> {
        const rows = await this.requireDatabase().getAllFromIndex(
            "prekeys",
            "kind",
            "signed",
        );
        const row = rows[0];
        if (!row) return null;
        return this.storedPreKeyToCrypto(
            await this.open<StoredPreKey>(row.id, row),
        );
    }

    async getSessionByDeviceID(
        deviceID: string,
    ): Promise<null | SessionCrypto> {
        const rows = await this.requireDatabase().getAllFromIndex(
            "sessions",
            "device",
            this.lookup("session-device", deviceID),
        );
        if (rows.length === 0) return null;
        const sessions = await Promise.all(
            rows.map((row) => this.open<Session>(row.id, row)),
        );
        sessions.sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
        const session = sessions[0];
        return session ? this.sqlToCrypto(session) : null;
    }

    async getSessionByPublicKey(
        publicKey: Uint8Array,
    ): Promise<null | SessionCrypto> {
        const rows = await this.requireDatabase().getAllFromIndex(
            "sessions",
            "publicKey",
            this.lookup("session-public-key", XUtils.encodeHex(publicKey)),
        );
        const row = rows[0];
        if (!row) return null;
        return this.sqlToCrypto(await this.open<Session>(row.id, row));
    }

    async hasMessage(mailID: string): Promise<boolean> {
        return Boolean(
            await this.requireDatabase().getKey(
                "messages",
                this.lookup("message", mailID),
            ),
        );
    }

    async init(): Promise<void> {
        if (this.database) return;
        try {
            this.database = await openDB<VexBrowserDatabase>(
                this.databaseName,
                1,
                {
                    upgrade(database) {
                        database.createObjectStore("devices");
                        const messages = database.createObjectStore("messages");
                        messages.createIndex("conversation", "conversation");
                        messages.createIndex("timestamp", "timestamp");
                        database.createObjectStore("metadata");
                        const prekeys = database.createObjectStore("prekeys");
                        prekeys.createIndex("kind", "kind");
                        const sessions = database.createObjectStore("sessions");
                        sessions.createIndex("device", "device");
                        sessions.createIndex("publicKey", "publicKey");
                    },
                },
            );
            this.ready = true;
            this.emit("ready");
        } catch (error: unknown) {
            const normalized =
                error instanceof Error
                    ? error
                    : new Error("Could not open encrypted browser storage.");
            this.emit("error", normalized);
            throw normalized;
        }
    }

    async markSessionUsed(sessionID: string): Promise<void> {
        await this.updateSession(sessionID, (session) => ({
            ...session,
            lastUsed: new Date().toISOString(),
        }));
    }

    async markSessionVerified(sessionID: string): Promise<void> {
        await this.updateSession(sessionID, (session) => ({
            ...session,
            verified: true,
        }));
    }

    async pruneExpiredLocalMessages(
        clientMaxRetentionDays: number,
    ): Promise<void> {
        const database = this.requireDatabase();
        const rows = await database.getAll("messages");
        const cap = Math.min(
            30,
            Math.max(1, Math.round(clientMaxRetentionDays)),
        );
        const now = Date.now();
        const expired: string[] = [];
        await Promise.all(
            rows.map(async (row) => {
                const message = await this.open<Message>(row.id, row);
                const maxDays = Math.min(
                    30,
                    cap,
                    effectiveMessageRetentionHintDays(
                        message.retentionHintDays,
                    ),
                );
                const timestamp = new Date(message.timestamp).getTime();
                if (
                    Number.isFinite(timestamp) &&
                    now - timestamp > maxDays * 86_400_000
                ) {
                    expired.push(row.id);
                }
            }),
        );
        const transaction = database.transaction("messages", "readwrite");
        await Promise.all(
            expired.map((id) => transaction.objectStore("messages").delete(id)),
        );
        await transaction.done;
    }

    async purgeHistory(): Promise<void> {
        await this.requireDatabase().clear("messages");
    }

    async purgeKeyData(): Promise<void> {
        const database = this.requireDatabase();
        const transaction = database.transaction(
            ["messages", "metadata", "prekeys", "sessions"],
            "readwrite",
        );
        await Promise.all([
            transaction.objectStore("messages").clear(),
            transaction.objectStore("metadata").clear(),
            transaction.objectStore("prekeys").clear(),
            transaction.objectStore("sessions").clear(),
        ]);
        await transaction.done;
    }

    async saveDevice(device: Device): Promise<void> {
        const id = this.lookup("device", device.deviceID);
        await this.requireDatabase().put(
            "devices",
            await this.seal(id, device),
            id,
        );
    }

    async saveMessage(message: Message): Promise<void> {
        const id = this.lookup("message", message.mailID);
        const database = this.requireDatabase();
        if (await database.getKey("messages", id)) return;
        const row: MessageRow = {
            ...(await this.seal(id, message)),
            conversation: this.lookup(
                "conversation",
                message.group ||
                    (message.direction === "incoming"
                        ? message.authorID
                        : message.readerID),
            ),
            timestamp: message.timestamp,
        };
        await database.add("messages", row, id);
    }

    async savePreKeys(
        preKeys: UnsavedPreKey[],
        oneTime: boolean,
    ): Promise<PreKeysSQL[]> {
        const database = this.requireDatabase();
        const kind = oneTime ? "one-time" : "signed";
        let nextIndex = await this.readCounter(
            oneTime ? "next-one-time-index" : "next-signed-index",
        );
        const rows: PreKeyRow[] = [];
        const added: PreKeysSQL[] = [];
        for (const preKey of preKeys) {
            const index = nextIndex++;
            const stored: StoredPreKey = {
                index,
                privateKey: XUtils.encodeHex(preKey.keyPair.secretKey),
                publicKey: XUtils.encodeHex(preKey.keyPair.publicKey),
                signature: XUtils.encodeHex(preKey.signature),
            };
            const id = this.lookup(`prekey:${kind}`, String(index));
            rows.push({ ...(await this.seal(id, stored)), kind });
            added.push({
                deviceID: "",
                index,
                keyID: "",
                publicKey: stored.publicKey,
                signature: stored.signature,
                userID: "",
            });
        }
        const counterID = this.lookup("metadata", `next-${kind}-index`);
        const counterRow = await this.seal(counterID, nextIndex);
        const existingSignedKeys = oneTime
            ? []
            : await database.getAllKeysFromIndex("prekeys", "kind", "signed");
        const transaction = database.transaction(
            ["metadata", "prekeys"],
            "readwrite",
        );
        await Promise.all([
            ...existingSignedKeys.map((id) =>
                transaction.objectStore("prekeys").delete(id),
            ),
            ...rows.map((row) =>
                transaction.objectStore("prekeys").put(row, row.id),
            ),
            transaction.objectStore("metadata").put(counterRow, counterRow.id),
        ]);
        await transaction.done;
        return added;
    }

    async saveSession(session: Session): Promise<void> {
        const id = this.lookup("session", session.sessionID);
        const row: SessionRow = {
            ...(await this.seal(id, session)),
            device: this.lookup("session-device", session.deviceID),
            publicKey: this.lookup("session-public-key", session.publicKey),
        };
        await this.requireDatabase().put("sessions", row, id);
    }

    async updateMessage(
        mailID: string,
        patch: MessageUpdatePatch,
    ): Promise<boolean> {
        if (
            patch.message === undefined &&
            !Object.prototype.hasOwnProperty.call(patch, "extra")
        ) {
            return false;
        }
        const database = this.requireDatabase();
        const id = this.lookup("message", mailID);
        const row = await database.get("messages", id);
        if (!row) return false;
        const current = await this.open<Message>(id, row);
        const next = { ...current };
        if (Object.prototype.hasOwnProperty.call(patch, "extra")) {
            next.extra = patch.extra;
        }
        if (patch.message !== undefined) next.message = patch.message;
        await database.put(
            "messages",
            {
                ...(await this.seal(id, next)),
                conversation: row.conversation,
                timestamp: row.timestamp,
            },
            id,
        );
        return true;
    }

    private async getConversationHistory(
        conversationID: string,
    ): Promise<Message[]> {
        const rows = await this.requireDatabase().getAllFromIndex(
            "messages",
            "conversation",
            this.lookup("conversation", conversationID),
        );
        const messages = await Promise.all(
            rows.map((row) => this.open<Message>(row.id, row)),
        );
        return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    private lookup(namespace: string, value: string): string {
        return XUtils.encodeHex(
            xHMAC(["vex-web-storage-v1", namespace, value], this.encryptionKey),
        );
    }

    private async open<T>(id: string, row: CipherRow): Promise<T> {
        const plaintext = await xSecretboxOpenAsync(
            row.ciphertext,
            row.nonce,
            this.encryptionKey,
        );
        if (!plaintext) {
            throw new Error("Encrypted browser storage could not be verified.");
        }
        const decoded = JSON.parse(
            XUtils.encodeUTF8(plaintext),
        ) as SealedValue<T>;
        if (decoded.id !== id) {
            throw new Error("Encrypted browser storage record was misplaced.");
        }
        return decoded.value;
    }

    private async readCounter(name: string): Promise<number> {
        const id = this.lookup("metadata", name);
        const row = await this.requireDatabase().get("metadata", id);
        if (!row) return 1;
        const value = await this.open<number>(id, row);
        return Number.isSafeInteger(value) && value > 0 ? value : 1;
    }

    private requireDatabase(): IDBPDatabase<VexBrowserDatabase> {
        if (!this.database) {
            throw new Error("Encrypted browser storage is not initialized.");
        }
        return this.database;
    }

    private async seal<T>(id: string, value: T): Promise<CipherRow> {
        const nonce = xMakeNonce();
        const plaintext = XUtils.decodeUTF8(JSON.stringify({ id, value }));
        return {
            ciphertext: await xSecretboxAsync(
                plaintext,
                nonce,
                this.encryptionKey,
            ),
            id,
            nonce,
        };
    }

    private sqlToCrypto(session: Session): SessionCrypto {
        let skippedKeys: Record<string, string> = {};
        try {
            skippedKeys = JSON.parse(session.skippedKeys) as Record<
                string,
                string
            >;
        } catch {
            skippedKeys = {};
        }
        return {
            CKr: session.CKr ? XUtils.decodeHex(session.CKr) : null,
            CKs: session.CKs ? XUtils.decodeHex(session.CKs) : null,
            DHr: session.DHr ? XUtils.decodeHex(session.DHr) : null,
            DHsPrivate: XUtils.decodeHex(session.DHsPrivate),
            DHsPublic: XUtils.decodeHex(session.DHsPublic),
            fingerprint: XUtils.decodeHex(session.fingerprint),
            lastUsed: session.lastUsed,
            mode: session.mode,
            Nr: session.Nr,
            Ns: session.Ns,
            PN: session.PN,
            publicKey: XUtils.decodeHex(session.publicKey),
            RK: XUtils.decodeHex(session.RK),
            sessionID: session.sessionID,
            SK: XUtils.decodeHex(session.SK),
            skippedKeys,
            userID: session.userID,
            verified: session.verified,
        };
    }

    private storedPreKeyToCrypto(preKey: StoredPreKey): Promise<PreKeysCrypto> {
        return Promise.resolve({
            index: preKey.index,
            keyPair: xBoxKeyPairFromSecret(XUtils.decodeHex(preKey.privateKey)),
            signature: XUtils.decodeHex(preKey.signature),
        });
    }

    private async updateSession(
        sessionID: string,
        update: (session: Session) => Session,
    ): Promise<void> {
        const database = this.requireDatabase();
        const id = this.lookup("session", sessionID);
        const row = await database.get("sessions", id);
        if (!row) return;
        const session = update(await this.open<Session>(id, row));
        await database.put(
            "sessions",
            {
                ...(await this.seal(id, session)),
                device: row.device,
                publicKey: row.publicKey,
            },
            id,
        );
    }
}

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
    getCryptoProfile,
    xBoxKeyPairFromSecret,
    xBoxKeyPairFromSecretAsync,
    xSecretbox,
    xSecretboxAsync,
    xSecretboxOpen,
    xSecretboxOpenAsync,
    XUtils,
} from "@vex-chat/crypto";
import { effectiveMessageRetentionHintDays } from "@vex-chat/libvex";

import { EventEmitter } from "eventemitter3";

interface StoredPreKey {
    index: number;
    privateKey: string;
    publicKey: string;
    signature: string;
}

/**
 * Browser-only storage for desktop Vite mode.
 *
 * Tauri keeps using SQLite. This fallback exists so the desktop frontend can
 * run against local Spire in a plain browser while testing mobile/desktop
 * voice calls.
 */
export class MemoryStorage extends EventEmitter implements Storage {
    public ready = false;

    private readonly atRestAesKey: Uint8Array;
    private readonly devices: Device[] = [];
    private messages: Message[] = [];
    private nextOtkIndex = 1;
    private nextPreKeyIndex = 1;
    private oneTimeKeys: StoredPreKey[] = [];
    private preKeys: StoredPreKey[] = [];
    private sessions: Session[] = [];

    constructor(atRestAesKey: Uint8Array) {
        super();
        if (atRestAesKey.length !== 32) {
            throw new Error("MemoryStorage requires a 32-byte at-rest key.");
        }
        this.atRestAesKey = atRestAesKey;
    }

    close(): Promise<void> {
        return Promise.resolve();
    }

    deleteHistory(channelOrUserID: string): Promise<void> {
        this.messages = this.messages.filter(
            (message) =>
                message.group !== channelOrUserID &&
                message.authorID !== channelOrUserID &&
                message.readerID !== channelOrUserID,
        );
        return Promise.resolve();
    }

    deleteMessage(mailID: string): Promise<void> {
        this.messages = this.messages.filter(
            (message) => message.mailID !== mailID,
        );
        return Promise.resolve();
    }

    deleteOneTimeKey(index: number): Promise<void> {
        this.oneTimeKeys = this.oneTimeKeys.filter(
            (key) => key.index !== index,
        );
        return Promise.resolve();
    }

    getAllSessions(): Promise<Session[]> {
        return Promise.resolve(
            this.sessions.map((session) => ({ ...session })),
        );
    }

    getDevice(deviceID: string): Promise<Device | null> {
        return Promise.resolve(
            this.devices.find((device) => device.deviceID === deviceID) ?? null,
        );
    }

    async getGroupHistory(channelID: string): Promise<Message[]> {
        const rows = this.messages.filter(
            (message) => message.group === channelID,
        );
        return Promise.all(rows.map((message) => this.decryptMessage(message)));
    }

    async getMessageHistory(userID: string): Promise<Message[]> {
        const rows = this.messages.filter(
            (message) =>
                (message.direction === "incoming" &&
                    message.authorID === userID &&
                    !message.group) ||
                (message.direction === "outgoing" &&
                    message.readerID === userID &&
                    !message.group),
        );
        return Promise.all(rows.map((message) => this.decryptMessage(message)));
    }

    async getOneTimeKey(index: number): Promise<null | PreKeysCrypto> {
        const otk = this.oneTimeKeys.find((key) => key.index === index);
        if (!otk) return null;
        return this.storedPreKeyToCrypto(otk);
    }

    async getPreKeys(): Promise<null | PreKeysCrypto> {
        const preKey = this.preKeys[0];
        if (!preKey) return null;
        return this.storedPreKeyToCrypto(preKey);
    }

    getSessionByDeviceID(deviceID: string): Promise<null | SessionCrypto> {
        const session = this.sessions.find((s) => s.deviceID === deviceID);
        if (!session) return Promise.resolve(null);
        return Promise.resolve(this.sqlToCrypto(session));
    }

    getSessionByPublicKey(
        publicKey: Uint8Array,
    ): Promise<null | SessionCrypto> {
        const hex = XUtils.encodeHex(publicKey);
        const session = this.sessions.find((s) => s.publicKey === hex);
        if (!session) return Promise.resolve(null);
        return Promise.resolve(this.sqlToCrypto(session));
    }

    hasMessage(mailID: string): Promise<boolean> {
        return Promise.resolve(
            this.messages.some((message) => message.mailID === mailID),
        );
    }

    init(): Promise<void> {
        this.ready = true;
        this.emit("ready");
        return Promise.resolve();
    }

    markSessionUsed(sessionID: string): Promise<void> {
        const session = this.sessions.find((s) => s.sessionID === sessionID);
        if (session) session.lastUsed = new Date().toISOString();
        return Promise.resolve();
    }

    markSessionVerified(sessionID: string): Promise<void> {
        const session = this.sessions.find((s) => s.sessionID === sessionID);
        if (session) session.verified = true;
        return Promise.resolve();
    }

    pruneExpiredLocalMessages(clientMaxRetentionDays: number): Promise<void> {
        const cap = Math.min(
            30,
            Math.max(1, Math.round(clientMaxRetentionDays)),
        );
        const now = Date.now();
        const msPerDay = 86_400_000;
        this.messages = this.messages.filter((message) => {
            const maxDays = Math.min(
                30,
                cap,
                effectiveMessageRetentionHintDays(message.retentionHintDays),
            );
            const timestamp = new Date(message.timestamp).getTime();
            if (!Number.isFinite(timestamp)) return true;
            return now - timestamp <= maxDays * msPerDay;
        });
        return Promise.resolve();
    }

    purgeHistory(): Promise<void> {
        this.messages = [];
        return Promise.resolve();
    }

    purgeKeyData(): Promise<void> {
        this.sessions = [];
        this.preKeys = [];
        this.oneTimeKeys = [];
        this.messages = [];
        return Promise.resolve();
    }

    saveDevice(device: Device): Promise<void> {
        const existingIndex = this.devices.findIndex(
            (stored) => stored.deviceID === device.deviceID,
        );
        if (existingIndex >= 0) {
            this.devices[existingIndex] = device;
        } else {
            this.devices.push(device);
        }
        return Promise.resolve();
    }

    async saveMessage(message: Message): Promise<void> {
        if (this.messages.some((stored) => stored.mailID === message.mailID)) {
            return;
        }
        const copy = { ...message };
        const encrypted = await this.encryptUtf8(
            message.message,
            XUtils.decodeHex(message.nonce),
        );
        copy.message = XUtils.encodeHex(encrypted);
        this.messages.push(copy);
    }

    savePreKeys(
        preKeys: UnsavedPreKey[],
        oneTime: boolean,
    ): Promise<PreKeysSQL[]> {
        if (!oneTime) {
            this.preKeys = [];
        }
        const added: PreKeysSQL[] = [];
        for (const preKey of preKeys) {
            const index = oneTime
                ? this.nextOtkIndex++
                : this.nextPreKeyIndex++;
            const row: StoredPreKey = {
                index,
                privateKey: XUtils.encodeHex(preKey.keyPair.secretKey),
                publicKey: XUtils.encodeHex(preKey.keyPair.publicKey),
                signature: XUtils.encodeHex(preKey.signature),
            };
            if (oneTime) {
                this.oneTimeKeys.push(row);
            } else {
                this.preKeys.push(row);
            }
            added.push({
                deviceID: "",
                index,
                keyID: "",
                publicKey: row.publicKey,
                signature: row.signature,
                userID: "",
            });
        }
        return Promise.resolve(added);
    }

    saveSession(session: Session): Promise<void> {
        const index = this.sessions.findIndex(
            (stored) => stored.sessionID === session.sessionID,
        );
        if (index >= 0) {
            this.sessions[index] = session;
        } else {
            this.sessions.push(session);
        }
        return Promise.resolve();
    }

    async updateMessage(
        mailID: string,
        patch: MessageUpdatePatch,
    ): Promise<boolean> {
        const index = this.messages.findIndex(
            (message) => message.mailID === mailID,
        );
        if (index < 0) return false;
        if (
            patch.message === undefined &&
            !Object.prototype.hasOwnProperty.call(patch, "extra")
        ) {
            return false;
        }

        const current = this.messages[index];
        if (!current) return false;
        const next = { ...current };
        if (Object.prototype.hasOwnProperty.call(patch, "extra")) {
            next.extra = patch.extra;
        }
        if (patch.message !== undefined) {
            const encrypted = await this.encryptUtf8(
                patch.message,
                XUtils.decodeHex(current.nonce),
            );
            next.message = XUtils.encodeHex(encrypted);
        }
        this.messages[index] = next;
        return true;
    }

    private async decryptMessage(message: Message): Promise<Message> {
        const copy = { ...message };
        if (!copy.decrypted) {
            return copy;
        }
        const encrypted = XUtils.decodeHex(copy.message);
        const nonce = XUtils.decodeHex(copy.nonce);
        const decrypted =
            getCryptoProfile() === "fips"
                ? await xSecretboxOpenAsync(encrypted, nonce, this.atRestAesKey)
                : xSecretboxOpen(encrypted, nonce, this.atRestAesKey);
        if (decrypted) {
            copy.message = XUtils.encodeUTF8(decrypted);
        }
        return copy;
    }

    private encryptUtf8(
        plaintext: string,
        nonce: Uint8Array,
    ): Promise<Uint8Array> {
        const bytes = XUtils.decodeUTF8(plaintext);
        if (getCryptoProfile() === "fips") {
            return xSecretboxAsync(bytes, nonce, this.atRestAesKey);
        }
        return Promise.resolve(xSecretbox(bytes, nonce, this.atRestAesKey));
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

    private async storedPreKeyToCrypto(
        preKey: StoredPreKey,
    ): Promise<PreKeysCrypto> {
        const secret = XUtils.decodeHex(preKey.privateKey);
        return {
            index: preKey.index,
            keyPair:
                getCryptoProfile() === "fips"
                    ? await xBoxKeyPairFromSecretAsync(secret)
                    : xBoxKeyPairFromSecret(secret),
            signature: XUtils.decodeHex(preKey.signature),
        };
    }
}

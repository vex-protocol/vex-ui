import type { ClientDatabase } from "@vex-chat/libvex/storage/schema";
import type { Kysely, Transaction } from "kysely";

import {
    xMakeNonce,
    xRandomBytes,
    xSecretboxAsync,
    xSecretboxOpenAsync,
    XUtils,
} from "@vex-chat/crypto";

type MigrationExecutor = Kysely<ClientDatabase> | Transaction<ClientDatabase>;

export function decodeVexDbAtRestKey(hex: string): Uint8Array {
    const key = decodeHex(hex);
    if (key.length !== 32) {
        throw new Error("Stored Vex DB key is not 32 bytes.");
    }
    return key;
}

export function deriveLegacyMobileAtRestAesKey(
    privateKeyHex: string,
): Uint8Array {
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

export function encodeVexDbAtRestKey(key: Uint8Array): string {
    if (key.length !== 32) {
        throw new Error("Vex DB at-rest key must be 32 bytes.");
    }
    return XUtils.encodeHex(key);
}

export function generateVexDbAtRestKey(): Uint8Array {
    return xRandomBytes(32);
}

export async function rewrapVexSqliteAtRestKey(
    db: Kysely<ClientDatabase>,
    oldKey: Uint8Array,
    newKey: Uint8Array,
): Promise<void> {
    await db.transaction().execute(async (trx) => {
        await rewrapPreKeyTable(trx, "preKeys", oldKey, newKey);
        await rewrapPreKeyTable(trx, "oneTimeKeys", oldKey, newKey);
        await rewrapSessions(trx, oldKey, newKey);
        await rewrapMessages(trx, oldKey, newKey);
        await verifyPreKeyTable(trx, "preKeys", newKey);
        await verifyPreKeyTable(trx, "oneTimeKeys", newKey);
        await verifySessions(trx, newKey);
        await verifyMessages(trx, newKey);
    });
}

function decodeHex(hex: string): Uint8Array {
    const normalized = hex.trim().toLowerCase();
    if (normalized.length % 2 !== 0 || /[^0-9a-f]/u.test(normalized)) {
        throw new Error("Expected an even-length hex string.");
    }
    const out = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        const start = i * 2;
        out[i] = Number.parseInt(normalized.slice(start, start + 2), 16);
    }
    return out;
}

async function openMessage(
    ciphertextHex: string,
    nonceHex: string,
    key: Uint8Array,
): Promise<Uint8Array> {
    const plaintext = await xSecretboxOpenAsync(
        XUtils.decodeHex(ciphertextHex),
        XUtils.decodeHex(nonceHex),
        key,
    );
    if (!plaintext) {
        throw new Error("Failed to decrypt message during DB key migration.");
    }
    return plaintext;
}

async function rewrapMessages(
    db: MigrationExecutor,
    oldKey: Uint8Array,
    newKey: Uint8Array,
): Promise<void> {
    const rows = await db
        .selectFrom("messages")
        .select(["decrypted", "message", "nonce"])
        .where("decrypted", "!=", 0)
        .execute();

    for (const row of rows) {
        const plaintext = await openMessage(row.message, row.nonce, oldKey);
        await db
            .updateTable("messages")
            .set({ message: await sealMessage(plaintext, row.nonce, newKey) })
            .where("nonce", "=", row.nonce)
            .execute();
    }
}

async function rewrapPreKeyTable(
    db: MigrationExecutor,
    table: "oneTimeKeys" | "preKeys",
    oldKey: Uint8Array,
    newKey: Uint8Array,
): Promise<void> {
    const rows = await db
        .selectFrom(table)
        .select(["index", "privateKey"])
        .execute();

    for (const row of rows) {
        await db
            .updateTable(table)
            .set({
                privateKey: await rewrapSealedHex(
                    row.privateKey,
                    oldKey,
                    newKey,
                ),
            })
            .where("index", "=", row.index)
            .execute();
    }
}

async function rewrapSealedHex(
    sealedHex: string,
    oldKey: Uint8Array,
    newKey: Uint8Array,
): Promise<string> {
    const plaintextHex = await unsealHex(sealedHex, oldKey);
    return sealHex(plaintextHex, newKey);
}

async function rewrapSessions(
    db: MigrationExecutor,
    oldKey: Uint8Array,
    newKey: Uint8Array,
): Promise<void> {
    const rows = await db
        .selectFrom("sessions")
        .select(["CKr", "CKs", "DHsPrivate", "RK", "SK", "sessionID"])
        .execute();

    for (const row of rows) {
        const rawSK = await unsealHex(row.SK, oldKey);
        const sealedSK = await sealHex(rawSK, newKey);
        await db
            .updateTable("sessions")
            .set({
                CKr: row.CKr
                    ? await rewrapSealedHex(row.CKr, oldKey, newKey)
                    : null,
                CKs: row.CKs
                    ? await rewrapSealedHex(row.CKs, oldKey, newKey)
                    : null,
                DHsPrivate: row.DHsPrivate
                    ? await rewrapSealedHex(row.DHsPrivate, oldKey, newKey)
                    : sealedSK,
                RK: row.RK
                    ? await rewrapSealedHex(row.RK, oldKey, newKey)
                    : sealedSK,
                SK: sealedSK,
            })
            .where("sessionID", "=", row.sessionID)
            .execute();
    }
}

async function sealHex(plainHex: string, key: Uint8Array): Promise<string> {
    const nonce = xMakeNonce();
    const ct = await xSecretboxAsync(XUtils.decodeHex(plainHex), nonce, key);
    const sealed = new Uint8Array(nonce.length + ct.length);
    sealed.set(nonce);
    sealed.set(ct, nonce.length);
    return XUtils.encodeHex(sealed);
}

async function sealMessage(
    plaintext: Uint8Array,
    nonceHex: string,
    key: Uint8Array,
): Promise<string> {
    const nonce = XUtils.decodeHex(nonceHex);
    const ct = await xSecretboxAsync(plaintext, nonce, key);
    return XUtils.encodeHex(ct);
}

async function unsealHex(sealedHex: string, key: Uint8Array): Promise<string> {
    const sealed = XUtils.decodeHex(sealedHex);
    const nonce = sealed.slice(0, 24);
    const ct = sealed.slice(24);
    const plaintext = await xSecretboxOpenAsync(ct, nonce, key);
    if (!plaintext) {
        throw new Error(
            "Failed to decrypt sealed value during DB key migration.",
        );
    }
    return XUtils.encodeHex(plaintext);
}

async function verifyMessages(
    db: MigrationExecutor,
    key: Uint8Array,
): Promise<void> {
    const rows = await db
        .selectFrom("messages")
        .select(["decrypted", "message", "nonce"])
        .where("decrypted", "!=", 0)
        .execute();

    for (const row of rows) {
        await openMessage(row.message, row.nonce, key);
    }
}

async function verifyPreKeyTable(
    db: MigrationExecutor,
    table: "oneTimeKeys" | "preKeys",
    key: Uint8Array,
): Promise<void> {
    const rows = await db.selectFrom(table).select("privateKey").execute();

    for (const row of rows) {
        await unsealHex(row.privateKey, key);
    }
}

async function verifySessions(
    db: MigrationExecutor,
    key: Uint8Array,
): Promise<void> {
    const rows = await db
        .selectFrom("sessions")
        .select(["CKr", "CKs", "DHsPrivate", "RK", "SK"])
        .execute();

    for (const row of rows) {
        if (row.CKr) {
            await unsealHex(row.CKr, key);
        }
        if (row.CKs) {
            await unsealHex(row.CKs, key);
        }
        await unsealHex(row.DHsPrivate, key);
        await unsealHex(row.RK, key);
        await unsealHex(row.SK, key);
    }
}

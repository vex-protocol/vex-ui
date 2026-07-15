/**
 * Mobile (Expo / React Native) platform configuration.
 *
 * Each account database gets an independent random key stored by
 * expo-secure-store. The device identity key is never reused as a database
 * encryption key.
 */
import type { Storage } from "@vex-chat/libvex";
import type { ClientDatabase } from "@vex-chat/libvex/storage/schema";
import type { BootstrapConfig } from "@vex-chat/store";

import { Platform } from "react-native";

import {
    decodeVexDbAtRestKey,
    encodeVexDbAtRestKey,
    generateVexDbAtRestKey,
} from "@vex-chat/store";

import * as SecureStore from "expo-secure-store";

import { getServerUrl } from "./config";

const DB_KEY_PREFIX = "vex-db-key";

export async function clearLocalDatabaseKeyMaterial(
    username: string,
): Promise<void> {
    await SecureStore.deleteItemAsync(dbKeyKey(username));
}

export function mobileConfig(): BootstrapConfig {
    return {
        async createStorage(
            _privateKey: string,
            username: string,
        ): Promise<Storage> {
            const { Kysely } = await import("kysely");
            const { ExpoDialect } = await import("kysely-expo");
            const { SqliteStorage } =
                await import("@vex-chat/libvex/storage/sqlite");

            const db = new Kysely<ClientDatabase>({
                dialect: new ExpoDialect({ database: scopedDbName(username) }),
            });
            const storage = new SqliteStorage(
                db,
                await resolveAtRestAesKey(username),
            );
            await storage.init();
            return storage;
        },
        deviceName: Platform.OS,
    };
}

function dbKeyKey(username: string): string {
    return `${DB_KEY_PREFIX}.${sanitize(getServerUrl())}.${sanitize(username)}`;
}

async function readStoredDbKey(username: string): Promise<null | Uint8Array> {
    const raw = await SecureStore.getItemAsync(dbKeyKey(username));
    if (!raw) return null;
    try {
        return decodeVexDbAtRestKey(raw);
    } catch (err: unknown) {
        console.error("[vex-mobile] stored DB key is invalid", err);
        throw new Error("Stored local database key is invalid.");
    }
}

async function resolveAtRestAesKey(username: string): Promise<Uint8Array> {
    const stored = await readStoredDbKey(username);
    if (stored) return stored;

    const key = generateVexDbAtRestKey();
    await SecureStore.setItemAsync(
        dbKeyKey(username),
        encodeVexDbAtRestKey(key),
    );
    return key;
}

function sanitize(value: string): string {
    return value
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-");
}

function scopedDbName(username: string): string {
    return `vex-client.${sanitize(getServerUrl())}.${sanitize(username)}.db`;
}

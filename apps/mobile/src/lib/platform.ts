/**
 * Mobile (Expo / React Native) platform configuration.
 *
 * Constructs a BootstrapConfig for the Vex store using:
 * - Storage:   Kysely + kysely-expo + expo-sqlite
 * - deviceName: Platform.OS
 */
import type { Storage } from "@vex-chat/libvex";
import type { ClientDatabase } from "@vex-chat/libvex/storage/schema";
import type { BootstrapConfig } from "@vex-chat/store";
import type { Kysely } from "kysely";

import { Platform } from "react-native";

import {
    decodeVexDbAtRestKey,
    deriveLegacyMobileAtRestAesKey,
    encodeVexDbAtRestKey,
    generateVexDbAtRestKey,
    rewrapVexSqliteAtRestKey,
} from "@vex-chat/store";

import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { defaultDatabaseDirectory } from "expo-sqlite";

import { getServerUrl } from "./config";

const DB_KEY_PREFIX = "vex-db-key";
const DB_KEY_MIGRATION_PREFIX = "vex-db-key-migration";

interface DbBackupFile {
    backupUri: string;
    existed: boolean;
    sourceUri: string;
}

interface DbKeyMigrationJournal {
    backupFiles: DbBackupFile[];
    dbKeyHex: string;
    dbName: string;
    startedAt: string;
    username: string;
    version: 1;
}

export function mobileConfig(): BootstrapConfig {
    return {
        async createStorage(
            privateKey: string,
            username: string,
        ): Promise<Storage> {
            await recoverPendingDbKeyMigration(username);

            const { Kysely } = await import("kysely");
            const { ExpoDialect } = await import("kysely-expo");
            const { SqliteStorage } =
                await import("@vex-chat/libvex/storage/sqlite");

            const dbName = scopedDbName(username);
            const db = new Kysely<ClientDatabase>({
                dialect: new ExpoDialect({ database: dbName }),
            });
            const atRestAes = await resolveAtRestAesKey({
                db,
                dbName,
                privateKey,
                SqliteStorage,
                username,
            });
            const storage = new SqliteStorage(db, atRestAes);
            await storage.init();
            await applyLibvex6RatchetMigration(dbName, db, username);
            return storage;
        },
        deviceName: Platform.OS,
    };
}

async function applyLibvex6RatchetMigration(
    dbName: string,
    db: Pick<Kysely<ClientDatabase>, "deleteFrom">,
    username: string,
): Promise<void> {
    const key = libv6MigrationKey(username);
    const already = await SecureStore.getItemAsync(key);
    if (already === "1") {
        return;
    }
    // libvex 6 ratchet rollout: force fresh device sessions once per account/server.
    await db.deleteFrom("sessions").execute();
    await SecureStore.setItemAsync(key, "1");
    console.info("[vex-mobile] applied libvex6 session migration", {
        dbName,
        username,
    });
}

async function backupDatabaseFiles(
    dbName: string,
    username: string,
): Promise<DbBackupFile[]> {
    const documentDirectory = FileSystem.documentDirectory;
    if (!documentDirectory) {
        throw new Error("File system document directory is unavailable.");
    }

    if (typeof defaultDatabaseDirectory !== "string") {
        throw new Error("SQLite database directory is unavailable.");
    }

    const sqliteDir = toFileUri(defaultDatabaseDirectory);
    const sourceUris = [
        joinUriPath(sqliteDir, dbName),
        joinUriPath(sqliteDir, `${dbName}-wal`),
        joinUriPath(sqliteDir, `${dbName}-shm`),
    ];
    const backupDir =
        `${documentDirectory}vex-db-backups/` +
        `${sanitize(getServerUrl())}.${sanitize(username)}.${Date.now()}/`;
    await FileSystem.makeDirectoryAsync(backupDir, { intermediates: true });

    const files: DbBackupFile[] = [];
    for (const sourceUri of sourceUris) {
        const fileName = sourceUri.slice(sourceUri.lastIndexOf("/") + 1);
        const backupUri = `${backupDir}${fileName}`;
        const info = await FileSystem.getInfoAsync(sourceUri);
        files.push({ backupUri, existed: info.exists, sourceUri });
        if (!info.exists) {
            continue;
        }
        await FileSystem.copyAsync({ from: sourceUri, to: backupUri });
    }
    return files;
}

async function cleanupMigrationBackups(files: DbBackupFile[]): Promise<void> {
    if (files.length === 0) {
        return;
    }
    try {
        await deleteMigrationBackups(files);
    } catch (err: unknown) {
        console.warn(
            "[vex-mobile] failed to delete DB key migration backups",
            err,
        );
    }
}

function dbKeyKey(username: string): string {
    return `${DB_KEY_PREFIX}.${sanitize(getServerUrl())}.${sanitize(username)}`;
}

function dbKeyMigrationKey(username: string): string {
    return `${DB_KEY_MIGRATION_PREFIX}.${sanitize(getServerUrl())}.${sanitize(
        username,
    )}`;
}

function decodeDbKey(hex: string): Uint8Array {
    return decodeVexDbAtRestKey(hex);
}

async function deleteMigrationBackups(files: DbBackupFile[]): Promise<void> {
    const backupDirs = [
        ...new Set(files.map((file) => parentUri(file.backupUri))),
    ];
    const [backupDir] = backupDirs;
    if (backupDir && backupDirs.length === 1) {
        await FileSystem.deleteAsync(backupDir, { idempotent: true });
        return;
    }

    for (const file of files) {
        await FileSystem.deleteAsync(file.backupUri, { idempotent: true });
    }
}

function isDbBackupFile(value: unknown): value is DbBackupFile {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as Partial<DbBackupFile>;
    return (
        typeof candidate.backupUri === "string" &&
        typeof candidate.existed === "boolean" &&
        typeof candidate.sourceUri === "string"
    );
}

function joinUriPath(dir: string, fileName: string): string {
    return `${dir.replace(/\/+$/, "")}/${fileName.replace(/^\/+/, "")}`;
}

function libv6MigrationKey(username: string): string {
    return `vex-libvex6-migrated.${sanitize(getServerUrl())}.${sanitize(username)}`;
}

function parentUri(uri: string): string {
    const normalized = uri.replace(/\/+$/, "");
    const slash = normalized.lastIndexOf("/");
    if (slash < 0) {
        return uri;
    }
    return normalized.slice(0, slash + 1);
}

async function readMigrationJournal(
    username: string,
): Promise<DbKeyMigrationJournal | null> {
    const raw = await SecureStore.getItemAsync(dbKeyMigrationKey(username));
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<DbKeyMigrationJournal>;
        if (
            parsed.version === 1 &&
            typeof parsed.dbKeyHex === "string" &&
            typeof parsed.dbName === "string" &&
            typeof parsed.startedAt === "string" &&
            typeof parsed.username === "string" &&
            Array.isArray(parsed.backupFiles) &&
            parsed.backupFiles.every(isDbBackupFile)
        ) {
            return parsed as DbKeyMigrationJournal;
        }
    } catch (err: unknown) {
        console.error(
            "[vex-mobile] DB key migration journal is unreadable",
            err,
        );
        throw new Error(
            "Stored local DB migration journal is unreadable; aborting recovery.",
        );
    }
    console.error("[vex-mobile] DB key migration journal is invalid");
    throw new Error(
        "Stored local DB migration journal is invalid; aborting recovery.",
    );
}

async function readStoredDbKey(username: string): Promise<null | Uint8Array> {
    const raw = await SecureStore.getItemAsync(dbKeyKey(username));
    if (!raw) {
        return null;
    }
    try {
        return decodeDbKey(raw);
    } catch (err: unknown) {
        console.error("[vex-mobile] stored DB key is invalid", err);
        throw new Error("Stored local DB key is invalid; aborting migration.");
    }
}

async function recoverPendingDbKeyMigration(username: string): Promise<void> {
    const journal = await readMigrationJournal(username);
    if (!journal) {
        return;
    }

    const storedDbKey = await readStoredDbKey(username);
    if (storedDbKey) {
        await cleanupMigrationBackups(journal.backupFiles);
        await SecureStore.deleteItemAsync(dbKeyMigrationKey(username));
        return;
    }

    await restoreDatabaseBackup(journal.backupFiles);
    await SecureStore.deleteItemAsync(dbKeyMigrationKey(username));
    await SecureStore.deleteItemAsync(dbKeyKey(username));
    console.warn("[vex-mobile] recovered interrupted DB key migration", {
        dbName: journal.dbName,
        username,
    });
}

async function resolveAtRestAesKey({
    db,
    dbName,
    privateKey,
    SqliteStorage,
    username,
}: {
    db: Kysely<ClientDatabase>;
    dbName: string;
    privateKey: string;
    SqliteStorage: new (
        db: Kysely<ClientDatabase>,
        atRestAesKey: Uint8Array,
    ) => Storage;
    username: string;
}): Promise<Uint8Array> {
    const storedDbKey = await readStoredDbKey(username);
    if (storedDbKey) {
        return storedDbKey;
    }

    const legacyKey = deriveLegacyMobileAtRestAesKey(privateKey);
    const legacyStorage = new SqliteStorage(db, legacyKey);
    await legacyStorage.init();

    const nextKey = generateVexDbAtRestKey();
    let backupFiles: DbBackupFile[] = [];
    let journal: DbKeyMigrationJournal;
    try {
        backupFiles = await backupDatabaseFiles(dbName, username);
        journal = {
            backupFiles,
            dbKeyHex: encodeVexDbAtRestKey(nextKey),
            dbName,
            startedAt: new Date().toISOString(),
            username,
            version: 1,
        };
        await SecureStore.setItemAsync(
            dbKeyMigrationKey(username),
            JSON.stringify(journal),
        );
    } catch (err: unknown) {
        await cleanupMigrationBackups(backupFiles);
        console.warn(
            "[vex-mobile] DB key migration setup failed; using legacy key",
            err,
        );
        return legacyKey;
    }

    try {
        await rewrapVexSqliteAtRestKey(db, legacyKey, nextKey);
    } catch (err: unknown) {
        try {
            await SecureStore.deleteItemAsync(dbKeyMigrationKey(username));
        } catch (cleanupErr: unknown) {
            console.warn(
                "[vex-mobile] failed to clear DB key migration journal after rollback",
                cleanupErr,
            );
        }
        console.warn(
            "[vex-mobile] DB key migration failed before commit; using legacy key",
            err,
        );
        await cleanupMigrationBackups(journal.backupFiles);
        return legacyKey;
    }

    try {
        await SecureStore.setItemAsync(dbKeyKey(username), journal.dbKeyHex);
    } catch (err: unknown) {
        console.error(
            "[vex-mobile] DB key migration committed but SecureStore save failed; backup journal kept for restart recovery",
            err,
        );
        throw new Error(
            "Local DB key migration needs recovery. Restart Vex and try again.",
        );
    }

    await cleanupMigrationBackups(journal.backupFiles);
    try {
        await SecureStore.deleteItemAsync(dbKeyMigrationKey(username));
    } catch (err: unknown) {
        console.warn(
            "[vex-mobile] DB key migration completed; journal cleanup will retry on next start",
            err,
        );
    }

    console.info("[vex-mobile] migrated DB at-rest key", {
        dbName,
        username,
    });
    return nextKey;
}

async function restoreDatabaseBackup(files: DbBackupFile[]): Promise<void> {
    for (const file of files) {
        if (!file.existed) {
            continue;
        }
        const backup = await FileSystem.getInfoAsync(file.backupUri);
        if (!backup.exists) {
            throw new Error(
                `Missing Vex DB migration backup: ${file.backupUri}`,
            );
        }
    }

    for (const file of files) {
        const current = await FileSystem.getInfoAsync(file.sourceUri);
        if (current.exists) {
            await FileSystem.deleteAsync(file.sourceUri, { idempotent: true });
        }
        if (!file.existed) {
            continue;
        }
        await FileSystem.copyAsync({
            from: file.backupUri,
            to: file.sourceUri,
        });
    }
}

function sanitize(s: string): string {
    return s
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-");
}

function scopedDbName(username: string): string {
    return `vex-client.${sanitize(getServerUrl())}.${sanitize(username)}.db`;
}

function toFileUri(path: string): string {
    if (path.startsWith("file://") || !path.startsWith("/")) {
        return path;
    }
    return `file://${path}`;
}

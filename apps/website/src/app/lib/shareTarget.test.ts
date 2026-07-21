import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { openDB } from "idb";

import {
    clearPendingShares,
    consumePendingShare,
    prunePendingShares,
    sharedText,
    type PendingShare,
} from "./shareTarget";

const SHARE_DATABASE = "vex-web-share-target";
const SHARE_STORE = "shares";

afterEach(async () => {
    await clearPendingShares();
});

describe("sharedText", () => {
    it("combines a title, message, and URL", () => {
        expect(
            sharedText(
                "An interesting page",
                "Thought you would like this.",
                "https://example.com/story",
            ),
        ).toBe(
            "An interesting page\n\nThought you would like this.\n\nhttps://example.com/story",
        );
    });

    it("does not repeat a title or URL already present in the message", () => {
        expect(
            sharedText(
                "Same text",
                "Same text\nhttps://example.com/story",
                "https://example.com/story",
            ),
        ).toBe("Same text\nhttps://example.com/story");
    });

    it("trims empty values", () => {
        expect(sharedText("  ", " Hello ", "  ")).toBe("Hello");
    });
});

describe("pending share storage", () => {
    it("deletes a share as soon as the app consumes it", async () => {
        const id = crypto.randomUUID();
        await storePendingShare({
            createdAt: Date.now(),
            files: [
                {
                    contentType: "text/plain",
                    data: new Blob(["private draft"], { type: "text/plain" }),
                    fileName: "draft.txt",
                    lastModified: Date.now(),
                },
            ],
            id,
            text: "",
            title: "Draft",
            url: "",
        });

        const consumed = await consumePendingShare(id);

        expect(consumed).toMatchObject({ id, title: "Draft" });
        expect(consumed?.files[0]?.fileName).toBe("draft.txt");
        expect(await consumePendingShare(id)).toBeNull();
    });

    it("prunes expired records while preserving a fresh share", async () => {
        const now = Date.now();
        const expiredID = crypto.randomUUID();
        const freshID = crypto.randomUUID();
        await storePendingShare(pendingShare(expiredID, now - 3_600_001));
        await storePendingShare(pendingShare(freshID, now));

        await prunePendingShares(now);

        expect(await pendingShareIDs()).toEqual([freshID]);
    });

    it("clears every pending share with local app data", async () => {
        await storePendingShare(pendingShare(crypto.randomUUID(), Date.now()));
        await storePendingShare(pendingShare(crypto.randomUUID(), Date.now()));

        await clearPendingShares();

        expect(await pendingShareIDs()).toEqual([]);
    });
});

function pendingShare(id: string, createdAt: number) {
    return {
        createdAt,
        files: [],
        id,
        text: "Shared text",
        title: "",
        url: "",
    };
}

async function storePendingShare(value: PendingShare) {
    const database = await shareDatabase();
    try {
        await database.put(SHARE_STORE, value);
    } finally {
        database.close();
    }
}

async function pendingShareIDs(): Promise<IDBValidKey[]> {
    const database = await shareDatabase();
    try {
        return await database.getAllKeys(SHARE_STORE);
    } finally {
        database.close();
    }
}

function shareDatabase() {
    return openDB(SHARE_DATABASE, 1, {
        upgrade(database) {
            if (!database.objectStoreNames.contains(SHARE_STORE)) {
                database.createObjectStore(SHARE_STORE, { keyPath: "id" });
            }
        },
    });
}

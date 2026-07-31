import { describe, expect, test } from "vitest";

import { ComposerRecoveryQueue } from "../composer-recovery.ts";

describe("ComposerRecoveryQueue", () => {
    test("keeps failed sends separate by conversation", () => {
        const queue = new ComposerRecoveryQueue<object, string>();
        const attachment = {};

        queue.add("dm:one", {
            attachment,
            metadata: "reply:one",
            value: "first",
        });
        queue.add("dm:two", {
            metadata: "reply:two",
            value: "second",
        });

        expect(queue.get("dm:one")).toMatchObject([
            {
                attachment,
                metadata: "reply:one",
                value: "first",
            },
        ]);
        expect(queue.get("dm:two")).toMatchObject([
            {
                metadata: "reply:two",
                value: "second",
            },
        ]);
    });

    test("removes only the selected failed send", () => {
        const queue = new ComposerRecoveryQueue<never>();
        const first = queue.add("channel:one", {
            metadata: undefined,
            value: "first",
        });
        const second = queue.add("channel:one", {
            metadata: undefined,
            value: "second",
        });

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(queue.remove("channel:one", first?.id ?? -1)).toBe(true);
        expect(queue.get("channel:one")).toMatchObject([
            {
                value: "second",
            },
        ]);
    });

    test("evicts the oldest failed sends across conversations", () => {
        const queue = new ComposerRecoveryQueue<never>(2);

        queue.add("dm:one", {
            metadata: undefined,
            value: "oldest",
        });
        queue.add("dm:two", {
            metadata: undefined,
            value: "middle",
        });
        queue.add("dm:one", {
            metadata: undefined,
            value: "newest",
        });

        expect(queue.get("dm:one")).toMatchObject([
            {
                value: "newest",
            },
        ]);
        expect(queue.get("dm:two")).toMatchObject([
            {
                value: "middle",
            },
        ]);
    });

    test("ignores empty recovery entries", () => {
        const queue = new ComposerRecoveryQueue<never>();

        expect(
            queue.add("", {
                metadata: undefined,
                value: "message",
            }),
        ).toBeNull();
        expect(
            queue.add("dm:one", {
                metadata: undefined,
                value: "",
            }),
        ).toBeNull();
        expect(queue.get("dm:one")).toEqual([]);
    });
});

import { describe, expect, test } from "vitest";

import {
    decodeVexDbAtRestKey,
    encodeVexDbAtRestKey,
    generateVexDbAtRestKey,
} from "../database-key.ts";

describe("database keys", () => {
    test("round-trips a generated 256-bit key", () => {
        const key = generateVexDbAtRestKey();

        expect(key).toHaveLength(32);
        expect(decodeVexDbAtRestKey(encodeVexDbAtRestKey(key))).toEqual(key);
    });

    test.each(["0", "zz", "00", "00".repeat(33)])(
        "rejects malformed key %s",
        (value) => {
            expect(() => decodeVexDbAtRestKey(value)).toThrow();
        },
    );

    test("does not reuse generated keys", () => {
        expect(generateVexDbAtRestKey()).not.toEqual(generateVexDbAtRestKey());
    });
});

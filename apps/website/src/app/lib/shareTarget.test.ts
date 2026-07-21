import { describe, expect, it } from "vitest";

import { sharedText } from "./shareTarget";

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

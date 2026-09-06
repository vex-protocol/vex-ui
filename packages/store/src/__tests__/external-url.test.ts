import { describe, expect, test } from "vitest";

import { normalizeExternalUrl } from "../external-url.ts";

describe("normalizeExternalUrl", () => {
    test.each([
        undefined,
        null,
        42,
        "",
        "/relative/path",
        "//example.com",
        "javascript:alert(1)",
        "java\nscript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "tel:+15555555555",
        "mailto:example@example.com",
        "vex://invite/123",
        "https://trusted.example@evil.example/",
        "https://user:password@example.com/",
        "https://exa\tmple.com/",
        "https://example.com/\u0000",
    ])("rejects unsafe or ambiguous URLs: %s", (value) => {
        expect(normalizeExternalUrl(value)).toBeNull();
    });

    test("normalizes web URLs without losing paths, queries or fragments", () => {
        expect(
            normalizeExternalUrl(" HTTPS://Example.COM/a?b=c#section "),
        ).toBe("https://example.com/a?b=c#section");
        expect(normalizeExternalUrl("http://localhost:8080/path")).toBe(
            "http://localhost:8080/path",
        );
    });
});

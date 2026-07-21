import { describe, expect, it } from "vitest";

import {
    isPublicPreviewAddress,
    PreviewTargetError,
    validatePreviewURL,
} from "./linkPreviewFetch";

describe("validatePreviewURL", () => {
    it("accepts public HTTP URLs and removes fragments", () => {
        expect(
            validatePreviewURL(
                "https://example.com/path?q=1#private",
            ).toString(),
        ).toBe("https://example.com/path?q=1");
    });

    it.each([
        "file:///etc/passwd",
        "ftp://example.com/file",
        "http://user:password@example.com",
        "https://example.com:8443",
        "http://localhost",
        "http://service.internal",
        "http://router.local",
        "http://127.0.0.1",
        "http://[::1]",
        "http://[::ffff:127.0.0.1]",
    ])("rejects unsafe target %s", (target) => {
        expect(() => validatePreviewURL(target)).toThrow(PreviewTargetError);
    });
});

describe("isPublicPreviewAddress", () => {
    it.each([
        "0.0.0.0",
        "10.20.30.40",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.168.1.1",
        "198.51.100.9",
        "224.0.0.1",
        "::",
        "::1",
        "::ffff:8.8.8.8",
        "64:ff9b::808:808",
        "fc00::1",
        "fe80::1",
        "2001:db8::1",
    ])("blocks non-public address %s", (address) => {
        expect(isPublicPreviewAddress(address)).toBe(false);
    });

    it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
        "allows public address %s",
        (address) => {
            expect(isPublicPreviewAddress(address)).toBe(true);
        },
    );
});

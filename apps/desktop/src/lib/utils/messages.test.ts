import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { openExternalUrl } from "../externalLinks.js";

import { handleLinkClick, renderContent } from "./messages.js";

vi.mock("@tauri-apps/plugin-opener", () => ({
    openUrl: vi.fn(async () => {}),
}));

beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
});

function clickMessage(html: string): HTMLDivElement {
    const container = document.createElement("div");
    container.innerHTML = renderContent(html);
    container.addEventListener("click", handleLinkClick);
    document.body.append(container);
    container
        .querySelector("a")
        ?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    return container;
}

describe("message links", () => {
    test.each([
        "[open](javascript:alert(1))",
        "[open](file:///etc/passwd)",
        "[open](data:text/html,hello)",
        '<a href="javascript:alert(1)" data-external="file:///etc/passwd">open</a>',
        '<a data-external="file:///etc/passwd">open</a>',
        '<a href="java&#10;script:alert(1)">open</a>',
        '<a href="https://trusted.example@evil.example/">open</a>',
    ])("cannot dispatch unsafe message links: %s", (html) => {
        const container = clickMessage(html);
        expect(container.querySelector("[data-external]")).toBeNull();
        expect(container.querySelector("a[href]")).toBeNull();
        expect(openUrl).not.toHaveBeenCalled();
    });

    test("opens sanitized web links and preserves query parameters and anchors", () => {
        const container = clickMessage(
            "[open](https://example.com/path?one=1&two=2#section)",
        );
        expect(openUrl).toHaveBeenCalledExactlyOnceWith(
            "https://example.com/path?one=1&two=2#section",
        );
        expect(container.querySelector("a")?.rel).toBe("noreferrer noopener");
    });

    test("cannot replace a safe destination with a forged data attribute", () => {
        clickMessage(
            '<a href="https://example.com/" data-external="file:///etc/passwd">open</a>',
        );
        expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://example.com/");
    });

    test("validates the click boundary even when markup was not rendered by us", () => {
        const link = document.createElement("a");
        link.href = "file:///etc/passwd";
        link.addEventListener("click", handleLinkClick);
        const click = new MouseEvent("click", { cancelable: true });
        link.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        expect(openUrl).not.toHaveBeenCalled();
    });

    test("native message, embed and preview opener rejects unsafe URLs", () => {
        openExternalUrl("vex://invite/123");
        openExternalUrl("javascript:alert(1)");
        expect(openUrl).not.toHaveBeenCalled();
        openExternalUrl("https://example.com/#section");
        expect(openUrl).toHaveBeenCalledExactlyOnceWith(
            "https://example.com/#section",
        );
    });
});

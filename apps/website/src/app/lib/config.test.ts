import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
});

describe("website server selection", () => {
    it.each([
        ["dev.vex.wtf", "dev.vex.wtf"],
        ["api.vex.wtf", "api.vex.wtf"],
    ])("uses the first-party deployment host %s", async (hostname, host) => {
        stubBrowserLocation({ host, hostname });

        const { getServerHost } = await import("./config");

        expect(getServerHost()).toBe(host);
    });

    it("keeps the production API default on other website hosts", async () => {
        stubBrowserLocation({ host: "vex.wtf", hostname: "vex.wtf" });

        const { getServerHost } = await import("./config");

        expect(getServerHost()).toBe("api.vex.wtf");
    });

    it("preserves an explicitly selected homeserver", async () => {
        stubBrowserLocation(
            { host: "dev.vex.wtf", hostname: "dev.vex.wtf" },
            "chat.example.com",
        );

        const { getServerHost } = await import("./config");

        expect(getServerHost()).toBe("chat.example.com");
    });
});

function stubBrowserLocation(
    location: { host: string; hostname: string },
    storedServer: null | string = null,
): void {
    vi.stubGlobal("window", {
        location: { ...location, protocol: "https:" },
    });
    vi.stubGlobal("localStorage", {
        getItem: vi.fn(() => storedServer),
    });
}

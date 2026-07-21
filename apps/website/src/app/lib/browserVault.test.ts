import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

describe("browser vault key creation", () => {
    it("shares one first-run key across independent tab runtimes", async () => {
        vi.resetModules();
        const firstTab = await import("./browserVault");
        vi.resetModules();
        const secondTab = await import("./browserVault");
        const scope = `race-${crypto.randomUUID()}.example`;
        const username = "first_run_user";

        const [firstKey, secondKey] = await Promise.all([
            firstTab.getBrowserDatabaseKey(scope, username),
            secondTab.getBrowserDatabaseKey(scope, username),
        ]);

        expect(firstKey).not.toBe(secondKey);
        expect(firstKey).toEqual(secondKey);
        expect(firstKey).toHaveLength(32);
    });

    it("deactivates a captured scope after the current scope changes", async () => {
        vi.resetModules();
        const { createBrowserKeyStore } = await import("./browserVault");
        const suffix = crypto.randomUUID();
        const oldScope = `old-${suffix}.example`;
        const newScope = `new-${suffix}.example`;
        let currentScope = oldScope;
        const keyStore = createBrowserKeyStore(() => currentScope);

        await keyStore.save({
            deviceID: "old-device",
            deviceKey: "0".repeat(64),
            token: "old-token",
            username: "scope_user",
        });
        currentScope = newScope;
        await keyStore.save({
            deviceID: "new-device",
            deviceKey: "1".repeat(64),
            token: "new-token",
            username: "scope_user",
        });

        await keyStore.deactivate(oldScope);

        currentScope = oldScope;
        expect(await keyStore.loadActive()).toBeNull();
        currentScope = newScope;
        expect(await keyStore.loadActive()).toMatchObject({
            deviceID: "new-device",
            token: "new-token",
        });
    });
});

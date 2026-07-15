import { beforeEach, describe, expect, test, vi } from "vitest";

import {
    $accountEntitlementsWritable,
    accountHasCapability,
    accountLimitValue,
    accountTierAtLeast,
    defaultAccountEntitlements,
} from "../domains/entitlements.ts";
import { vexService } from "../service.ts";

const serviceInternals = vexService as unknown as {
    client: unknown;
};

describe("account entitlement selectors", () => {
    test("orders free, plus, and pro", () => {
        expect(accountTierAtLeast("free", "plus")).toBe(false);
        expect(accountTierAtLeast("plus", "free")).toBe(true);
        expect(accountTierAtLeast("pro", "plus")).toBe(true);
    });

    test("derives capabilities and limits from the tier baseline", () => {
        const pro = defaultAccountEntitlements("user-1", "pro");
        expect(accountHasCapability(pro, "calls.relay_priority")).toBe(true);
        expect(accountLimitValue(pro, "devices.max_trusted_devices")).toBe(10);
    });
});

describe("vexService entitlement overrides", () => {
    beforeEach(() => {
        vexService.configureProductFeatures({
            premiumTiers: true,
            voiceCalling: true,
        });
        serviceInternals.client = null;
        $accountEntitlementsWritable.set(defaultAccountEntitlements());
    });

    test("sets the local store from a supported dev override client", async () => {
        const entitlements = {
            ...defaultAccountEntitlements("user-1", "plus"),
            source: "dev_override" as const,
        };
        serviceInternals.client = {
            entitlements: {
                setDevTier: vi.fn(async () => entitlements),
            },
            me: {
                user: vi.fn(() => ({ userID: "user-1", username: "alice" })),
            },
        };

        const result = await vexService.setDevAccountTier("plus");

        expect(result).toEqual({ entitlements, ok: true });
        expect($accountEntitlementsWritable.get()).toEqual(entitlements);
    });

    test("returns an error when the client does not expose the dev override", async () => {
        serviceInternals.client = {
            entitlements: {},
            me: {
                user: vi.fn(() => ({ userID: "user-1", username: "alice" })),
            },
        };

        await expect(vexService.setDevAccountTier("plus")).resolves.toEqual({
            error: "Client does not support entitlement overrides.",
            ok: false,
        });
    });
});

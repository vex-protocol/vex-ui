import { beforeEach, describe, expect, test, vi } from "vitest";

import {
    $billingAccountWritable,
    $billingOperationWritable,
    $billingProductsWritable,
    defaultBillingOperationState,
} from "../domains/billing.ts";
import {
    $accountEntitlementsWritable,
    defaultAccountEntitlements,
} from "../domains/entitlements.ts";
import { vexService } from "../service.ts";

const serviceInternals = vexService as unknown as {
    client: unknown;
};

describe("vexService billing", () => {
    beforeEach(() => {
        serviceInternals.client = null;
        $accountEntitlementsWritable.set(defaultAccountEntitlements());
        $billingAccountWritable.set(null);
        $billingOperationWritable.set(defaultBillingOperationState());
        $billingProductsWritable.set([]);
    });

    test("loads billing products from a supported client", async () => {
        const products = [
            {
                environment: "sandbox" as const,
                platform: "apple_app_store" as const,
                productID: "apple_plus_monthly",
                storeProductID: "chat.vex.plus.monthly",
                tier: "plus" as const,
            },
        ];
        serviceInternals.client = {
            billing: {
                products: vi.fn(async () => products),
            },
        };

        await expect(vexService.refreshBillingProducts()).resolves.toEqual(
            products,
        );
        expect($billingProductsWritable.get()).toEqual(products);
    });

    test("submits Apple transactions and publishes entitlement state", async () => {
        const account = {
            entitlements: {
                ...defaultAccountEntitlements("user-1", "pro"),
                source: "store" as const,
            },
            subscriptions: [
                {
                    environment: "sandbox" as const,
                    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
                    platform: "apple_app_store" as const,
                    productID: "apple_pro_monthly",
                    status: "active" as const,
                    storeProductID: "chat.vex.pro.monthly",
                    subscriptionID: "sub-1",
                    tier: "pro" as const,
                    updatedAt: new Date().toISOString(),
                },
            ],
        };
        serviceInternals.client = {
            billing: {
                submitAppleTransaction: vi.fn(async () => account),
            },
        };

        const result = await vexService.submitAppleStoreTransaction({
            signedTransactionInfo: "jws",
        });

        expect(result).toEqual({ account, ok: true });
        expect($billingAccountWritable.get()).toEqual(account);
        expect($accountEntitlementsWritable.get().tier).toBe("pro");
        expect($billingOperationWritable.get()).toMatchObject({
            busy: false,
            error: null,
        });
    });

    test("returns an error when billing methods are missing", async () => {
        serviceInternals.client = { billing: {} };

        await expect(
            vexService.submitGooglePlayPurchase({ purchaseToken: "token" }),
        ).resolves.toMatchObject({
            error: "Client does not support subscription verification.",
            ok: false,
        });
    });
});

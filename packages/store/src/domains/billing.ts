import type { AccountEntitlements } from "./entitlements.ts";

import { atom, readonlyType } from "nanostores";

export interface BillingAccountState {
    entitlements: AccountEntitlements;
    subscriptions: BillingSubscription[];
}
export type BillingEnvironment = "production" | "sandbox";
export interface BillingOperationState {
    busy: boolean;
    error: null | string;
    lastUpdatedAt: null | string;
}

export type BillingPlatform = "apple_app_store" | "google_play";

export interface BillingProduct {
    environment: BillingEnvironment;
    platform: BillingPlatform;
    productID: string;
    storeProductID: string;
    tier: "plus" | "pro";
}

export interface BillingSubscription {
    environment: BillingEnvironment;
    expiresAt: null | string;
    platform: BillingPlatform;
    productID: string;
    status: BillingSubscriptionStatus;
    storeProductID: string;
    subscriptionID: string;
    tier: "plus" | "pro";
    updatedAt: string;
}

export type BillingSubscriptionStatus =
    | "active"
    | "billing_retry"
    | "expired"
    | "grace_period"
    | "pending"
    | "revoked";

export function defaultBillingOperationState(): BillingOperationState {
    return {
        busy: false,
        error: null,
        lastUpdatedAt: null,
    };
}

export const $billingProductsWritable = atom<BillingProduct[]>([]);
export const $billingProducts = readonlyType($billingProductsWritable);

export const $billingAccountWritable = atom<BillingAccountState | null>(null);
export const $billingAccount = readonlyType($billingAccountWritable);

export const $billingOperationWritable = atom<BillingOperationState>(
    defaultBillingOperationState(),
);
export const $billingOperation = readonlyType($billingOperationWritable);

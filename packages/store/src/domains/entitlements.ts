import { atom, computed, readonlyType } from "nanostores";

export const ACCOUNT_TIERS = ["free", "plus", "pro"] as const;

export type AccountEntitlementCapability =
    | "attachments.encrypted_uploads"
    | "calls.relay_priority"
    | "devices.additional_slots"
    | "identity.profile_customization"
    | "servers.custom_invites"
    | "servers.custom_profile"
    | "servers.extended_assets";

export type AccountEntitlementLimit =
    | "attachments.max_encrypted_bytes"
    | "devices.max_trusted_devices"
    | "identity.max_profile_assets"
    | "servers.max_custom_invites"
    | "servers.max_emoji_slots"
    | "servers.max_sticker_slots";

export interface AccountEntitlements {
    capabilities: Record<AccountEntitlementCapability, boolean>;
    expiresAt: null | string;
    limits: Record<AccountEntitlementLimit, number>;
    refreshedAt: string;
    source: AccountEntitlementSource;
    tier: AccountTier;
    userID: string;
}

export type AccountEntitlementSource = "default" | "dev_override" | "store";

export type AccountTier = (typeof ACCOUNT_TIERS)[number];

const CAPABILITIES_BY_TIER: Record<
    AccountTier,
    Record<AccountEntitlementCapability, boolean>
> = {
    free: {
        "attachments.encrypted_uploads": true,
        "calls.relay_priority": false,
        "devices.additional_slots": false,
        "identity.profile_customization": false,
        "servers.custom_invites": false,
        "servers.custom_profile": false,
        "servers.extended_assets": false,
    },
    plus: {
        "attachments.encrypted_uploads": true,
        "calls.relay_priority": false,
        "devices.additional_slots": true,
        "identity.profile_customization": true,
        "servers.custom_invites": true,
        "servers.custom_profile": true,
        "servers.extended_assets": false,
    },
    pro: {
        "attachments.encrypted_uploads": true,
        "calls.relay_priority": true,
        "devices.additional_slots": true,
        "identity.profile_customization": true,
        "servers.custom_invites": true,
        "servers.custom_profile": true,
        "servers.extended_assets": true,
    },
};

const LIMITS_BY_TIER: Record<
    AccountTier,
    Record<AccountEntitlementLimit, number>
> = {
    free: {
        "attachments.max_encrypted_bytes": 25 * 1024 * 1024,
        "devices.max_trusted_devices": 2,
        "identity.max_profile_assets": 1,
        "servers.max_custom_invites": 3,
        "servers.max_emoji_slots": 0,
        "servers.max_sticker_slots": 0,
    },
    plus: {
        "attachments.max_encrypted_bytes": 100 * 1024 * 1024,
        "devices.max_trusted_devices": 5,
        "identity.max_profile_assets": 4,
        "servers.max_custom_invites": 25,
        "servers.max_emoji_slots": 50,
        "servers.max_sticker_slots": 50,
    },
    pro: {
        "attachments.max_encrypted_bytes": 500 * 1024 * 1024,
        "devices.max_trusted_devices": 10,
        "identity.max_profile_assets": 8,
        "servers.max_custom_invites": 100,
        "servers.max_emoji_slots": 250,
        "servers.max_sticker_slots": 250,
    },
};

const TIER_ORDER: Record<AccountTier, number> = {
    free: 0,
    plus: 1,
    pro: 2,
};

export function accountHasCapability(
    entitlements: AccountEntitlements,
    capability: AccountEntitlementCapability,
): boolean {
    return entitlements.capabilities[capability];
}

export function accountLimitValue(
    entitlements: AccountEntitlements,
    limit: AccountEntitlementLimit,
): number {
    return entitlements.limits[limit] ?? 0;
}

export function accountTierAtLeast(
    current: AccountTier,
    minimum: AccountTier,
): boolean {
    return TIER_ORDER[current] >= TIER_ORDER[minimum];
}

export function defaultAccountEntitlements(
    userID = "",
    tier: AccountTier = "free",
): AccountEntitlements {
    return {
        capabilities: { ...CAPABILITIES_BY_TIER[tier] },
        expiresAt: null,
        limits: { ...LIMITS_BY_TIER[tier] },
        refreshedAt: new Date(0).toISOString(),
        source: "default",
        tier,
        userID,
    };
}

export const $accountEntitlementsWritable = atom<AccountEntitlements>(
    defaultAccountEntitlements(),
);
export const $accountTier = computed(
    $accountEntitlementsWritable,
    (entitlements) => entitlements.tier,
);

export const $accountEntitlements = readonlyType($accountEntitlementsWritable);

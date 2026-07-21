import type { ProductFeatureAvailability } from "@vex-chat/store";

function enabled(value: unknown): boolean {
    return (
        typeof value === "string" &&
        ["1", "true"].includes(value.trim().toLowerCase())
    );
}

export const productFeatures: Readonly<ProductFeatureAvailability> =
    Object.freeze({
        premiumTiers: enabled(import.meta.env.VITE_ENABLE_PREMIUM_TIERS),
        voiceCalling: enabled(import.meta.env.VITE_ENABLE_VOICE_CALLING),
    });

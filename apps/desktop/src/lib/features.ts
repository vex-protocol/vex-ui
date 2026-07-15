import type { ProductFeatureAvailability } from "@vex-chat/store";

function enabled(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true";
}

export const productFeatures: Readonly<ProductFeatureAvailability> =
    Object.freeze({
        premiumTiers: enabled(import.meta.env.VITE_ENABLE_PREMIUM_TIERS),
        voiceCalling: enabled(import.meta.env.VITE_ENABLE_VOICE_CALLING),
    });

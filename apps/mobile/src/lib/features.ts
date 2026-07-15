import type { ProductFeatureAvailability } from "@vex-chat/store";

function enabled(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === "1" || normalized === "true";
}

export const productFeatures: Readonly<ProductFeatureAvailability> =
    Object.freeze({
        premiumTiers: enabled(process.env.EXPO_PUBLIC_ENABLE_PREMIUM_TIERS),
        voiceCalling: enabled(process.env.EXPO_PUBLIC_ENABLE_VOICE_CALLING),
    });

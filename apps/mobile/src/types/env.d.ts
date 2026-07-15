declare namespace NodeJS {
    interface ProcessEnv {
        EXPO_PUBLIC_DEV_API_KEY?: string;
        EXPO_PUBLIC_ENABLE_DEV_SERVER?: string;
        EXPO_PUBLIC_ENABLE_PREMIUM_TIERS?: string;
        EXPO_PUBLIC_ENABLE_VOICE_CALLING?: string;
        EXPO_PUBLIC_SERVER_URL?: string;
        EXPO_PUBLIC_VEX_APP_VERSION?: string;
        EXPO_PUBLIC_VEX_BUILD_LABEL?: string;
        EXPO_PUBLIC_VEX_COMMIT_SHA?: string;
    }
}

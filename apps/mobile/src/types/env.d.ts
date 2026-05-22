declare namespace NodeJS {
    interface ProcessEnv {
        EXPO_PUBLIC_ENABLE_DEV_SERVER?: string;
        EXPO_PUBLIC_SERVER_URL?: string;
        EXPO_PUBLIC_VEX_APP_VERSION?: string;
        EXPO_PUBLIC_VEX_COMMIT_SHA?: string;
    }
}

import { Alert, Linking } from "react-native";

import { normalizeExternalUrl } from "@vex-chat/store";

export function openExternalUrl(value: unknown): void {
    const url = normalizeExternalUrl(value);
    if (url) {
        void Linking.openURL(url).catch(() => {
            Alert.alert("Could not open link", url);
        });
    }
}

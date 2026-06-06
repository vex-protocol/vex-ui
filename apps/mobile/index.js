// Hermes doesn't provide crypto.getRandomValues (facebook/hermes#915).
// Polyfill must load before anything that calls globalThis.crypto.getRandomValues.
import "react-native-get-random-values";
import { LogBox, Platform } from "react-native";

import notifee, { EventType } from "@notifee/react-native";
import { registerRootComponent } from "expo";

import "./src/lib/backgroundTaskDefinitions";
import App from "./App";
import { handleNativeCallBackgroundNotification } from "./src/lib/nativeCallUi";
import { showNativeCallFromPushData } from "./src/lib/nativeCallWakePush";
import { enqueueNotificationRouteFromAndroidBackground } from "./src/lib/notificationRouteQueue";

if (__DEV__) {
    LogBox.ignoreLogs([
        "Call to function 'ExpoKeepAwake.activate' has been rejected",
    ]);
}

if (Platform.OS === "android") {
    const messaging = require("@react-native-firebase/messaging").default;
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
        const data = remoteMessage?.data;
        console.info("[vex-push] firebase background message", {
            hasData: Boolean(data),
            keys: data ? Object.keys(data).sort() : [],
        });
        await showNativeCallFromPushData(data).catch((err) => {
            console.warn(
                "[vex-push] firebase native call notification failed",
                err instanceof Error ? err.message : String(err),
            );
        });
    });
}

notifee.onBackgroundEvent(async ({ detail, type }) => {
    const data = detail.notification?.data;
    console.info("[vex-push] notifee background event", {
        hasData: Boolean(data),
        keys: data ? Object.keys(data).sort() : [],
        type,
    });

    if (type === EventType.ACTION_PRESS) {
        const handled = await handleNativeCallBackgroundNotification(
            data,
            detail.pressAction?.id,
        );
        if (handled) {
            return;
        }
    }

    if (type !== EventType.PRESS || !data) {
        return;
    }
    if (data["kind"] !== "dm" && data["kind"] !== "group") {
        return;
    }
    enqueueNotificationRouteFromAndroidBackground(data);
});

registerRootComponent(App);

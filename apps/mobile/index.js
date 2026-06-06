// Hermes doesn't provide crypto.getRandomValues (facebook/hermes#915).
// Polyfill must load before anything that calls globalThis.crypto.getRandomValues.
import "react-native-get-random-values";
import { LogBox } from "react-native";

import notifee, { EventType } from "@notifee/react-native";
import { registerRootComponent } from "expo";

import "./src/lib/backgroundTaskDefinitions";
import App from "./App";
import { handleNativeCallBackgroundNotification } from "./src/lib/nativeCallUi";
import { enqueueNotificationRouteFromAndroidBackground } from "./src/lib/notificationRouteQueue";

if (__DEV__) {
    LogBox.ignoreLogs([
        "Call to function 'ExpoKeepAwake.activate' has been rejected",
    ]);
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

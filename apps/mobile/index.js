// Hermes doesn't provide crypto.getRandomValues (facebook/hermes#915).
// Polyfill must load before anything that calls globalThis.crypto.getRandomValues.
import "react-native-get-random-values";
import { LogBox } from "react-native";

import notifee, { EventType } from "@notifee/react-native";
import { registerRootComponent } from "expo";

import App from "./App";
import { enqueueNotificationRouteFromAndroidBackground } from "./src/lib/notifications";

if (__DEV__) {
    LogBox.ignoreLogs([
        "Call to function 'ExpoKeepAwake.activate' has been rejected",
    ]);
}

notifee.onBackgroundEvent(({ detail, type }) => {
    const data = detail.notification?.data;
    console.info("[vex-push] notifee background event", {
        hasData: Boolean(data),
        keys: data ? Object.keys(data).sort() : [],
        type,
    });

    if (type !== EventType.PRESS || !data) {
        return Promise.resolve();
    }
    if (data["kind"] !== "dm" && data["kind"] !== "group") {
        return Promise.resolve();
    }
    enqueueNotificationRouteFromAndroidBackground(data);
    return Promise.resolve();
});

registerRootComponent(App);

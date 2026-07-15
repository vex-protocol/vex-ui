import type { AuthStackParamList } from "./types";

import React from "react";

import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AccountSelectorScreen } from "../screens/AccountSelectorScreen";
import { AuthenticateScreen } from "../screens/AuthenticateScreen";
import { HangTightScreen } from "../screens/HangTightScreen";
import { ProvisionDeviceScreen } from "../screens/ProvisionDeviceScreen";
import { RecoverPasswordScreen } from "../screens/RecoverPasswordScreen";
import { WelcomeScreen } from "../screens/WelcomeScreen";

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
    return (
        <Stack.Navigator
            initialRouteName="HangTight"
            screenOptions={{ headerShown: false }}
        >
            <Stack.Screen component={WelcomeScreen} name="Welcome" />
            <Stack.Screen component={HangTightScreen} name="HangTight" />
            <Stack.Screen
                component={AccountSelectorScreen}
                name="AccountSelector"
            />
            <Stack.Screen component={AuthenticateScreen} name="Authenticate" />
            <Stack.Screen
                component={ProvisionDeviceScreen}
                name="ProvisionDevice"
            />
            <Stack.Screen
                component={RecoverPasswordScreen}
                name="RecoverPassword"
            />
        </Stack.Navigator>
    );
}

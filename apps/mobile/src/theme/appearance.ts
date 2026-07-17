import type { AccentPresetID, AccentTokens } from "@vex-chat/ui/theme";

import {
    accentPresets,
    accentTokensFor,
    defaultAccentPresetID,
    isAccentPresetID,
} from "@vex-chat/ui/theme";

import { useStore } from "@nanostores/react";
import * as SecureStore from "expo-secure-store";
import { atom, computed } from "nanostores";

const ACCENT_STORE_KEY = "vex.appearance.accent.v1";

export const $accentPreference = atom<AccentPresetID>(defaultAccentPresetID);
export const $accentColors = computed($accentPreference, (id) =>
    accentTokensFor(id, "dark"),
);

let hydrationPromise: null | Promise<void> = null;

export function hydrateAccentPreference(): Promise<void> {
    hydrationPromise ??= (async () => {
        try {
            const stored = await SecureStore.getItemAsync(ACCENT_STORE_KEY);
            if (isAccentPresetID(stored)) {
                $accentPreference.set(stored);
            }
        } catch (error) {
            console.warn("[vex-appearance] could not read accent", error);
        }
    })();
    return hydrationPromise;
}

export async function setAccentPreference(id: AccentPresetID): Promise<void> {
    $accentPreference.set(id);
    try {
        await SecureStore.setItemAsync(ACCENT_STORE_KEY, id);
    } catch (error) {
        console.warn("[vex-appearance] could not save accent", error);
    }
}

export function useAccentColors(): AccentTokens {
    return useStore($accentColors);
}

export {
    accentPresets,
    accentTokensFor,
    defaultAccentPresetID,
    isAccentPresetID,
};
export type {
    AccentPreset,
    AccentPresetID,
    AccentTokens,
} from "@vex-chat/ui/theme";

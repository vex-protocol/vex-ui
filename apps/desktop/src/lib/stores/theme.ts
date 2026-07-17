import type { AccentPresetID } from "@vex-chat/ui/theme";

import { writable } from "svelte/store";

import {
    accentPresets,
    accentTokensFor,
    defaultAccentPresetID,
    isAccentPresetID,
} from "@vex-chat/ui/theme";

export type Theme = "dark" | "light";

const storedTheme = localStorage.getItem("vex-theme");
const savedTheme: Theme = storedTheme === "light" ? "light" : "dark";
const storedAccent = localStorage.getItem("vex-accent");
const savedAccent = isAccentPresetID(storedAccent)
    ? storedAccent
    : defaultAccentPresetID;

export const theme = writable<Theme>(savedTheme);
export const accentPreference = writable<AccentPresetID>(savedAccent);

let currentTheme = savedTheme;
let currentAccent = savedAccent;

theme.subscribe((t) => {
    currentTheme = t;
    localStorage.setItem("vex-theme", t);
    document.documentElement.setAttribute("data-theme", t);
    applyAccentTokens();
});

accentPreference.subscribe((accent) => {
    currentAccent = accent;
    localStorage.setItem("vex-accent", accent);
    document.documentElement.setAttribute("data-accent", accent);
    applyAccentTokens();
});

export function initializeAppearance(): void {
    document.documentElement.setAttribute("data-theme", currentTheme);
    document.documentElement.setAttribute("data-accent", currentAccent);
    applyAccentTokens();
}

export function setAccentPreference(next: AccentPresetID): void {
    accentPreference.set(next);
}

export function setTheme(next: Theme): void {
    theme.set(next);
}

export function toggleTheme(): void {
    theme.update((t) => (t === "dark" ? "light" : "dark"));
}

function applyAccentTokens(): void {
    const tokens = accentTokensFor(currentAccent, currentTheme);
    const root = document.documentElement.style;
    root.setProperty("--accent", tokens.accent);
    root.setProperty("--accent-border", tokens.accentBorder);
    root.setProperty("--accent-hover", tokens.accentHover);
    root.setProperty("--accent-soft", tokens.accentSoft);
    root.setProperty("--accent-text", tokens.accentText);
    root.setProperty("--on-accent", tokens.onAccent);
}

export { accentPresets };
export type { AccentPresetID };

import type { AccentPresetID } from "@vex-chat/ui/theme";

import { writable } from "svelte/store";

import {
    accentPresets,
    accentTokensFor,
    defaultAccentPresetID,
    isAccentPresetID,
    neutralTokensFor,
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
    applyAppearanceTokens();
});

accentPreference.subscribe((accent) => {
    currentAccent = accent;
    localStorage.setItem("vex-accent", accent);
    document.documentElement.setAttribute("data-accent", accent);
    applyAppearanceTokens();
});

export function initializeAppearance(): void {
    document.documentElement.setAttribute("data-theme", currentTheme);
    document.documentElement.setAttribute("data-accent", currentAccent);
    applyAppearanceTokens();
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

function applyAppearanceTokens(): void {
    const accent = accentTokensFor(currentAccent, currentTheme);
    const neutral = neutralTokensFor(currentTheme);
    const root = document.documentElement.style;
    root.setProperty("--bg-primary", neutral.background);
    root.setProperty("--bg-secondary", neutral.panel);
    root.setProperty("--bg-tertiary", neutral.rail);
    root.setProperty("--bg-surface", neutral.surface);
    root.setProperty("--bg-elevated", neutral.elevated);
    root.setProperty("--bg-hover", neutral.hover);
    root.setProperty("--bg-selected", neutral.selected);
    root.setProperty("--text-primary", neutral.text);
    root.setProperty("--text-secondary", neutral.textSecondary);
    root.setProperty("--text-muted", neutral.textMuted);
    root.setProperty("--text-faint", neutral.textFaint);
    root.setProperty("--border", neutral.border);
    root.setProperty("--border-strong", neutral.borderStrong);
    root.setProperty("--unread-bg", neutral.unread);
    root.setProperty("--unread-text", neutral.unreadText);
    root.setProperty("--accent", accent.accent);
    root.setProperty("--accent-border", accent.accentBorder);
    root.setProperty("--accent-hover", accent.accentHover);
    root.setProperty("--accent-soft", accent.accentSoft);
    root.setProperty("--accent-text", accent.accentText);
    root.setProperty("--on-accent", accent.onAccent);
}

export { accentPresets };
export type { AccentPresetID };

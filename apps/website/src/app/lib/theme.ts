import type { AccentPresetID, ColorScheme } from "@vex-chat/ui/theme";

import {
    accentTokensFor,
    defaultAccentPresetID,
    isAccentPresetID,
    neutralTokensFor,
} from "@vex-chat/ui/theme";

import { useEffect, useState } from "preact/hooks";

const ACCENT_KEY = "vex-accent";
const SCHEME_KEY = "vex-theme";

export interface WebThemeState {
    accent: AccentPresetID;
    scheme: ColorScheme;
    setAccent(accent: AccentPresetID): void;
    setScheme(scheme: ColorScheme): void;
}

export function useWebTheme(): WebThemeState {
    const [accent, setAccentState] = useState<AccentPresetID>(() => {
        const stored = localStorage.getItem(ACCENT_KEY);
        return isAccentPresetID(stored) ? stored : defaultAccentPresetID;
    });
    const [scheme, setSchemeState] = useState<ColorScheme>(() =>
        localStorage.getItem(SCHEME_KEY) === "light" ? "light" : "dark",
    );

    useEffect(() => {
        applyTheme(accent, scheme);
    }, [accent, scheme]);

    return {
        accent,
        scheme,
        setAccent(next) {
            localStorage.setItem(ACCENT_KEY, next);
            setAccentState(next);
        },
        setScheme(next) {
            localStorage.setItem(SCHEME_KEY, next);
            setSchemeState(next);
        },
    };
}

function applyTheme(accentID: AccentPresetID, scheme: ColorScheme): void {
    const accent = accentTokensFor(accentID, scheme);
    const neutral = neutralTokensFor(scheme);
    const root = document.documentElement;
    root.dataset.vexTheme = scheme;
    const values: Record<string, string> = {
        "--accent": accent.accent,
        "--accent-border": accent.accentBorder,
        "--accent-dark": accent.accentDark,
        "--accent-hover": accent.accentHover,
        "--accent-muted": accent.accentMuted,
        "--accent-soft": accent.accentSoft,
        "--accent-text": accent.accentText,
        "--bg-elevated": neutral.elevated,
        "--bg-hover": neutral.hover,
        "--bg-panel": neutral.panel,
        "--bg-primary": neutral.background,
        "--bg-rail": neutral.rail,
        "--bg-selected": neutral.selected,
        "--bg-surface": neutral.surface,
        "--border": neutral.border,
        "--border-strong": neutral.borderStrong,
        "--on-accent": accent.onAccent,
        "--overlay": neutral.overlay,
        "--text-faint": neutral.textFaint,
        "--text-muted": neutral.textMuted,
        "--text-primary": neutral.text,
        "--text-secondary": neutral.textSecondary,
        "--unread": neutral.unread,
        "--unread-text": neutral.unreadText,
    };
    for (const [name, value] of Object.entries(values)) {
        root.style.setProperty(name, value);
    }
    root.style.colorScheme = scheme;
}

import {
    accentTokensFor,
    defaultAccentPresetID,
    neutralTokensFor,
} from "@vex-chat/ui/theme";

const defaultAccent = accentTokensFor(defaultAccentPresetID);
const neutral = neutralTokensFor("dark");

export const colors = {
    ...defaultAccent,
    bg: neutral.background,
    border: neutral.borderStrong,
    borderSubtle: neutral.border,
    card: neutral.panel,
    dangerBg: "rgba(242,63,66,0.14)",
    dangerBorder: "rgba(242,63,66,0.44)",
    dangerText: "#ffb8b9",
    elevated: neutral.elevated,
    error: "#f23f42",
    hover: neutral.hover,
    info: "#5ca8e6",
    infoBg: "rgba(92,168,230,0.13)",
    infoBorder: "rgba(92,168,230,0.32)",
    infoText: "#b6d9f4",
    input: neutral.surface,
    muted: neutral.textMuted,
    mutedDark: neutral.textFaint,
    offline: neutral.textFaint,
    online: "#3ba55c",
    overlay: neutral.overlay,
    panel: neutral.panel,
    rail: neutral.rail,
    selected: neutral.selected,
    success: "#3ba55c",
    successBg: "rgba(59,165,92,0.16)",
    successBorder: "rgba(59,165,92,0.44)",
    successText: "#8cdda5",
    surface: neutral.panel,
    surfaceLight: neutral.surface,
    text: neutral.text,
    textSecondary: neutral.textSecondary,
    transparent: "transparent",
    unread: neutral.unread,
    unreadText: neutral.unreadText,
    warning: "#f0b232",
} as const;

export type ColorToken = keyof typeof colors;

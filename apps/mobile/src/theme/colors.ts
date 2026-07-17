import { accentTokensFor, defaultAccentPresetID } from "@vex-chat/ui/theme";

const defaultAccent = accentTokensFor(defaultAccentPresetID);

export const colors = {
    ...defaultAccent,
    bg: "#1e1f22",
    border: "#3b3e46",
    borderSubtle: "#292b31",
    card: "#18191d",
    dangerBg: "rgba(242,63,66,0.14)",
    dangerBorder: "rgba(242,63,66,0.44)",
    dangerText: "#ffb8b9",
    elevated: "#2b2d33",
    error: "#f23f42",
    hover: "#303238",
    info: "#5ca8e6",
    infoBg: "rgba(92,168,230,0.13)",
    infoBorder: "rgba(92,168,230,0.32)",
    infoText: "#b6d9f4",
    input: "#24262b",
    muted: "#b5bac1",
    mutedDark: "#80848e",
    offline: "#80848e",
    online: "#3ba55c",
    overlay: "rgba(0,0,0,0.58)",
    panel: "#18191d",
    rail: "#111214",
    selected: "#383a42",
    success: "#3ba55c",
    successBg: "rgba(59,165,92,0.16)",
    successBorder: "rgba(59,165,92,0.44)",
    successText: "#8cdda5",
    surface: "#18191d",
    surfaceLight: "#24262b",
    text: "#f2f3f5",
    textSecondary: "#dbdee1",
    transparent: "transparent",
    warning: "#f0b232",
} as const;

export type ColorToken = keyof typeof colors;

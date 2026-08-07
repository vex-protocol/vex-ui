export const accentPresetIDs = [
    "blue",
    "cyan",
    "green",
    "gold",
    "orange",
    "pink",
    "purple",
    "red",
] as const;

export interface AccentPreset {
    color: string;
    id: AccentPresetID;
    label: string;
}
export type AccentPresetID = (typeof accentPresetIDs)[number];

export interface AccentTokens {
    accent: string;
    accentBorder: string;
    accentDark: string;
    accentHover: string;
    accentMuted: string;
    accentSoft: string;
    accentText: string;
    onAccent: string;
}

export type ColorScheme = "dark" | "light";

export interface NeutralTokens {
    background: string;
    border: string;
    borderStrong: string;
    elevated: string;
    hover: string;
    overlay: string;
    panel: string;
    rail: string;
    selected: string;
    surface: string;
    text: string;
    textFaint: string;
    textMuted: string;
    textSecondary: string;
    unread: string;
    unreadText: string;
}

export const defaultAccentPresetID: AccentPresetID = "red";

// These base colors all maintain at least 4.5:1 contrast with white so the
// selected accent remains safe for buttons, badges, and compact controls.
// The default is the Vex brand red used across the product identity.
const defaultAccentPreset: AccentPreset = {
    color: "#E70000",
    id: defaultAccentPresetID,
    label: "Red",
};

export const accentPresets: readonly AccentPreset[] = [
    defaultAccentPreset,
    { color: "#2563EB", id: "blue", label: "Blue" },
    { color: "#0E7490", id: "cyan", label: "Cyan" },
    { color: "#15803D", id: "green", label: "Green" },
    { color: "#A16207", id: "gold", label: "Gold" },
    { color: "#C2410C", id: "orange", label: "Orange" },
    { color: "#BE185D", id: "pink", label: "Pink" },
    { color: "#7E22CE", id: "purple", label: "Purple" },
];

const darkNeutralTokens: NeutralTokens = {
    background: "#0C0E12",
    border: "#242C37",
    borderStrong: "#3A4452",
    elevated: "#202732",
    hover: "#29313D",
    overlay: "rgba(0, 0, 0, 0.72)",
    panel: "#12161C",
    rail: "#07090C",
    selected: "#323B49",
    surface: "#191F28",
    text: "#F4F6F9",
    textFaint: "#848C99",
    textMuted: "#98A1AF",
    textSecondary: "#DCE1E8",
    unread: "#39424F",
    unreadText: "#F4F6F9",
};

const lightNeutralTokens: NeutralTokens = {
    background: "#FFFFFF",
    border: "#D6DBE2",
    borderStrong: "#B6BEC9",
    elevated: "#FFFFFF",
    hover: "#E8EBF0",
    overlay: "rgba(17, 19, 24, 0.48)",
    panel: "#F1F3F6",
    rail: "#E5E8ED",
    selected: "#DBE0E8",
    surface: "#F7F8FA",
    text: "#101318",
    textFaint: "#626B77",
    textMuted: "#4E5763",
    textSecondary: "#262C34",
    unread: "#3F4752",
    unreadText: "#FFFFFF",
};

export function accentPresetFor(id: AccentPresetID): AccentPreset {
    return (
        accentPresets.find((preset) => preset.id === id) ?? defaultAccentPreset
    );
}

export function accentTokensFor(
    id: AccentPresetID,
    scheme: ColorScheme = "dark",
): AccentTokens {
    const base = accentPresetFor(id).color;
    const dark = scheme === "dark";

    return {
        accent: base,
        accentBorder: rgba(base, dark ? 0.42 : 0.32),
        accentDark: mixHex(base, "#000000", 0.2),
        accentHover: mixHex(base, "#000000", 0.08),
        accentMuted: mixHex(base, dark ? "#FFFFFF" : "#000000", 0.3),
        accentSoft: rgba(base, dark ? 0.12 : 0.08),
        accentText: mixHex(
            base,
            dark ? "#FFFFFF" : "#000000",
            dark ? 0.34 : 0.3,
        ),
        onAccent: "#FFFFFF",
    };
}

export function isAccentPresetID(value: unknown): value is AccentPresetID {
    return (
        typeof value === "string" &&
        (accentPresetIDs as readonly string[]).includes(value)
    );
}

export function neutralTokensFor(scheme: ColorScheme = "dark"): NeutralTokens {
    return scheme === "dark" ? darkNeutralTokens : lightNeutralTokens;
}

function channel(first: number, second: number, amount: number): string {
    return Math.round(first + (second - first) * amount)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
}

function hexChannels(hex: string): {
    blue: number;
    green: number;
    red: number;
} {
    const normalized = hex.replace("#", "");
    return {
        blue: Number.parseInt(normalized.slice(4, 6), 16),
        green: Number.parseInt(normalized.slice(2, 4), 16),
        red: Number.parseInt(normalized.slice(0, 2), 16),
    };
}

function mixHex(first: string, second: string, amount: number): string {
    const a = hexChannels(first);
    const b = hexChannels(second);
    return `#${channel(a.red, b.red, amount)}${channel(a.green, b.green, amount)}${channel(a.blue, b.blue, amount)}`;
}

function rgba(hex: string, alpha: number): string {
    const { blue, green, red } = hexChannels(hex);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

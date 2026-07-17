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

export const defaultAccentPresetID: AccentPresetID = "blue";

// These base colors all maintain at least 4.5:1 contrast with white so the
// selected accent remains safe for buttons, badges, and compact controls.
export const accentPresets: readonly AccentPreset[] = [
    { color: "#2563EB", id: "blue", label: "Blue" },
    { color: "#0E7490", id: "cyan", label: "Cyan" },
    { color: "#15803D", id: "green", label: "Green" },
    { color: "#A16207", id: "gold", label: "Gold" },
    { color: "#C2410C", id: "orange", label: "Orange" },
    { color: "#BE185D", id: "pink", label: "Pink" },
    { color: "#7E22CE", id: "purple", label: "Purple" },
    { color: "#B91C1C", id: "red", label: "Red" },
];

export function accentPresetFor(id: AccentPresetID): AccentPreset {
    return accentPresets.find((preset) => preset.id === id) ?? accentPresets[0];
}

export function accentTokensFor(
    id: AccentPresetID,
    scheme: ColorScheme = "dark",
): AccentTokens {
    const base = accentPresetFor(id).color;
    const dark = scheme === "dark";

    return {
        accent: base,
        accentBorder: rgba(base, dark ? 0.5 : 0.38),
        accentDark: mixHex(base, "#000000", 0.2),
        accentHover: mixHex(base, dark ? "#FFFFFF" : "#000000", 0.1),
        accentMuted: mixHex(base, dark ? "#FFFFFF" : "#000000", 0.3),
        accentSoft: rgba(base, dark ? 0.18 : 0.11),
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

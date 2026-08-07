import { type TextStyle } from "react-native";

export const fontFamilies = {
    body: "Inter",
    heading: "SpaceGrotesk",
    mono: "ChivoMono",
} as const;

export const typography = {
    body: {
        fontFamily: fontFamilies.body,
        fontSize: 14,
        fontWeight: "400",
        lineHeight: 20,
    } satisfies TextStyle,

    bodyLarge: {
        fontFamily: fontFamilies.body,
        fontSize: 16,
        fontWeight: "400",
        lineHeight: 22,
    } satisfies TextStyle,

    button: {
        fontFamily: fontFamilies.body,
        fontSize: 14,
        fontWeight: "600",
        lineHeight: 20,
    } satisfies TextStyle,

    heading: {
        fontFamily: fontFamilies.heading,
        fontSize: 38,
        fontWeight: "700",
        letterSpacing: 0,
        lineHeight: 44,
    } satisfies TextStyle,

    headingSmall: {
        fontFamily: fontFamilies.heading,
        fontSize: 27,
        fontWeight: "700",
        letterSpacing: 0,
        lineHeight: 32,
    } satisfies TextStyle,

    label: {
        fontFamily: fontFamilies.body,
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0,
        lineHeight: 16,
        textTransform: "uppercase",
    } satisfies TextStyle,
} as const;

export type TypographyPreset = keyof typeof typography;

import { describe, expect, it } from "vitest";

import {
    accentPresets,
    accentTokensFor,
    defaultAccentPresetID,
    isAccentPresetID,
} from "./theme";

describe("accent theme", () => {
    it("keeps filled controls readable in every preset", () => {
        for (const preset of accentPresets) {
            const tokens = accentTokensFor(preset.id);
            expect(
                contrast(tokens.accent, tokens.onAccent),
            ).toBeGreaterThanOrEqual(4.5);
            expect(
                contrast(tokens.accentHover, tokens.onAccent),
            ).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("keeps accent text readable in dark and light themes", () => {
        for (const preset of accentPresets) {
            const dark = accentTokensFor(preset.id, "dark");
            const light = accentTokensFor(preset.id, "light");
            expect(contrast(dark.accentText, "#1E1F22")).toBeGreaterThanOrEqual(
                4.5,
            );
            expect(
                contrast(light.accentText, "#FFFFFF"),
            ).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("uses blue as the default", () => {
        expect(defaultAccentPresetID).toBe("blue");
        expect(accentTokensFor(defaultAccentPresetID).accent).toBe("#2563EB");
    });

    it("rejects unknown persisted values", () => {
        expect(isAccentPresetID("purple")).toBe(true);
        expect(isAccentPresetID("chartreuse")).toBe(false);
        expect(isAccentPresetID(null)).toBe(false);
    });
});

function contrast(first: string, second: string): number {
    const lighter = Math.max(luminance(first), luminance(second));
    const darker = Math.min(luminance(first), luminance(second));
    return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
    const channels = [1, 3, 5].map((start) =>
        Number.parseInt(hex.slice(start, start + 2), 16),
    );
    const [red = 0, green = 0, blue = 0] = channels.map((value) => {
        const normalized = value / 255;
        return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

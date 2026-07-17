import React from "react";

import Svg, { Polygon } from "react-native-svg";

import { useAccentColors } from "../theme";

interface HourglassIconProps {
    color?: string;
    size?: number;
}

export function HourglassIcon({ color, size = 36 }: HourglassIconProps) {
    const accent = useAccentColors();
    const fill = color ?? accent.accent;
    // Two triangles forming a bowtie/hourglass X shape
    // Triangles extend to the edges with a tight pinch at center
    const s = size;
    const pad = s * 0.02; // minimal padding from edge

    return (
        <Svg height={s} viewBox={`0 0 ${s} ${s}`} width={s}>
            {/* Top triangle: top-left → top-right → center */}
            <Polygon
                fill={fill}
                points={`${pad},${pad} ${s - pad},${pad} ${s / 2},${s / 2}`}
            />
            {/* Bottom triangle: bottom-left → bottom-right → center */}
            <Polygon
                fill={fill}
                points={`${pad},${s - pad} ${s - pad},${s - pad} ${s / 2},${s / 2}`}
            />
        </Svg>
    );
}

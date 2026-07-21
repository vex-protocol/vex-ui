interface VexMarkProps {
    label?: boolean;
    size?: number;
}

export function VexMark({ label = false, size = 34 }: VexMarkProps) {
    return (
        <span className="vex-mark-lockup">
            <span
                aria-hidden="true"
                className="vex-mark"
                style={{ height: size, width: size }}
            />
            {label ? <strong>vex</strong> : null}
        </span>
    );
}

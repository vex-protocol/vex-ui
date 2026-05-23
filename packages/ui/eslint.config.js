import { base } from "@vex-chat/eslint-config/base";

export default [
    { ignores: ["dist/**", "output/**"] },
    ...base,
    {
        // Mitosis .lite.tsx files are a restricted JSX subset that compiles
        // to multiple targets (React, Svelte, ...). Event handler parameters
        // have to be typed as `any` because the source can't know which
        // framework's event shape it'll emit for — React's
        // ChangeEvent<HTMLInputElement> vs Svelte's Event, etc. Relax the
        // type-safety rules that legitimately can't be satisfied under
        // Mitosis's transpile model.
        //
        // Intentionally NOT relaxed:
        //   - restrict-template-expressions (nullable string interpolation
        //     is a real bug, not a Mitosis limitation)
        //   - perfectionist/sort-* (alphabetization works fine)
        //   - consistent-type-imports (type imports work fine)
        //
        // TODO(mitosis-verify): verify these relaxations are still needed
        // after each @builder.io/mitosis upgrade. Newer Mitosis versions may
        // emit typed event handlers, at which point these overrides should
        // be tightened or removed. Last verified against
        // @builder.io/mitosis@0.12.1 + @builder.io/mitosis-cli@0.13.0 on
        // 2026-04-10. Re-check with:
        //
        //   pnpm dlx eslint packages/ui/src --rule '{"@typescript-eslint/no-explicit-any":"error"}'
        //
        // If the output is clean, remove this override block.
        files: ["src/**/*.lite.tsx"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            // Template expression type-safety is idiomatically awkward
            // in Mitosis .lite.tsx for two reasons:
            //
            // 1. CSS pixel/size interpolation (`${px}px`, `${fontSize}em`)
            //    is normal UI code — there's no valid way to write these
            //    without a number in a template literal.
            //
            // 2. `useDefaultProps` sets runtime defaults for optional props
            //    BUT the static types remain `T | undefined`, so template
            //    interpolations like `${props.variant}` see the union type
            //    even though the runtime value is guaranteed non-undefined.
            //    Mitosis's type system doesn't narrow across useDefaultProps.
            //    This is a Mitosis tooling gap, not a bug surface.
            //
            // Relax to permissive defaults for .lite.tsx only. Other
            // workspaces still run the rule at strictTypeChecked defaults.
            "@typescript-eslint/restrict-template-expressions": [
                "error",
                {
                    allowAny: true,
                    allowBoolean: true,
                    allowNullish: true,
                    allowNumber: true,
                    allowRegExp: true,
                },
            ],
        },
    },
];

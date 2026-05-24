import { base } from "@vex-chat/eslint-config/base";

export default [
    { ignores: ["dist/**", "data/**"] },
    ...base,
    {
        rules: {
            // The public website talks to its own /api routes and public
            // status endpoints; the SDK-only app transport restriction used
            // by mobile/desktop does not apply here.
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-confusing-void-expression": "off",
            "@typescript-eslint/no-deprecated": "off",
            "@typescript-eslint/no-misused-promises": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-unnecessary-condition": "off",
            "@typescript-eslint/no-unnecessary-type-assertion": "off",
            "@typescript-eslint/no-unnecessary-type-parameters": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/prefer-promise-reject-errors": "off",
            "perfectionist/sort-imports": "off",
            "perfectionist/sort-jsx-props": "off",
            "perfectionist/sort-modules": "off",
            "perfectionist/sort-named-imports": "off",
            "perfectionist/sort-object-types": "off",
            "perfectionist/sort-objects": "off",
            "perfectionist/sort-switch-case": "off",
            "perfectionist/sort-union-types": "off",
        },
    },
];

/**
 * Copyright (c) 2020-2026 Vex Heavy Industries LLC
 * Licensed under AGPL-3.0. See LICENSE for details.
 * Commercial licenses available at vex.wtf
 */

module.exports = {
    hooks: {
        readPackage(pkg) {
            if (pkg.name === "@builder.io/mitosis") {
                // This repo only builds React and Svelte outputs from
                // Mitosis. Keep the dependency graph aligned with that
                // supported surface: Angular support is patched out of the
                // Mitosis package entrypoints, and Svelte is kept on the
                // workspace catalog version.
                if (pkg.dependencies) {
                    delete pkg.dependencies["@angular/compiler"];
                    pkg.dependencies.svelte = "5.55.7";
                    pkg.dependencies["svelte-preprocess"] = "6.0.3";
                }
            }
            if (
                pkg.name === "prettier-plugin-svelte" &&
                pkg.version?.startsWith("2.")
            ) {
                // Mitosis 0.13 uses Prettier 2's synchronous formatter API,
                // which keeps it on prettier-plugin-svelte 2.x. The generated
                // Svelte output is still compiled by the workspace Svelte 5
                // toolchain, so align the peer metadata with that runtime.
                if (pkg.peerDependencies) {
                    pkg.peerDependencies.svelte =
                        "^3.2.0 || ^4.0.0-next.0 || ^5.0.0";
                }
            }
            if (pkg.name === "@builder.io/mitosis-cli") {
                // Mitosis CLI uses esbuild.transform for local component
                // transpilation. Use the same audited esbuild generation
                // already present in the Storybook/Vite toolchain.
                if (pkg.dependencies) {
                    pkg.dependencies.esbuild = "0.27.7";
                }
            }
            if (pkg.name === "gluegun" && pkg.dependencies?.apisauce) {
                // The Mitosis CLI uses Gluegun for command wiring, not its
                // optional HTTP helper. Dropping this edge keeps the UI
                // workspace off the extra HTTP-client dependency chain.
                delete pkg.dependencies.apisauce;
            }
            return pkg;
        },
    },
};

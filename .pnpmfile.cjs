/**
 * Copyright (c) 2020-2026 Vex Heavy Industries LLC
 * Licensed under AGPL-3.0. See LICENSE for details.
 * Commercial licenses available at vex.wtf
 */

module.exports = {
    hooks: {
        readPackage(pkg) {
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

const path = require("path");
const fs = require("fs");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const localProtocolRoot = path.resolve(monorepoRoot, "../vex-protocol");
const hasLocalProtocol = fs.existsSync(
    path.join(localProtocolRoot, "packages/libvex/package.json"),
);
const useLocalProtocol =
    process.env.VEX_USE_LOCAL_PROTOCOL_SYMLINK === "1" && hasLocalProtocol;

const config = getDefaultConfig(projectRoot);

config.watchFolders = useLocalProtocol
    ? [monorepoRoot, localProtocolRoot]
    : [monorepoRoot];
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(monorepoRoot, "node_modules"),
    ...(useLocalProtocol
        ? [path.resolve(localProtocolRoot, "node_modules")]
        : []),
];
config.resolver.unstable_enableSymlinks = true;

// Two flags working together to solve the libvex/Kysely/Hermes tangle:
//
//   1. unstable_enablePackageExports: true (Expo SDK 55 default)
//      — needed so Metro can resolve subpath exports like
//        "@vex-chat/libvex/storage/sqlite" (used in platform.ts),
//        and workspace packages like "@vex-chat/store" that only
//        declare their entry via "exports".
//
//   2. unstable_conditionNames: ['react-native', 'require']
//      — forces Metro to prefer the CJS ("require") condition over
//        the ESM ("import") condition when a package's exports map
//        offers both. Kysely's ESM build of FileMigrationProvider
//        contains `yield import(runtime-path)` which Hermes's bytecode
//        compiler rejects with "Invalid expression encountered" during
//        the release `createBundleReleaseJsAndAssets` Gradle task.
//        Kysely's CJS build uses plain `require()` and compiles fine.
//
// Why not just disable package exports globally (the Bluesky approach):
// Bluesky ships a single app with no workspace packages and no libvex-
// style subpath imports. vex-chat has both — disabling exports globally
// breaks "@vex-chat/store" resolution (exports-only package.json) and
// "@vex-chat/libvex/storage/sqlite" subpath lookup. conditionNames
// lets us keep exports on while avoiding the ESM paths that hit
// Hermes.
//
// Condition resolution order:
//   1. 'react-native' — preferred when a package has RN-specific code
//   2. 'require' — CJS, skips ESM variants (avoids yield import() etc.)
//   3. implicit 'default' fallback for packages with neither
//
// 'import' is intentionally ABSENT so Metro never picks ESM variants.
// If a package is ESM-only (no require + no default), we'll see a
// resolution failure and handle it case-by-case.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ["react-native", "require"];

// Stub Node-only modules that libvex@2.0.0 drags into the import graph.
//
// libvex's main index imports Client.js, which imports (at least):
//   - storage/node.js  → better-sqlite3  → "fs"
//   - utils/createLogger.js → winston → "os", "fs", "net", "tls", ...
//
// React Native has none of those Node builtins. Even with package
// exports off, these are genuine Node-only top-level deps that fail
// to bundle — CJS doesn't save them. Stubbing is the right answer here.
//
// Design choices:
//   - Stubs are real constructors / functions, not { type: "empty" },
//     so a surprise `new X()` at module load gives a clear error
//     instead of a cryptic "object is not a constructor" crash.
//   - Stubs live in src/lib/stubs/<name>.js so stack traces are readable.
//
// Adding another stub: create apps/mobile/src/lib/stubs/<name>.js,
// add the entry to nodeStubs below. Done.
//
// Proper fix lives in libvex itself (conditional exports or a
// platform-agnostic logger). Remove this block when libvex ships
// either.
const nodeStubs = {
    "better-sqlite3": path.resolve(
        projectRoot,
        "src/lib/stubs/better-sqlite3.js",
    ),
    "node:http": path.resolve(projectRoot, "src/lib/stubs/node-http.js"),
    "node:https": path.resolve(projectRoot, "src/lib/stubs/node-https.js"),
    http: path.resolve(projectRoot, "src/lib/stubs/node-http.js"),
    https: path.resolve(projectRoot, "src/lib/stubs/node-https.js"),
    winston: path.resolve(projectRoot, "src/lib/stubs/winston.js"),
};

const mobileKyselyEntry = require.resolve("kysely", {
    paths: [
        path.resolve(projectRoot, "node_modules"),
        path.resolve(monorepoRoot, "node_modules"),
    ],
});

// Kysely's FileMigrationProvider uses `yield import(runtime-path)` in
// BOTH its ESM and CJS builds — Node 14+ supports dynamic import() in
// CJS so the compiler preserves the syntax. conditionNames can't help;
// stubbing the specific file is the only way to keep it out of the
// Hermes bytecode compilation path. Mobile never instantiates
// FileMigrationProvider (it's dead code from Kysely's main index
// re-exporting everything). The stub file throws if anyone tries.
const pathStubs = [
    {
        match: /file-migration-provider(\.js|\.ts|\.cjs|\.mjs)?$/,
        stub: path.resolve(
            projectRoot,
            "src/lib/stubs/kysely-file-migration-provider.js",
        ),
    },
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (useLocalProtocol && moduleName === "@vex-chat/libvex") {
        return {
            filePath: path.join(
                localProtocolRoot,
                "packages/libvex/dist/index.js",
            ),
            type: "sourceFile",
        };
    }
    if (
        useLocalProtocol &&
        moduleName.startsWith("@vex-chat/libvex/storage/")
    ) {
        const subpath = moduleName.slice("@vex-chat/libvex/storage/".length);
        return {
            filePath: path.join(
                localProtocolRoot,
                `packages/libvex/dist/storage/${subpath}.js`,
            ),
            type: "sourceFile",
        };
    }
    // Some transitive noble consumers still import the old subpath with
    // ".js". Metro can resolve it via filesystem fallback, but it warns on
    // every reload because this subpath is not exported. Normalize it to the
    // official exported entry to avoid terminal spam.
    if (
        path.isAbsolute(moduleName) &&
        moduleName.endsWith(
            `${path.sep}@noble${path.sep}hashes${path.sep}crypto.js`,
        )
    ) {
        return {
            filePath: moduleName,
            type: "sourceFile",
        };
    }
    if (moduleName === "@noble/hashes/crypto.js") {
        return context.resolveRequest(
            context,
            "@noble/hashes/crypto",
            platform,
        );
    }
    if (moduleName === "kysely") {
        return {
            filePath: mobileKyselyEntry,
            type: "sourceFile",
        };
    }
    const stub = nodeStubs[moduleName];
    if (stub !== undefined) {
        return context.resolveRequest(context, stub, platform);
    }
    for (const entry of pathStubs) {
        if (entry.match.test(moduleName)) {
            return context.resolveRequest(context, entry.stub, platform);
        }
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

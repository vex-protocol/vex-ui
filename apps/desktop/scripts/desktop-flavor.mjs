#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_DIR = process.env.VEX_DESKTOP_INSTALL_DIR || "/Applications";
const APP_QUIT_TIMEOUT_MS = 2_000;
const APP_TERMINATE_TIMEOUT_MS = 3_000;
const APP_EXIT_POLL_MS = 100;
const sleepSignal = new Int32Array(new SharedArrayBuffer(4));

const flavors = {
    development: {
        appName: "Vex Development",
        bundleID: "com.vex-chat.app.dev",
        config: "src-tauri/tauri.development.conf.json",
        developmentTeamID: "UBG5MM55LT",
        profile: "release",
        serverURL: "dev.vex.wtf",
    },
    production: {
        appName: "vex-chat",
        bundleID: "com.vex-chat.app",
        config: "src-tauri/tauri.production.conf.json",
        profile: "release",
        serverURL: "api.vex.wtf",
    },
};

class CommandError extends Error {
    constructor(message, exitCode = 1) {
        super(message);
        this.exitCode = exitCode;
    }
}

function usage() {
    console.error(
        "Usage: desktop-flavor.mjs <dev|build|install> <development|production> [options]",
    );
    console.error("Install options: --skip-build, --no-launch");
}

function commandName(name) {
    return process.platform === "win32" ? `${name}.cmd` : name;
}

function runChecked(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: APP_DIR,
        stdio: "inherit",
        ...options,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new CommandError(
            `${command} exited with status ${result.status ?? "unknown"}`,
            result.status ?? 1,
        );
    }
}

function certificateTeamID(identity) {
    const certificate = spawnSync(
        "/usr/bin/security",
        ["find-certificate", "-c", identity, "-p"],
        { encoding: null },
    );
    if (certificate.status !== 0 || !certificate.stdout?.length) return null;

    const details = spawnSync(
        "/usr/bin/openssl",
        ["x509", "-noout", "-subject", "-nameopt", "RFC2253"],
        {
            encoding: "utf8",
            input: certificate.stdout,
        },
    );
    if (details.status !== 0) return null;
    return /(?:^|,)OU=([^,\n]+)/.exec(details.stdout)?.[1]?.trim() ?? null;
}

function findDevelopmentSigningIdentity(teamID) {
    const result = spawnSync(
        "/usr/bin/security",
        ["find-identity", "-v", "-p", "codesigning"],
        { encoding: "utf8" },
    );
    if (result.status !== 0) return null;

    const identities = [
        ...result.stdout.matchAll(/^\s*\d+\)\s+[A-Fa-f0-9]+\s+"([^"]+)"/gm),
    ]
        .map((match) => match[1])
        .filter((identity) => identity?.startsWith("Apple Development:"));
    return (
        identities.find((identity) => certificateTeamID(identity) === teamID) ??
        identities[0] ??
        null
    );
}

function resolveMacSigningIdentity(flavorName, flavor) {
    const configured =
        process.env.VEX_DESKTOP_SIGNING_IDENTITY?.trim() ||
        process.env.APPLE_SIGNING_IDENTITY?.trim();
    if (configured) return configured;
    if (flavorName !== "development") return null;
    return findDevelopmentSigningIdentity(flavor.developmentTeamID);
}

function runTauri(action, flavorName, flavor, extraArgs = []) {
    if (action === "dev" && flavorName !== "development") {
        throw new CommandError("Hot reload is only supported for development.");
    }

    const env = {
        ...process.env,
        VITE_APP_ENV: flavorName,
        VITE_SERVER_URL: action === "dev" ? "localhost:5180" : flavor.serverURL,
    };
    const signingIdentity =
        process.platform === "darwin" && action === "build"
            ? resolveMacSigningIdentity(flavorName, flavor)
            : null;
    if (signingIdentity) {
        env.APPLE_SIGNING_IDENTITY = signingIdentity;
    }
    if (action === "build") delete env.VITE_PROXY_TARGET;

    const args = [action, "--config", flavor.config];
    args.push(...extraArgs);

    console.log(`Flavor: ${flavorName}`);
    console.log(`App: ${flavor.appName} (${flavor.bundleID})`);
    console.log(`Server: ${flavor.serverURL}`);
    if (signingIdentity) {
        console.log(`Signing: ${signingIdentity}`);
    } else if (process.platform === "darwin" && action === "build") {
        console.warn(
            "Signing: no Apple identity found; Keychain may prompt again after each rebuild.",
        );
    }
    runChecked(commandName("tauri"), args, { env });
}

function readBundleID(appPath) {
    const plist = join(appPath, "Contents", "Info.plist");
    const result = spawnSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :CFBundleIdentifier", plist],
        { encoding: "utf8" },
    );
    if (result.status !== 0) {
        throw new CommandError(
            `Could not read bundle identifier from ${plist}`,
        );
    }
    return result.stdout.trim();
}

function quitInstalledApp(bundleID) {
    if (!isInstalledAppRunning(bundleID)) return;
    spawnSync(
        "/usr/bin/osascript",
        ["-e", `tell application id "${bundleID}" to quit`],
        { stdio: "ignore" },
    );
    if (waitForInstalledAppExit(bundleID, APP_QUIT_TIMEOUT_MS)) return;
    const appSpecifier = runningAppSpecifier(bundleID);
    if (appSpecifier) {
        spawnSync("/usr/bin/lsappinfo", ["kill", appSpecifier], {
            stdio: "ignore",
        });
    }
    if (!waitForInstalledAppExit(bundleID, APP_TERMINATE_TIMEOUT_MS)) {
        throw new CommandError(
            `Could not replace ${bundleID} because it is still running. Quit it and try again.`,
        );
    }
}

function waitForInstalledAppExit(bundleID, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (isInstalledAppRunning(bundleID) && Date.now() < deadline) {
        Atomics.wait(sleepSignal, 0, 0, APP_EXIT_POLL_MS);
    }
    return !isInstalledAppRunning(bundleID);
}

function isInstalledAppRunning(bundleID) {
    return runningAppSpecifier(bundleID) !== null;
}

function runningAppSpecifier(bundleID) {
    const result = spawnSync(
        "/usr/bin/lsappinfo",
        ["find", `bundleid=${bundleID}`],
        { encoding: "utf8" },
    );
    const match = result.stdout.match(/ASN:0x[\da-f]+-(0x[\da-f]+)/i);
    return match?.[1] ?? null;
}

function hasValidSignature(appPath) {
    const result = spawnSync(
        "/usr/bin/codesign",
        ["--verify", "--deep", "--strict", appPath],
        { stdio: "ignore" },
    );
    return result.status === 0;
}

function ensureValidSignature(appPath) {
    if (hasValidSignature(appPath)) return;
    runChecked("/usr/bin/codesign", [
        "--force",
        "--deep",
        "--sign",
        "-",
        appPath,
    ]);
    if (!hasValidSignature(appPath)) {
        throw new CommandError(
            "Installed app failed code-signature verification.",
        );
    }
}

function installMacApp(flavorName, flavor, options) {
    if (process.platform !== "darwin") {
        throw new CommandError(
            "Desktop app installation is only supported on macOS.",
        );
    }

    const allowed = new Set(["--skip-build", "--no-launch"]);
    const unknown = options.filter((option) => !allowed.has(option));
    if (unknown.length > 0) {
        throw new CommandError(`Unknown install option: ${unknown.join(", ")}`);
    }

    if (!options.includes("--skip-build")) {
        runTauri("build", flavorName, flavor, ["--bundles", "app"]);
    }

    const source = join(
        APP_DIR,
        "src-tauri",
        "target",
        flavor.profile,
        "bundle",
        "macos",
        `${flavor.appName}.app`,
    );
    const target = join(INSTALL_DIR, `${flavor.appName}.app`);
    const backup = join(
        INSTALL_DIR,
        `.${flavor.appName}.app.previous-${process.pid}`,
    );

    if (!existsSync(source)) {
        throw new CommandError(`Built app not found at ${source}`);
    }
    if (readBundleID(source) !== flavor.bundleID) {
        throw new CommandError(
            `Built app has an unexpected bundle identifier.`,
        );
    }
    mkdirSync(INSTALL_DIR, { recursive: true });
    if (existsSync(target) && readBundleID(target) !== flavor.bundleID) {
        throw new CommandError(
            `Refusing to replace ${target}: its bundle identifier does not match ${flavor.bundleID}.`,
        );
    }

    quitInstalledApp(flavor.bundleID);
    let movedExisting = false;
    try {
        if (existsSync(target)) {
            renameSync(target, backup);
            movedExisting = true;
        }
        runChecked("/usr/bin/ditto", ["--rsrc", "--extattr", source, target]);
        ensureValidSignature(target);
        if (readBundleID(target) !== flavor.bundleID) {
            throw new CommandError("Installed app failed bundle verification.");
        }
        if (movedExisting) rmSync(backup, { recursive: true });
    } catch (error) {
        if (existsSync(target))
            rmSync(target, { force: true, recursive: true });
        if (movedExisting && existsSync(backup)) renameSync(backup, target);
        throw error;
    }

    console.log(`Installed ${target}`);
    if (!options.includes("--no-launch")) {
        runChecked("/usr/bin/open", [target]);
        console.log(`Launched ${flavor.appName}`);
    }
}

try {
    const [action, flavorName, ...options] = process.argv.slice(2);
    const normalizedOptions = options[0] === "--" ? options.slice(1) : options;
    const flavor = flavors[flavorName];
    if (!flavor || !["dev", "build", "install"].includes(action)) {
        usage();
        throw new CommandError("Invalid desktop flavor command.");
    }

    if (action === "install") {
        installMacApp(flavorName, flavor, normalizedOptions);
    } else {
        runTauri(action, flavorName, flavor, normalizedOptions);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof CommandError ? error.exitCode : 1;
}

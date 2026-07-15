#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
    copyFileSync,
    mkdirSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BUNDLE_ROOT = join(
    APP_DIR,
    "src-tauri",
    "target",
    "release",
    "bundle",
);
const VALID_FLAVORS = new Set(["development", "production"]);
const VALID_ARCHITECTURES = new Set(["arm64", "x64"]);
const ARTIFACT_TYPES = {
    linux: [{ directory: "deb", extension: ".deb", label: "Debian package" }],
    macos: [{ directory: "dmg", extension: ".dmg", label: "disk image" }],
    windows: [
        { directory: "msi", extension: ".msi", label: "MSI installer" },
        { directory: "nsis", extension: ".exe", label: "NSIS installer" },
    ],
};

function usage() {
    console.error(
        "Usage: collect-ci-artifacts.mjs --platform <macos|windows|linux> " +
            "--architecture <arm64|x64> --flavor <development|production> " +
            "--output <directory> [--bundle-root <directory>]",
    );
}

function parseOptions(args) {
    const allowed = new Set([
        "--architecture",
        "--bundle-root",
        "--flavor",
        "--output",
        "--platform",
    ]);
    const options = {};

    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!allowed.has(key) || !value || value.startsWith("--")) {
            usage();
            throw new Error(
                `Invalid option near ${key ?? "(missing option)"}.`,
            );
        }
        if (key in options) throw new Error(`Duplicate option: ${key}`);
        options[key] = value;
    }

    for (const required of [
        "--architecture",
        "--flavor",
        "--output",
        "--platform",
    ]) {
        if (!options[required]) throw new Error(`Missing option: ${required}`);
    }
    return options;
}

function findSingleArtifact(bundleRoot, artifactType) {
    const sourceDirectory = join(bundleRoot, artifactType.directory);
    let entries;
    try {
        entries = readdirSync(sourceDirectory, { withFileTypes: true });
    } catch (error) {
        throw new Error(
            `Could not read ${artifactType.label} directory ${sourceDirectory}: ${error.message}`,
        );
    }

    const matches = entries
        .filter(
            (entry) =>
                entry.isFile() &&
                extname(entry.name).toLowerCase() === artifactType.extension,
        )
        .map((entry) => join(sourceDirectory, entry.name))
        .sort();
    if (matches.length !== 1) {
        throw new Error(
            `Expected exactly one ${artifactType.label} in ${sourceDirectory}; found ${matches.length}.`,
        );
    }
    return matches[0];
}

async function sha256(filePath) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest("hex");
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const platform = options["--platform"];
    const architecture = options["--architecture"];
    const flavor = options["--flavor"];
    const artifactTypes = ARTIFACT_TYPES[platform];
    if (!artifactTypes) throw new Error(`Unsupported platform: ${platform}`);
    if (!VALID_ARCHITECTURES.has(architecture)) {
        throw new Error(`Unsupported architecture: ${architecture}`);
    }
    if (!VALID_FLAVORS.has(flavor)) {
        throw new Error(`Unsupported flavor: ${flavor}`);
    }

    const bundleRoot = resolve(
        APP_DIR,
        options["--bundle-root"] ?? DEFAULT_BUNDLE_ROOT,
    );
    const outputDirectory = resolve(APP_DIR, options["--output"]);
    const sourceFiles = artifactTypes.map((artifactType) =>
        findSingleArtifact(bundleRoot, artifactType),
    );

    rmSync(outputDirectory, { force: true, recursive: true });
    mkdirSync(outputDirectory, { recursive: true });

    const names = new Set();
    const files = [];
    for (const sourcePath of sourceFiles) {
        const name = basename(sourcePath);
        if (names.has(name))
            throw new Error(`Duplicate artifact name: ${name}`);
        names.add(name);

        const destinationPath = join(outputDirectory, name);
        copyFileSync(sourcePath, destinationPath);
        const size = statSync(destinationPath).size;
        if (size === 0) throw new Error(`Artifact is empty: ${sourcePath}`);
        files.push({
            name,
            sha256: await sha256(destinationPath),
            size,
        });
    }
    files.sort((left, right) => left.name.localeCompare(right.name));

    writeFileSync(
        join(outputDirectory, "SHA256SUMS.txt"),
        `${files.map((file) => `${file.sha256}  ${file.name}`).join("\n")}\n`,
    );
    writeFileSync(
        join(outputDirectory, "manifest.json"),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                flavor,
                platform,
                architecture,
                sourceCommit: process.env.GITHUB_SHA || null,
                files,
            },
            null,
            4,
        )}\n`,
    );

    console.log(
        `Collected ${files.length} installer(s) in ${outputDirectory}:`,
    );
    for (const file of files) {
        console.log(
            `- ${file.name} (${file.size} bytes, sha256 ${file.sha256})`,
        );
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

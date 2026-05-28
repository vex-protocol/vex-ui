#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(rootDir, "..", "..");

function git(args) {
    try {
        return execFileSync("git", ["-C", repoRoot, ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return "";
    }
}

function parseVersion(value) {
    const match = String(value ?? "")
        .trim()
        .match(/^(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : undefined;
}

function compareVersion(left, right) {
    for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
}

if (process.env.VEX_APP_VERSION) {
    console.log(process.env.VEX_APP_VERSION);
    process.exit(0);
}

const pkg = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
);
const packageVersion = String(pkg.version ?? "0.0.0");

const exactProdTag = git([
    "tag",
    "--points-at",
    "HEAD",
    "--list",
    "mobile-v*",
    "--sort=-v:refname",
])
    .split("\n")
    .find(Boolean);

if (exactProdTag) {
    console.log(exactProdTag.replace(/^mobile-v/, ""));
    process.exit(0);
}

const latestProdTag = git(["tag", "--list", "mobile-v*", "--sort=-v:refname"])
    .split("\n")
    .find(Boolean);
const latestBaseVersion = latestProdTag?.replace(/^mobile-v/, "");
const packageParts = parseVersion(packageVersion) ?? [0, 0, 0];
const baseParts = parseVersion(latestBaseVersion);

if (!baseParts) {
    console.log(packageVersion);
    process.exit(0);
}

const nextRcParts = [baseParts[0], baseParts[1], baseParts[2] + 1];
const chosen =
    compareVersion(packageParts, nextRcParts) > 0 ? packageParts : nextRcParts;
console.log(chosen.join("."));

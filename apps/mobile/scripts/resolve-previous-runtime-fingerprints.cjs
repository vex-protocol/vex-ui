#!/usr/bin/env node

const fs = require("node:fs");

const buildsPath = process.env.EAS_BUILDS_JSON;
const fallbackAndroidPath = process.env.FALLBACK_ANDROID_FINGERPRINT_JSON;
const fallbackIosPath = process.env.FALLBACK_IOS_FINGERPRINT_JSON;
const githubOutput = process.env.GITHUB_OUTPUT;

const builds = buildsPath ? readJsonArray(buildsPath) : [];
const androidFromBuilds = runtimeFromBuilds(builds, "ANDROID");
const iosFromBuilds = runtimeFromBuilds(builds, "IOS");
const android = androidFromBuilds ?? readHash(fallbackAndroidPath);
const ios = iosFromBuilds ?? readHash(fallbackIosPath);
const androidSource = androidFromBuilds
    ? "eas-builds"
    : android
      ? "release-assets"
      : "missing";
const iosSource = iosFromBuilds
    ? "eas-builds"
    : ios
      ? "release-assets"
      : "missing";

appendOutput("android_hash", android ?? "");
appendOutput("ios_hash", ios ?? "");
appendOutput("android_source", androidSource);
appendOutput("ios_source", iosSource);
appendOutput("exists", android && ios ? "true" : "false");

console.log(
    android
        ? `Previous Android runtime fingerprint: ${android} (${androidSource})`
        : "Previous Android runtime fingerprint missing; will build",
);
console.log(
    ios
        ? `Previous iOS runtime fingerprint: ${ios} (${iosSource})`
        : "Previous iOS runtime fingerprint missing; will build",
);

function appendOutput(name, value) {
    if (!githubOutput) return;
    fs.appendFileSync(githubOutput, `${name}=${value}\n`);
}

function buildTime(build) {
    return Date.parse(
        build.completedAt ?? build.updatedAt ?? build.createdAt ?? "",
    );
}

function normalizeRuntime(value) {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim().toLowerCase();
    return /^[a-f0-9]{16,128}$/.test(trimmed) ? trimmed : undefined;
}

function readHash(file) {
    if (!file) return undefined;
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return normalizeRuntime(data.hash);
    } catch {
        return undefined;
    }
}

function readJsonArray(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, "utf8"));
        return Array.isArray(value) ? value : [value];
    } catch {
        return [];
    }
}

function runtimeFromBuilds(builds, platform) {
    return builds
        .filter(
            (build) =>
                String(build?.platform ?? "").toUpperCase() === platform &&
                String(build?.status ?? "").toUpperCase() === "FINISHED",
        )
        .sort((left, right) => buildTime(right) - buildTime(left))
        .map((build) =>
            normalizeRuntime(build.runtimeVersion ?? build.fingerprint?.hash),
        )
        .find(Boolean);
}

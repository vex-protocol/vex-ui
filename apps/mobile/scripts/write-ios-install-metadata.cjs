#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const workspace = process.env.GITHUB_WORKSPACE;
const nativeBuildsPath =
    process.env.NATIVE_BUILDS_JSON || "/tmp/native-builds.json";
const fingerprintPath =
    process.env.IOS_FINGERPRINT_JSON || "/tmp/current-fingerprint-ios.json";
const installJsonPath =
    process.env.IOS_INSTALL_JSON ||
    (workspace ? path.join(workspace, "ios-install.json") : "ios-install.json");

const profile = requiredEnv("IOS_INSTALL_PROFILE");
const channel = requiredEnv("IOS_INSTALL_CHANNEL");
const bundleIdentifier = requiredEnv("IOS_BUNDLE_IDENTIFIER");

const builds = normalizeBuilds(readJson(nativeBuildsPath));
const build = builds.find(
    (candidate) => String(candidate?.platform ?? "").toLowerCase() === "ios",
);

if (!build?.id) {
    console.error("EAS iOS build output did not include a build id.");
    process.exit(1);
}

const artifactUrl =
    build?.artifacts?.applicationArchiveUrl ?? build?.artifacts?.buildUrl;
if (!artifactUrl) {
    console.error("EAS iOS build output did not include an IPA artifact URL.");
    console.error(`Build id: ${build.id}`);
    process.exit(1);
}

const owner = build?.project?.ownerAccount?.name ?? "vex-chat";
const slug = build?.project?.slug ?? "vex";
const projectId = build?.project?.id ?? process.env.EXPO_PROJECT_ID;
const buildVersion =
    build.appBuildVersion ?? build.buildVersion ?? build.version ?? build.id;
const appVersion = build.appVersion ?? process.env.IOS_APP_VERSION;
const installUrl = `https://expo.dev/accounts/${owner}/projects/${slug}/builds/${build.id}`;
const manifestUrl = projectId
    ? `https://api.expo.dev/v2/projects/${projectId}/builds/${build.id}/manifest.plist`
    : undefined;
const fingerprint = readOptionalFingerprint(fingerprintPath);
const createdAt = new Date().toISOString();

const install = {
    platform: "ios",
    provider: "expo",
    profile,
    channel,
    bundleIdentifier,
    buildId: build.id,
    installUrl,
    artifactUrl,
    directInstallUrl: manifestUrl
        ? `itms-services://?action=download-manifest&url=${encodeURIComponent(
              manifestUrl,
          )}`
        : undefined,
    manifestUrl,
    appVersion,
    buildVersion: String(buildVersion),
    commit: process.env.GITHUB_SHA,
    fingerprint,
    createdAt,
};

fs.writeFileSync(installJsonPath, `${JSON.stringify(install, null, 2)}\n`);

function normalizeBuilds(value) {
    return Array.isArray(value) ? value : [value];
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        console.error(`Could not read ${file}: ${err.message}`);
        process.exit(1);
    }
}

function readOptionalFingerprint(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8")).hash;
    } catch {
        return undefined;
    }
}

function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        console.error(`Missing required environment variable ${name}.`);
        process.exit(1);
    }
    return value;
}

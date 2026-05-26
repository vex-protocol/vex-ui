#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const profile = process.env.EAS_BUILD_PROFILE;
if (!profile) {
    console.error("EAS_BUILD_PROFILE must be set.");
    process.exit(1);
}

const easJsonPath = path.join(process.cwd(), "eas.json");
const easJson = JSON.parse(fs.readFileSync(easJsonPath, "utf8"));
const buildProfile = easJson.build?.[profile];
if (!buildProfile) {
    console.error(`No EAS build profile named "${profile}" found in eas.json.`);
    process.exit(1);
}

const passthroughEnv = [
    "EXPO_PUBLIC_ENABLE_DEV_SERVER",
    "EXPO_PUBLIC_SERVER_URL",
    "EXPO_PUBLIC_VEX_APP_VERSION",
    "EXPO_PUBLIC_VEX_BUILD_LABEL",
    "EXPO_PUBLIC_VEX_COMMIT_SHA",
    "VEX_APP_DISPLAY_NAME",
    "VEX_APP_ENV",
    "VEX_APP_VERSION",
    "VEX_ENABLE_DEV_BUILD",
    "VEX_IOS_ASSOCIATED_DOMAIN_MODE",
    "VEX_IOS_BUNDLE_IDENTIFIER",
    "VEX_PASSKEY_RP_HOST",
];

buildProfile.env = buildProfile.env ?? {};
const applied = [];
for (const name of passthroughEnv) {
    const value = process.env[name];
    if (value === undefined) continue;
    buildProfile.env[name] = value;
    applied.push(name);
}

fs.writeFileSync(easJsonPath, `${JSON.stringify(easJson, null, 4)}\n`);
console.log(
    `Prepared EAS ${profile} env for remote build: ${applied.join(", ")}`,
);

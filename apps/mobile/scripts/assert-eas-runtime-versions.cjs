#!/usr/bin/env node

const fs = require("node:fs");

const buildsPath = process.env.NATIVE_BUILDS_JSON || "/tmp/native-builds.json";
const expectedAndroid = process.env.EXPECTED_ANDROID_RUNTIME_VERSION;
const expectedIos = process.env.EXPECTED_IOS_RUNTIME_VERSION;

const builds = normalizeBuilds(JSON.parse(fs.readFileSync(buildsPath, "utf8")));

assertRuntime("android", expectedAndroid);
assertRuntime("ios", expectedIos);

function assertRuntime(platform, expected) {
    if (!expected) {
        console.error(
            `Missing EXPECTED_${platform.toUpperCase()}_RUNTIME_VERSION.`,
        );
        process.exit(1);
    }
    const build = builds.find(
        (candidate) =>
            String(candidate?.platform ?? "").toLowerCase() === platform,
    );
    const actual = build?.runtimeVersion ?? build?.fingerprint?.hash;
    if (!actual) {
        console.error(
            `EAS ${platform} build output did not include a runtime version.`,
        );
        if (build?.id) console.error(`Build id: ${build.id}`);
        process.exit(1);
    }
    if (actual !== expected) {
        console.error(
            `EAS ${platform} runtime mismatch. Expected ${expected}, got ${actual}.`,
        );
        if (build?.id) console.error(`Build id: ${build.id}`);
        process.exit(1);
    }
    console.log(`EAS ${platform} runtime matches ${actual}.`);
}

function normalizeBuilds(value) {
    return Array.isArray(value) ? value : [value];
}

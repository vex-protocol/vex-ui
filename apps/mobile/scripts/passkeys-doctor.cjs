#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const target = process.env.VEX_MOBILE_TARGET || "dev";
const env = {
    ...process.env,
    EXPO_NO_TELEMETRY: "1",
    VEX_MOBILE_TARGET: target,
};

const failures = [];
const warnings = [];

function ok(message) {
    console.log(`[ok] ${message}`);
}

function warn(message) {
    warnings.push(message);
    console.log(`[warn] ${message}`);
}

function fail(message) {
    failures.push(message);
    console.log(`[fail] ${message}`);
}

function parseJsonFromOutput(output) {
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start < 0 || end < start) {
        throw new Error("Expo config did not print JSON.");
    }
    return JSON.parse(output.slice(start, end + 1));
}

function getExpoConfig() {
    const result = spawnSync(
        "pnpm",
        ["exec", "expo", "config", "--type", "public", "--json"],
        {
            cwd: appRoot,
            encoding: "utf8",
            env,
        },
    );
    if (result.status !== 0) {
        throw new Error(
            [
                "Could not read Expo config.",
                result.stderr.trim(),
                result.stdout.trim(),
            ]
                .filter(Boolean)
                .join("\n"),
        );
    }
    return parseJsonFromOutput(result.stdout);
}

function associatedDomainHost(entry) {
    if (typeof entry !== "string" || !entry.startsWith("webcredentials:")) {
        return undefined;
    }
    const rest = entry.slice("webcredentials:".length);
    return rest.split("?")[0].split("/")[0].trim();
}

function checkGeneratedNativeProjects({
    androidPackage,
    rpHost,
    webcredentials,
}) {
    const iosEntitlements = path.join(
        appRoot,
        "ios/VexDeveloper/VexDeveloper.entitlements",
    );
    if (!existsSync(iosEntitlements)) {
        warn(
            "Generated iOS project was not found; run `pnpm -F mobile prebuild` before building iOS.",
        );
    } else {
        const entitlements = readFileSync(iosEntitlements, "utf8");
        if (!entitlements.includes(webcredentials)) {
            fail(
                `Generated iOS entitlements do not include ${webcredentials}; rerun \`pnpm -F mobile prebuild\`.`,
            );
        } else {
            ok(
                "Generated iOS entitlements match the passkey associated domain.",
            );
        }
    }

    const androidStrings = path.join(
        appRoot,
        "android/app/src/main/res/values/strings.xml",
    );
    const androidManifest = path.join(
        appRoot,
        "android/app/src/main/AndroidManifest.xml",
    );
    if (!existsSync(androidStrings) || !existsSync(androidManifest)) {
        warn(
            "Generated Android project was not found; run `pnpm -F mobile prebuild` before building Android.",
        );
        return;
    }

    const strings = readFileSync(androidStrings, "utf8");
    const manifest = readFileSync(androidManifest, "utf8");
    const assetLinksUrl = `https://${rpHost}/.well-known/assetlinks.json`;
    if (!strings.includes(assetLinksUrl)) {
        fail(
            `Generated Android asset_statements does not include ${assetLinksUrl}; rerun \`pnpm -F mobile prebuild\`.`,
        );
    } else if (!manifest.includes('android:name="asset_statements"')) {
        fail(
            "Generated AndroidManifest.xml does not declare asset_statements metadata; rerun `pnpm -F mobile prebuild`.",
        );
    } else {
        ok(
            `Generated Android asset statements point ${androidPackage} at ${assetLinksUrl}.`,
        );
    }
}

function requestJson(url) {
    return new Promise((resolve) => {
        const req = https.get(
            url,
            { headers: { accept: "application/json" }, timeout: 10_000 },
            (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    body += chunk;
                });
                res.on("end", () => {
                    let json;
                    try {
                        json = body.trim() ? JSON.parse(body) : undefined;
                    } catch (err) {
                        resolve({
                            body,
                            error: err,
                            headers: res.headers,
                            json: undefined,
                            statusCode: res.statusCode,
                        });
                        return;
                    }
                    resolve({
                        body,
                        error: undefined,
                        headers: res.headers,
                        json,
                        statusCode: res.statusCode,
                    });
                });
            },
        );
        req.on("timeout", () => {
            req.destroy(new Error("request timed out"));
        });
        req.on("error", (error) => {
            resolve({
                body: "",
                error,
                headers: {},
                json: undefined,
                statusCode: 0,
            });
        });
    });
}

function getLocalAndroidDebugFingerprint() {
    const candidates = [
        path.join(appRoot, "android/app/debug.keystore"),
        path.join(os.homedir(), ".android/debug.keystore"),
    ];
    for (const keystore of candidates) {
        if (!existsSync(keystore)) {
            continue;
        }
        const result = spawnSync(
            "keytool",
            [
                "-list",
                "-v",
                "-keystore",
                keystore,
                "-alias",
                "androiddebugkey",
                "-storepass",
                "android",
                "-keypass",
                "android",
            ],
            { encoding: "utf8" },
        );
        if (result.status !== 0) {
            warn(`Could not inspect Android debug keystore at ${keystore}.`);
            continue;
        }
        const match = result.stdout.match(/SHA256:\s*([0-9A-F:]+)/i);
        if (match) {
            return { fingerprint: match[1].toUpperCase(), keystore };
        }
    }
    return undefined;
}

function matchingAssetLinksEntries(assetLinks, androidPackage) {
    if (!Array.isArray(assetLinks)) {
        return [];
    }
    return assetLinks.filter((entry) => {
        const relation = Array.isArray(entry?.relation) ? entry.relation : [];
        return (
            entry?.target?.namespace === "android_app" &&
            entry.target.package_name === androidPackage &&
            relation.includes("delegate_permission/common.get_login_creds")
        );
    });
}

async function main() {
    console.log(`Mobile passkeys doctor (target: ${target})`);

    const config = getExpoConfig();
    const iosBundleId = config.ios?.bundleIdentifier;
    const androidPackage = config.android?.package;
    const associatedDomains = Array.isArray(config.ios?.associatedDomains)
        ? config.ios.associatedDomains
        : [];
    const webcredentials = associatedDomains.find((entry) =>
        entry.startsWith("webcredentials:"),
    );
    const rpHost = associatedDomainHost(webcredentials);

    if (!iosBundleId) {
        fail("Expo config has no iOS bundle identifier.");
    } else {
        ok(`iOS bundle identifier: ${iosBundleId}`);
    }

    if (!androidPackage) {
        fail("Expo config has no Android package.");
    } else {
        ok(`Android package: ${androidPackage}`);
    }

    if (!webcredentials || !rpHost) {
        fail("Expo config has no webcredentials associated domain.");
        process.exitCode = 1;
        return;
    }
    ok(`Passkey RP host from Associated Domains: ${rpHost}`);
    if (webcredentials.includes("?mode=developer")) {
        warn(
            "iOS Associated Domains developer mode is enabled; devices must opt in to Associated Domains Development.",
        );
    }
    checkGeneratedNativeProjects({ androidPackage, rpHost, webcredentials });

    const aasaUrl = `https://${rpHost}/.well-known/apple-app-site-association`;
    const aasa = await requestJson(aasaUrl);
    if (aasa.statusCode !== 200) {
        fail(`iOS AASA ${aasaUrl} returned HTTP ${aasa.statusCode}.`);
    } else if (aasa.error) {
        fail(`iOS AASA ${aasaUrl} did not return valid JSON.`);
    } else {
        ok(`iOS AASA is reachable: ${aasaUrl}`);
        const apps = Array.isArray(aasa.json?.webcredentials?.apps)
            ? aasa.json.webcredentials.apps
            : [];
        const matchingApps = apps.filter(
            (appId) =>
                typeof appId === "string" &&
                iosBundleId &&
                appId.endsWith(`.${iosBundleId}`),
        );
        if (matchingApps.length === 0) {
            fail(
                `iOS AASA webcredentials.apps does not list a TeamID-prefixed ${iosBundleId} app id.`,
            );
        } else {
            ok(`iOS AASA lists ${matchingApps.join(", ")}`);
        }
    }

    const assetLinksUrl = `https://${rpHost}/.well-known/assetlinks.json`;
    const assetLinks = await requestJson(assetLinksUrl);
    if (assetLinks.statusCode !== 200) {
        fail(
            `Android assetlinks ${assetLinksUrl} returned HTTP ${assetLinks.statusCode}.`,
        );
    } else if (assetLinks.error) {
        fail(`Android assetlinks ${assetLinksUrl} did not return valid JSON.`);
    } else {
        ok(`Android assetlinks is reachable: ${assetLinksUrl}`);
        const entries = matchingAssetLinksEntries(
            assetLinks.json,
            androidPackage,
        );
        if (entries.length === 0) {
            fail(
                `Android assetlinks does not grant get_login_creds to ${androidPackage}.`,
            );
        } else {
            ok(
                `Android assetlinks grants get_login_creds to ${androidPackage}`,
            );
        }

        const localDebug = getLocalAndroidDebugFingerprint();
        if (!localDebug) {
            warn(
                "No local Android debug keystore found yet; run prebuild/android before checking local debug fingerprints.",
            );
        } else {
            ok(
                `Local Android debug fingerprint: ${localDebug.fingerprint} (${path.relative(
                    appRoot,
                    localDebug.keystore,
                )})`,
            );
            const publishedFingerprints = new Set(
                entries.flatMap((entry) =>
                    Array.isArray(entry?.target?.sha256_cert_fingerprints)
                        ? entry.target.sha256_cert_fingerprints.map((value) =>
                              String(value).toUpperCase(),
                          )
                        : [],
                ),
            );
            if (!publishedFingerprints.has(localDebug.fingerprint)) {
                fail(
                    "Android assetlinks does not include the local debug fingerprint; add it to SPIRE_PASSKEY_ANDROID_FINGERPRINTS.",
                );
            } else {
                ok("Android assetlinks includes the local debug fingerprint.");
            }
        }
    }

    if (failures.length > 0) {
        console.log(
            `\nResult: ${failures.length} failure(s), ${warnings.length} warning(s).`,
        );
        process.exitCode = 1;
        return;
    }
    console.log(`\nResult: pass (${warnings.length} warning(s)).`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

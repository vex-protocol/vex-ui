import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, loadEnv } from "vite";

const DEV_SPIRE_URL = "https://dev.vex.wtf";
const PROD_SPIRE_URL = "https://api.vex.wtf";
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.|100\.)/i;

type DesktopAppEnvironment = "development" | "production";

function desktopManualChunk(id: string): string | undefined {
    const normalized = id.replaceAll("\\", "/");
    if (
        normalized.includes("/vex-protocol/packages/crypto/") ||
        normalized.includes("/node_modules/@vex-chat/crypto/")
    ) {
        return "vex-crypto";
    }
    if (
        (normalized.includes("/vex-protocol/packages/libvex/") ||
            normalized.includes("/node_modules/@vex-chat/libvex/")) &&
        !normalized.includes("/packages/libvex/src/storage/") &&
        !normalized.includes("/node_modules/@vex-chat/libvex/dist/storage/")
    ) {
        return "vex-protocol";
    }
    if (normalized.includes("/vex-ui/packages/store/")) {
        return "vex-store";
    }
    return undefined;
}

function hostOnly(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            return new URL(trimmed).host;
        } catch {
            return (
                trimmed
                    .replace(/^https?:\/\//i, "")
                    .split("/")[0]
                    ?.replace(/\/+$/, "") ?? ""
            );
        }
    }
    return trimmed.split("/")[0] ?? trimmed;
}

function normalizeProxyTarget(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    const host = hostOnly(trimmed);
    const scheme = LOCAL_HOST_RE.test(host) ? "http" : "https";
    return `${scheme}://${host}`;
}

function readEnvValue(value: string | undefined): string {
    return value?.trim() ?? "";
}

function resolveAppEnvironment(
    mode: string,
    configured: string,
): DesktopAppEnvironment {
    if (configured === "development" || configured === "production") {
        return configured;
    }
    if (configured.length > 0) {
        throw new Error(
            `[vex] Unsupported VITE_APP_ENV "${configured}". Expected "development" or "production".`,
        );
    }
    return mode === "production" ? "production" : "development";
}

function validateFlavorServer(
    appEnvironment: DesktopAppEnvironment,
    mode: string,
    serverUrl: string,
    proxyTarget: string,
): void {
    if (mode !== "production") return;

    const defaultServer =
        serverUrl ||
        (appEnvironment === "development" ? DEV_SPIRE_URL : PROD_SPIRE_URL);
    const serverHost = hostOnly(defaultServer);
    const proxyHost = hostOnly(proxyTarget);
    const hasProxyTarget = proxyTarget.length > 0;
    if (
        appEnvironment === "production" &&
        (serverHost !== hostOnly(PROD_SPIRE_URL) ||
            (hasProxyTarget && proxyHost !== hostOnly(PROD_SPIRE_URL)))
    ) {
        throw new Error(
            `[vex] Refusing to build production for ${defaultServer}. Production must target ${PROD_SPIRE_URL}.`,
        );
    }
    if (
        appEnvironment === "development" &&
        (serverHost !== hostOnly(DEV_SPIRE_URL) ||
            (hasProxyTarget && proxyHost !== hostOnly(DEV_SPIRE_URL)))
    ) {
        throw new Error(
            `[vex] Refusing to build development for ${defaultServer}. Development must target ${DEV_SPIRE_URL}.`,
        );
    }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const appEnvironment = resolveAppEnvironment(
        mode,
        readEnvValue(env.VITE_APP_ENV),
    );
    const envProxyTarget = readEnvValue(env.VITE_PROXY_TARGET);
    const envServerUrl = readEnvValue(env.VITE_SERVER_URL);
    validateFlavorServer(appEnvironment, mode, envServerUrl, envProxyTarget);
    const envServerHost = hostOnly(envServerUrl);
    const envServerIsViteProxy =
        envServerHost === "localhost:5180" ||
        envServerHost === "127.0.0.1:5180";
    const fallbackProxyTarget =
        mode === "production" ? PROD_SPIRE_URL : DEV_SPIRE_URL;
    const spireUrl = normalizeProxyTarget(
        envProxyTarget ||
            (!envServerIsViteProxy && envServerUrl.length > 0
                ? envServerUrl
                : fallbackProxyTarget),
    );
    const spire = { changeOrigin: true, target: spireUrl } as const;
    const rootWebsocketOnly = {
        ...spire,
        bypass: (req: { headers: { upgrade?: string }; url?: string }) => {
            if (
                req.url === "/" &&
                req.headers.upgrade?.toLowerCase() === "websocket"
            ) {
                return;
            }
            return req.url;
        },
        ws: true,
    } as const;
    const isTauriDebug = process.env.TAURI_ENV_DEBUG ?? env.TAURI_ENV_DEBUG;

    return {
        build: {
            // Don't minify for debug builds
            minify: isTauriDebug ? false : "esbuild",
            rollupOptions: {
                output: {
                    manualChunks: desktopManualChunk,
                },
            },
            sourcemap: !!isTauriDebug,
            // Tauri supports es2021
            target: "es2021",
        },
        // Hide native browser env APIs from Tauri frontend
        envPrefix: ["VITE_", "TAURI_ENV_*"],
        plugins: [svelte()],
        // Tauri expects a fixed port and doesn't need the browser to open
        server: {
            port: 5180,
            // Proxy API requests to spire so the WebView never makes cross-origin HTTP requests
            proxy: {
                // Vite matches proxy prefixes in declaration order. Keep the
                // root websocket fallback after every HTTP API prefix.
                "/": rootWebsocketOnly,
                "/auth": spire,
                "/avatar": spire,
                "/calls": spire,
                "/channel": spire,
                "/device": spire,
                "/deviceList": spire,
                "/emoji": spire,
                "/file": spire,
                "/goodbye": spire,
                "/invite": spire,
                "/mail": spire,
                "/permission": spire,
                "/register": spire,
                "/server": spire,
                "/socket": { changeOrigin: true, target: spireUrl, ws: true },
                "/token": spire,
                "/user": spire,
                "/userList": spire,
                "/whoami": spire,
            },
            strictPort: true,
        },
    };
});

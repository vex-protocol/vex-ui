import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, loadEnv } from "vite";

const DEV_SPIRE_URL = "https://dev.vex.wtf";
const PROD_SPIRE_URL = "https://api.vex.wtf";
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.|100\.)/i;

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const envProxyTarget = readEnvValue(env.VITE_PROXY_TARGET);
    const envServerUrl = readEnvValue(env.VITE_SERVER_URL);
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

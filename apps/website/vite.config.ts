import { defineConfig, loadEnv } from "vite";

const DEV_SPIRE_URL = "https://dev.vex.wtf";
const SPIRE_HTTP_PATHS = [
    "/auth",
    "/avatar",
    "/calls",
    "/channel",
    "/device",
    "/deviceList",
    "/emoji",
    "/file",
    "/goodbye",
    "/invite",
    "/mail",
    "/permission",
    "/register",
    "/server",
    "/server-icon",
    "/socket",
    "/token",
    "/user",
    "/userList",
    "/whoami",
] as const;

function manualChunk(id: string): string | undefined {
    const normalized = id.replaceAll("\\", "/");
    if (
        normalized.includes("/node_modules/@vex-chat/crypto/") ||
        normalized.includes("/packages/crypto/")
    ) {
        return "vex-crypto";
    }
    if (
        normalized.includes("/node_modules/@vex-chat/libvex/") &&
        !normalized.includes("/storage/")
    ) {
        return "vex-protocol";
    }
    if (normalized.includes("/packages/store/")) return "vex-store";
    return undefined;
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const apiPort = env.CLA_API_PORT?.trim() || "8787";
    const spireTarget = env.VITE_WEB_SPIRE_PROXY?.trim() || DEV_SPIRE_URL;
    const spireProxy = Object.fromEntries(
        SPIRE_HTTP_PATHS.map((path) => [
            path,
            {
                changeOrigin: true,
                target: spireTarget,
                ...(path === "/socket" ? { ws: true } : {}),
            },
        ]),
    );
    return {
        build: {
            rollupOptions: { output: { manualChunks: manualChunk } },
            target: "es2022",
        },
        server: {
            proxy: {
                "/api": {
                    target: `http://127.0.0.1:${apiPort}`,
                    // Keep Host as localhost:5173 so the OAuth API can infer the public origin
                    // when SITE_ORIGIN is unset; changeOrigin:true breaks that (Host becomes :8787).
                    changeOrigin: false,
                },
                ...spireProxy,
                "/": {
                    bypass: (req: {
                        headers: { upgrade?: string };
                        url?: string;
                    }) => {
                        if (
                            req.url === "/" &&
                            req.headers.upgrade?.toLowerCase() === "websocket"
                        ) {
                            return;
                        }
                        return req.url;
                    },
                    changeOrigin: true,
                    target: spireTarget,
                    ws: true,
                },
            },
        },
    };
});

// Polyfill `process.env.NODE_ENV` so libvex's transport safety guard can
// detect a dev build. Vite substitutes `import.meta.env.DEV` at build time
// but libvex inspects the runtime `process` global directly.
if (typeof (globalThis as { process?: unknown }).process === "undefined") {
    (
        globalThis as unknown as { process: { env: { NODE_ENV: string } } }
    ).process = {
        env: {
            NODE_ENV: import.meta.env.DEV ? "development" : "production",
        },
    };
}

import { mount } from "svelte";

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import "./app.css";
import App from "./App.svelte";
import { authenticatePasskey, registerPasskey } from "./lib/passkey.js";
import { vexService } from "./lib/store/index.js";

const browserFetch = globalThis.fetch.bind(globalThis);
const nativeHttpOrigins = new Set([
    "https://api.vex.wtf",
    "https://dev.vex.wtf",
]);

if ("__TAURI_INTERNALS__" in globalThis) {
    globalThis.fetch = (input, init) => {
        const requestUrl =
            input instanceof Request ? input.url : input.toString();
        const origin = new URL(requestUrl, globalThis.location.href).origin;
        // Preserve WebKit fetch for tauri:// assets and Vite's lazy chunks.
        return nativeHttpOrigins.has(origin)
            ? tauriFetch(input, init)
            : browserFetch(input, init);
    };
}

vexService.setPasskeyCeremonyDriver({
    authenticate: authenticatePasskey,
    register: registerPasskey,
});

// Apply saved theme before mount to prevent flash of wrong theme
const savedTheme = localStorage.getItem("vex-theme") ?? "dark";
document.documentElement.setAttribute("data-theme", savedTheme);

const target = document.getElementById("app");
if (!target) {
    throw new Error("#app element not found in DOM");
}

const app = mount(App, {
    target,
});

export default app;

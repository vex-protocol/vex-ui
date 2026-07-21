const APP_CACHE = "vex-web-shell-v1";
const APP_SHELL_URL = "/app/home";
const SHARE_DATABASE = "vex-web-share-target";
const SHARE_STORE = "shares";
const SHARE_MAX_AGE_MS = 60 * 60 * 1000;

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(APP_CACHE)
            .then((cache) =>
                cache.addAll([
                    APP_SHELL_URL,
                    "/manifest.json",
                    "/app-icon-192.png",
                    "/app-icon-512.png",
                ]),
            )
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        Promise.all([
            caches
                .keys()
                .then((keys) =>
                    Promise.all(
                        keys
                            .filter(
                                (key) =>
                                    key.startsWith("vex-web-shell-") &&
                                    key !== APP_CACHE,
                            )
                            .map((key) => caches.delete(key)),
                    ),
                ),
            pruneExpiredShares().catch(() => {}),
        ]).then(() => self.clients.claim()),
    );
});

self.addEventListener("message", (event) => {
    if (event.data === "SKIP_WAITING") {
        void self.skipWaiting();
        return;
    }
    if (
        event.data?.type === "DISCARD_SHARE" &&
        typeof event.data.id === "string"
    ) {
        event.waitUntil(deleteShare(event.data.id));
    }
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (
        event.request.method === "POST" &&
        url.origin === self.location.origin &&
        url.pathname === "/app/share"
    ) {
        event.respondWith(receiveShare(event.request));
        return;
    }
    if (event.request.method !== "GET" || url.origin !== self.location.origin) {
        return;
    }
    if (event.request.mode === "navigate" && url.pathname.startsWith("/app/")) {
        event.respondWith(appNavigation(event.request));
        return;
    }
    if (
        url.pathname.startsWith("/assets/") ||
        [
            "/app-icon-192.png",
            "/app-icon-512.png",
            "/apple-touch-icon.png",
            "/favicon.ico",
            "/favicon.svg",
            "/manifest.json",
        ].includes(url.pathname)
    ) {
        event.respondWith(cacheFirst(event.request));
    }
});

async function appNavigation(request) {
    const cache = await caches.open(APP_CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) await cache.put(APP_SHELL_URL, response.clone());
        return response;
    } catch {
        return (
            (await cache.match(APP_SHELL_URL)) ||
            new Response("Vex is unavailable offline.", {
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                status: 503,
            })
        );
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(APP_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
}

async function receiveShare(request) {
    try {
        const form = await request.formData();
        const id = createShareID();
        const files = form
            .getAll("files")
            .filter((value) => value instanceof File && value.size > 0)
            .slice(0, 10)
            .map((file) => ({
                contentType: file.type || "application/octet-stream",
                data: file,
                fileName: file.name || `shared-file-${Date.now()}`,
                lastModified: file.lastModified,
            }));
        await storeShare({
            createdAt: Date.now(),
            files,
            id,
            text: textValue(form.get("text")),
            title: textValue(form.get("title")),
            url: textValue(form.get("url")),
        });
        return Response.redirect(
            new URL(`/app/share?id=${encodeURIComponent(id)}`, request.url),
            303,
        );
    } catch {
        return Response.redirect(
            new URL("/app/share?error=unavailable", request.url),
            303,
        );
    }
}

function storeShare(record) {
    return openShareDatabase().then(
        (database) =>
            new Promise((resolve, reject) => {
                const transaction = database.transaction(
                    SHARE_STORE,
                    "readwrite",
                );
                const store = transaction.objectStore(SHARE_STORE);
                const existing = store.getAll();
                existing.onsuccess = () => {
                    const cutoff = Date.now() - SHARE_MAX_AGE_MS;
                    for (const candidate of existing.result) {
                        if (candidate.createdAt < cutoff)
                            store.delete(candidate.id);
                    }
                    store.put(record);
                };
                existing.onerror = () => store.put(record);
                transaction.oncomplete = () => {
                    database.close();
                    resolve();
                };
                transaction.onerror = () => {
                    database.close();
                    reject(transaction.error);
                };
                transaction.onabort = () => {
                    database.close();
                    reject(transaction.error);
                };
            }),
    );
}

function deleteShare(id) {
    if (!id) return Promise.resolve();
    return openShareDatabase().then(
        (database) =>
            new Promise((resolve, reject) => {
                const transaction = database.transaction(
                    SHARE_STORE,
                    "readwrite",
                );
                transaction.objectStore(SHARE_STORE).delete(id);
                settleShareTransaction(database, transaction, resolve, reject);
            }),
    );
}

function pruneExpiredShares(now = Date.now()) {
    return openShareDatabase().then(
        (database) =>
            new Promise((resolve, reject) => {
                const transaction = database.transaction(
                    SHARE_STORE,
                    "readwrite",
                );
                const store = transaction.objectStore(SHARE_STORE);
                const existing = store.getAll();
                existing.onsuccess = () => {
                    const cutoff = now - SHARE_MAX_AGE_MS;
                    for (const candidate of existing.result) {
                        if (candidate.createdAt < cutoff) {
                            store.delete(candidate.id);
                        }
                    }
                };
                settleShareTransaction(database, transaction, resolve, reject);
            }),
    );
}

function settleShareTransaction(database, transaction, resolve, reject) {
    transaction.oncomplete = () => {
        database.close();
        resolve();
    };
    transaction.onerror = () => {
        database.close();
        reject(transaction.error);
    };
    transaction.onabort = () => {
        database.close();
        reject(transaction.error);
    };
}

function openShareDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(SHARE_DATABASE, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(SHARE_STORE)) {
                request.result.createObjectStore(SHARE_STORE, {
                    keyPath: "id",
                });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function textValue(value) {
    return typeof value === "string" ? value.trim() : "";
}

function createShareID() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) =>
        value.toString(16).padStart(2, "0"),
    ).join("");
}

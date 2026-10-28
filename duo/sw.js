// Deployed at the site root so it controls the whole app
const CACHE = "duo-ds-v1";
const PRECACHE = [
    "./",
    "duo/duo.css",
    "duo/duo.js",
    "duo/manifest.webmanifest",
    "duo/icons/icon-192.png",
    "duo/icons/apple-touch-icon.png",
    "data/loader.js",
    "data/emulator.min.js",
    "data/emulator.min.css",
    "data/compression/extract7z.js"
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// Cross-origin isolation lets the threaded core use SharedArrayBuffer
function isolate(res) {
    if (!res || res.status === 0 || res.type === "opaque") return res;
    const headers = new Headers(res.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function networkFirst(req) {
    const cache = await caches.open(CACHE);
    try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
    } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
    }
}

async function staleWhileRevalidate(req, event) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const update = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
    });
    if (hit) {
        event.waitUntil(update.catch(() => {}));
        return hit;
    }
    return update;
}

self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== self.location.origin) return;
    // Cores are large and only change with a deploy, so serve them from cache first
    const res = url.pathname.endsWith(".data") ? staleWhileRevalidate(req, event) : networkFirst(req);
    event.respondWith(res.then(isolate));
});

const CACHE_PREFIX = `controle-gastos-shell:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_FILES = ["./", "./index.html", "./script.js", "./style.css"]
    .map((file) => new URL(file, self.registration.scope).href);
const SDK_FILES = ["app", "database", "auth"].map((name) =>
    `https://www.gstatic.com/firebasejs/10.12.2/firebase-${name}-compat.js`);

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_FILES, ...SDK_FILES])));
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    url.search = "";
    if(event.request.method !== "GET" || ![...APP_FILES, ...SDK_FILES].includes(url.href)) return;
    // Apenas os arquivos do app entram aqui. Autenticação e banco continuam no SDK.
    const cacheKey = url.href;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(cacheKey);
        if(SDK_FILES.includes(cacheKey) && cached) return cached;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(event.request, { signal: controller.signal });
            if(response.ok){
                await cache.put(cacheKey, response.clone());
                return response;
            }
            return cached || response;
        } catch(error){
            if(cached) return cached;
            throw error;
        } finally {
            clearTimeout(timer);
        }
    })());
});

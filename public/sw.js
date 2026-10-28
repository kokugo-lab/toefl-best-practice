// 電波がなくても開けるように、画面を端末に保存しておく（Service Worker）。
// 画面は通信を優先して最新版を使い、つながらない・遅い（4秒）ときだけ保存した版を出す。問題の生成（/api/）は保存しない。
const CACHE = "tbp-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const isPage = req.mode === "navigate";
  const key = isPage ? "/" : url.pathname;          // 画面は1つの鍵で保存（?v=… の確認用アクセスで増やさない）
  e.respondWith(
    Promise.race([
      fetch(req).then((r) => {
        if (r.ok && (isPage || !url.search)) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(key, c)); }
        return r;
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 4000)),
    ]).catch(() => caches.match(key).then((r) => r || caches.match("/")).then((r) => r || Response.error()))
  );
});

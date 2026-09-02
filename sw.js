// JSF Navi 2026 Service Worker
// VERSION を上げると全キャッシュが更新される（データ更新時はここを変える）
const VERSION = "v15";
const CACHE = `jsf-navi-${VERSION}`;

const APP_SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/store.js",
  "js/util.js",
  "data/venues.json",
  "data/performances.json",
  "data/walktimes.json",
  "data/routes.json",
  "data/tieup.json",
  "icon.svg",
  "manifest.webmanifest",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  // addAllはブラウザのHTTPキャッシュ経由で古いファイルを拾うことがあるため、
  // cache: "reload" でネットワークから確実に最新を取得してから保存する
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(
        APP_SHELL.map((url) => fetch(url, { cache: "reload" }).then((res) => c.put(url, res)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 地図タイルはキャッシュせず素通し（容量対策）
  if (url.hostname === "tile.openstreetmap.org") return;
  // データはネットワーク優先（最新の変更を反映）、失敗時キャッシュ
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // それ以外はキャッシュ優先
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});

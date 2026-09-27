// Cache-first app-shell service worker. Only ever registered when the app is
// served over http(s); the file:// double-click flow never touches this.
// Bump the version whenever any shell asset changes so clients update.
const CACHE = "compress-lab-v14";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/state.js",
  "./js/codecs.js",
  "./js/zip.js",
  "./js/worker.js",
  "./js/imageio.js",
  "./js/compare.js",
  "./js/batch.js",
  "./js/app.js",
  "./js/meta.js",
  "./js/pdf.js",
  "./js/toolkit.js",
  "./js/tools/pdf.js",
  "./js/tools/split.js",
  "./js/editor.js",
  "./js/tools/crop.js",
  "./js/tools/metadata.js",
  "./js/tools/redact.js",
  "./js/tools/stitch.js",
  "./js/tools/collage.js",
  "./js/gif.js",
  "./js/tools/gif.js",
  "./js/tools/frame.js",
  "./js/tools/resize.js",
  "./js/tools/adjust.js",
  "./js/tools/watermark.js",
  "./js/tools/palette.js",
  "./js/tools/convert.js",
  "./js/qr.js",
  "./js/tools/qr.js",
  "./js/tools/pdfimages.js",
  "./js/tools/bgremove.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: "reload" skips the browser's HTTP cache, so a new version can
      // never be filled with stale copies of the old files.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }
  // Ignore the #hash (tool routes) and any ?query when matching the shell.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

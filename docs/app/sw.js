const CACHE = 'woodworking-planner-v3';
const FILES = ['.', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg', 'index.html', 'manifest.webmanifest', 'src/app.js', 'src/debug.js', 'src/format.js', 'src/joints.js', 'src/model.js', 'src/project.js', 'src/scene.js', 'src/storage.js', 'styles.css', 'vendor/three/addons/OrbitControls.js', 'vendor/three/LICENSE', 'vendor/three/three.core.js', 'vendor/three/three.module.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});

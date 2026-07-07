// Minimal app-shell cache so reopening the installed app with no signal
// shows the UI (which can then show its own offline state) instead of a
// blank/network-error page. Deliberately NOT a general-purpose offline data
// cache -- Supabase calls (different origin) are never touched here; this
// only ever serves static build assets and the HTML shell.
const CACHE_NAME = 'rop-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App shell (HTML): network-first so a signal always gets the latest
  // deploy, falling back to whatever shell was cached last time.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then(r => r || caches.match(req)))
    );
    return;
  }

  // Static assets (content-hashed JS/CSS/icons): cache-first is safe since a
  // new deploy ships new filenames, not new content at the same URL.
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

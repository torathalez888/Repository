const CACHE_NAME = 'torath-alez-v3';
const SHELL_FILES = ['./manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/**
 * استراتيجية "الشبكة أولاً": يحاول يجيب أحدث نسخة من الإنترنت دايماً.
 * يستخدم النسخة المخزّنة مؤقتاً فقط لو ما فيه إنترنت (احتياطي للعمل بدون اتصال).
 * هذا يمنع مشكلة "الكاش القديم" اللي كانت تحتاج مسح يدوي بعد كل تحديث.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

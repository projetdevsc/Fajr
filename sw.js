/* ═══════════════════════════════════
   FAJR WAKE — Service Worker
   Background alarm + caching
   ═══════════════════════════════════ */

const CACHE_NAME = 'fajr-wake-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

// ─── Install: cache assets ───
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ───
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: network first, cache fallback ───
self.addEventListener('fetch', (e) => {
  // Don't cache API calls or audio
  if (e.request.url.includes('api.aladhan.com') || e.request.url.includes('cdn.aladhan.com')) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ─── Message from main thread ───
let alarmTimeout = null;

self.addEventListener('message', (e) => {
  if (e.data.type === 'SCHEDULE_ALARM') {
    const { hour, minute } = e.data;
    scheduleAlarm(hour, minute);
  }
});

function scheduleAlarm(hour, minute) {
  if (alarmTimeout) clearTimeout(alarmTimeout);

  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);

  // If time already passed today, schedule for tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const ms = target - now;
  console.log(`[SW] Alarm scheduled in ${Math.round(ms / 60000)} minutes`);

  alarmTimeout = setTimeout(() => {
    // Fire notification
    self.registration.showNotification('🌙 Fajr Wake — Lève-toi !', {
      body: 'Il est l\'heure de la prière du Fajr. Ouvre l\'app pour désactiver l\'alarme.',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" x="50" text-anchor="middle" font-size="80">🌙</text></svg>',
      tag: 'fajr-alarm',
      requireInteraction: true,
      vibrate: [500, 200, 500, 200, 500, 200, 500],
      actions: [
        { action: 'open', title: 'Ouvrir Fajr Wake' }
      ]
    });

    // Try to wake up the main thread
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: 'ALARM_TRIGGER' });
      });
    });
  }, ms);
}

// ─── Notification click ───
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      // Focus existing window
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'ALARM_TRIGGER' });
          return;
        }
      }
      // Open new window
      return self.clients.openWindow('./');
    })
  );
});

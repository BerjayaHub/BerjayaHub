// Service worker Berjaya Hub — dua fungsi:
// 1. Menampilkan notifikasi push (reminder clock in) yang dikirim Edge Function.
// 2. Prasyarat wajib supaya app bisa "Add to Home Screen" (PWA) -- di iOS,
//    push notification HANYA jalan kalau app sudah di-install lewat cara ini.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Berjaya Hub', body: 'Kamu punya notifikasi baru.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (err) {
    if (event.data) payload.body = event.data.text();
  }

  const options = {
    body: payload.body,
    icon: payload.icon || 'images/logo.svg',
    badge: payload.badge || 'images/logo.svg',
    data: { url: payload.url || './' },
    vibrate: [200, 100, 200],
    tag: payload.tag || 'berjaya-hub-reminder',
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(targetUrl.replace('./', '')));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});

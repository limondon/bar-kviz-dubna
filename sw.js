const CACHE_NAME = 'bar-v2';
const ASSETS = [
  './',
  'index.html',
  'guest.html',
  'style.css',
  'manifest.json',
  'js/main.js',
  'js/state.js',
  'js/firebase.js',
  'js/utils.js',
  'js/render.js',
  'js/orders.js',
  'js/tables.js',
  'js/menu.js',
  'js/ui.js',
  'js/stock.js',
  'js/notifications.js',
  'js/calls.js',
  'js/quiz.js',
  'js/menu-data.js',
];

// ═══════════════════════════
//  INSTALL — кэшируем основные файлы
// ═══════════════════════════
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ═══════════════════════════
//  ACTIVATE — чистим старый кэш
// ═══════════════════════════
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ═══════════════════════════
//  FETCH — сначала сеть, потом кэш
// ═══════════════════════════
self.addEventListener('fetch', e => {
  // Не кэшируем Firebase запросы
  if (e.request.url.includes('firebase') || e.request.url.includes('gstatic')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ═══════════════════════════
//  PUSH NOTIFICATIONS
// ═══════════════════════════
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '🍺 Новый заказ!';
  const options = {
    body: data.body || 'Новый заказ в очереди',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    vibrate: [150, 80, 150, 80, 150],
    tag: 'new-order',           // заменяет предыдущее уведомление того же типа
    renotify: true,             // вибрирует даже если уведомление уже есть
    requireInteraction: false,
    silent: false,
    data: { url: './' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ═══════════════════════════
//  КЛИК ПО УВЕДОМЛЕНИЮ — открывает приложение
// ═══════════════════════════
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Если приложение уже открыто — фокус на него
      for (const client of list) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // Иначе открываем новое окно
      return clients.openWindow('./');
    })
  );
});

// ═══════════════════════════
//  СООБЩЕНИЯ ОТ СТРАНИЦЫ
//  Страница отправляет NOTIFY_NEW_ORDER → SW показывает уведомление
// ═══════════════════════════
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'NOTIFY_NEW_ORDER') {
    const { table, count } = e.data;
    self.registration.showNotification('🍺 Новый заказ!', {
      body: `Стол ${table} — ${count} позиц.`,
      icon: 'icons/icon-192.png',
      vibrate: [150, 80, 150, 80, 150],
      tag: 'new-order',
      renotify: true,
      silent: false,
    });
  }
});

const CACHE_NAME = 'bar-v35';
const ASSETS = [
  './',
  'index.html',
  'guest.html',
  'guest.css',
  'style.css',
  'manifest.json',
  'js/main.js',
  'js/archive.js',
  'js/state.js',
  'js/firebase.js',
  'js/guest.js',
  'js/guest-api.js',
  'js/counters.js',
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
  // Activate on the next clean visit; do not replace code under an active order.
});

// ═══════════════════════════
//  ACTIVATE — чистим старый кэш
// ═══════════════════════════
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => /^bar-v\d+$/.test(k) && k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ═══════════════════════════
//  FETCH — сначала сеть, потом кэш
// ═══════════════════════════
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  // Only our static GET resources belong in the application cache.
  if (e.request.method !== 'GET' || url.origin !== scope.origin) return;
  const relative = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null;
  if (relative === null || !ASSETS.includes(relative || './')) return;
  const key = new URL(relative || './', scope).href;
  e.respondWith(fetch(e.request).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(key) || new Response('Нет соединения. Подключитесь к сети и обновите страницу.', {
      status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}
    });
  }));
});

// ═══════════════════════════
//  PUSH NOTIFICATIONS
// ═══════════════════════════
self.addEventListener('push', e => {
  let data={};
  try{data=e.data?e.data.json():{};}catch{data={};}
  const title = data.title || '🍺 Новый заказ!';
  const options = {
    body: data.body || 'Новый заказ в очереди',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    vibrate: [150, 80, 150, 80, 150],
    tag: data.tag || 'new-order',
    renotify: true,             // вибрирует даже если уведомление уже есть
    requireInteraction: false,
    silent: false,
    data: { url: data.url || './' }
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
      return clients.openWindow(e.notification.data?.url||'./');
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
  } else if(e.data&&e.data.type==='NOTIFY_WAITER_CALL'){
    self.registration.showNotification('🔔 Вызов официанта!',{
      body:`Стол ${e.data.table} зовёт официанта`,icon:'icons/icon-192.png',badge:'icons/icon-192.png',tag:'waiter-call',renotify:true,silent:false,data:{url:'./?push=calls'}
    });
  }
});

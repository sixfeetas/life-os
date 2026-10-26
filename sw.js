/* Life OS · Service Worker
   策略：全部「网络优先，缓存兜底」
   —— 本地工具必须保证改完代码刷新就见效，离线时仍可用。
   每次改样式/脚本，把 CACHE 版本号 +1。
*/
const CACHE = 'lifeos-v16';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './shared/theme.css',
  './shared/util.js',
  './shared/data.js',
  './shared/store.js',
  './shared/cloud.js',
  './app.js',
  './tab-log.js',
  './tab-plan.js',
  './tab-insight.js'
];

self.addEventListener('install', e => {
  // 新版本立即接管，不等旧页面关闭
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// 页面可以主动要求跳过等待
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isNav = req.mode === 'navigate';

  e.respondWith(
    fetch(req)
      .then(res => {
        // 拿到新内容就顺手更新缓存（不阻塞返回）
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => {
        // 离线兜底
        return caches.match(req).then(hit => {
          if (hit) return hit;
          if (isNav) return caches.match('./index.html');
          return Response.error();
        });
      })
  );
});

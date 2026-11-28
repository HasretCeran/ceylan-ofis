// Ceylan Ofis service worker — her zaman önce internetten en güncel dosyayı alır,
// internet yoksa son kaydedilen sürümle açılır.
const CACHE = 'ceylan-ofis-v1.30.3';
const SHELL = ['./', './index.html', './app.js', './config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/ceylan-logo.svg', './icons/ceylan-logo-koyu.svg', './teklif-cikti.js', './hizli-teklif.js', './siparis.js', './depo.js', './sayim.js', './stok-aktar.js', './satinalma.js', './rapor.js', './icerik.js', './onizle.js', './sablon/teklif-sablonu.xlsx'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const ayniSite = u.origin === location.origin;
  const cdn = /(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)$/.test(u.hostname);
  if (!ayniSite && !cdn) return;               // Supabase istekleri hiç önbelleğe alınmaz
  if (ayniSite && u.pathname.endsWith('version.json')) return;
  if (cdn) {                                   // sürümü sabit kütüphaneler: önce önbellek
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const k = res.clone(); caches.open(CACHE).then(c => c.put(r, k)); return res; })));
    return;
  }
  e.respondWith(fetch(r, {cache: 'no-cache'}).then(res => { if (res.ok) { const k = res.clone(); caches.open(CACHE).then(c => c.put(r, k)); } return res; })
    .catch(() => caches.match(r, {ignoreSearch: true}).then(m => m || caches.match('./index.html'))));
});

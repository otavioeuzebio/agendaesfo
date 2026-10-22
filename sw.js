/**
 * Service worker — faz o app abrir e funcionar sem internet.
 *
 * Estratégia:
 *  - Instalação: guarda todos os arquivos do app (app shell) no cache.
 *  - Navegação: tenta a rede (para pegar atualizações) e cai no cache offline.
 *  - Demais arquivos: cache primeiro, rede em segundo plano para atualizar.
 *
 * Ao publicar uma nova versão, altere VERSAO para forçar a atualização.
 */
const VERSAO = 'agenda-cadete-v1.2.0';
const ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app.css',
  './app.js',
  './store.js',
  './agenda.js',
  './ics.js',
  './modelos.js',
  './catalog.js',
  './dates.js',
  './quickParse.js',
  './brasao-apmg.png',
  './brasao-esfo.png',
  './formacao.jpg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copia = res.clone(); caches.open(VERSAO).then((c) => c.put('./index.html', copia)); return res; })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cache) => {
      const rede = fetch(req)
        .then((res) => { if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); } return res; })
        .catch(() => cache);
      return cache || rede;
    }),
  );
});

// Tocar no aviso abre (ou foca) o app e mostra a missão.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const chave = e.notification.data?.chave;
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const alvo = janelas[0];
    if (alvo) { await alvo.focus(); alvo.postMessage({ tipo: 'abrir', chave }); }
    else await self.clients.openWindow('./');
  })());
});

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
const VERSAO = 'agenda-cadete-v2.0.0';
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
  './firebase-config.js',
  './acesso.js',
  './portao.js',
  './catalog.js',
  './dates.js',
  './quickParse.js',
  './extras.js',
  './cripto.js',
  './nuvem.js',
  './gcal.js',
  './escalaPdf.js',
  './brasao-apmg.png',
  './brasao-esfo.png',
  './formacao.jpg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' ignora o cache HTTP do navegador, para nunca instalar arquivos antigos
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Bibliotecas externas (Firebase na gstatic, pdf.js na jsDelivr): guardadas para usar offline.
const BIBLIOTECAS = ['https://www.gstatic.com', 'https://cdn.jsdelivr.net'];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const origem = new URL(req.url).origin;
  if (BIBLIOTECAS.includes(origem)) {
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then((cache) => cache.put(req, copia)); }
      return res;
    })));
    return;
  }
  if (origem !== self.location.origin) return;

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
    if (alvo) { await alvo.focus(); if (chave) alvo.postMessage({ tipo: 'abrir', chave }); }
    else await self.clients.openWindow(chave ? './#abrir=' + encodeURIComponent(chave) : './');
  })());
});

/* ---------- Lembretes com o app fechado (Firebase Cloud Messaging) ----------
 * A rotina automática só repassa o texto CRIPTOGRAFADO. Aqui, no aparelho,
 * ele é aberto com a chave da conta guardada no IndexedDB (a mesma de cripto.js).
 */
function lerChaveConta(uid) {
  return new Promise((ok) => {
    const r = indexedDB.open('agenda-cadete', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('chaves');
    r.onerror = () => ok(null);
    r.onsuccess = () => {
      try {
        const tx = r.result.transaction('chaves', 'readonly');
        const q = tx.objectStore('chaves').get('conta:' + uid);
        q.onsuccess = () => ok(q.result || null);
        q.onerror = () => ok(null);
      } catch (e) { ok(null); }
    };
  });
}
const deB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

async function abrirLembrete(d) {
  try {
    const chave = await lerChaveConta(d.uid);
    if (!chave) return null;
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(d.iv) }, chave, deB64(d.dados));
    return JSON.parse(new TextDecoder().decode(claro));
  } catch (e) { return null; }
}

self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) {}
  const d = p.data || p;
  e.waitUntil((async () => {
    // se o app está aberto e visível, ele mesmo já avisa
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const l = d.iv ? await abrirLembrete(d) : null;
    if (l && janelas.some((j) => j.visibilityState === 'visible')) {
      for (const j of janelas) j.postMessage({ tipo: 'lembrete', chave: l.chave });
    }
    const titulo = l ? l.titulo : 'Agenda do Cadete';
    const corpo = l ? l.corpo : 'Você tem um lembrete. Toque para abrir.';
    await self.registration.showNotification(titulo, {
      body: corpo, tag: l?.tag || 'lembrete', icon: 'icon-192.png', badge: 'icon-192.png',
      data: { chave: l?.chave || '' }, requireInteraction: !!l?.critico,
    });
  })());
});

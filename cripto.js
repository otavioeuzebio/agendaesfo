/**
 * Criptografia de ponta a ponta (Web Crypto, dentro do aparelho).
 *
 *  - Chave da conta: derivada da SENHA de login (PBKDF2-SHA256, 310 mil
 *    iterações, sal = id da conta) → AES-GCM 256. Ela nunca sai do aparelho
 *    e fica guardada no IndexedDB como chave "não exportável".
 *    Quem só tem acesso ao Firebase (inclusive o administrador) vê apenas
 *    dados embaralhados.
 *  - Par de chaves de troca (ECDH P-256): permite que dois cadetes troquem
 *    dados de um serviço sem que mais ninguém consiga ler. A chave privada
 *    viaja só dentro do cofre criptografado da própria conta.
 *
 * Também é usado pelo service worker (lembretes com o app fechado), por isso
 * não depende de nada da tela.
 */
const BANCO = 'agenda-cadete';
const LOJA = 'chaves';
const ITERACOES = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function abrirBanco() {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}
async function idb(modo, fn) {
  const db = await abrirBanco();
  return new Promise((ok, falha) => {
    const tx = db.transaction(LOJA, modo);
    const req = fn(tx.objectStore(LOJA));
    tx.oncomplete = () => { db.close(); ok(req?.result); };
    tx.onerror = () => { db.close(); falha(tx.error); };
  });
}
const lerIdb = (k) => idb('readonly', (s) => s.get(k));
const gravarIdb = (k, v) => idb('readwrite', (s) => s.put(v, k));
const apagarIdb = (k) => idb('readwrite', (s) => s.delete(k));

export const b64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const deB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

/* ---------- chave da conta ---------- */
export async function derivarChave(senha, uid) {
  const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('agenda-cadete:' + uid), iterations: ITERACOES, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
/** Deriva a chave a partir da senha e guarda neste aparelho. */
export async function guardarChaveDaSenha(senha, uid) {
  const k = await derivarChave(senha, uid);
  await gravarIdb('conta:' + uid, k);
  return k;
}
export const chaveDaConta = (uid) => lerIdb('conta:' + uid).catch(() => null);
export const esquecerChave = (uid) => Promise.all([apagarIdb('conta:' + uid), apagarIdb('par:' + uid)]).catch(() => {});

export async function cifrar(chave, objeto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dados = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, enc.encode(JSON.stringify(objeto)));
  return { iv: b64(iv), dados: b64(dados) };
}
export async function decifrar(chave, { iv, dados }) {
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(iv) }, chave, deB64(dados));
  return JSON.parse(dec.decode(claro));
}

/* ---------- par de chaves para trocas ---------- */
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
export async function novoPar() {
  const p = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  return { privada: await crypto.subtle.exportKey('jwk', p.privateKey), publica: await crypto.subtle.exportKey('jwk', p.publicKey) };
}
export const guardarPar = (uid, par) => gravarIdb('par:' + uid, par);
export const lerPar = (uid) => lerIdb('par:' + uid).catch(() => null);

/** Chave AES comum entre a minha privada e a pública do outro cadete. */
export async function chaveComum(privadaJwk, publicaJwk) {
  const priv = await crypto.subtle.importKey('jwk', privadaJwk, ECDH, false, ['deriveKey']);
  const pub = await crypto.subtle.importKey('jwk', { ...publicaJwk, key_ops: [] }, ECDH, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Resumo curto (hex) — usado para ids de eventos e comparação de chaves. */
export async function resumo(texto, tam = 32) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(texto));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, tam);
}

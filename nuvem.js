/**
 * Recursos que usam a internet (Firebase), todos opcionais:
 *
 *   cofres/{uid}      cópia CRIPTOGRAFADA da agenda (sincroniza aparelhos)
 *   push/{uid}        tokens do aparelho + horários de lembrete (texto criptografado)
 *   perfis/{email}    nome, nome de guerra, turma e chave pública (só quem participa da turma)
 *   avisos/{id}       mural do administrador
 *   trocas/{id}       pedidos de troca entre cadetes (dados do serviço criptografados entre os dois)
 *   escalas/{id}      escalas da turma publicadas pelo escalante
 *   atividade/{email} último acesso (para estatísticas do administrador, sem conteúdo)
 *
 * Quem administra o Firebase vê só e-mails, datas e dados embaralhados:
 * a chave que abre a agenda nasce da senha de cada cadete e fica no aparelho dele.
 */
import { carregar, confirmarSenha } from './acesso.js';
import { store } from './store.js';
import { listarDocs, removidosDocs, gravarDocs, mesclarDocs } from './documentos.js';
import { chaveDaConta, guardarChaveDaSenha, cifrar, decifrar, novoPar, guardarPar, lerPar, chaveComum } from './cripto.js';

export const VERSAO_APP = '2.9.1';
let conta = null; // { uid, email, admin, papel }
const ouvintes = new Set();
const status = { cofre: 'desligado', ultimaSinc: 0, erro: '', push: 'desligado' };
const avisar = () => ouvintes.forEach((f) => f(status));
export const statusNuvem = () => status;
export const aoMudarNuvem = (f) => { ouvintes.add(f); return () => ouvintes.delete(f); };
const online = () => navigator.onLine !== false;
const hojeTxt = () => new Date().toISOString().slice(0, 10);
const lerLocal = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? padrao; } catch (e) { return padrao; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

export function iniciarNuvem(c) {
  conta = c;
  status.ultimaSinc = lerLocal(`agenda-cadete:sinc:${c.uid}`, 0);
  store.assinar(() => agendarSincronizacao());
  window.addEventListener('online', () => sincronizar());
  // traz o que foi feito em outro aparelho: ao voltar para o app e a cada 2 min com ele aberto
  let ultimaVolta = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - ultimaVolta > 20000) { ultimaVolta = Date.now(); sincronizar(); }
  });
  setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 2 * 60000);
  sincronizar();
  registrarAtividade();
}

/* ======================= cofre criptografado ======================= */
let timerSinc = null, sincronizando = null, ignorarProxima = false;
export function agendarSincronizacao() {
  if (ignorarProxima) { ignorarProxima = false; return; }
  clearTimeout(timerSinc);
  timerSinc = setTimeout(() => sincronizar(), 4000);
}

/* Escalas completas (consulta) vão compactadas junto com a agenda criptografada. */
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
async function compactar(obj) {
  const txt = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return { json: txt };
  const buf = await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return { gz: b64(new Uint8Array(buf)) };
}
async function descompactar(p) {
  if (!p) return null;
  if (p.json) return JSON.parse(p.json);
  if (p.gz && typeof DecompressionStream !== 'undefined') {
    const bin = Uint8Array.from(atob(p.gz), (c) => c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  return null;
}
let aoReceberDocs = () => {};
export const definirAoReceberDocs = (f) => { aoReceberDocs = f; };

/** Estado enviado: a agenda inteira (o tema fica de cada aparelho). */
const paraEnviar = () => store.get();

/**
 * Busca a cópia da nuvem, junta com a daqui e envia o resultado.
 * Resultado: "ok" | "sem-chave" | "chave-diferente" | "offline" | "erro"
 */
export async function sincronizar({ forcarEnvio = false } = {}) {
  if (!conta) return 'erro';
  if (sincronizando) return sincronizando;
  sincronizando = (async () => {
    const chave = await chaveDaConta(conta.uid);
    if (!chave) { status.cofre = 'sem-chave'; avisar(); return 'sem-chave'; }
    if (!online()) { status.cofre = 'offline'; avisar(); return 'offline'; }
    try {
      const { fs, db } = await carregar();
      const ref = fs.doc(db, 'cofres', conta.uid);
      const snap = await fs.getDoc(ref);
      let par = await lerPar(conta.uid);
      let remotoTxt = '', remotoDocs = null;
      if (snap.exists() && !forcarEnvio) {
        let conteudo;
        try { conteudo = await decifrar(chave, snap.data()); }
        catch (e) { status.cofre = 'chave-diferente'; avisar(); return 'chave-diferente'; }
        if (conteudo.par) { par = conteudo.par; await guardarPar(conta.uid, par); }
        remotoTxt = JSON.stringify(conteudo.estado);
        remotoDocs = conteudo.docs || null;
        ignorarProxima = true;
        if (!store.mesclar(conteudo.estado)) ignorarProxima = false;
      }
      if (!par) { par = await novoPar(); await guardarPar(conta.uid, par); }
      const local = paraEnviar();
      // escalas completas: junta as daqui com as da nuvem
      const docsAqui = listarDocs(conta.uid), rmAqui = removidosDocs(conta.uid);
      let docsNuvem = [], rmNuvem = {};
      try { const r = await descompactar(remotoDocs); if (r) { docsNuvem = r.docs || []; rmNuvem = r.removidos || {}; } } catch (e) { /* cópia antiga sem escalas */ }
      const juntos = mesclarDocs(docsAqui, docsNuvem, rmAqui, rmNuvem);
      const assinatura = (l, rm) => JSON.stringify([l.map((d) => d.id + ':' + d.importadoEm), rm]);
      if (assinatura(juntos.docs, juntos.removidos) !== assinatura(docsAqui, rmAqui)) { gravarDocs(conta.uid, juntos.docs, juntos.removidos); aoReceberDocs(); }
      const docsMudaram = assinatura(juntos.docs, juntos.removidos) !== assinatura(docsNuvem, rmNuvem);
      if (forcarEnvio || docsMudaram || JSON.stringify(local) !== remotoTxt || !snap.data()?.temPar) {
        let cifra = await cifrar(chave, { estado: local, par, docs: await compactar(juntos) });
        // limite do documento no Firebase: se passar, leva só as escalas mais recentes
        for (const n of [8, 3, 0]) { if (cifra.dados.length < 880000) break; cifra = await cifrar(chave, { estado: local, par, docs: await compactar({ docs: juntos.docs.slice(0, n), removidos: juntos.removidos }) }); }
        await fs.setDoc(ref, { ...cifra, temPar: true, atualizadoEm: fs.serverTimestamp() });
      }
      status.cofre = 'ok'; status.erro = ''; status.ultimaSinc = Date.now();
      gravarLocal(`agenda-cadete:sinc:${conta.uid}`, status.ultimaSinc);
      avisar();
      atualizarPush().catch(() => {});
      return 'ok';
    } catch (e) {
      console.warn('Sincronização falhou', e);
      status.cofre = 'erro'; status.erro = e?.code || e?.message || ''; avisar();
      return 'erro';
    }
  })();
  try { return await sincronizando; } finally { sincronizando = null; }
}

/** Para logins antigos: confere a senha e cria a chave neste aparelho. */
export async function ativarComSenha(senha) {
  await confirmarSenha(senha);
  await guardarChaveDaSenha(senha, conta.uid);
  return sincronizar();
}
/** A cópia da nuvem foi feita com outra senha: substitui pela agenda deste aparelho. */
export const substituirCofre = () => sincronizar({ forcarEnvio: true });

/* ======================= atividade (estatísticas) ======================= */
function plataforma() {
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : 'Computador';
}
export async function registrarAtividade() {
  if (!conta || !online()) return;
  const k = `agenda-cadete:ativ:${conta.uid}`;
  if (lerLocal(k, '') === hojeTxt()) return;
  try {
    const { fs, db } = await carregar();
    const instalado = matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
    await fs.setDoc(fs.doc(db, 'atividade', conta.email), { ultimoAcesso: fs.serverTimestamp(), dia: hojeTxt(), plataforma: plataforma(), instalado, versao: VERSAO_APP });
    gravarLocal(k, hojeTxt());
  } catch (e) { /* estatística é opcional */ }
}
/** Só o administrador consegue ler. Não contém nada da agenda. */
export async function estatisticas() {
  const { fs, db } = await carregar();
  const docs = (await fs.getDocs(fs.collection(db, 'atividade'))).docs.map((d) => d.data());
  const dias = (d) => (Date.now() - new Date(d.dia + 'T12:00:00').getTime()) / 86400000;
  const contar = (f) => docs.filter(f).length;
  const porPlat = {};
  for (const d of docs) porPlat[d.plataforma || '?'] = (porPlat[d.plataforma || '?'] || 0) + 1;
  return {
    total: docs.length,
    hoje: contar((d) => d.dia === hojeTxt()),
    semana: contar((d) => dias(d) <= 7),
    mes: contar((d) => dias(d) <= 30),
    instalados: contar((d) => d.instalado),
    porPlat,
    push: (await fs.getDocs(fs.collection(db, 'push')).catch(() => ({ size: null }))).size,
  };
}

/* ======================= perfil e turma ======================= */
export async function lerMeuPerfil() {
  const { fs, db } = await carregar();
  const s = await fs.getDoc(fs.doc(db, 'perfis', conta.email));
  return s.exists() ? s.data() : null;
}
export async function salvarPerfil({ nome, nomeGuerra, turma, participar }) {
  const { fs, db } = await carregar();
  const ref = fs.doc(db, 'perfis', conta.email);
  if (!participar) { await fs.deleteDoc(ref); return null; }
  let par = await lerPar(conta.uid);
  if (!par) { await sincronizar(); par = await lerPar(conta.uid); }
  if (!par) throw Object.assign(new Error('sem chave'), { code: 'sem-chave' });
  const dados = { email: conta.email, nome: nome.trim(), nomeGuerra: nomeGuerra.trim(), turma: turma.trim(), pub: JSON.stringify(par.publica), atualizadoEm: fs.serverTimestamp() };
  await fs.setDoc(ref, dados);
  return dados;
}
export async function colegasDaTurma(turma) {
  const { fs, db } = await carregar();
  const q = fs.query(fs.collection(db, 'perfis'), fs.where('turma', '==', turma));
  return (await fs.getDocs(q)).docs.map((d) => d.data()).filter((p) => p.email !== conta.email)
    .sort((a, b) => (a.nomeGuerra || a.nome).localeCompare(b.nomeGuerra || b.nome, 'pt'));
}

/* ======================= mural de avisos ======================= */
export async function listarAvisos() {
  const { fs, db } = await carregar();
  const q = fs.query(fs.collection(db, 'avisos'), fs.orderBy('criadoEm', 'desc'), fs.limit(30));
  return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data(), criadoEm: d.data().criadoEm?.toMillis?.() || Date.now() }));
}
export async function publicarAviso(titulo, texto, importante) {
  const { fs, db } = await carregar();
  await fs.addDoc(fs.collection(db, 'avisos'), { titulo: titulo.trim(), texto: texto.trim(), importante: !!importante, criadoEm: fs.serverTimestamp() });
}
export async function apagarAviso(id) {
  const { fs, db } = await carregar();
  await fs.deleteDoc(fs.doc(db, 'avisos', id));
}

/* ======================= trocas de serviço ======================= */
async function chaveComOutro(pubTxt) {
  const par = await lerPar(conta.uid);
  if (!par) throw Object.assign(new Error('sem chave'), { code: 'sem-chave' });
  return chaveComum(par.privada, JSON.parse(pubTxt));
}
/**
 * Pede a troca de um serviço a um colega da mesma turma.
 * Os dados do serviço vão criptografados: só os dois conseguem ler.
 */
export async function pedirTroca({ colega, meuPerfil, servico, motivo, fiscal }) {
  const { fs, db } = await carregar();
  const k = await chaveComOutro(colega.pub);
  const cifra = await cifrar(k, { servico, motivo, fiscal });
  await fs.addDoc(fs.collection(db, 'trocas'), {
    de: conta.email, para: colega.email, turma: meuPerfil.turma,
    deNome: meuPerfil.nomeGuerra || meuPerfil.nome, paraNome: colega.nomeGuerra || colega.nome,
    pubDe: meuPerfil.pub, pubPara: colega.pub,
    ...cifra, status: 'pendente', criadoEm: fs.serverTimestamp(), atualizadoEm: fs.serverTimestamp(),
  });
}
export async function minhasTrocas() {
  const { fs, db } = await carregar();
  const col = fs.collection(db, 'trocas');
  const [env, rec] = await Promise.all([
    fs.getDocs(fs.query(col, fs.where('de', '==', conta.email))),
    fs.getDocs(fs.query(col, fs.where('para', '==', conta.email))),
  ]);
  const abrir = async (d, enviada) => {
    const t = { id: d.id, ...d.data(), enviada, criadoEm: d.data().criadoEm?.toMillis?.() || Date.now() };
    try { Object.assign(t, await decifrar(await chaveComOutro(enviada ? t.pubPara : t.pubDe), t)); }
    catch (e) { t.ilegivel = true; }
    return t;
  };
  const todas = await Promise.all([...env.docs.map((d) => abrir(d, true)), ...rec.docs.map((d) => abrir(d, false))]);
  return todas.sort((a, b) => b.criadoEm - a.criadoEm);
}
/** status: "aceita" | "recusada" (quem recebeu) ou "cancelada" (quem pediu). */
export async function responderTroca(id, novo) {
  const { fs, db } = await carregar();
  await fs.updateDoc(fs.doc(db, 'trocas', id), { status: novo, atualizadoEm: fs.serverTimestamp() });
}
export async function apagarTroca(id) {
  const { fs, db } = await carregar();
  await fs.deleteDoc(fs.doc(db, 'trocas', id));
}

/* ======================= escalas da turma ======================= */
export async function listarEscalas() {
  const { fs, db } = await carregar();
  const q = fs.query(fs.collection(db, 'escalas'), fs.orderBy('criadoEm', 'desc'), fs.limit(12));
  return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data(), criadoEm: d.data().criadoEm?.toMillis?.() || Date.now() }));
}
export async function publicarEscala({ tipo, titulo, linhas }) {
  const { fs, db } = await carregar();
  await fs.addDoc(fs.collection(db, 'escalas'), { tipo, titulo, linhas, publicadoPor: conta.email, criadoEm: fs.serverTimestamp() });
}
export async function apagarEscala(id) {
  const { fs, db } = await carregar();
  await fs.deleteDoc(fs.doc(db, 'escalas', id));
}

/* ======================= lembretes com o app fechado ======================= */
let msg = null;
async function carregarMessaging() {
  if (msg) return msg;
  const { inst, base } = await carregar();
  const m = await import(`${base}/firebase-messaging.js`);
  if (!(await m.isSupported())) throw Object.assign(new Error('Este navegador não recebe avisos com o app fechado.'), { code: 'push/sem-suporte' });
  msg = { m, messaging: m.getMessaging(inst) };
  return msg;
}
export const pushAtivo = () => !!conta && lerLocal(`agenda-cadete:push:${conta.uid}`, false);

/** Liga os avisos com o app fechado neste aparelho. */
export async function ativarPush() {
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted')
    throw Object.assign(new Error('Avisos não autorizados.'), { code: 'push/negado' });
  if (!(await chaveDaConta(conta.uid))) throw Object.assign(new Error('Ative a sincronização antes.'), { code: 'sem-chave' });
  const { m, messaging } = await carregarMessaging();
  const reg = await navigator.serviceWorker.ready;
  const token = await m.getToken(messaging, { serviceWorkerRegistration: reg });
  if (!token) throw new Error('Não foi possível registrar o aparelho.');
  const { fs, db } = await carregar();
  await fs.setDoc(fs.doc(db, 'push', conta.uid), { uid: conta.uid, tokens: fs.arrayUnion(token), atualizadoEm: fs.serverTimestamp() }, { merge: true });
  gravarLocal(`agenda-cadete:push:${conta.uid}`, true);
  gravarLocal(`agenda-cadete:pushtoken:${conta.uid}`, token);
  localStorage.removeItem(`agenda-cadete:pushhash:${conta.uid}`);
  status.push = 'ok'; avisar();
  await atualizarPush();
}
export async function desativarPush() {
  const token = lerLocal(`agenda-cadete:pushtoken:${conta.uid}`, '');
  gravarLocal(`agenda-cadete:push:${conta.uid}`, false);
  try {
    const { fs, db } = await carregar();
    if (token) await fs.setDoc(fs.doc(db, 'push', conta.uid), { tokens: fs.arrayRemove(token) }, { merge: true });
    const { m, messaging } = await carregarMessaging();
    await m.deleteToken(messaging);
  } catch (e) { /* segue desligado neste aparelho */ }
  status.push = 'desligado'; avisar();
}

let fonteLembretes = null; // função que devolve [{ dispara, titulo, corpo, chave, critico }]
export const definirFonteLembretes = (f) => { fonteLembretes = f; };

/** Envia os horários dos próximos lembretes (texto criptografado) para o disparo com o app fechado. */
export async function atualizarPush() {
  if (!pushAtivo() || !fonteLembretes || !online()) return;
  const chave = await chaveDaConta(conta.uid);
  if (!chave) return;
  const lista = fonteLembretes().slice(0, 60);
  const assinatura = JSON.stringify(lista);
  const kHash = `agenda-cadete:pushhash:${conta.uid}`;
  if (lerLocal(kHash, '') === assinatura) return;
  const itens = await Promise.all(lista.map(async (l) => ({ t: l.dispara, ...(await cifrar(chave, l)) })));
  const { fs, db } = await carregar();
  await fs.setDoc(fs.doc(db, 'push', conta.uid), { uid: conta.uid, itens, atualizadoEm: fs.serverTimestamp() }, { merge: true });
  gravarLocal(kHash, assinatura);
}

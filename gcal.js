/**
 * Envia as missões para o Google Agenda da própria pessoa.
 *
 * Usa o login do Google direto no navegador (Google Identity Services):
 * a autorização vale só para este aparelho e o app fala direto com a API
 * do Google Agenda — nada passa pelo Firebase nem pelo administrador.
 *
 * Requer GOOGLE_CLIENT_ID em firebase-config.js (ID público do cliente OAuth).
 */
import { GOOGLE_CLIENT_ID } from './firebase-config.js';
import { resumo } from './cripto.js';

const ESCOPO = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
export const gcalConfigurado = () => !!GOOGLE_CLIENT_ID;

let gis = null;
function carregarGis() {
  if (gis) return gis;
  gis = new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => ok(window.google);
    s.onerror = () => { gis = null; falha(new Error('Sem internet para falar com o Google.')); };
    document.head.append(s);
  });
  return gis;
}

let token = null, validade = 0;
/** Pede (ou renova) a autorização. Precisa ser chamado a partir de um toque. */
export async function autorizar(silencioso = false) {
  if (token && Date.now() < validade - 60000) return token;
  const google = await carregarGis();
  return new Promise((ok, falha) => {
    const cliente = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: ESCOPO,
      prompt: silencioso ? '' : undefined,
      callback: (r) => {
        if (r.error) return falha(new Error(r.error === 'access_denied' ? 'Autorização recusada.' : r.error));
        token = r.access_token; validade = Date.now() + (r.expires_in || 3600) * 1000;
        ok(token);
      },
      error_callback: (e) => falha(new Error(e?.type === 'popup_closed' ? 'Janela do Google fechada.' : 'Não foi possível autorizar.')),
    });
    cliente.requestAccessToken();
  });
}
export function desconectar() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
  token = null; validade = 0;
}

const p2 = (n) => String(n).padStart(2, '0');
const dataSo = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';

/** Evento do Google a partir de um item da agenda. */
export function paraEvento(it, rotuloTipo) {
  const ev = {
    summary: it.titulo,
    location: it.local || undefined,
    description: [rotuloTipo, it.detalhe, it.escala?.oficial ? 'Oficial CPU: ' + it.escala.oficial : '', it.obs, 'Agenda do Cadete'].filter(Boolean).join('\n'),
    reminders: { useDefault: false, overrides: (it.lembretes || []).slice(0, 5).map((m) => ({ method: 'popup', minutes: Math.min(m, 40320) })) },
    extendedProperties: { private: { agendaCadete: it.chave } },
  };
  if (it.diaTodo) {
    ev.start = { date: dataSo(it.inicio) };
    ev.end = { date: dataSo((it.fim || it.inicio) + 86400000) };
  } else {
    ev.start = { dateTime: new Date(it.inicio).toISOString(), timeZone: FUSO };
    ev.end = { dateTime: new Date(it.fim || it.inicio + 3600000).toISOString(), timeZone: FUSO };
  }
  return ev;
}
/** Id de evento aceito pelo Google (letras a–v e números). */
export const idEvento = async (chave) => 'ac' + (await resumo(chave, 40));

async function chamar(metodo, url, corpo) {
  const r = await fetch(url, { method: metodo, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  if (r.status === 401) { token = null; throw new Error('Autorização expirou. Toque de novo em sincronizar.'); }
  return r;
}

/**
 * Cria/atualiza os eventos dos itens e apaga os que saíram da lista.
 * `enviados` = ids já criados antes (guardados no aparelho). Devolve a nova lista de ids.
 */
export async function sincronizarAgenda(itens, rotulo, enviados = []) {
  await autorizar(true);
  const ids = [];
  let criados = 0, atualizados = 0, apagados = 0;
  for (const it of itens) {
    const id = await idEvento(it.chave);
    ids.push(id);
    const ev = paraEvento(it, rotulo(it));
    let r = await chamar('PUT', `${API}/${id}`, ev);
    if (r.status === 404) { r = await chamar('POST', API, { ...ev, id }); if (r.ok) criados++; }
    else if (r.ok) atualizados++;
    if (r.status === 409) { // já existiu e foi apagado: restaura
      r = await chamar('PUT', `${API}/${id}`, { ...ev, status: 'confirmed' });
      if (r.ok) criados++;
    }
    if (!r.ok && r.status !== 409) throw new Error(`Google Agenda recusou (${r.status}).`);
  }
  for (const id of enviados) {
    if (ids.includes(id)) continue;
    const r = await chamar('DELETE', `${API}/${id}`);
    if (r.ok || r.status === 410 || r.status === 404) apagados++;
  }
  return { ids, criados, atualizados, apagados };
}

/**
 * Escalas completas (todos os cadetes), guardadas só neste aparelho.
 *
 * Cada PDF lido (Serviço Interno, Rotina, Desfile, Representação, Planilha de
 * Anotados, NAMCE) fica salvo inteiro para consulta: quem está em cada função,
 * em cada dia. Fica fora da agenda sincronizada (não vai para a nuvem) e nunca
 * guarda CPF — as linhas já chegam sem ele.
 */
import { normalizar } from './escalaPdf.js';

const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
/** Tira qualquer CPF que tenha escapado da leitura. */
const semCpf = (v) => (typeof v === 'string' ? v.replace(CPF, '').replace(/\s+/g, ' ').trim() : Array.isArray(v) ? v.map(semCpf) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, semCpf(x)])) : v);

const MAX = 20;
const chave = (uid) => `agenda-cadete:docs:${uid || 'local'}`;

export function listarDocs(uid) {
  try { return JSON.parse(localStorage.getItem(chave(uid)) || '[]'); } catch (e) { return []; }
}
export function apagarDoc(uid, id) {
  try { localStorage.setItem(chave(uid), JSON.stringify(listarDocs(uid).filter((d) => d.id !== id))); } catch (e) { /* sem espaço */ }
}
/** Guarda (ou substitui) um documento. Devolve o id. */
export function guardarDoc(uid, doc) {
  const datas = (doc.linhas || []).map((l) => l.data).filter(Boolean).sort();
  const id = doc.id || `${doc.tipo}-${datas[0] || ''}-${datas[datas.length - 1] || ''}-${doc.numero || ''}`.replace(/\W+/g, '-');
  const novo = { id, tipo: doc.tipo, titulo: doc.titulo, linhas: semCpf(doc.linhas || []), meta: semCpf(doc.meta || {}), importadoEm: Date.now() };
  const lista = [novo, ...listarDocs(uid).filter((d) => d.id !== id)].slice(0, MAX);
  try { localStorage.setItem(chave(uid), JSON.stringify(lista)); }
  catch (e) { try { localStorage.setItem(chave(uid), JSON.stringify(lista.slice(0, 5))); } catch (e2) { /* sem espaço */ } }
  return id;
}

/** A linha é do próprio cadete? (nome completo ou nome de guerra, exatos). */
export function ehMeu(nome, cfg = {}) {
  const n = normalizar(nome);
  return !!n && (n === normalizar(cfg.nomeCompleto) || n === normalizar(cfg.nomeGuerra));
}

/** Filtra pelo texto buscado (nome, função, sigla…). */
export function filtrar(linhas, busca) {
  const q = normalizar(busca);
  if (!q) return linhas;
  return linhas.filter((l) => normalizar([l.nome, l.detalhe, l.funcao, l.pel, l.secao, l.texto].filter(Boolean).join(' ')).includes(q));
}

/** Agrupa: [{ chave, itens }] mantendo a ordem de aparição. */
export function agrupar(linhas, f) {
  const m = new Map();
  for (const l of linhas) { const k = f(l); if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
  return [...m.entries()].map(([chave, itens]) => ({ chave, itens }));
}

/** Datas da escala e a que deve abrir (hoje, a próxima ou a primeira). */
export function datasDoDoc(doc, hojeYmd) {
  const ds = [...new Set((doc.linhas || []).map((l) => l.data).filter(Boolean))].sort();
  const abrir = ds.includes(hojeYmd) ? hojeYmd : ds.find((d) => d > hojeYmd) || ds[ds.length - 1] || '';
  return { datas: ds, abrir };
}

export const TIPOS_CONSULTA = { interna: 'Serviço Interno', rotina: 'Missões de Rotina', desfile: 'Desfile', representacao: 'Representação', anotados: 'Planilha de Anotados', namce: 'NAMCE' };

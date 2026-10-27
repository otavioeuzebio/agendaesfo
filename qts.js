/**
 * QTS — Quadro de Trabalho Semanal da APMG (lido no aparelho, nada é enviado).
 *
 * Página 1: grade da semana e a legenda (sigla, disciplina, instrutor, H.A.).
 * Páginas 2+: uma por dia, com Aula | Horário | Disciplina (e local na linha
 * de baixo) | Instrutor | Instrutor-adjunto. O leitor usa as páginas do dia,
 * que trazem tudo, e a legenda para os nomes completos e a carga horária.
 */
import { linhas as agrupar, juntar } from './escalaPdf.js';

const p2 = (n) => String(n).padStart(2, '0');
const HORARIO = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;
const VAZIO = /^\*[\s*]*$/; // "***" ou "* * *": sem aula

export const ehQts = (itens) => itens.slice(0, 40).some((i) => /quadro de trabalho semanal/i.test(i.s));

/** Legenda da página 1: { SIGLA: { nome, instrutor, adjuntos[], ha: {dadas,total} } } */
function lerLegenda(itens) {
  const cab = itens.find((i) => i.p === 1 && /^sigla$/i.test(i.s.trim()));
  if (!cab) return {};
  const xs = Object.fromEntries(['disciplina', 'instrutor', 'h.a.'].map((k) => [k, itens.find((i) => i.p === 1 && Math.abs(i.y - cab.y) < 3 && i.s.trim().toLowerCase().startsWith(k))?.x]));
  const rodape = Math.max(...itens.filter((i) => i.p === 1).map((i) => i.y)) - 5; // "1 / 8"
  const corpo = itens.filter((i) => i.p === 1 && i.y > cab.y + 3 && i.y < rodape);
  const out = {};
  let atual = null;
  for (const l of agrupar(corpo, 3)) {
    const sig = l.itens.filter((i) => i.x < (xs.disciplina || 80) - 4);
    const nome = l.itens.filter((i) => i.x >= (xs.disciplina || 80) - 4 && i.x < (xs.instrutor || 300) - 4);
    const inst = l.itens.filter((i) => i.x >= (xs.instrutor || 300) - 4 && i.x < (xs['h.a.'] || 510) - 4);
    const ha = l.itens.filter((i) => i.x >= (xs['h.a.'] || 510) - 4).map((i) => i.s.trim()).find((s) => /^\d+\s*\/\s*\d+$/.test(s));
    if (sig.length) {
      const s = juntar(sig).trim();
      const [d, t] = (ha || '').split('/').map((n) => +n);
      atual = out[s] = { nome: juntar(nome), instrutor: juntar(inst), adjuntos: [], ha: ha ? { dadas: d, total: t } : null };
    } else if (atual && inst.length) {
      const txt = juntar(inst).replace(/^adj:\s*/i, '');
      if (txt) atual.adjuntos.push(txt);
      if (ha && !atual.ha) { const [d, t] = ha.split('/').map((n) => +n); atual.ha = { dadas: d, total: t }; }
    } else if (atual && ha && !atual.ha) { const [d, t] = ha.split('/').map((n) => +n); atual.ha = { dadas: d, total: t }; }
  }
  return out;
}

/** Sigla base para achar na legenda: "DEOP (VA)" → "DEOP". */
export const siglaBase = (s) => String(s || '').replace(/\s*\(.*\)\s*$/, '').trim();

/**
 * Lê o QTS. Devolve:
 * { semana, ano, turma, titulo, dias: [{ data:'aaaa-mm-dd', dow, aulas:[{ n, ini, fim, sigla, local, instrutor, adjuntos[] }] }], legenda }
 */
export function lerQts(itens) {
  const legenda = lerLegenda(itens);
  const dias = [];
  let semana = null, ano = null, turma = '';
  for (const p of [...new Set(itens.map((i) => i.p))].sort((a, b) => a - b)) {
    const doPg = itens.filter((i) => i.p === p);
    const tit = doPg.find((i) => /-\s*DIA\s+\d{2}\/\d{2}\/\d{4}/i.test(i.s));
    if (!tit) continue;
    const m = tit.s.match(/^(.*?)\s*-\s*Semana\s+(\d+)\s*-\s*DIA\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (!m) continue;
    turma = m[1].trim(); semana = +m[2]; ano = +m[5];
    const data = `${m[5]}-${m[4]}-${m[3]}`;
    const cab = doPg.find((i) => /^disciplina$/i.test(i.s.trim()) && i.y > tit.y);
    const xDisc = cab?.x ?? 147;
    const xInst = doPg.find((i) => /^ass\.?\s*instrutor$/i.test(i.s.trim()))?.x ?? 249;
    const xAdj = doPg.find((i) => /instrutor-adjunto/i.test(i.s))?.x ?? 400;
    const xFaltas = doPg.find((i) => /^faltas$/i.test(i.s.trim()))?.x ?? xInst - 50;
    const fimTabela = Math.min(...doPg.filter((i) => /^observa/i.test(i.s.trim())).map((i) => i.y), Infinity);
    const horarios = doPg.filter((i) => HORARIO.test(i.s.trim()) && i.y > (cab?.y ?? tit.y) && i.y < fimTabela).sort((a, b) => a.y - b.y);
    const aulas = horarios.map((h, k) => {
      const y0 = h.y - 6, y1 = (horarios[k + 1]?.y ?? fimTabela) - 6;
      const faixa = doPg.filter((i) => i.y >= y0 && i.y < y1);
      const disc = agrupar(faixa.filter((i) => i.x >= xDisc - 4 && i.x < xFaltas - 2), 3).map((l) => juntar(l.itens));
      const inst = agrupar(faixa.filter((i) => i.x >= xInst - 4 && i.x < xAdj - 4), 3).map((l) => juntar(l.itens));
      const adj = agrupar(faixa.filter((i) => i.x >= xAdj - 4), 3).map((l) => juntar(l.itens));
      const [, h1, m1, h2, m2] = h.s.trim().match(HORARIO);
      const sigla = (disc[0] || '').trim();
      return {
        n: k + 1, ini: `${p2(h1)}:${m1}`, fim: `${p2(h2)}:${m2}`,
        sigla: VAZIO.test(sigla) || !sigla ? '' : sigla,
        local: disc.slice(1).join(' ').trim(), instrutor: inst.join(' ').trim(), adjuntos: adj.filter(Boolean),
      };
    });
    const dow = new Date(+m[5], +m[4] - 1, +m[3]).getDay();
    dias.push({ data, dow, aulas });
  }
  dias.sort((a, b) => a.data.localeCompare(b.data));
  const f = (d) => d.split('-').reverse().slice(0, 2).join('/');
  return {
    semana, ano, turma, legenda, dias,
    id: dias.length ? `qts-${dias[0].data}` : '',
    titulo: dias.length ? `QTS · Semana ${semana} · ${f(dias[0].data)} a ${f(dias[dias.length - 1].data)}` : 'QTS',
  };
}

/* ------------------------------ consulta ------------------------------ */
const minutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const ehIndisponivel = (sigla) => /^ind$/i.test(siglaBase(sigla));

/** Junta aulas seguidas da mesma disciplina e local: [{ sigla, local, ini, fim, n: qtd, instrutor, adjuntos }]. */
export function blocosDoDia(aulas) {
  const out = [];
  for (const a of aulas) {
    const ult = out[out.length - 1];
    if (ult && ult.sigla === a.sigla && ult.local === a.local && ult.instrutor === a.instrutor) { ult.fim = a.fim; ult.qtd++; ult.ultima = a.n; }
    else out.push({ sigla: a.sigla, local: a.local, ini: a.ini, fim: a.fim, qtd: 1, primeira: a.n, ultima: a.n, instrutor: a.instrutor, adjuntos: a.adjuntos || [] });
  }
  return out;
}

/** Aula agora e próxima aula a partir de `agora` (procura nas semanas guardadas). */
export function aulaAgora(semanas, agora = Date.now()) {
  const d = new Date(agora);
  const hoje = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const min = d.getHours() * 60 + d.getMinutes();
  const futuras = [];
  for (const s of semanas) for (const dia of s.dias) {
    if (dia.data < hoje) continue;
    for (const b of blocosDoDia(dia.aulas)) {
      if (!b.sigla || ehIndisponivel(b.sigla)) continue;
      const ini = minutos(b.ini), fim = minutos(b.fim);
      if (dia.data === hoje && fim <= min) continue;
      futuras.push({ ...b, data: dia.data, semana: s, agora: dia.data === hoje && ini <= min && min < fim, iniMs: new Date(`${dia.data}T${b.ini}:00`).getTime(), fimMs: new Date(`${dia.data}T${b.fim}:00`).getTime() });
    }
  }
  futuras.sort((a, b) => a.iniMs - b.iniMs);
  const atual = futuras.find((x) => x.agora) || null;
  const proxima = futuras.find((x) => !x.agora) || null;
  return { atual, proxima };
}

/** Guarda a semana importada (substitui a mesma semana) e mantém as 12 mais recentes. */
export function guardarSemana(lista = [], qts) {
  const sem = (lista || []).filter((s) => s.id !== qts.id);
  sem.push({ ...qts, importadoEm: Date.now() });
  return sem.sort((a, b) => a.id.localeCompare(b.id)).slice(-12);
}

/** Semana que contém o dia (ou a mais próxima). */
export function semanaDoDia(lista = [], dataYmd) {
  if (!lista.length) return null;
  return lista.find((s) => s.dias[0]?.data <= dataYmd && dataYmd <= s.dias[s.dias.length - 1]?.data)
    || [...lista].sort((a, b) => Math.abs(new Date(a.dias[0].data) - new Date(dataYmd)) - Math.abs(new Date(b.dias[0].data) - new Date(dataYmd)))[0];
}

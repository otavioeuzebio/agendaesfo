/**
 * Cruzamentos entre agenda, escalas completas e QTS (regras puras, sem tela):
 *   - quem está de serviço com você (escala completa do Serviço Interno)
 *   - colegas livres para troca (sem serviço na véspera, no dia e no dia seguinte)
 *   - conflitos (horários que batem, prova logo depois de serviço longo, serviço em horário de aula)
 *   - faltas por disciplina do QTS
 *   - provas ligadas às disciplinas do QTS
 */
import { normalizar } from './escalaPdf.js';
import { SUBTIPOS, SUBTIPOS_ESCALA } from './catalog.js';
import { blocosDoDia, siglaBase, ehIndisponivel } from './qts.js';

const HORA = 3600000, DIA = 24 * HORA;
const p2 = (n) => String(n).padStart(2, '0');
export const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const somaYmd = (s, n) => { const [a, m, d] = s.split('-').map(Number); return ymd(new Date(a, m - 1, d + n)); };
const ehMeu = (nome, cfg) => { const n = normalizar(nome); return !!n && (n === normalizar(cfg.nomeCompleto) || n === normalizar(cfg.nomeGuerra)); };
const rotuloFuncao = (l) => (SUBTIPOS[l.subtipo]?.rotulo || l.funcao || 'Função') + (l.detalhe ? ' · ' + l.detalhe : '');

/** Escala interna mais recente que cobre o dia. */
function escalaDoDia(docs, dia) {
  return docs.filter((d) => d.tipo === 'interna' && d.linhas.some((l) => l.data === dia))
    .sort((a, b) => (b.importadoEm || 0) - (a.importadoEm || 0))[0] || null;
}

/** Quem está na escala do Serviço Interno no dia: [{ rotulo, nomes: [{ grad, nome, eu }] }] (null sem escala). */
export function colegasNaEscala(docs, dia, cfg = {}) {
  const doc = escalaDoDia(docs, dia);
  if (!doc) return null;
  const out = new Map();
  for (const l of doc.linhas.filter((x) => x.data === dia)) {
    const r = rotuloFuncao(l);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push({ grad: l.grad || '', nome: l.nome, eu: ehMeu(l.nome, cfg) });
  }
  return [...out.entries()].map(([rotulo, nomes]) => ({ rotulo, nomes }));
}

/**
 * Colegas livres para assumir um serviço no dia: mesma graduação (turma),
 * sem serviço na véspera, no dia e no dia seguinte. Os menos escalados no
 * período vêm primeiro (ajuda a equilibrar a escala).
 */
export function livresParaTroca(docs, dia, cfg = {}) {
  const doc = escalaDoDia(docs, dia);
  if (!doc) return null;
  const minha = doc.linhas.find((l) => ehMeu(l.nome, cfg));
  const grad = minha?.grad || '';
  const ocupados = new Set(doc.linhas.filter((l) => [somaYmd(dia, -1), dia, somaYmd(dia, 1)].includes(l.data)).map((l) => normalizar(l.nome)));
  const contagem = new Map();
  for (const l of doc.linhas) {
    if (grad && l.grad !== grad) continue;
    const k = normalizar(l.nome);
    const x = contagem.get(k) || { nome: l.nome, grad: l.grad || '', servicos: 0 };
    if (l.subtipo !== 'sobreaviso') x.servicos++;
    contagem.set(k, x);
  }
  return [...contagem.entries()].filter(([k, x]) => !ocupados.has(k) && !ehMeu(x.nome, cfg))
    .map(([, x]) => x).sort((a, b) => a.servicos - b.servicos || a.nome.localeCompare(b.nome));
}

/** Nome da escala corresponde a um colega do app (nome de guerra como palavra do nome)? */
export function casaColega(nomeEscala, colega) {
  const n = ` ${normalizar(nomeEscala)} `;
  const g = normalizar(colega.nomeGuerra || '');
  const c = normalizar(colega.nome || '');
  return (!!c && n.trim() === c) || (!!g && n.includes(` ${g} `));
}

/* ------------------------------ conflitos ------------------------------ */
const FIXOS = new Set([...SUBTIPOS_ESCALA, 'prova', 'mce', 'representacao']);
const minutos = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/**
 * Conflitos nos próximos dias. `itens`: [{ chave, titulo, subtipo, inicio, fim, diaTodo, status }]
 * (fim já efetivo). `semanasQts`: semanas do QTS. Devolve [{ texto, quando, chaves }].
 */
export function conflitos(itens, semanasQts = [], agora = Date.now(), dias = 14) {
  const ate = agora + dias * DIA;
  const lista = itens.filter((i) => i.status === 'pendente' && !i.diaTodo && FIXOS.has(i.subtipo) && (i.fim || i.inicio) > agora && i.inicio < ate)
    .map((i) => ({ ...i, fim: i.fim || i.inicio + HORA })).sort((a, b) => a.inicio - b.inicio);
  const out = [];
  const nome = (i) => i.titulo || SUBTIPOS[i.subtipo]?.rotulo || 'Compromisso';
  // a) horários que se sobrepõem
  for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
    const a = lista[i], b = lista[j];
    if (b.inicio >= a.fim) break;
    if (a.subtipo === 'sobreaviso' && b.subtipo === 'sobreaviso') continue;
    out.push({ texto: `${nome(a)} e ${nome(b)} no mesmo horário`, quando: b.inicio, chaves: [a.chave, b.chave] });
  }
  // b) prova logo depois de serviço de 12 h ou mais
  for (const p of lista.filter((i) => i.subtipo === 'prova')) {
    const s = lista.find((i) => SUBTIPOS_ESCALA.includes(i.subtipo) && i.subtipo !== 'sobreaviso' && i.fim - i.inicio >= 12 * HORA && i.fim <= p.inicio && p.inicio - i.fim < 10 * HORA);
    if (s) out.push({ texto: `${nome(p)} ${Math.max(0, Math.round((p.inicio - s.fim) / HORA))} h depois de sair de ${nome(s)}`, quando: p.inicio, chaves: [s.chave, p.chave] });
  }
  // c) serviço, MCE ou representação em horário de aula do QTS
  for (const it of lista.filter((i) => i.subtipo !== 'prova' && i.subtipo !== 'sobreaviso')) {
    for (const sem of semanasQts) for (const d of sem.dias) {
      for (const b of blocosDoDia(d.aulas)) {
        if (!b.sigla || ehIndisponivel(b.sigla)) continue;
        const ini = new Date(`${d.data}T${b.ini}:00`).getTime(), fim = new Date(`${d.data}T${b.fim}:00`).getTime();
        if (ini < it.fim && it.inicio < fim) { out.push({ texto: `${nome(it)} no horário de aula (${siglaBase(b.sigla)} ${b.ini})`, quando: Math.max(ini, it.inicio), chaves: [it.chave] }); break; }
      }
    }
  }
  const vistos = new Set();
  return out.filter((c) => { const k = c.texto + c.quando; if (vistos.has(k)) return false; vistos.add(k); return true; }).sort((a, b) => a.quando - b.quando);
}

/* ------------------------------ faltas ------------------------------ */
export const LIMITE_FALTAS_PADRAO = 25; // % das horas-aula previstas
/** Chave de uma aula: "aaaa-mm-dd|n". */
export const chaveAula = (data, n) => `${data}|${n}`;
/** Faltas por disciplina: { SIGLA: { faltas, permitidas, total } } (cada aula = 1 H.A.). */
export function resumoFaltas(semanas = [], faltas = {}, pct = LIMITE_FALTAS_PADRAO) {
  const out = {};
  const legenda = {};
  for (const s of semanas) Object.assign(legenda, s.legenda || {});
  for (const [k, sigla] of Object.entries(faltas || {})) { const s = siglaBase(sigla); (out[s] ||= { faltas: 0 }).faltas++; void k; }
  for (const [s, l] of Object.entries(legenda)) {
    if (!l.ha?.total || ehIndisponivel(s)) continue;
    const r = (out[s] ||= { faltas: 0 });
    r.total = l.ha.total; r.permitidas = Math.floor((l.ha.total * pct) / 100);
  }
  return out;
}

/* ------------------------------ provas × QTS ------------------------------ */
/** A disciplina lançada na prova é a desta sigla do QTS? ("DPM1", "DPM1 – Direito Penal…", "Direito Penal Militar I") */
export function discDaSigla(disciplina, sigla, nome) {
  const d = normalizar(disciplina);
  const s = normalizar(siglaBase(sigla));
  const n = normalizar(nome);
  return !!d && (d === s || d.startsWith(s + ' ') || (!!n && (d === n || d.endsWith(n))));
}
/** Opções para o campo Disciplina: "SIGLA – Nome" de todas as semanas do QTS. */
export function opcoesDisciplina(semanas = [], cap = (t) => t) {
  const m = new Map();
  for (const s of semanas) for (const [sig, l] of Object.entries(s.legenda || {})) if (!ehIndisponivel(sig) && l.nome) m.set(sig, `${sig} – ${cap(l.nome)}`);
  return [...m.values()].sort();
}

/* ------------------------------ resumo da noite ------------------------------ */
/**
 * Texto do resumo do dia seguinte. Recebe as partes já prontas:
 * { rotuloDia, itens: [{ hora, titulo, local }], aulas: [{ ini, sigla, local }], revista, alimentos: [nome], pendencias: [texto] }
 * Devolve null quando não há nada para o dia.
 */
export function textoResumo({ rotuloDia, itens = [], aulas = [], revista = '', alimentos = [], pendencias = [] }) {
  const partes = [];
  if (aulas.length) partes.push('Aulas: ' + aulas.map((a) => `${a.sigla} ${a.ini}${a.local ? ' (' + a.local + ')' : ''}`).join(', '));
  if (itens.length) partes.push(itens.map((i) => `${i.titulo}${i.hora ? ' ' + i.hora : ''}${i.local ? ' – ' + i.local : ''}`).join('; '));
  if (revista) partes.push(revista);
  if (alimentos.length) partes.push('Geladeira: ' + alimentos.join(', '));
  if (pendencias.length) partes.push(pendencias.join(' '));
  if (!partes.length) return null;
  return { titulo: `${rotuloDia}: ${itens.length ? itens.length + ' compromisso' + (itens.length > 1 ? 's' : '') : 'sem compromissos'}${aulas.length ? ', ' + aulas.length + ' aula' + (aulas.length > 1 ? 's' : '') : ''}`, corpo: partes.join(' · ') };
}

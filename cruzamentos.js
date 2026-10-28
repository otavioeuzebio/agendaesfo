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
export function textoResumo({ rotuloDia, itens = [], aulas = [], revista = '', alimentos = [], pendencias = [], farda = '' }) {
  const partes = [];
  if (aulas.length) partes.push('Aulas: ' + aulas.map((a) => `${a.sigla} ${a.ini}${a.local ? ' (' + a.local + ')' : ''}`).join(', '));
  if (itens.length) partes.push(itens.map((i) => `${i.titulo}${i.hora ? ' ' + i.hora : ''}${i.local ? ' – ' + i.local : ''}`).join('; '));
  if (revista) partes.push(revista);
  if (alimentos.length) partes.push('Geladeira: ' + alimentos.join(', '));
  if (pendencias.length) partes.push(pendencias.join(' '));
  if (!partes.length) return null;
  if (farda) partes.push(farda);
  return { titulo: `${rotuloDia}: ${itens.length ? itens.length + ' compromisso' + (itens.length > 1 ? 's' : '') : 'sem compromissos'}${aulas.length ? ', ' + aulas.length + ' aula' + (aulas.length > 1 ? 's' : '') : ''}`, corpo: partes.join(' · ') };
}

/* ------------------------------ fardamento do dia ------------------------------ */
/**
 * Regra da EsFO (informada pelo cadete):
 *   farda: seg e ter = fardamento orgânico com gandola; demais dias = fardamento orgânico com combat shirt
 *   agasalho DAG: qua, qui e sex = camiseta branca; demais dias = camiseta preta
 */
export const FARDA_SEMANA = ['Fardamento orgânico com combat shirt', 'Fardamento orgânico com gandola', 'Fardamento orgânico com gandola',
  'Fardamento orgânico com combat shirt', 'Fardamento orgânico com combat shirt', 'Fardamento orgânico com combat shirt', 'Fardamento orgânico com combat shirt'];
export const DAG_SEMANA = ['Camiseta preta', 'Camiseta preta', 'Camiseta preta', 'Camiseta branca', 'Camiseta branca', 'Camiseta branca', 'Camiseta preta'];
/**
 * Fardamento do dia. `extras`: [{ quando, texto }] vindos de serviços/representações (fardamento próprio)
 * e de aulas de EFM. Devolve { farda, dag, extras }.
 */
export function fardamentoDoDia(dia, { itens = [], aulas = [], fardamentoPadrao = '' } = {}) {
  const dow = new Date(dia).getDay();
  const extras = [];
  for (const i of itens) {
    const f = (i.escala?.fardamento || (['sentinela_guarda', 'sentinela_posto2', 'cmt_guarda', 'estagio_cpu', 'guarda'].includes(i.subtipo) ? fardamentoPadrao : '') || '').trim();
    if (f) extras.push({ quando: i.inicio, texto: `${i.titulo}: ${f}` });
  }
  const efm = aulas.find((a) => /^EFM/i.test(siglaBase(a.sigla)));
  if (efm) extras.push({ quando: new Date(`${ymd(dia)}T${efm.ini}:00`).getTime(), texto: `EFM às ${efm.ini}: levar o uniforme de educação física` });
  return { farda: FARDA_SEMANA[dow], dag: DAG_SEMANA[dow], extras: extras.sort((a, b) => a.quando - b.quando) };
}

/* ------------------------------ licença do fim de semana ------------------------------ */
export const LICENCA_PADRAO = { saidaDia: 5, saidaHora: '18:00', retornoDia: 0, retornoHora: '19:00' };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/**
 * Licença do fim de semana que contém (ou vem depois de) `agora`.
 * itens: compromissos pendentes { titulo, subtipo, inicio, fim, detalhe }.
 * Devolve { saida, retorno, bloqueios: [texto], livre } ou null quando desligado.
 */
export function licencaDoFimDeSemana(itens, cfgLic = {}, agora = Date.now()) {
  const c = { ...LICENCA_PADRAO, ...cfgLic };
  if (c.ativo === false) return null;
  const hoje = new Date(agora);
  // sexta-feira (dia de saída) desta semana; se a licença já acabou, a da próxima
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - ((hoje.getDay() - c.saidaDia + 7) % 7));
  const em = (d, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x.getTime(); };
  let saida = em(base, c.saidaHora);
  let retorno = em(new Date(base.getFullYear(), base.getMonth(), base.getDate() + ((c.retornoDia - c.saidaDia + 7) % 7 || 7)), c.retornoHora);
  if (retorno < agora) { saida += 7 * DIA; retorno += 7 * DIA; }
  const bloqueios = [];
  for (const i of itens) {
    const fim = i.fim || i.inicio + HORA;
    if (i.inicio >= retorno || fim <= saida) continue;
    const quando = `${DIAS[new Date(i.inicio).getDay()]} ${p2(new Date(i.inicio).getHours())}h${p2(new Date(i.inicio).getMinutes()) === '00' ? '' : p2(new Date(i.inicio).getMinutes())}`;
    if (i.subtipo === 'sobreaviso') bloqueios.push(`Sobreaviso (${quando}): fique em local de fácil acionamento`);
    else if (i.subtipo === 'mce' || (SUBTIPOS_ESCALA.includes(i.subtipo))) bloqueios.push(`${i.titulo} (${quando})`);
  }
  return { saida, retorno, bloqueios, livre: !bloqueios.length };
}

/* ------------------------------ equilíbrio na turma ------------------------------ */
/**
 * Seus serviços no mês × a sua turma (mesma graduação), pela escala completa.
 * Devolve { meu, media, min, max, n, posicao } ou null sem escala com o seu nome.
 */
export function equilibrioTurma(docs, cfg, ano, mes) {
  const pref = `${ano}-${p2(mes + 1)}`;
  const doc = docs.filter((d) => d.tipo === 'interna' && d.linhas.some((l) => l.data?.startsWith(pref)))
    .sort((a, b) => (b.importadoEm || 0) - (a.importadoEm || 0))[0];
  if (!doc) return null;
  const minha = doc.linhas.find((l) => ehMeu(l.nome, cfg));
  if (!minha) return null;
  const cont = new Map();
  for (const l of doc.linhas) {
    if (l.grad !== minha.grad) continue;
    const k = normalizar(l.nome);
    if (!cont.has(k)) cont.set(k, 0);
    if (l.data?.startsWith(pref) && l.subtipo !== 'sobreaviso') cont.set(k, cont.get(k) + 1);
  }
  const vals = [...cont.values()];
  const meu = cont.get(normalizar(minha.nome)) || 0;
  const ordem = [...vals].sort((a, b) => b - a);
  return { meu, media: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals), n: vals.length, posicao: ordem.indexOf(meu) + 1, grad: minha.grad };
}

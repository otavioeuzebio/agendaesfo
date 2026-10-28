/**
 * Quartos de hora da guarda, colados (ou compartilhados) do WhatsApp:
 *
 *   *GUARDA*
 *   Fonseca 19:00 às 20:40 / 00:00 às 01:50
 *   Euzebio 22:20 às 00:00 / 03:40 às 05:30
 *   *POSTO II*
 *   Edson 19:00 às 20:40 / 00:00 às 01:50
 *
 * Regras puras, sem tela. As linhas viram { data, secao, subtipo, nome, detalhe, quartos }.
 */
const HORA = 3600000, DIA = 24 * HORA;
const p2 = (n) => String(n).padStart(2, '0');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const ymd = (d) => { d = new Date(d); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

const H = String.raw`(\d{1,2})\s*(?:[:hH.]\s*(\d{2}))?\s*h?`;
const FAIXA = new RegExp(`${H}\\s*(?:às|as|à|a|ate|até|-|–|—)\\s*${H}`, 'gi');
const hm = (h, m) => `${p2(+h)}:${p2(+(m || 0))}`;

/** Nome do posto → função da escala interna. */
export function subtipoDoPosto(posto) {
  const p = norm(posto);
  if (/posto\s*(ii|2)\b/.test(p)) return 'sentinela_posto2';
  if (/rond/.test(p)) return 'plantao_rondante';
  if (/bloco/.test(p)) return 'plantao_bloco3';
  if (/guarda|posto\s*(i|1)\b|sentinela/.test(p)) return 'sentinela_guarda';
  return '';
}

/** Lê o texto. Devolve { data ('' se não veio no texto), postos: [{ posto, subtipo, linhas: [{ nome, faixas: [['22:20','00:00'], …] }] }] }. */
export function lerQuartos(texto, hoje = new Date()) {
  const out = { data: '', postos: [] };
  let atual = null;
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const linha = bruta.replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
    if (!linha) continue;
    const faixas = [...linha.matchAll(FAIXA)].filter((m) => +m[1] < 24 && +m[3] < 24).map((m) => [hm(m[1], m[2]), hm(m[3], m[4])]);
    if (!faixas.length) {
      const d = linha.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      if (d && !out.data) {
        let ano = d[3] ? +d[3] : hoje.getFullYear(); if (ano < 100) ano += 2000;
        out.data = `${ano}-${p2(d[2])}-${p2(d[1])}`;
      }
      const posto = linha.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '').replace(/[:\-–—]+$/, '').trim();
      const destaque = /^\s*[*_]/.test(bruta) || /^[A-ZÀ-Ú0-9 .ºª°]+$/.test(posto);
      if (posto && posto.length <= 40 && (destaque || subtipoDoPosto(posto))) { atual = { posto, subtipo: subtipoDoPosto(posto), linhas: [] }; out.postos.push(atual); }
      continue;
    }
    const nome = linha.slice(0, linha.search(/\d/)).replace(/[:\-–—|]+\s*$/, '').trim();
    if (!nome) continue;
    if (!atual) { atual = { posto: 'Guarda', subtipo: 'sentinela_guarda', linhas: [] }; out.postos.push(atual); }
    atual.linhas.push({ nome, faixas });
  }
  out.postos = out.postos.filter((p) => p.linhas.length);
  return out;
}

/** O texto parece uma escala de quartos? (2+ linhas "Nome hh:mm às hh:mm"). */
export const ehTextoQuartos = (texto) => lerQuartos(texto).postos.reduce((n, p) => n + p.linhas.length, 0) >= 2;

const txtFaixas = (f, sep = ', ') => f.map(([a, b]) => `${a}-${b}`).join(sep);

/** Linhas planas (para guardar, consultar e publicar na turma). */
export function linhasQuartos(lido, data) {
  return lido.postos.flatMap((p) => p.linhas.map((l) => ({
    data, secao: p.posto, subtipo: p.subtipo, nome: l.nome,
    detalhe: l.faixas.map(([a, b]) => `${a}–${b}`).join(' · '), quartos: txtFaixas(l.faixas),
  })));
}

/** É o nome do cadete? Nome de guerra exato, ou contido como palavra ("D. Torres" ↔ "Torres"). */
export function ehMeuNome(nome, cfg = {}) {
  const n = norm(nome);
  if (!n) return false;
  if (n === norm(cfg.nomeCompleto)) return true;
  const g = norm(cfg.nomeGuerra);
  if (!g) return false;
  return n === g || (g.length >= 4 && ` ${n} `.includes(` ${g} `)) || (n.length >= 4 && ` ${g} `.includes(` ${n} `));
}

/** Data provável do serviço: a do texto; senão hoje (ou ontem, de madrugada). */
export function dataProvavel(lido, agora = Date.now()) {
  if (lido.data) return lido.data;
  const d = new Date(agora);
  return ymd(d.getHours() < 7 ? agora - DIA : agora);
}

/** Horários absolutos dos quartos, a partir do dia do serviço (o que passa da meia-noite vai para o dia seguinte). */
export function horariosDosQuartos(texto, data, inicioServico) {
  const base = new Date(data + 'T00:00').getTime();
  const ancora = inicioServico ?? base + 12 * HORA;
  const out = [];
  let cursor = ancora - 3 * HORA;
  for (const parte of String(texto || '').split(/[,;]+/)) {
    const m = parte.trim().match(/^(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:-|–|às|a)\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?$/i);
    if (!m) continue;
    let ini = base + (+m[1] * 60 + +(m[2] || 0)) * 60000;
    while (ini < cursor) ini += DIA;
    let fim = base + (+m[3] * 60 + +(m[4] || 0)) * 60000;
    while (fim <= ini) fim += DIA;
    out.push({ ini, fim });
    cursor = fim;
  }
  return out;
}

/**
 * Lembretes de cada quarto de hora (para as missões de serviço com "Seus horários no posto").
 * Devolve [{ dispara, titulo, corpo, chave, tag, critico: true }] entre `de` e `ate`.
 */
export function lembretesQuartos(itens, de, ate, antecedencia = 15) {
  const out = [];
  for (const it of itens) {
    if (!it.escala?.quartos || it.status && it.status !== 'pendente') continue;
    for (const q of horariosDosQuartos(it.escala.quartos, ymd(it.inicio), it.inicio)) {
      const dispara = q.ini - antecedencia * 60000;
      if (dispara < de || dispara > ate) continue;
      const hi = `${p2(new Date(q.ini).getHours())}:${p2(new Date(q.ini).getMinutes())}`, hf = `${p2(new Date(q.fim).getHours())}:${p2(new Date(q.fim).getMinutes())}`;
      out.push({ dispara, titulo: `Quarto de hora às ${hi}`, corpo: `${it.escala.posto || it.titulo}: ${hi} às ${hf}. Prepare-se para assumir o posto.`, chave: it.chave || it.id, tag: `quarto:${it.chave || it.id}:${q.ini}`, critico: true });
    }
  }
  return out.sort((a, b) => a.dispara - b.dispara);
}

/**
 * Outros documentos da EsFO lidos no aparelho (nada é enviado):
 *
 *  - Escala de Desfile ............ FUNÇÃO | GRAD | NOME (semana)
 *  - Escala de Representação ...... evento, data, horário, local, fardamento, titulares e sobreaviso
 *  - Escala de Comando / Suplência  organograma em imagem: o cadete escolhe a própria função
 *  - Planilha de Anotados ......... FO+ e AAD, prazos de ciência, defesa e período das MCE
 *  - Nota de Aplicação de MCE ..... MCE de cada cadete e a tabela de horários do fim de semana
 *
 * Cada leitor devolve um "documento": { tipo, titulo, periodo?, linhas, ...dados }.
 * As linhas carregam tudo o que é preciso para virar compromisso, para a mesma
 * linha servir à escala publicada para a turma. CPF e outros dados pessoais da
 * escala nunca são guardados.
 */
import { normalizar, linhas as agrupar, juntar, blocosCentralizados } from './escalaPdf.js';

const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const deYmd = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const somaDias = (s, n) => { const d = deYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const ts = (dia, h = 0, m = 0) => { const d = deYmd(dia); d.setHours(h, m, 0, 0); return d.getTime(); };
const slug = (s) => normalizar(s).replace(/[^a-z0-9]+/g, '').slice(0, 24);
/** CPF (nunca guardado): 000.000.000-00 ou 00000000000 junto do nome. */
export const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const ano4 = (a) => (String(a).length === 2 ? 2000 + +a : +a);

export const NOMES_DOC = {
  desfile: 'Escala de Desfile',
  representacao: 'Escala de Representação',
  comando: 'Escala de Comando',
  suplencia: 'Escala de Suplência',
  anotados: 'Planilha de Anotados',
  namce: 'Nota de Aplicação de MCE',
};
/** Tipos que podem ser publicados para a turma (os disciplinares nunca). */
export const PUBLICAVEIS = ['desfile', 'representacao'];

/** Funções do organograma de Comando/Suplência do Batalhão EsFO. */
export const FUNCOES_COMANDO = [
  'Comandante de Batalhão', 'Subcomandante de Batalhão', 'P/1', 'P/3', 'P/4', 'P/5',
  'Cmt. 1ª Cia', 'Cmt. 2ª Cia', 'Cmt. 3ª Cia', 'Cmt. CHOE',
  'Cmd. 3º PM Alfa', 'Cmd. 3º PM Bravo', 'Cmd. 3º PM Charlie', 'Cmd. 3º PM Delta',
  'Cmd. 1º PM Alfa', 'Cmd. 1º PM Bravo', 'Cmd. 1º PM Charlie', 'Cmd. 1º PM Delta',
  'Cmd. 1º PM Alfa/2', 'Cmd. 1º PM Bravo/2', 'Cmd. 1º PM Charlie/2', 'Chefe de Turma',
];

/** Tabela de MCE da EsFO (usada quando o PDF não traz a tabela). dia: 0 sexta, 1 sábado, 2 domingo. */
export const MCE_PADRAO = {
  'EEsp 1': { dia: 0, ini: [14, 0], fim: [18, 0] }, 'EEsp 2': { dia: 0, ini: [18, 0], fim: [22, 0] }, 'LC 1': { dia: 0, ini: [19, 0], fim: [7, 0] },
  'EEsp 3': { dia: 1, ini: [7, 15], fim: [11, 15] }, 'EEsp 4': { dia: 1, ini: [14, 0], fim: [18, 0] }, 'EEsp 5': { dia: 1, ini: [18, 0], fim: [22, 0] },
  'LC 2': { dia: 1, ini: [7, 0], fim: [19, 0] }, 'LC 3': { dia: 1, ini: [19, 0], fim: [7, 0] },
  'EEsp 6': { dia: 2, ini: [7, 15], fim: [11, 15] }, 'EEsp 7': { dia: 2, ini: [14, 0], fim: [18, 0] }, 'EEsp 8': { dia: 2, ini: [18, 0], fim: [22, 0] },
  'LC 4': { dia: 2, ini: [7, 0], fim: [19, 0] }, 'LC 5': { dia: 2, ini: [19, 0], fim: [7, 0] },
};
const NOME_MCE = { EEsp: 'Escala Especial', LC: 'Licença Cassada', TD: 'Trabalho Didático' };

/* ------------------------------------------------------------------ */
/* Detecção                                                           */
/* ------------------------------------------------------------------ */
export function detectarTipoExtra(itens) {
  const t = normalizar(itens.slice(0, 60).map((i) => i.s).join(' '));
  if (t.includes('medida corretiva escolar') && t.includes('nota de aplicacao')) return 'namce';
  if (t.includes('planilha de anotados')) return 'anotados';
  if (t.includes('escala de representac')) return 'representacao';
  if (t.includes('escala de desfile')) return 'desfile';
  if (t.includes('escala de suplencia')) return 'suplencia';
  if (t.includes('escala de comando')) return 'comando';
  return null;
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                         */
/* ------------------------------------------------------------------ */
/** Linhas de texto na ordem de leitura, página por página. */
function linhasPorPagina(itens, tol = 3) {
  const out = [];
  for (const p of [...new Set(itens.map((i) => i.p))].sort((a, b) => a - b)) out.push(...agrupar(itens.filter((i) => i.p === p), tol).map((l) => ({ ...l, p })));
  return out;
}
const textoDe = (itens) => linhasPorPagina(itens).map((l) => juntar(l.itens)).join('\n');

/** Datas por extenso: "25 out. 26", "25 de out. de 2026", "30 out. 26". */
function datasPorExtenso(texto) {
  const out = [];
  const re = /(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?\s*(?:de\s+)?(\d{4}|\d{2})\b/gi;
  let m;
  while ((m = re.exec(texto))) out.push(ymd(new Date(ano4(m[3]), MESES[m[2].toLowerCase()], +m[1])));
  return out;
}
/** Período da escala: as duas primeiras datas por extenso do cabeçalho. */
function periodoDe(texto) {
  const ds = datasPorExtenso(texto);
  if (!ds.length) return null;
  return { ini: ds[0], fim: ds[1] && ds[1] >= ds[0] ? ds[1] : ds[0] };
}
const dataCurta = (s) => { const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{2,4})/); return m ? `${ano4(m[3])}-${m[2]}-${m[1]}` : ''; };
const GRAD = /^(cad\.?|al\.?\s*of|aluno[\s-]oficial|sd\.|cb\.|sgt|asp|\d[º°]\s*ten|cap\.|maj\.)/i;

/** O nome da linha é do cadete? Nome completo, parte dele (2+ palavras) ou o nome de guerra. */
export function casaNome(nome, { nomeCompleto = '', nomeGuerra = '' } = {}, { soGuerra = false } = {}) {
  const n = normalizar(nome);
  if (!n) return false;
  const g = normalizar(nomeGuerra);
  if (g && n === g) return true;
  if (soGuerra) return false;
  const c = normalizar(nomeCompleto);
  if (c && n === c) return true;
  if (c) {
    const pc = c.split(' '), pn = n.split(' ');
    return pn.length >= 2 && pn.every((w) => pc.includes(w)) && pn.filter((w) => w.length > 3).length >= 2;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Escala de Desfile                                                  */
/* ------------------------------------------------------------------ */
function lerDesfile(itens) {
  const texto = textoDe(itens);
  const periodo = periodoDe(texto);
  const out = [];
  for (const l of linhasPorPagina(itens, 3)) {
    const k = l.itens.findIndex((i) => GRAD.test(i.s.trim()));
    if (k <= 0) continue;
    const funcao = juntar(l.itens.slice(0, k));
    const nome = juntar(l.itens.slice(k + 1));
    if (!funcao || !nome || /escalante/i.test(nome)) continue;
    out.push({ data: periodo?.ini || '', ate: periodo?.fim || '', subtipo: 'desfile', detalhe: funcao, grad: l.itens[k].s.trim(), nome });
  }
  return { tipo: 'desfile', titulo: tituloPeriodo('Desfile', periodo), periodo, linhas: out };
}

/* ------------------------------------------------------------------ */
/* Escala de Representação                                            */
/* ------------------------------------------------------------------ */
function campo(texto, letra, proxima) {
  const re = new RegExp(`\\b${letra}\\)\\s*[^:]*:\\s*([\\s\\S]*?)(?=\\n\\s*${proxima}\\)|$)`, 'i');
  const m = texto.match(re);
  return m ? m[1].replace(/\s+/g, ' ').replace(/[;.]\s*$/, '').trim() : '';
}
function lerRepresentacao(itens) {
  const texto = textoDe(itens);
  const evento = campo(texto, 'a', 'b').replace(/^escala de representa[cç][aã]o\s*[–-]\s*/i, '');
  const dataTxt = campo(texto, 'b', 'c');
  const data = datasPorExtenso(dataTxt)[0] || '';
  const hm = campo(texto, 'c', 'd').match(/(\d{1,2})\s*h\s*(\d{2})?/i);
  const hora = hm ? `${p2(hm[1])}:${hm[2] || '00'}` : '';
  const horarioTxt = campo(texto, 'c', 'd');
  const local = campo(texto, 'd', 'e');
  const fardamento = campo(texto, 'e', 'f');
  const obs = campo(texto.split(/\n\s*GRAD\b/)[0], 'g', 'h');

  // tabela: Nº | GRAD | NOME | CPF (CPF é ignorado e nunca guardado)
  const cab = itens.find((i) => /^nome completo$/i.test(i.s.trim()));
  const corpo = itens.filter((i) => !cab || i.p > cab.p || (i.p === cab.p && i.y > cab.y + 3));
  const out = [];
  let grupo = 'Titular';
  let atual = null;
  for (const l of linhasPorPagina(corpo, 4)) {
    const sem = l.itens.map((i) => ({ ...i, s: i.s.replace(CPF, '').trim() })).filter((i) => i.s);
    const txt = juntar(sem);
    if (/^sobreaviso$/i.test(txt)) { grupo = 'Sobreaviso'; atual = null; continue; }
    if (/s[aã]o jos[eé] dos pinhais|oficial p\/1|^\d[º°]\s*ten|^cap\.|^maj\./i.test(txt)) { atual = null; continue; }
    const kGrad = sem.findIndex((i) => GRAD.test(i.s.trim()));
    if (kGrad >= 0 && /^\d{1,2}$/.test(sem[0]?.s.trim() || '')) {
      atual = { data, hora, subtipo: 'representacao', detalhe: grupo, grad: sem[kGrad].s.trim(), nome: juntar(sem.slice(kGrad + 1)), evento, local, fardamento, obs, horarioTxt };
      out.push(atual);
    } else if (atual && sem.length && !/^\d/.test(txt) && txt.length < 40) {
      atual.nome = `${atual.nome} ${txt}`.trim(); // nome quebrado em duas linhas
      atual = null;
    }
  }
  const antigo = out.find((l) => l.detalhe === 'Titular');
  for (const l of out) l.maisAntigo = antigo ? `${antigo.grad} ${antigo.nome}` : '';
  return { tipo: 'representacao', titulo: `Representação${evento ? ' – ' + evento : ''}${data ? ' · ' + data.split('-').reverse().slice(0, 2).join('/') : ''}`, periodo: data ? { ini: data, fim: data } : null, linhas: out, evento, local, fardamento };
}

/* ------------------------------------------------------------------ */
/* Escala de Comando / Suplência (organograma em imagem)              */
/* ------------------------------------------------------------------ */
function lerComando(itens, tipo) {
  const texto = textoDe(itens);
  const periodo = periodoDe(texto);
  const prazo = /procurar o\s+respons[aá]vel da fun[cç][aã]o at[eé] (?:a |o )?s[aá]bado [aà]s (\d{1,2})h(\d{2})?/i.exec(texto.replace(/\s+/g, ' '));
  return {
    tipo, titulo: tituloPeriodo(tipo === 'comando' ? 'Comando do Batalhão' : 'Suplência de Comando', periodo), periodo, linhas: [],
    prazoSabado: prazo ? [+prazo[1], +(prazo[2] || 0)] : (tipo === 'suplencia' ? [19, 0] : null),
    semTexto: true, // os nomes estão em imagem: o cadete escolhe a função
  };
}

/* ------------------------------------------------------------------ */
/* Tabelas de anotações (Planilha de Anotados e NAMCE)                */
/* ------------------------------------------------------------------ */
const TITULO_SECAO = /^(\d\s*[°º]\s*CFO(\s*\/\s*\d)?|CHOE|Fato Observado Positivo.*)$/i;
const CABECALHOS = [
  [/^n[°º]$/i, 'num'], [/^data$/i, 'data'], [/^anotador$/i, 'anotador'], [/^pel\.?$/i, 'pel'],
  [/^(cadete|aluno[\s-]oficial)$/i, 'nome'], [/^(descri[cç][aã]o|altera[cç][aã]o administrativa disciplinar)$/i, 'texto'], [/^mce$/i, 'mce'],
];

function colunaDe(it, cols) {
  const c = it.x + it.w / 2;
  let k = -1;
  cols.forEach((col, i) => { if (col.x <= c + 2) k = i; });
  if (k < 0) return null;
  if (it.x > cols[k].x + cols[k].w + 10 && cols[k + 1]) k++; // texto justificado começa depois do título da coluna
  return cols[k].id;
}

/** Linhas de todas as tabelas do documento: { secao, positivo, data, anotador, pel, nome, texto, mce }. */
export function lerTabelasAnotacao(itens) {
  const out = [];
  let cols = null, positivo = false, secao = '';
  const paginas = [...new Set(itens.map((i) => i.p))].sort((a, b) => a - b);
  for (const p of paginas) {
    const doPg = itens.filter((i) => i.p === p);
    const ls = agrupar(doPg, 3);
    // marcos da página: títulos de seção e cabeçalhos de tabela
    const marcos = [];
    for (const l of ls) {
      const txt = juntar(l.itens);
      if (TITULO_SECAO.test(txt)) { marcos.push({ y: l.y, tipo: 'secao', txt }); continue; }
      const ids = l.itens.map((i) => CABECALHOS.find(([re]) => re.test(i.s.trim()))?.[1]);
      if (ids.includes('num') && ids.includes('data') && ids.filter(Boolean).length >= 3) {
        marcos.push({ y: l.y, tipo: 'cab', cols: l.itens.map((i, k) => ({ id: ids[k], x: i.x, w: i.w })).filter((c) => c.id), positivo: l.itens.some((i) => /^descri/i.test(i.s.trim())) });
      }
      if (/^(s[aã]o jos[eé] dos pinhais|tabela de medidas|orienta[cç][oõ]es)/i.test(txt)) marcos.push({ y: l.y, tipo: 'fim' });
    }
    marcos.sort((a, b) => a.y - b.y);
    // trechos de tabela: do cabeçalho (ou do topo, se continua da página anterior) até o próximo marco
    const trechos = [];
    let ini = cols ? 0 : null;
    let estado = { cols, positivo, secao };
    for (const m of marcos) {
      if (ini !== null && estado.cols) trechos.push({ y0: ini, y1: m.y, ...estado });
      if (m.tipo === 'secao') { estado = { ...estado, secao: m.txt, positivo: /positivo/i.test(m.txt) }; ini = null; }
      else if (m.tipo === 'cab') { estado = { ...estado, cols: m.cols, positivo: m.positivo || /positivo/i.test(estado.secao) }; ini = m.y + 3; }
      else { ini = null; estado = { ...estado, cols: null }; }
    }
    if (ini !== null && estado.cols) trechos.push({ y0: ini, y1: Infinity, ...estado });
    ({ cols, positivo, secao } = estado);

    for (const tr of trechos) {
      const dentro = doPg.filter((i) => i.y > tr.y0 && i.y < tr.y1);
      const porCol = {};
      for (const it of dentro) { const id = colunaDe(it, tr.cols); if (id) (porCol[id] ||= []).push(it); }
      const ancoras = (porCol.data || []).filter((i) => /^\d{2}\/\d{2}\/\d{2,4}$/.test(i.s.trim())).sort((a, b) => a.y - b.y);
      if (!ancoras.length) continue;
      const linhas = ancoras.map((a) => ({ secao: tr.secao, positivo: tr.positivo, data: dataCurta(a.s), anotador: '', pel: '', nome: '', texto: '', mce: '' }));
      const ysA = ancoras.map((a) => a.y);
      for (const id of ['anotador', 'pel', 'nome', 'texto', 'mce']) {
        if (!porCol[id]) continue;
        const lc = agrupar(porCol[id], 3);
        const blocos = blocosCentralizados(lc.map((l) => l.y), ysA);
        blocos.forEach((b, k) => { if (b) linhas[k][id] = lc.slice(b[0], b[1] + 1).map((l) => juntar(l.itens)).join(' ').replace(/\s+/g, ' ').trim(); });
      }
      out.push(...linhas);
    }
  }
  return out;
}

function numeroDoc(texto, re) { const m = texto.match(re); return m ? `${m[1]}/${m[2]}` : ''; }

function lerAnotados(itens) {
  const texto = textoDe(itens);
  const plano = texto.replace(/\s+/g, ' ');
  const numero = numeroDoc(plano, /planilha de anotados n[°º.]*\s*(\d+)\s*\/\s*(\d{4})/i);
  const prazos = [...plano.matchAll(/(\d{1,2})h(\d{2})?(?:min)?[^()]{0,60}\((\d{2})\/(\d{2})\/(\d{4})\)/gi)]
    .map((m) => ts(`${m[5]}-${m[4]}-${m[3]}`, +m[1], +(m[2] || 0)));
  const mceM = plano.match(/medidas corretivas escolares[^.]*?\((\d{2})\/(\d{2})\/(\d{4})\)[^.]*?\((\d{2})\/(\d{2})\/(\d{4})\)/i);
  const linhas = lerTabelasAnotacao(itens).map((l) => ({ ...l, subtipo: 'anotacao', tipoAnot: l.positivo ? 'FO+' : 'AAD' }));
  return {
    tipo: 'anotados', titulo: `Planilha de Anotados ${numero || ''}`.trim(), linhas, numero,
    ciencia: prazos[0] || null, defesa: prazos[1] || null,
    mce: mceM ? { ini: `${mceM[3]}-${mceM[2]}-${mceM[1]}`, fim: `${mceM[6]}-${mceM[5]}-${mceM[4]}` } : null,
  };
}

/** Lê a "Tabela de Medidas Corretivas Escolares" do PDF; cai na tabela padrão. */
function tabelaMce(itens) {
  const tab = itens.find((i) => /tabela de medidas corretivas/i.test(i.s));
  if (!tab) return MCE_PADRAO;
  const abaixo = itens.filter((i) => i.p === tab.p && i.y > tab.y + 3);
  const fimY = Math.min(...abaixo.filter((i) => /orienta[cç][oõ]es|^eesp$|^lc$/i.test(i.s.trim())).map((i) => i.y), Infinity);
  const ls = agrupar(abaixo.filter((i) => i.y < fimY), 3);
  const codigos = [], dias = [];
  for (const l of ls) {
    const txt = juntar(l.itens);
    const c = txt.match(/\b(EEsp|LC)\s*(\d+)\b.*?(\d{1,2})h(\d{2})?\s*[àa]s\s*(\d{1,2})h(\d{2})?/i);
    if (c) codigos.push({ y: l.y, cod: `${/lc/i.test(c[1]) ? 'LC' : 'EEsp'} ${c[2]}`, ini: [+c[3], +(c[4] || 0)], fim: [+c[5], +(c[6] || 0)] });
    const d = txt.match(/^(sexta|s[aá]bado|domingo)/i);
    if (d) dias.push({ y: l.y, dia: /sexta/i.test(d[1]) ? 0 : /domingo/i.test(d[1]) ? 2 : 1 });
  }
  if (codigos.length < 3 || !dias.length) return MCE_PADRAO;
  const blocos = blocosCentralizados(codigos.map((c) => c.y), dias.map((d) => d.y));
  const t = {};
  blocos.forEach((b, k) => { if (b) for (let i = b[0]; i <= b[1]; i++) t[codigos[i].cod] = { dia: dias[k].dia, ini: codigos[i].ini, fim: codigos[i].fim }; });
  return Object.keys(t).length >= 3 ? t : MCE_PADRAO;
}

function lerNamce(itens) {
  const plano = textoDe(itens).replace(/\s+/g, ' ');
  const numero = numeroDoc(plano, /medida corretiva escolar n[°º.]*\s*(\d+)\s*\/\s*(\d{4})/i);
  const linhas = lerTabelasAnotacao(itens).map((l) => ({ ...l, subtipo: 'mce', tipoAnot: l.positivo ? 'FO+' : 'AAD' }));
  return { tipo: 'namce', titulo: `NAMCE ${numero || ''}`.trim(), linhas, numero, tabela: tabelaMce(itens) };
}

/* ------------------------------------------------------------------ */
/* Leitura geral                                                      */
/* ------------------------------------------------------------------ */
function tituloPeriodo(nome, periodo) {
  if (!periodo) return nome;
  const f = (d) => d.split('-').reverse().slice(0, 2).join('/');
  return `${nome} · ${f(periodo.ini)}${periodo.fim !== periodo.ini ? ' a ' + f(periodo.fim) : ''}`;
}

export function lerDocumento(tipo, itens) {
  if (tipo === 'desfile') return lerDesfile(itens);
  if (tipo === 'representacao') return lerRepresentacao(itens);
  if (tipo === 'comando' || tipo === 'suplencia') return lerComando(itens, tipo);
  if (tipo === 'anotados') return lerAnotados(itens);
  if (tipo === 'namce') return lerNamce(itens);
  return null;
}

/** Linhas do documento que são do cadete. */
export function minhasLinhas(doc, cfg) {
  const soGuerra = doc.tipo === 'anotados' || doc.tipo === 'namce';
  return (doc.linhas || []).filter((l) => casaNome(l.nome, cfg, { soGuerra }));
}

/** Sexta-feira do fim de semana das MCE: a próxima (ou a atual, de sexta a domingo). */
export function sextaDasMce(hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dow = d.getDay();
  const delta = dow === 5 ? 0 : dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow;
  d.setDate(d.getDate() + delta);
  return ymd(d);
}

/** Códigos de MCE de um texto ("Eesp1 + Eesp2", "LC1", "TD") e situação (anulada, transferida…). */
export function codigosMce(txt) {
  const t = String(txt || '');
  const situacao = (t.match(/\b(anulada|transferida|justificada|cancelada|suspensa|duplicada|mantida em suspenso)\b/i) || [])[1];
  const cods = [...t.matchAll(/\b(EEsp|LC|TD)\s*(\d*)/gi)].map((m) => (/^td$/i.test(m[1]) ? 'TD' : `${/^lc$/i.test(m[1]) ? 'LC' : 'EEsp'} ${m[2]}`.trim()));
  return { codigos: [...new Set(cods)], situacao: situacao ? situacao.toLowerCase() : '' };
}

/** Registros para o histórico disciplinar (FO+, AAD e MCE) — ficam só no aparelho. */
export function registrosDisciplina(doc, minhas) {
  const ref = doc.tipo === 'namce' ? `NAMCE ${doc.numero}` : `Planilha ${doc.numero}`;
  return minhas.map((l) => {
    const { codigos, situacao } = codigosMce(l.mce);
    return {
      id: `disc-${slug(ref)}-${l.data}-${slug(l.texto)}`,
      data: l.data, tipo: l.tipoAnot, texto: l.texto.replace(/^\(?\[?FO\+\]?\)?\s*/i, ''), anotador: l.anotador || '',
      doc: ref, mce: doc.tipo === 'namce' ? (situacao || codigos.join(' + ')) : '',
    };
  });
}

/**
 * Compromissos criados a partir do documento.
 * opts: { funcao } (Comando/Suplência), { sexta: 'aaaa-mm-dd' } (NAMCE)
 */
export function missoesDoDocumento(doc, minhas, opts = {}) {
  const out = [];
  const add = (m) => {
    if (out.some((x) => x.id === m.id)) return;
    out.push({ origemEscala: true, local: '', obs: '', detalhe: '', escala: null, fim: null, diaTodo: false, ...m, checklist: (m.checklist || []).map((t) => ({ t, ok: false })) });
  };

  if (doc.tipo === 'desfile') {
    for (const l of minhas) {
      if (!l.data) continue;
      add({ id: `doc-desfile-${l.data}`, titulo: `Desfile – ${l.detalhe}`, categoria: 'administrativo', subtipo: 'desfile', prioridade: 'importante',
        inicio: ts(l.data), fim: l.ate && l.ate !== l.data ? ts(l.ate, 23, 59) : null, diaTodo: true, local: 'APMG', detalhe: l.detalhe,
        obs: `Escala de Desfile da semana: ${l.detalhe}. Confirme com o escalante o dia e o horário da formatura.`,
        lembretes: [1440], escala: { funcao: l.detalhe }, checklist: ['Fardamento de desfile conferido e passado', `Ensaiar a função (${l.detalhe})`] });
    }
  }

  if (doc.tipo === 'representacao') {
    for (const l of minhas) {
      if (!l.data) continue;
      const [h, m] = (l.hora || '07:00').split(':').map(Number);
      const sobre = l.detalhe === 'Sobreaviso';
      const souAntigo = l.maisAntigo && normalizar(l.maisAntigo).endsWith(normalizar(l.nome));
      add({ id: `doc-rep-${l.data}-${slug(l.evento)}`, titulo: `${sobre ? 'Sobreaviso – ' : ''}Representação${l.evento ? ' – ' + l.evento : ''}`,
        categoria: 'operacional', subtipo: 'representacao', prioridade: sobre ? 'importante' : 'critico',
        inicio: ts(l.data, h, m), local: l.local, detalhe: l.detalhe,
        obs: [l.horarioTxt && `Horário: ${l.horarioTxt}.`, l.fardamento && `Fardamento: ${l.fardamento}.`, l.obs].filter(Boolean).join(' '),
        lembretes: [1440, 120, 30], escala: { funcao: sobre ? 'Sobreaviso' : 'Representação', fardamento: l.fardamento || '' },
        checklist: [
          souAntigo ? 'Você é o mais antigo: passar as orientações aos escalados' : `Contatar o mais antigo (${l.maisAntigo || 'cadete mais antigo'}) para as orientações`,
          `Fardamento conferido: ${l.fardamento || 'conforme a escala'}`, 'Conferir o trajeto e chegar com antecedência'] });
    }
  }

  if ((doc.tipo === 'comando' || doc.tipo === 'suplencia') && opts.funcao && doc.periodo) {
    const sup = doc.tipo === 'suplencia';
    const { ini, fim } = doc.periodo;
    add({ id: `doc-${doc.tipo}-${ini}`, titulo: sup ? `Suplente – ${opts.funcao}` : opts.funcao, categoria: 'administrativo', subtipo: sup ? 'suplencia' : 'funcao_comando',
      prioridade: 'importante', inicio: ts(ini), fim: fim !== ini ? ts(fim, 23, 59) : null, diaTodo: true, local: 'Batalhão EsFO', detalhe: opts.funcao,
      obs: sup ? `Suplência de comando da semana: ${opts.funcao}. Assume a função na falta do titular.` : `Função de comando da semana no Batalhão EsFO: ${opts.funcao}.`,
      lembretes: [1440], escala: { funcao: opts.funcao } });
    if (sup && doc.prazoSabado) {
      const d = deYmd(ini);
      d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); // sábado anterior ao início (ou o próprio)
      add({ id: `doc-suplencia-${ini}-contato`, titulo: `Procurar o titular – ${opts.funcao}`, categoria: 'administrativo', subtipo: 'suplencia', prioridade: 'critico',
        inicio: ts(ymd(d), ...doc.prazoSabado), local: '', obs: 'O cadete suplente deve procurar o responsável da função até sábado às 19h.', lembretes: [1440, 120], checklist: ['Procurar o titular da função', 'Anotar as pendências da semana'] });
    }
  }

  if (doc.tipo === 'anotados' && minhas.length) {
    const aad = minhas.filter((l) => l.tipoAnot === 'AAD');
    const lista = minhas.map((l) => `${l.tipoAnot} ${l.data.split('-').reverse().slice(0, 2).join('/')}: ${l.texto}`).join('\n');
    const ref = `Planilha ${doc.numero || ''}`.trim();
    if (doc.ciencia) add({ id: `doc-anot-${slug(doc.numero)}-ciencia`, titulo: `Tomar ciência – ${ref}`, categoria: 'administrativo', subtipo: 'documento', prioridade: 'critico',
      inicio: doc.ciencia, obs: `Assinar a ciência no eProtocolo.\n${lista}`, lembretes: [1440, 120, 30], checklist: ['Assinar a ciência no eProtocolo'] });
    if (aad.length && doc.defesa) add({ id: `doc-anot-${slug(doc.numero)}-defesa`, titulo: `Prazo de defesa – ${ref}`, categoria: 'administrativo', subtipo: 'documento', prioridade: 'importante',
      inicio: doc.defesa, obs: `Razões de defesa pelo eProtocolo ou verbalmente ao Coordenador.\n${aad.map((l) => '• ' + l.texto).join('\n')}`, lembretes: [1440, 120], checklist: ['Decidir se apresenta defesa', 'Protocolar a defesa ou falar com o Coordenador'] });
    if (aad.length && doc.mce) add({ id: `doc-anot-${slug(doc.numero)}-mce`, titulo: `Possível MCE – ${ref}`, categoria: 'administrativo', subtipo: 'mce', prioridade: 'importante',
      inicio: ts(doc.mce.ini), fim: ts(doc.mce.fim, 23, 59), diaTodo: true, obs: 'Período de cumprimento das MCE. Os horários saem na Nota de Aplicação (NAMCE).', lembretes: [1440] });
  }

  if (doc.tipo === 'namce' && opts.sexta) {
    const tabela = doc.tabela || MCE_PADRAO;
    const porCodigo = {};
    for (const l of minhas) {
      const { codigos, situacao } = codigosMce(l.mce);
      if (situacao || l.tipoAnot === 'FO+') continue;
      for (const c of codigos) (porCodigo[c] ||= []).push(l.texto);
    }
    for (const [cod, fatos] of Object.entries(porCodigo)) {
      const motivo = fatos.map((f) => '• ' + f).join('\n');
      if (cod === 'TD') {
        add({ id: `doc-mce-${slug(doc.numero)}-td`, titulo: 'MCE – Trabalho Didático', categoria: 'administrativo', subtipo: 'mce', prioridade: 'critico',
          inicio: ts(opts.sexta, 18), obs: `Verificar com o Oficial Coordenador a atividade até o fim do expediente de sexta.\n${motivo}`, lembretes: [1440, 120] });
        continue;
      }
      const t = tabela[cod];
      if (!t) continue;
      const dia = somaDias(opts.sexta, t.dia);
      const inicio = ts(dia, ...t.ini);
      let fim = ts(dia, ...t.fim);
      if (fim <= inicio) fim = ts(somaDias(dia, 1), ...t.fim);
      const [sigla, n] = cod.split(' ');
      add({ id: `doc-mce-${slug(doc.numero)}-${slug(cod)}`, titulo: `MCE – ${NOME_MCE[sigla]} ${n}`, categoria: 'administrativo', subtipo: 'mce', prioridade: 'critico',
        inicio, fim, local: 'EsFO / APMG', detalhe: cod,
        obs: `Apresentar-se ao Dia-à-EsFO. Participar do hasteamento e do arriamento da Bandeira enquanto estiver na APMG.\n${motivo}`,
        lembretes: [1440, 120, 30], checklist: ['Apresentar-se ao Dia-à-EsFO', 'Fardamento definido pelo Dia-à-EsFO'] });
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

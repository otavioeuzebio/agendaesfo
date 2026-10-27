/**
 * Leitura das escalas em PDF da EsFO, direto no aparelho (nada é enviado).
 *
 *  - "Previsão de Escala de Serviço Interno": uma tabela por dia, com
 *    FUNÇÃO | GRAD | NOME COMPLETO. Funções com várias linhas têm o rótulo
 *    centralizado verticalmente na célula mesclada.
 *  - "Escala da Rotina": grade SEÇÕES × dias, com nomes de guerra.
 *
 * As funções `lerEscalaInterna` e `lerEscalaRotina` recebem itens de texto já
 * extraídos ({ p, s, x, y, w } — página, texto, posição, largura) e devolvem
 * TODAS as linhas da escala. O filtro pelo nome do cadete é feito depois,
 * para o mesmo código servir à escala publicada pelo escalante.
 */

const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (a, m, d) => `${a}-${p2(m + 1)}-${p2(d)}`;

/** Remove acentos, caixa e espaços repetidos. */
export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ */
/* Extração (pdf.js, carregado sob demanda, arquivos dentro do site)  */
/* ------------------------------------------------------------------ */
const CDN_PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build';
let pdfjs = null;
async function carregarPdfjs() {
  if (pdfjs) return pdfjs;
  // cópia dentro do site (vendor/); se não existir, usa a mesma biblioteca pela CDN jsDelivr
  try {
    pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  } catch (e) {
    pdfjs = await import(`${CDN_PDFJS}/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${CDN_PDFJS}/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

/** Extrai os itens de texto de um PDF (File, Blob ou ArrayBuffer). */
export async function extrairItens(arquivo) {
  const lib = await carregarPdfjs();
  const dados = arquivo instanceof ArrayBuffer ? arquivo : await arquivo.arrayBuffer();
  const doc = await lib.getDocument({ data: new Uint8Array(dados) }).promise;
  const itens = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      itens.push({ p, s: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width });
    }
  }
  return itens;
}

/** "interna", "rotina" ou null. */
export function detectarTipo(itens) {
  const t = normalizar(itens.slice(0, 80).map((i) => i.s).join(' '));
  if (t.includes('servico interno') || itens.some((i) => /^nome completo$/i.test(i.s.trim()))) return 'interna';
  if (t.includes('escala da rotina') || t.includes('secoes')) return 'rotina';
  return null;
}

/* ------------------------------------------------------------------ */
/* Utilidades de geometria                                            */
/* ------------------------------------------------------------------ */

/** Agrupa itens em linhas (y próximos) e junta pedaços colados (acentos quebrados). */
export function linhas(itens, tolerancia = 3) {
  const ord = [...itens].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const it of ord) {
    const l = out.find((x) => Math.abs(x.y - it.y) <= tolerancia);
    if (l) { l.itens.push(it); l.y = (l.y * (l.itens.length - 1) + it.y) / l.itens.length; }
    else out.push({ y: it.y, itens: [it] });
  }
  out.sort((a, b) => a.y - b.y);
  for (const l of out) l.itens.sort((a, b) => a.x - b.x);
  return out;
}

/** Junta itens de uma célula: pedaços colados sem espaço, palavras com espaço. */
export function juntar(itens) {
  const ord = [...itens].sort((a, b) => a.x - b.x);
  let txt = '';
  let fim = null;
  for (const it of ord) {
    if (fim !== null) txt += it.x - fim > 1.2 ? ' ' : '';
    txt += it.s;
    fim = it.x + it.w;
  }
  return txt.replace(/\s+/g, ' ').trim();
}

/**
 * Distribui linhas (ordenadas) entre rótulos (ordenados) sabendo que cada
 * rótulo fica centralizado verticalmente no seu bloco de linhas.
 * Devolve, para cada rótulo, o intervalo [inicio, fim] de índices.
 */
export function blocosCentralizados(ysLinhas, ysRotulos) {
  const blocos = [];
  let s = 0;
  ysRotulos.forEach((yr, k) => {
    if (s >= ysLinhas.length) { blocos.push(null); return; }
    const restantes = ysRotulos.length - k - 1;
    const maxFim = ysLinhas.length - 1 - restantes; // deixa ao menos 1 linha para cada rótulo seguinte
    let melhor = s;
    let erro = Infinity;
    for (let e = s; e <= Math.max(s, maxFim); e++) {
      const d = Math.abs((ysLinhas[s] + ysLinhas[e]) / 2 - yr);
      if (d < erro - 0.01) { erro = d; melhor = e; }
    }
    blocos.push([s, melhor]);
    s = melhor + 1;
  });
  return blocos;
}

/* ------------------------------------------------------------------ */
/* Escala de Serviço Interno                                          */
/* ------------------------------------------------------------------ */
const FUNCOES_INTERNAS = [
  [/^respondente/, 'respondente'],
  [/^cmt\.? da guarda/, 'cmt_guarda'],
  [/^sentinelas? da guarda/, 'sentinela_guarda'],
  [/^sentinelas? do posto/, 'sentinela_posto2'],
  [/^dia a esfo|^dia-a-esfo/, 'dia_esfo'],
  [/^cmt\.? do bloco/, 'cmt_bloco3'],
  [/^plantoes rondantes/, 'plantao_rondante'],
  [/^plantoes do bloco/, 'plantao_bloco3'],
  [/^sobreaviso/, 'sobreaviso'],
];
/** Ordem das funções (sem os sobreavisos) na Previsão de Escala de Serviço Interno. */
const ORDEM_INTERNA = ['respondente', 'cmt_guarda', 'sentinela_guarda', 'sentinela_posto2', 'dia_esfo', 'cmt_bloco3', 'plantao_rondante', 'plantao_bloco3'];
const NOME_FUNCAO = { respondente: 'Respondente', cmt_guarda: 'Cmt. da Guarda', sentinela_guarda: 'Sentinelas da Guarda', sentinela_posto2: 'Sentinelas do Posto II', dia_esfo: 'Dia-à-EsFO', cmt_bloco3: 'Cmt. do Bloco III', plantao_rondante: 'Plantões Rondantes - Postos Externos', plantao_bloco3: 'Plantões do Bloco III' };
const GRAD = /^(cad\.|al\.|sd\.|cb\.|sgt|asp|ten|cap|maj)/i;

function dataDoTexto(t) {
  // "1 out. 26 (quinta-feira)" ou "1 out. 2026"
  const m = normalizar(t).match(/(\d{1,2}) (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.? (\d{2,4})/);
  if (!m) return null;
  let a = +m[3]; if (a < 100) a += 2000;
  let mes = MESES[m[2]];
  // confere com o dia da semana escrito ao lado: corrige erro de digitação no mês ("16 set." no meio de outubro)
  const sem = normalizar(t).match(/(domingo|segunda|terca|quarta|quinta|sexta|sabado)/);
  if (sem) {
    const alvo = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].indexOf(sem[1]);
    if (new Date(a, mes, +m[1]).getDay() !== alvo) {
      const certo = [mes + 1, mes - 1, mes + 2, mes - 2].find((x) => new Date(a, x, +m[1]).getDay() === alvo && new Date(a, x, +m[1]).getDate() === +m[1]);
      if (certo != null) { const d = new Date(a, certo, +m[1]); return ymd(d.getFullYear(), d.getMonth(), d.getDate()); }
    }
  }
  return ymd(a, mes, +m[1]);
}

/** Erro total de centralização (quanto cada rótulo fica fora do centro do seu bloco). */
function erroBlocos(ysLinhas, ysRotulos, blocos) {
  let e = 0;
  blocos.forEach((b, k) => { e += b ? Math.abs((ysLinhas[b[0]] + ysLinhas[b[1]]) / 2 - ysRotulos[k]) : 50; });
  return e;
}

/** Junta rótulos quebrados em duas linhas ("Plantões Rondantes" + "- Postos Externos"). */
function juntarRotulos(rotulos) {
  const rot = [];
  for (const r of rotulos) {
    const ant = rot[rot.length - 1];
    if (ant && /^-/.test(r.txt.trim())) { ant.txt += ' ' + r.txt; ant.ys.push(r.y); }
    else rot.push({ txt: r.txt, ys: [r.y] });
  }
  return rot.map((r) => ({ ...r, y: r.ys.reduce((a, b) => a + b, 0) / r.ys.length }));
}

/**
 * Todas as linhas da escala interna: [{ data, subtipo, funcao, detalhe, grad, nome }].
 *
 * Cuidados com o PDF real:
 *  - cabeçalho "Data:" repetido no topo de páginas com uma data ANTIGA (é ignorado:
 *    as datas só avançam ao longo do documento);
 *  - célula mesclada cortada pela quebra de página: as primeiras linhas da página
 *    seguinte (antes do próximo cabeçalho) continuam a última função da página anterior.
 */
export function lerEscalaInterna(itens) {
  const out = [];
  const paginas = [...new Set(itens.map((i) => i.p))].sort((a, b) => a - b);
  let data = null;
  let tabela = null; // { data, colGrad, linhas: [], rotulos: [], continua?: tabela anterior }
  const tabelas = [];
  for (const p of paginas) {
    const ls = linhas(itens.filter((i) => i.p === p));
    // nova página: o que vier antes de um cabeçalho continua a tabela anterior
    if (tabela) { tabela = { data: tabela.data, colGrad: tabela.colGrad, linhas: [], rotulos: [], continua: tabela }; tabelas.push(tabela); }
    for (const l of ls) {
      const t = juntar(l.itens);
      const tn = normalizar(t);
      const iData = l.itens.findIndex((i) => /^data:?$/i.test(i.s.trim()));
      if (iData >= 0 || /^data:/i.test(t)) {
        const d = dataDoTexto(t.replace(/^.*?data:?/i, ''));
        if (d && (!data || d >= data)) data = d; // data antiga repetida no topo da página: ignora
        continue;
      }
      if (tn.startsWith('funcao') && tn.includes('grad')) {
        const g = l.itens.find((i) => /^grad$/i.test(i.s.trim()));
        tabela = { data, colGrad: g ? g.x : 200, linhas: [], rotulos: [] };
        tabelas.push(tabela);
        continue;
      }
      if (!tabela || !data) continue;
      // separa rótulo (à esquerda da coluna GRAD), graduação e nome
      const esq = l.itens.filter((i) => i.x + i.w < tabela.colGrad - 4);
      const resto = l.itens.filter((i) => i.x + i.w >= tabela.colGrad - 4);
      const gradIt = resto.find((i) => GRAD.test(i.s.trim()));
      if (esq.length) tabela.rotulos.push({ y: l.y, txt: juntar(esq) });
      if (gradIt) {
        const nomeIts = resto.filter((i) => i !== gradIt && i.x > gradIt.x + gradIt.w + 10);
        tabela.linhas.push({ y: l.y, grad: gradIt.s.trim(), nome: juntar(nomeIts) });
      }
    }
  }

  const subtipoDe = (txt) => (FUNCOES_INTERNAS.find(([re]) => re.test(normalizar(txt))) || [])[1] || null;
  const grupoSobreaviso = (anterior) => !anterior ? 'Respondente'
    : anterior === 'respondente' ? 'Respondente'
    : ['cmt_guarda', 'sentinela_guarda', 'sentinela_posto2'].includes(anterior) ? 'Guarda'
    : ['dia_esfo', 'cmt_bloco3'].includes(anterior) ? 'Dia-à-EsFO / Bloco III'
    : anterior === 'plantao_rondante' ? 'Plantões Rondantes'
    : anterior === 'plantao_bloco3' ? 'Plantões do Bloco III' : '';
  const emitir = (tb, rotulo, linhasRot) => {
    if (!rotulo?.subtipo) return;
    for (const l of linhasRot) out.push({ data: tb.data, subtipo: rotulo.subtipo, funcao: rotulo.txt.replace(/\s+/g, ' ').trim(), detalhe: rotulo.detalhe, grad: l.grad, nome: l.nome });
  };

  for (const tb of tabelas) {
    if (!tb.linhas.length) continue;
    const rot = juntarRotulos(tb.rotulos);
    // função anterior (para saber a quem o sobreaviso responde) e último rótulo, vindos da página anterior
    let anterior = tb.continua?.ultimoAnterior ?? null;
    for (const r of rot) r.subtipo = subtipoDe(r.txt);
    // rótulo faltando no PDF: dois "Sobreaviso" seguidos → a função que vem entre eles na ordem da escala
    for (let i = 0; i < rot.length - 1; i++) {
      if (rot[i].subtipo !== 'sobreaviso' || rot[i + 1].subtipo !== 'sobreaviso') continue;
      const antes = [...rot.slice(0, i)].reverse().find((r) => r.subtipo && r.subtipo !== 'sobreaviso')?.subtipo ?? anterior;
      const falta = ORDEM_INTERNA[ORDEM_INTERNA.indexOf(antes) + 1];
      if (!falta) continue;
      rot.splice(i + 1, 0, { txt: NOME_FUNCAO[falta], ys: [], y: (rot[i].y + rot[i + 1].y) / 2, subtipo: falta });
    }
    for (const r of rot) {
      r.detalhe = r.subtipo === 'sobreaviso' ? grupoSobreaviso(anterior) : '';
      if (r.subtipo && r.subtipo !== 'sobreaviso') anterior = r.subtipo;
    }
    tb.ultimoAnterior = anterior;
    tb.ultimoRotulo = rot[rot.length - 1] || tb.continua?.ultimoRotulo || null;
    const ys = tb.linhas.map((l) => l.y);
    // continuação: quantas linhas do topo ainda são da última função da página anterior
    let k = 0;
    if (tb.continua && tb.continua.ultimoRotulo) {
      if (!rot.length) k = ys.length;
      else {
        let melhor = Infinity;
        for (let c = 0; c <= Math.min(6, ys.length - 1); c++) {
          if (ys[c] > rot[0].y) break; // a 1ª função desta página não pode começar depois do próprio rótulo
          const e = erroBlocos(ys.slice(c), rot.map((r) => r.y), blocosCentralizados(ys.slice(c), rot.map((r) => r.y)));
          if (e < melhor - 0.5) { melhor = e; k = c; }
        }
      }
      emitir(tb, tb.continua.ultimoRotulo, tb.linhas.slice(0, k));
    }
    const resto = tb.linhas.slice(k);
    const blocos = blocosCentralizados(resto.map((l) => l.y), rot.map((r) => r.y));
    rot.forEach((r, i) => { const b = blocos[i]; if (b) emitir(tb, r, resto.slice(b[0], b[1] + 1)); });
    // linhas que sobraram depois do último bloco ficam com a última função
    const ultimo = blocos.filter(Boolean).pop();
    if (ultimo && ultimo[1] < resto.length - 1) emitir(tb, rot[blocos.lastIndexOf(ultimo)], resto.slice(ultimo[1] + 1));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Escala da Rotina                                                   */
/* ------------------------------------------------------------------ */
export const SECOES_ROTINA = [
  ['cafe dos instrutores', 'cafe_instrutores'],
  ['copa', 'copa'],
  ['viaturas pm', 'viaturas_pm'],
  ['salas comando coordenacao subcomando', 'salas_comando'],
  ['bloco de salas de aula', 'bloco_salas'],
  ['lavanderia', 'lavanderia'],
  ['museu esfo', 'museu_esfo'],
  ['manutencao predio adm', 'manutencao_adm'],
];
const POSICOES_SALAS = ['Sala Cmdo', 'Corredor 1', 'Corredor 2', 'Sala Subcmdo'];
const norm2 = (s) => normalizar(s).replace(/[.,:]/g, ' ').replace(/\s+/g, ' ').trim();

/** Todas as células da escala da rotina: [{ data, subtipo, detalhe, nome }]. */
export function lerEscalaRotina(itens, hoje = new Date()) {
  const out = [];
  const paginas = [...new Set(itens.map((i) => i.p))];
  for (const p of paginas) {
    const doPg = itens.filter((i) => i.p === p);
    // cabeçalho dos dias: "DOM. 25/10"
    const cab = doPg.filter((i) => /^(dom|seg|ter|qua|qui|sex|s[aá]b)\.?\s*\d{1,2}\/\d{1,2}/i.test(i.s.trim()));
    if (cab.length < 2) continue;
    const yCab = cab[0].y;
    const colunas = cab.map((c) => {
      const [, d, m] = c.s.match(/(\d{1,2})\/(\d{1,2})/);
      // ano mais próximo de hoje
      let a = hoje.getFullYear();
      const cand = [a - 1, a, a + 1].map((x) => new Date(x, +m - 1, +d));
      const melhor = cand.reduce((b, x) => (Math.abs(x - hoje) < Math.abs(b - hoje) ? x : b));
      return { cx: c.x + c.w / 2, data: ymd(melhor.getFullYear(), +m - 1, +d) };
    }).sort((a, b) => a.cx - b.cx);
    const passo = colunas.length > 1 ? (colunas[colunas.length - 1].cx - colunas[0].cx) / (colunas.length - 1) : 90;
    const limiteEsq = colunas[0].cx - passo / 2;

    // corpo da tabela: abaixo do cabeçalho, até as "Orientações"
    const fimTabela = Math.min(...doPg.filter((i) => /^orienta/i.test(i.s.trim())).map((i) => i.y), Infinity);
    const corpo = doPg.filter((i) => i.y > yCab + 3 && i.y < fimTabela);
    const rotulosIt = corpo.filter((i) => i.x + i.w <= limiteEsq + 2);
    const celulasIt = corpo.filter((i) => i.x + i.w > limiteEsq + 2);

    const ls = linhas(celulasIt, 3.5);
    const ysLinhas = ls.map((l) => l.y);

    // rótulos em várias linhas: segmenta usando os nomes conhecidos das seções
    const linhasRot = linhas(rotulosIt, 2).map((l) => ({ y: l.y, txt: norm2(juntar(l.itens)) }));
    const rot = [];
    let acum = null;
    for (const lr of linhasRot) {
      if (!acum) acum = { txt: lr.txt, ys: [lr.y] };
      else { acum.txt += ' ' + lr.txt; acum.ys.push(lr.y); }
      const sec = SECOES_ROTINA.find(([n]) => n === acum.txt);
      const prefixo = SECOES_ROTINA.some(([n]) => n.startsWith(acum.txt + ' '));
      if (sec) { rot.push({ ...acum, subtipo: sec[1] }); acum = null; }
      else if (!prefixo) {
        // texto desconhecido: tenta reconhecer pelo início e segue
        const parecido = SECOES_ROTINA.find(([n]) => acum.txt.startsWith(n.split(' ')[0]));
        rot.push({ ...acum, subtipo: parecido ? parecido[1] : null });
        acum = null;
      }
    }
    const ysR = rot.map((r) => r.ys.reduce((a, b) => a + b, 0) / r.ys.length);
    const blocos = blocosCentralizados(ysLinhas, ysR);

    rot.forEach((r, k) => {
      const b = blocos[k];
      if (!b || !r.subtipo) return;
      for (let i = b[0]; i <= b[1]; i++) {
        const l = ls[i];
        for (const col of colunas) {
          const its = l.itens.filter((it) => Math.abs(it.x + it.w / 2 - col.cx) < passo / 2);
          const nome = juntar(its);
          if (!nome || /^x+$/i.test(nome)) continue;
          const detalhe = r.subtipo === 'salas_comando' ? (POSICOES_SALAS[i - b[0]] || '') : '';
          out.push({ data: col.data, subtipo: r.subtipo, detalhe, nome });
        }
      }
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Filtro pelo cadete                                                 */
/* ------------------------------------------------------------------ */

/** Linhas da escala interna em que aparece o nome completo do cadete. */
export function filtrarPorNomeCompleto(linhasEscala, nomeCompleto) {
  const alvo = normalizar(nomeCompleto);
  if (!alvo) return [];
  return linhasEscala.filter((l) => normalizar(l.nome) === alvo);
}

/** Células da rotina com o nome de guerra do cadete (comparação exata). */
export function filtrarPorNomeGuerra(celulas, nomeGuerra) {
  const alvo = normalizar(nomeGuerra);
  if (!alvo) return [];
  return celulas.filter((c) => normalizar(c.nome) === alvo);
}

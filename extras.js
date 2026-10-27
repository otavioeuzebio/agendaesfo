/**
 * Regras puras (sem tela) das funções extras:
 *   - checklist padrão por tipo de serviço
 *   - relatório de horas / serviços cumpridos
 *   - painel acadêmico (média ponderada e nota necessária)
 *   - conversão das linhas da escala em PDF em missões
 *
 * Nada aqui toca no armazenamento: recebe dados e devolve dados (fácil de testar).
 */
import { SUBTIPOS, SUBTIPOS_ESCALA, lembretesPadrao } from './catalog.js';
import { MODELOS, horarioPadrao, SERVICO_INTERNO } from './modelos.js';

const DIA = 86400000;

/* ---------------- Checklist ---------------- */
/** Material de quem tira serviço armado (Sentinela, Cmt. da Guarda e Estágio CPU). */
export const CK_MATERIAL = ['Fardamento conferido e passado', 'Arma', 'Carregadores', 'Tonfa', 'Colete', 'Fardamento orgânico', 'Capacete / boina', 'Documentos (identidade funcional)', 'Armamento conferido / cautelado'];
const CK_SERVICO = ['Fardamento conferido e passado', 'Identidade funcional / documentos', 'Apresentar-se no horário', 'Ler as alterações do serviço anterior', 'Combinar a rendição'];
const CK_SENTINELA = [...CK_MATERIAL, 'Apresentar-se no horário', 'Combinar a rendição'];
const CK_CMT = [...CK_SERVICO, 'Conferir efetivo e postos', 'Livro de partes em dia'];
const CK_CMT_GUARDA = [...CK_MATERIAL, 'Conferir efetivo e postos', 'Livro de partes em dia', 'Combinar a rendição'];
const CK_CPU = [...CK_MATERIAL, 'Contato do oficial CPU', 'Transporte até a unidade', 'Alimentação / água'];
const CK_ROTINA = ['Separar material de limpeza', 'Executar a missão', 'Dar o pronto ao responsável'];

export const CHECKLISTS = {
  respondente: CK_CMT, cmt_guarda: CK_CMT_GUARDA, dia_esfo: CK_CMT, cmt_bloco3: CK_CMT,
  sentinela_guarda: CK_SENTINELA, sentinela_posto2: CK_SENTINELA,
  plantao_rondante: CK_SERVICO, plantao_bloco3: CK_SERVICO,
  sobreaviso: ['Celular carregado e com som', 'Fardamento pronto', 'Ficar em local de fácil acionamento'],
  guarda: CK_SENTINELA, oficial_dia: CK_CMT, escala_especial: CK_SERVICO, escala_outro: CK_SERVICO,
  estagio_cpu: CK_CPU,
  prova: ['Revisar o conteúdo', 'Caneta, lápis e documento', 'Conferir sala e horário'],
  trabalho: ['Conferir as normas / formatação', 'Revisar o texto', 'Entregar / enviar'],
  seminario: ['Preparar a apresentação', 'Ensaiar', 'Levar material'],
  representacao: ['Contatar o cadete mais antigo para as orientações', 'Fardamento conferido e passado', 'Conferir o trajeto e chegar com antecedência'],
  desfile: ['Fardamento de desfile conferido e passado', 'Confirmar dia e horário da formatura'],
  funcao_comando: ['Conferir as atribuições da função', 'Combinar a passagem com quem saiu'],
  suplencia: ['Procurar o titular da função', 'Anotar as pendências da semana'],
  mce: ['Apresentar-se ao Dia-à-EsFO', 'Fardamento definido pelo Dia-à-EsFO'],
};
for (const s of Object.keys(SUBTIPOS)) if (SUBTIPOS[s].categoria === 'rotina') CHECKLISTS[s] = CK_ROTINA;

/** Checklist novo (itens desmarcados) para um tipo. */
export const checklistPadrao = (subtipo) => (CHECKLISTS[subtipo] || []).map((t) => ({ t, ok: false }));
export const pendentesChecklist = (m) => (m?.checklist || []).filter((c) => !c.ok).length;

/** Serviços armados: checklist de material e aviso na véspera ("Separou o 4º A?"). */
export const SERVICOS_ARMADOS = ['sentinela_guarda', 'sentinela_posto2', 'cmt_guarda', 'estagio_cpu', 'guarda'];
const NOME_CURTO = { sentinela_guarda: 'guarda', sentinela_posto2: 'Posto II', cmt_guarda: 'Cmt. da Guarda', estagio_cpu: 'estágio CPU', guarda: 'guarda' };
const hh = (ms) => { const d = new Date(ms); return d.getMinutes() ? `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}` : `${String(d.getHours()).padStart(2, '0')}h`; };
const diaRel = (de, ate) => {
  const a = new Date(de); a.setHours(0, 0, 0, 0);
  const b = new Date(ate); b.setHours(0, 0, 0, 0);
  const n = Math.round((b - a) / DIA);
  return n === 0 ? 'Hoje' : n === 1 ? 'Amanhã' : `${String(b.getDate()).padStart(2, '0')}/${String(b.getMonth() + 1).padStart(2, '0')}`;
};
/**
 * Aviso da véspera: "Amanhã: guarda 07h. Separou o 4º A?"
 * `quando` = hora em que o aviso aparece (o "amanhã" é contado a partir dela).
 */
export function avisoVespera(it, quando, fardamentoPadrao = '') {
  const tipo = NOME_CURTO[it.subtipo] || (SUBTIPOS[it.subtipo]?.rotulo || 'serviço').toLowerCase();
  const fard = (it.escala?.fardamento || fardamentoPadrao || '').trim();
  const titulo = `${diaRel(quando, it.inicio)}: ${tipo} ${hh(it.inicio)}.`;
  const faltam = (it.checklist || []).filter((c) => !c.ok).map((c) => c.t);
  const pergunta = fard ? `Separou o ${fard}?` : 'Separou o fardamento e o material?';
  const resto = faltam.length ? ` Falta conferir: ${faltam.slice(0, 4).join(', ')}${faltam.length > 4 ? ` e mais ${faltam.length - 4}` : ''}.` : '';
  return { titulo: `${titulo} ${pergunta}`, corpo: `${it.titulo}${it.local ? ' · ' + it.local : ''}.${resto}` };
}

/**
 * Quadro de horários do posto ("19h-21h, 01h-03h") → faixas reais a partir do início do serviço.
 * Cada faixa vira { ini, fim } em ms; horários "antes" do início caem no dia seguinte.
 */
export function quadroDoPosto(texto, inicio, fim) {
  if (!texto) return [];
  const out = [];
  const base = new Date(inicio); base.setHours(0, 0, 0, 0);
  let cursor = inicio;
  for (const parte of String(texto).split(/[,;]+/)) {
    const m = parte.trim().match(/^(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:-|às|a|–)\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?$/i);
    if (!m) continue;
    let ini = base.getTime() + (+m[1] * 60 + +(m[2] || 0)) * 60000;
    while (ini < cursor - (out.length ? 60000 : 3 * 3600000)) ini += DIA; // 1º horário pode começar um pouco antes da hora marcada
    let f = base.getTime() + (+m[3] * 60 + +(m[4] || 0)) * 60000;
    while (f <= ini) f += DIA;
    if (fim && ini >= fim) continue;
    out.push({ ini, fim: f, rotulo: parte.trim() });
    cursor = f;
  }
  return out;
}

/* ---------------- Relatório de horas ---------------- */
/**
 * Resumo dos serviços de um período.
 * Conta o que foi cumprido (concluído) ou que já terminou sem ser trocado.
 * Sobreaviso fica separado (não é hora de serviço efetivo).
 * Retorna { linhas: [{ subtipo, rotulo, qtd, horas }], total: {qtd, horas}, sobreaviso: {qtd, horas}, rotina: {qtd} }
 */
export function relatorioHoras(itens, agora = Date.now()) {
  const porTipo = new Map();
  const total = { qtd: 0, horas: 0 }, sobreaviso = { qtd: 0, horas: 0 }, rotina = { qtd: 0 };
  for (const it of itens) {
    if (it.status === 'pulado') continue;
    const fim = it.fim ?? (it.diaTodo ? it.inicio + DIA : it.inicio);
    const cumprido = it.status === 'concluida' || fim <= agora;
    if (!cumprido) continue;
    const cat = SUBTIPOS[it.subtipo]?.categoria;
    if (cat === 'rotina') { rotina.qtd++; continue; }
    if (!SUBTIPOS_ESCALA.includes(it.subtipo)) continue;
    const horas = it.fim ? Math.max(0, (it.fim - it.inicio) / 3600000) : 0;
    if (it.subtipo === 'sobreaviso') { sobreaviso.qtd++; sobreaviso.horas += horas; continue; }
    const l = porTipo.get(it.subtipo) || { subtipo: it.subtipo, rotulo: SUBTIPOS[it.subtipo].rotulo, qtd: 0, horas: 0 };
    l.qtd++; l.horas += horas; porTipo.set(it.subtipo, l);
    total.qtd++; total.horas += horas;
  }
  const linhas = [...porTipo.values()].sort((a, b) => b.horas - a.horas || b.qtd - a.qtd);
  // equilíbrio: folga entre um serviço e o próximo (sem contar sobreaviso e rotina)
  const inicios = itens.filter((it) => it.status !== 'pulado' && SUBTIPOS_ESCALA.includes(it.subtipo) && it.subtipo !== 'sobreaviso')
    .sort((a, b) => a.inicio - b.inicio);
  const folgas = [];
  for (let i = 1; i < inicios.length; i++) {
    const fimAnt = inicios[i - 1].fim ?? inicios[i - 1].inicio;
    folgas.push(Math.max(0, (inicios[i].inicio - fimAnt) / 3600000));
  }
  const equilibrio = folgas.length ? {
    menorFolga: Math.min(...folgas), mediaFolga: folgas.reduce((a, b) => a + b, 0) / folgas.length,
    seguidos: folgas.filter((h) => h < 24).length,
    estagios: (porTipo.get('estagio_cpu')?.qtd || 0),
    guardas: ['sentinela_guarda', 'sentinela_posto2', 'cmt_guarda', 'guarda'].reduce((n, k) => n + (porTipo.get(k)?.qtd || 0), 0),
  } : null;
  return { linhas, total, sobreaviso, rotina, equilibrio };
}

/** Texto do relatório para compartilhar. */
export function textoRelatorio(titulo, r) {
  const h = (x) => `${Math.round(x * 10) / 10} h`;
  return [
    titulo,
    ...r.linhas.map((l) => `• ${l.rotulo}: ${l.qtd} (${h(l.horas)})`),
    `Total de serviço: ${r.total.qtd} (${h(r.total.horas)})`,
    r.sobreaviso.qtd ? `Sobreaviso: ${r.sobreaviso.qtd} (${h(r.sobreaviso.horas)})` : '',
    r.rotina.qtd ? `Missões de rotina: ${r.rotina.qtd}` : '',
    r.equilibrio ? `Menor folga entre serviços: ${h(r.equilibrio.menorFolga)} · folga média: ${h(r.equilibrio.mediaFolga)}` : '',
  ].filter(Boolean).join('\n');
}

/* ---------------- Painel acadêmico ---------------- */
export const SUBTIPOS_AVALIACAO = ['prova', 'trabalho', 'seminario'];
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);

/**
 * Médias ponderadas por disciplina.
 * Cada avaliação: missao com { disciplina, peso (padrão 1), nota (0–10 ou vazio) }.
 * "precisa": média que falta tirar nas avaliações ainda sem nota para chegar à mínima.
 */
export function mediasAcademicas(missoes, mediaMinima = 7) {
  const por = new Map();
  for (const m of missoes) {
    if (!SUBTIPOS_AVALIACAO.includes(m.subtipo)) continue;
    const disc = (m.disciplina || '').trim() || 'Sem disciplina';
    const d = por.get(disc) || { disciplina: disc, avaliacoes: [], somaPesos: 0, somaNotas: 0, pesosFeitos: 0, pesosFaltam: 0 };
    const peso = num(m.peso) ?? 1;
    const nota = num(m.nota);
    d.avaliacoes.push({ id: m.id, titulo: m.titulo, inicio: m.inicio, peso, nota, subtipo: m.subtipo });
    d.somaPesos += peso;
    if (nota != null) { d.somaNotas += nota * peso; d.pesosFeitos += peso; } else d.pesosFaltam += peso;
    por.set(disc, d);
  }
  return [...por.values()].map((d) => {
    const media = d.pesosFeitos ? d.somaNotas / d.pesosFeitos : null;
    let precisa = null, situacao = 'sem-notas';
    if (d.pesosFaltam > 0) {
      precisa = (mediaMinima * d.somaPesos - d.somaNotas) / d.pesosFaltam;
      situacao = precisa <= 0 ? 'garantida' : precisa > 10 ? 'impossivel' : 'em-aberto';
      if (precisa < 0) precisa = 0;
    } else if (media != null) situacao = media >= mediaMinima ? 'aprovado' : 'abaixo';
    d.avaliacoes.sort((a, b) => a.inicio - b.inicio);
    const proxima = d.avaliacoes.find((a) => a.nota == null) || null;
    const finalizada = d.pesosFaltam === 0 && media != null;
    return { ...d, media, precisa, situacao, proxima, finalizada };
  }).sort((a, b) => a.disciplina.localeCompare(b.disciplina, 'pt'));
}

/** Média geral: soma das médias das disciplinas finalizadas ÷ quantidade de disciplinas finalizadas. */
export function mediaGeral(disciplinas) {
  const fin = disciplinas.filter((d) => d.finalizada && d.disciplina !== 'Sem disciplina');
  return { media: fin.length ? fin.reduce((s, d) => s + d.media, 0) / fin.length : null, finalizadas: fin.length, total: disciplinas.filter((d) => d.disciplina !== 'Sem disciplina').length };
}

/* ---------------- Escala em PDF → missões ---------------- */
const modeloDe = (subtipo) => MODELOS.find((m) => m.subtipo === subtipo);
const deYmd = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };

/** Id fixo por serviço: importar a mesma escala de novo não duplica. */
export const idEscala = (l) => `esc-${l.data}-${l.subtipo}${l.detalhe ? '-' + l.detalhe.toLowerCase().replace(/[^a-z0-9]+/g, '') : ''}`;

/** Converte linhas lidas da escala (já filtradas pelo cadete) em missões prontas para salvar. */
export function linhasParaMissoes(linhas, { fardamento = '' } = {}) {
  const vistos = new Set();
  const out = [];
  for (const l of linhas) {
    const id = idEscala(l);
    if (vistos.has(id)) continue;
    vistos.add(id);
    const mod = modeloDe(l.subtipo) || {};
    const h = horarioPadrao(l.subtipo, deYmd(l.data));
    if (!h) continue;
    const titulo = l.subtipo === 'sobreaviso' && l.detalhe ? `Sobreaviso – ${l.detalhe}` : (mod.titulo || SUBTIPOS[l.subtipo]?.rotulo || 'Serviço');
    const prioridade = mod.prioridade || (SERVICO_INTERNO.includes(l.subtipo) ? 'critico' : 'importante');
    out.push({
      id, titulo, categoria: SUBTIPOS[l.subtipo].categoria, subtipo: l.subtipo, prioridade,
      inicio: h.inicio, fim: h.fim, diaTodo: h.diaTodo, local: mod.local || '', obs: mod.obs || '',
      lembretes: mod.lembretes || lembretesPadrao(l.subtipo, prioridade),
      escala: mod.escala ? { ...mod.escala, funcao: l.funcao || mod.escala.funcao, ...(fardamento && SERVICOS_ARMADOS.includes(l.subtipo) ? { fardamento } : {}) } : null,
      detalhe: l.detalhe || '', origemEscala: true,
      checklist: checklistPadrao(l.subtipo),
    });
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

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
const CK_SERVICO = ['Fardamento conferido e passado', 'Identidade funcional / documentos', 'Apresentar-se no horário', 'Ler as alterações do serviço anterior', 'Combinar a rendição'];
const CK_SENTINELA = [...CK_SERVICO, 'Conferir o material do posto'];
const CK_CMT = [...CK_SERVICO, 'Conferir efetivo e postos', 'Livro de partes em dia'];
const CK_CPU = ['Fardamento operacional', 'Colete e equipamentos', 'Identidade funcional / documentos', 'Contato do oficial CPU', 'Transporte até a unidade', 'Alimentação / água'];
const CK_ROTINA = ['Separar material de limpeza', 'Executar a missão', 'Dar o pronto ao responsável'];

export const CHECKLISTS = {
  respondente: CK_CMT, cmt_guarda: CK_CMT, dia_esfo: CK_CMT, cmt_bloco3: CK_CMT,
  sentinela_guarda: CK_SENTINELA, sentinela_posto2: CK_SENTINELA,
  plantao_rondante: CK_SENTINELA, plantao_bloco3: CK_SENTINELA,
  sobreaviso: ['Celular carregado e com som', 'Fardamento pronto', 'Ficar em local de fácil acionamento'],
  guarda: CK_SENTINELA, oficial_dia: CK_CMT, escala_especial: CK_SERVICO, escala_outro: CK_SERVICO,
  estagio_cpu: CK_CPU,
  prova: ['Revisar o conteúdo', 'Caneta, lápis e documento', 'Conferir sala e horário'],
  trabalho: ['Conferir as normas / formatação', 'Revisar o texto', 'Entregar / enviar'],
  seminario: ['Preparar a apresentação', 'Ensaiar', 'Levar material'],
};
for (const s of Object.keys(SUBTIPOS)) if (SUBTIPOS[s].categoria === 'rotina') CHECKLISTS[s] = CK_ROTINA;

/** Checklist novo (itens desmarcados) para um tipo. */
export const checklistPadrao = (subtipo) => (CHECKLISTS[subtipo] || []).map((t) => ({ t, ok: false }));
export const pendentesChecklist = (m) => (m?.checklist || []).filter((c) => !c.ok).length;

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
  return { linhas, total, sobreaviso, rotina };
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
    return { ...d, media, precisa, situacao };
  }).sort((a, b) => a.disciplina.localeCompare(b.disciplina, 'pt'));
}

/* ---------------- Escala em PDF → missões ---------------- */
const modeloDe = (subtipo) => MODELOS.find((m) => m.subtipo === subtipo);
const deYmd = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };

/** Id fixo por serviço: importar a mesma escala de novo não duplica. */
export const idEscala = (l) => `esc-${l.data}-${l.subtipo}${l.detalhe ? '-' + l.detalhe.toLowerCase().replace(/[^a-z0-9]+/g, '') : ''}`;

/** Converte linhas lidas da escala (já filtradas pelo cadete) em missões prontas para salvar. */
export function linhasParaMissoes(linhas) {
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
      escala: mod.escala ? { ...mod.escala, funcao: l.funcao || mod.escala.funcao } : null,
      detalhe: l.detalhe || '', origemEscala: true,
      checklist: checklistPadrao(l.subtipo),
    });
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

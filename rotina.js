/**
 * Rotina do alojamento (regras puras, sem tela):
 *   - revista matinal: checklist do dia e lembrete no horário escolhido
 *   - geladeira: validade dos alimentos (aviso na véspera, no dia e na quinta da Copa)
 *   - relatório do estágio CPU: prazo criado sozinho depois de cada estágio
 *
 * Os itens da revista vêm das AAD mais comuns nas Planilhas de Anotados.
 */
const HORA = 3600000, DIA = 24 * HORA;
const p2 = (n) => String(n).padStart(2, '0');
export const ymd = (d) => { d = new Date(d); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const deYmd = (s) => { const [a, m, d] = String(s).split('-').map(Number); return new Date(a, m - 1, d); };
const emHora = (dia, hhmm) => { const [h, m] = String(hhmm || '06:00').split(':').map(Number); const d = new Date(dia); d.setHours(h || 0, m || 0, 0, 0); return d.getTime(); };
const ddmm = (s) => s.split('-').reverse().slice(0, 2).join('/');

/* ------------------------------ revista ------------------------------ */
export const REVISTA_PADRAO = [
  'Cama arrumada, lençol limpo e esticado',
  'Estrado e armação do beliche sem pó',
  'Armário limpo (por dentro, por cima e no pé)',
  'Gaveta sem lixo e material de estudo guardado',
  'Toalha DAG limpa, sem manchas, no lugar',
  'Mesa e chão limpos',
  'Vidros sem marcas',
  'Nenhum material abandonado (carregador, roupa, calçado)',
  'Luz apagada e alojamento em ordem ao sair',
];
/** Configuração da revista com os padrões (dias: 0 dom … 6 sáb). */
export function configRevista(config = {}) {
  const r = config.revista || {};
  return { ativo: r.ativo !== false, hora: r.hora || '06:00', dias: Array.isArray(r.dias) ? r.dias : [1, 2, 3, 4, 5], itens: r.itens?.length ? r.itens : REVISTA_PADRAO };
}
export const diaDeRevista = (config, dia) => { const r = configRevista(config); return r.ativo && r.dias.includes(new Date(dia).getDay()); };
/** Estado de hoje: { itens, ok: [índices marcados], feita }. */
export function revistaDoDia(config, dia) {
  const r = configRevista(config), hoje = ymd(dia), h = config.revistaHoje || {};
  const ok = h.data === hoje ? (h.ok || []).filter((i) => i < r.itens.length) : [];
  return { itens: r.itens, ok, feita: h.data === hoje && !!h.feita, dia: hoje };
}

/* ------------------------------ geladeira ------------------------------ */
/** Situação do alimento: { estado: 'vencido'|'hoje'|'amanha'|'logo'|'ok', dias }. */
export function situacaoAlimento(validade, agora = Date.now()) {
  const dias = Math.round((deYmd(validade) - deYmd(ymd(agora))) / DIA);
  return { dias, estado: dias < 0 ? 'vencido' : dias === 0 ? 'hoje' : dias === 1 ? 'amanha' : dias <= 3 ? 'logo' : 'ok' };
}
export const ROTULO_ALIMENTO = { vencido: 'Vencido', hoje: 'Vence hoje', amanha: 'Vence amanhã', logo: 'Vence em breve', ok: 'No prazo' };
export const alimentosEmAlerta = (config, agora = Date.now()) => (config.geladeira || [])
  .map((a) => ({ ...a, ...situacaoAlimento(a.validade, agora) }))
  .filter((a) => a.estado !== 'ok' && a.estado !== 'logo')
  .sort((a, b) => a.dias - b.dias);

/* ------------------------------ lembretes extras ------------------------------ */
/**
 * Lembretes que não vêm de missões: revista, validade e conferência de quinta.
 * Devolve [{ dispara, titulo, corpo, chave, tag, critico }] entre `de` e `ate`.
 */
export function lembretesExtras(config = {}, de, ate) {
  const out = [];
  const r = configRevista(config);
  for (let d = new Date(de - DIA); d.getTime() <= ate; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const dia = ymd(d);
    if (r.ativo && r.dias.includes(d.getDay())) {
      const dispara = emHora(d, r.hora);
      const feita = config.revistaHoje?.data === dia && config.revistaHoje?.feita;
      if (!feita && dispara >= de && dispara <= ate) out.push({ dispara, titulo: 'Revista matinal', corpo: `Confira: ${r.itens.slice(0, 3).join(' · ')}…`, chave: 'revista', tag: `revista:${dia}`, critico: false });
    }
    if (d.getDay() === 4 && (config.geladeira || []).length) {
      const dispara = emHora(d, '18:00');
      const lista = (config.geladeira || []).map((a) => `${a.item} (${ddmm(a.validade)})`).join(', ');
      if (dispara >= de && dispara <= ate) out.push({ dispara, titulo: 'Quinta: conferência da geladeira', corpo: `A Copa confere a validade hoje. Seus itens: ${lista}`, chave: 'geladeira', tag: `gelq:${dia}`, critico: false });
    }
  }
  for (const a of config.geladeira || []) {
    const v = deYmd(a.validade);
    for (const [quando, titulo, sufixo] of [[emHora(new Date(v.getTime() - DIA), '08:00'), 'Vence amanhã', 'v1'], [emHora(v, '07:00'), 'Vence hoje', 'v0']]) {
      if (quando >= de && quando <= ate) out.push({ dispara: quando, titulo: `${titulo}: ${a.item}`, corpo: 'Consuma ou descarte antes da revista da geladeira.', chave: 'geladeira', tag: `gel:${a.id}:${sufixo}`, critico: false });
    }
  }
  return out.sort((a, b) => a.dispara - b.dispara);
}

/* ------------------------------ relatório de estágio ------------------------------ */
export const PRAZO_RELATORIO_PADRAO = 48; // horas depois do fim do estágio
/**
 * Missões de "Relatório do estágio" que ainda não foram criadas.
 * Só olha estágios dos últimos 30 dias (e os futuros), uma vez por estágio.
 */
export function relatoriosACriar(missoes, config = {}, agora = Date.now()) {
  const horas = +(config.prazoRelatorioHoras ?? PRAZO_RELATORIO_PADRAO);
  if (!horas || config.relatorioAuto === false) return [];
  const feitos = new Set(config.relatoriosCriados || []);
  const ids = new Set(missoes.map((m) => m.id));
  return missoes
    .filter((m) => m.subtipo === 'estagio_cpu' && m.status !== 'pulado' && !feitos.has(m.id) && !ids.has(`rel-${m.id}`) && (m.fim || m.inicio) > agora - 30 * DIA)
    .map((m) => {
      const unidade = m.escala?.unidade || m.local || '';
      const fim = m.fim || m.inicio + 12 * HORA;
      return {
        id: `rel-${m.id}`, titulo: `Relatório do estágio CPU${unidade ? ' – ' + unidade : ''}`, categoria: 'administrativo', subtipo: 'documento', prioridade: 'importante',
        inicio: fim + horas * HORA, fim: null, diaTodo: false, local: '', detalhe: '',
        obs: `Prazo contado a partir do fim do estágio de ${ddmm(ymd(m.inicio))}. Ajuste o prazo em Missões › Rotina.`,
        lembretes: [1440, 120], checklist: ['Redigir o relatório', 'Assinar o relatório', 'Entregar / protocolar no prazo'].map((t) => ({ t, ok: false })),
        origemEstagio: m.id,
      };
    });
}

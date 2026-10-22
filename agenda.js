/**
 * Visão unificada da agenda: junta missões avulsas e plantões gerados
 * pelos ciclos em uma só lista de "itens", que é o que as telas consomem.
 *
 * Item = Missao + { origem: "missao"|"ciclo", cicloId?, chave }
 */
import { store } from './store.js';
import { SUBTIPOS, lembretesPadrao } from './catalog.js';

const DIA = 86400000;

/** Fim efetivo: o fim informado, o fim do dia (dia todo) ou o próprio início. */
export const fimEfetivo = (it) => it.fim ?? (it.diaTodo ? it.inicio + DIA - 1 : it.inicio);

/** Plantões de um ciclo que tocam o intervalo [de, ate). */
export function plantoesDoCiclo(c, de, ate) {
  if (!c.ativo || !c.periodoMin || c.periodoMin <= 0) return [];
  const periodo = c.periodoMin * 60000;
  const dur = (c.duracaoMin || 0) * 60000;
  const limite = c.ate ? Math.min(ate, c.ate + DIA) : ate;
  // primeiro índice cujo fim alcança "de"
  let k = Math.max(0, Math.floor((de - dur - c.inicio) / periodo));
  const out = [];
  for (let n = 0; n < 400; n++, k++) {
    const ini = c.inicio + k * periodo;
    if (ini >= limite) break;
    if (ini + dur < de) continue;
    const exc = (c.excecoes || {})[ini];
    if (exc?.tipo === 'arquivado') continue; // removido do histórico
    out.push({
      id: `ciclo:${c.id}:${ini}`,
      chave: `ciclo:${c.id}:${ini}`,
      origem: 'ciclo',
      cicloId: c.id,
      titulo: c.titulo,
      categoria: SUBTIPOS[c.subtipo]?.categoria || 'operacional',
      subtipo: c.subtipo,
      prioridade: c.prioridade || 'critico',
      inicio: ini,
      fim: dur ? ini + dur : null,
      diaTodo: false,
      local: c.local || '',
      obs: exc?.motivo || '',
      status: exc?.tipo === 'concluido' ? 'concluida' : exc?.tipo === 'pulado' ? 'pulado' : 'pendente',
      lembretes: c.lembretes || lembretesPadrao(c.subtipo, c.prioridade || 'critico'),
    });
  }
  return out;
}

/** Todos os itens que ocupam algum instante de [de, ate), em ordem. */
export function itensNoIntervalo(de, ate, { incluirPulados = false } = {}) {
  const { missoes, ciclos } = store.get();
  const avulsas = missoes
    .filter((m) => m.inicio < ate && fimEfetivo(m) >= de)
    .map((m) => ({ ...m, origem: 'missao', chave: m.id }));
  const deCiclos = ciclos.flatMap((c) => plantoesDoCiclo(c, de, ate));
  return [...avulsas, ...deCiclos]
    .filter((i) => incluirPulados || i.status !== 'pulado')
    .sort((a, b) => (b.diaTodo - a.diaTodo) || a.inicio - b.inicio);
}

/** Pendentes que ainda não terminaram (inclui em andamento), próximos 60 dias. */
export function proximas(agora) {
  return itensNoIntervalo(agora - 2 * DIA, agora + 60 * DIA)
    .filter((i) => i.status === 'pendente' && fimEfetivo(i) >= agora)
    .sort((a, b) => a.inicio - b.inicio);
}

/** Próximo compromisso crítico (ou operacional); senão, o próximo qualquer. */
export function proximoCritico(agora) {
  const lista = proximas(agora);
  return lista.find((i) => i.prioridade === 'critico' || i.categoria === 'operacional') || lista[0];
}

/** Pendentes cujo horário já passou (últimos 30 dias). */
export function atrasadas(agora) {
  return itensNoIntervalo(agora - 30 * DIA, agora)
    .filter((i) => i.status === 'pendente' && fimEfetivo(i) < agora)
    .sort((a, b) => b.inicio - a.inicio);
}

/** Lembretes que já deveriam ter disparado e ainda não foram exibidos. */
export function lembretesVencidos(agora) {
  const { avisados } = store.get();
  const out = [];
  for (const it of proximas(agora)) {
    const ancora = it.diaTodo ? it.inicio + 8 * 3600000 : it.inicio;
    for (const min of it.lembretes || []) {
      const dispara = ancora - min * 60000;
      const chave = `${it.chave}@${min}`;
      // só avisa se venceu há menos de 6 h (evita enxurrada ao abrir após dias fechado)
      if (dispara <= agora && agora - dispara < 6 * 3600000 && !avisados[chave]) out.push({ it, min, chave });
    }
  }
  return out;
}

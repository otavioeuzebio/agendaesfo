/**
 * Armazenamento local (localStorage) — fonte da verdade do app.
 *
 * Estrutura salva na chave "agenda-cadete:v1":
 * {
 *   versao: 1,
 *   config:  { nome, tema },                // tema: "auto" | "claro" | "escuro"
 *   missoes: [Missao],
 *   ciclos:  [Ciclo],
 *   avisados: { [chave]: ms }                // lembretes já exibidos (evita repetir)
 * }
 *
 * Missao = {
 *   id, titulo, categoria, subtipo, prioridade,
 *   inicio (ms), fim (ms|null), diaTodo (bool), local, obs,
 *   status: "pendente"|"concluida", lembretes: [min],
 *   escala: { posto, funcao, fardamento } | null,
 *   trocas: [{ em, comQuem, motivo, status }],
 *   criadoEm, atualizadoEm
 * }
 *
 * Ciclo (escala de rodízio que se repete sozinha) = {
 *   id, titulo, subtipo, prioridade, local, lembretes,
 *   inicio (ms do 1º plantão), duracaoMin, periodoMin, ate (ms|null), ativo,
 *   excecoes: { [inicioDoPlantaoMs]: { tipo: "concluido"|"pulado", motivo } }
 * }
 *
 * Cada gravação é síncrona e imediata: fechar o app logo depois não perde nada.
 */
const CHAVE_ANTIGA = 'agenda-cadete:v1';
let CHAVE = CHAVE_ANTIGA; // vira "agenda-cadete:v1:<conta>" quando há login

const vazio = () => ({
  versao: 1,
  config: { nome: '', tema: 'auto' },
  missoes: [],
  ciclos: [],
  avisados: {},
  removidos: {}, // id → quando foi apagado (para a sincronização não ressuscitar)
});

let estado = carregar();
const ouvintes = new Set();

function carregar() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return vazio();
    const dados = JSON.parse(bruto);
    return { ...vazio(), ...dados, config: { ...vazio().config, ...(dados.config || {}) } };
  } catch (e) {
    console.warn('Dados locais ilegíveis; iniciando vazio.', e);
    return vazio();
  }
}

let falhouGravar = false;
function gravar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(estado));
    falhouGravar = false;
  } catch (e) {
    falhouGravar = true;
    console.error('Falha ao salvar no aparelho', e);
  }
  ouvintes.forEach((fn) => fn(estado));
}

/**
 * Passa a usar a agenda de uma conta. Cada conta tem a sua chave no
 * aparelho, então duas pessoas no mesmo celular não veem a agenda uma da outra.
 * A agenda que já existia antes do login vai para a primeira conta que entrar.
 */
export function usarConta(uid) {
  CHAVE = `${CHAVE_ANTIGA}:${uid}`;
  try {
    const antiga = localStorage.getItem(CHAVE_ANTIGA);
    if (antiga && !localStorage.getItem(CHAVE)) {
      localStorage.setItem(CHAVE, antiga);
      localStorage.removeItem(CHAVE_ANTIGA);
    }
  } catch (e) { /* armazenamento indisponível */ }
  estado = carregar();
  try { localStorage.setItem('agenda-cadete:tema', estado.config.tema || 'auto'); } catch (e) {}
}

export const store = {
  get: () => estado,
  falhouGravar: () => falhouGravar,
  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },

  setConfig(parcial) {
    estado.config = { ...estado.config, ...parcial, atualizadoEm: Date.now() }; gravar();
    try { localStorage.setItem('agenda-cadete:tema', estado.config.tema || 'auto'); } catch (e) {}
  },

  salvarMissao(m) {
    const agora = Date.now();
    const i = estado.missoes.findIndex((x) => x.id === m.id);
    if (i >= 0) estado.missoes[i] = { ...estado.missoes[i], ...m, atualizadoEm: agora };
    else estado.missoes.push({ trocas: [], status: 'pendente', ...m, id: m.id || novoId(), criadoEm: agora, atualizadoEm: agora });
    gravar();
  },
  /** Grava várias missões de uma vez (importação de escala). Devolve quantas eram novas. */
  salvarMissoes(lista) {
    const agora = Date.now();
    let novas = 0;
    for (const m of lista) {
      const i = estado.missoes.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        const atual = estado.missoes[i];
        // mantém o que o cadete já marcou (status, checklist, observações)
        estado.missoes[i] = { ...m, ...atual, inicio: m.inicio, fim: m.fim, diaTodo: m.diaTodo, atualizadoEm: agora };
      } else { estado.missoes.push({ trocas: [], status: 'pendente', ...m, criadoEm: agora, atualizadoEm: agora }); novas++; }
      delete estado.removidos[m.id];
    }
    gravar();
    return novas;
  },
  excluirMissao(id) { estado.missoes = estado.missoes.filter((m) => m.id !== id); estado.removidos[id] = Date.now(); gravar(); },
  /** Marca/desmarca um item do checklist de uma missão. */
  marcarChecklist(id, indice) {
    const m = estado.missoes.find((x) => x.id === id);
    if (!m || !m.checklist?.[indice]) return;
    m.checklist = m.checklist.map((c, i) => (i === indice ? { ...c, ok: !c.ok } : c));
    m.atualizadoEm = Date.now(); gravar();
  },
  alternarMissao(id) {
    const m = estado.missoes.find((x) => x.id === id);
    if (m) { m.status = m.status === 'concluida' ? 'pendente' : 'concluida'; m.atualizadoEm = Date.now(); gravar(); }
  },
  registrarTroca(id, troca) {
    const m = estado.missoes.find((x) => x.id === id);
    if (m) { m.trocas = [...(m.trocas || []), { em: Date.now(), ...troca }]; m.atualizadoEm = Date.now(); gravar(); }
  },

  salvarCiclo(c) {
    const i = estado.ciclos.findIndex((x) => x.id === c.id);
    if (i >= 0) estado.ciclos[i] = { ...estado.ciclos[i], ...c, atualizadoEm: Date.now() };
    else estado.ciclos.push({ excecoes: {}, ativo: true, ...c, id: c.id || novoId(), atualizadoEm: Date.now() });
    gravar();
  },
  excluirCiclo(id) { estado.ciclos = estado.ciclos.filter((c) => c.id !== id); estado.removidos['ciclo:' + id] = Date.now(); gravar(); },
  /** Marca/desmarca um plantão de ciclo (concluído, pulado por troca/dispensa). */
  excecaoCiclo(cicloId, inicioMs, excecao) {
    const c = estado.ciclos.find((x) => x.id === cicloId);
    if (!c) return;
    c.excecoes = { ...(c.excecoes || {}) };
    if (excecao) c.excecoes[inicioMs] = excecao; else delete c.excecoes[inicioMs];
    c.atualizadoEm = Date.now();
    gravar();
  },

  marcarAvisado(chave) {
    estado.avisados[chave] = Date.now();
    // limpa marcas com mais de 30 dias
    const limite = Date.now() - 30 * 86400000;
    for (const k in estado.avisados) if (estado.avisados[k] < limite) delete estado.avisados[k];
    gravar();
  },

  /** Cópia do estado atual, usada para "Desfazer". */
  snapshot() { return JSON.stringify(estado); },
  restaurar(snap) {
    // o que volta ganha data nova, para a sincronização não apagar de novo
    const agora = Date.now();
    const antes = JSON.parse(snap);
    for (const m of antes.missoes) { delete (antes.removidos || {})[m.id]; m.atualizadoEm = agora; }
    for (const c of antes.ciclos) { delete (antes.removidos || {})['ciclo:' + c.id]; c.atualizadoEm = agora; }
    estado = { ...vazio(), ...antes }; gravar();
  },
  /** Tira do histórico: apaga missões concluídas e arquiva plantões de ciclo concluídos. */
  removerDoHistorico(chaves) {
    for (const k of chaves) {
      if (k.startsWith('ciclo:')) {
        const [, id, ini] = k.split(':');
        const c = estado.ciclos.find((x) => x.id === id);
        if (c) { c.excecoes = { ...(c.excecoes || {}), [ini]: { tipo: 'arquivado' } }; c.atualizadoEm = Date.now(); }
      } else { estado.missoes = estado.missoes.filter((m) => m.id !== k); estado.removidos[k] = Date.now(); }
    }
    gravar();
  },

  exportar() { return JSON.stringify({ ...estado, exportadoEm: new Date().toISOString() }, null, 2); },
  importar(texto) {
    const dados = JSON.parse(texto);
    if (!Array.isArray(dados.missoes) || !Array.isArray(dados.ciclos)) throw new Error('Arquivo não é um backup da Agenda do Cadete.');
    estado = { ...vazio(), ...dados, config: { ...vazio().config, ...(dados.config || {}) } };
    gravar();
  },

  /** Junta um estado vindo de outro aparelho com o daqui. Devolve true se algo mudou aqui. */
  mesclar(remoto) {
    const antes = JSON.stringify(estado);
    estado = mesclarEstados(estado, remoto);
    const mudou = JSON.stringify(estado) !== antes;
    if (mudou) gravar();
    return mudou;
  },
};

/**
 * Mescla dois estados da agenda (sincronização entre aparelhos).
 *  - missões e ciclos: fica a versão com "atualizadoEm" mais recente;
 *  - apagados (removidos) vencem versões mais antigas;
 *  - configurações: a mais recente;
 *  - avisos já exibidos: união.
 */
export function mesclarEstados(a, b) {
  if (!b) return a;
  const removidos = { ...(a.removidos || {}) };
  for (const [k, t] of Object.entries(b.removidos || {})) removidos[k] = Math.max(removidos[k] || 0, t);
  // esquece marcas de remoção com mais de 120 dias
  const limite = Date.now() - 120 * 86400000;
  for (const k in removidos) if (removidos[k] < limite) delete removidos[k];

  const juntar = (la = [], lb = [], prefixo) => {
    const mapa = new Map();
    for (const x of [...la, ...lb]) {
      const atual = mapa.get(x.id);
      if (!atual || (x.atualizadoEm || 0) > (atual.atualizadoEm || 0)) mapa.set(x.id, x);
    }
    return [...mapa.values()].filter((x) => !(removidos[prefixo + x.id] >= (x.atualizadoEm || 0)));
  };
  const avisados = { ...(a.avisados || {}) };
  for (const [k, t] of Object.entries(b.avisados || {})) avisados[k] = Math.max(avisados[k] || 0, t);
  const config = (b.config?.atualizadoEm || 0) > (a.config?.atualizadoEm || 0)
    ? { ...a.config, ...b.config, tema: a.config?.tema ?? b.config.tema } // tema é de cada aparelho
    : a.config;
  return {
    ...a,
    config,
    missoes: juntar(a.missoes, b.missoes, ''),
    ciclos: juntar(a.ciclos, b.ciclos, 'ciclo:'),
    avisados,
    removidos,
  };
}

export function novoId() {
  return (crypto.randomUUID && crypto.randomUUID()) || 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Pede ao navegador para não apagar os dados em limpeza automática. */
export async function pedirArmazenamentoPersistente() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* sem suporte */ }
  return false;
}

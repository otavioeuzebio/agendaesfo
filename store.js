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
    estado.config = { ...estado.config, ...parcial }; gravar();
    try { localStorage.setItem('agenda-cadete:tema', estado.config.tema || 'auto'); } catch (e) {}
  },

  salvarMissao(m) {
    const agora = Date.now();
    const i = estado.missoes.findIndex((x) => x.id === m.id);
    if (i >= 0) estado.missoes[i] = { ...estado.missoes[i], ...m, atualizadoEm: agora };
    else estado.missoes.push({ trocas: [], status: 'pendente', ...m, id: m.id || novoId(), criadoEm: agora, atualizadoEm: agora });
    gravar();
  },
  excluirMissao(id) { estado.missoes = estado.missoes.filter((m) => m.id !== id); gravar(); },
  alternarMissao(id) {
    const m = estado.missoes.find((x) => x.id === id);
    if (m) { m.status = m.status === 'concluida' ? 'pendente' : 'concluida'; m.atualizadoEm = Date.now(); gravar(); }
  },
  registrarTroca(id, troca) {
    const m = estado.missoes.find((x) => x.id === id);
    if (m) { m.trocas = [...(m.trocas || []), { em: Date.now(), ...troca }]; gravar(); }
  },

  salvarCiclo(c) {
    const i = estado.ciclos.findIndex((x) => x.id === c.id);
    if (i >= 0) estado.ciclos[i] = { ...estado.ciclos[i], ...c };
    else estado.ciclos.push({ excecoes: {}, ativo: true, ...c, id: c.id || novoId() });
    gravar();
  },
  excluirCiclo(id) { estado.ciclos = estado.ciclos.filter((c) => c.id !== id); gravar(); },
  /** Marca/desmarca um plantão de ciclo (concluído, pulado por troca/dispensa). */
  excecaoCiclo(cicloId, inicioMs, excecao) {
    const c = estado.ciclos.find((x) => x.id === cicloId);
    if (!c) return;
    c.excecoes = { ...(c.excecoes || {}) };
    if (excecao) c.excecoes[inicioMs] = excecao; else delete c.excecoes[inicioMs];
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
  restaurar(snap) { estado = JSON.parse(snap); gravar(); },
  /** Tira do histórico: apaga missões concluídas e arquiva plantões de ciclo concluídos. */
  removerDoHistorico(chaves) {
    for (const k of chaves) {
      if (k.startsWith('ciclo:')) {
        const [, id, ini] = k.split(':');
        const c = estado.ciclos.find((x) => x.id === id);
        if (c) c.excecoes = { ...(c.excecoes || {}), [ini]: { tipo: 'arquivado' } };
      } else estado.missoes = estado.missoes.filter((m) => m.id !== k);
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
};

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

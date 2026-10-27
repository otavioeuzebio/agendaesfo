/**
 * Modelos pré-preenchidos (abas da adição) e regras de horário.
 *
 * Fontes: "Previsão de Escala de Serviço Interno" e "Escala da Rotina" da EsFO.
 * Para mudar um horário, um local ou uma unidade, edite apenas este arquivo.
 */

/** Unidades do Estágio CPU, agrupadas por Comando Regional. */
export const UNIDADES_CPU = [
  { crpm: '1º CRPM', unidades: ['12º BPM', '13º BPM', '20º BPM', '23º BPM', '33º BPM'] },
  { crpm: '6º CRPM', unidades: ['17º BPM', '22º BPM', '29º BPM', '34º BPM'] },
];
export const crpmDa = (unidade) => UNIDADES_CPU.find((g) => g.unidades.includes(unidade))?.crpm || '';

/** Grupos do Sobreaviso (a quem o sobreaviso responde na escala). */
export const GRUPOS_SOBREAVISO = ['Respondente', 'Guarda', 'Dia-à-EsFO / Bloco III', 'Plantões Rondantes', 'Plantões do Bloco III'];

/** Posições da missão "Salas: Comando, Coordenação, Subcomando" (da esquerda para a direita na escala). */
export const POSICOES_SALAS = ['Sala Cmdo', 'Corredor 1', 'Corredor 2', 'Sala Subcmdo'];

/** Funções do Serviço Interno: todas seguem o horário do serviço do dia. */
export const SERVICO_INTERNO = ['respondente', 'cmt_guarda', 'sentinela_guarda', 'sentinela_posto2', 'dia_esfo', 'cmt_bloco3', 'plantao_rondante', 'plantao_bloco3', 'sobreaviso'];

/**
 * Horário das Missões de Rotina (conforme as orientações da escala).
 *   hora: [h, min] de início/apresentação · fim: [h, min] ou null
 *   diaTodo: sem horário fixo · diaSeguinte: feita no dia seguinte ao da escala
 */
const ROTINA = {
  cafe_instrutores: { hora: [6, 45], regra: 'Sala pronta para revista às 06h45' },
  copa:             { hora: [18, 0], regra: 'Limpeza até o pernoite; apresentar ao Cmt. do Bloco ou Dia-à-EsFO' },
  viaturas_pm:      { hora: [6, 50], regra: 'Apresentar às 06h50 aos responsáveis de "Viaturas EsFO"' },
  salas_comando:    { hora: [18, 0], fim: [21, 0], regra: 'Após o expediente; apresentar ao Cmt. do Bloco até 21h' },
  bloco_salas:      { hora: [18, 0], regra: 'Após as 18h; apresentar ao Cmt. do Bloco ao terminar' },
  lavanderia:       { hora: [6, 20], diaSeguinte: true, regra: 'Feita no dia seguinte; pronta para revista às 06h20' },
  museu_esfo:       { diaTodo: true, regra: 'Sem horário fixo; aos domingos, aspirar o tapete' },
  manutencao_adm:   { hora: [18, 0], regra: 'Após as 18h, até o pernoite (fiscalização do Respondente)' },
};

const ehFimDeSemana = (d) => d.getDay() === 0 || d.getDay() === 6;
const em = (dia, h, m = 0, diasDepois = 0) => new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + diasDepois, h, m, 0, 0).getTime();

/**
 * Horário automático do tipo para a data escolhida.
 * Retorna { inicio, fim|null, diaTodo, regra } ou null quando o tipo não tem regra.
 *  - Serviço Interno (todas as funções): seg–sex 19h → 07h; sáb e dom 07h → 07h.
 *  - Estágio CPU: 06h → 18h (fins de semana).
 *  - Missões de Rotina: horários das orientações da escala.
 */
export function horarioPadrao(subtipo, dia) {
  if (SERVICO_INTERNO.includes(subtipo)) {
    return ehFimDeSemana(dia)
      ? { inicio: em(dia, 7), fim: em(dia, 7, 0, 1), diaTodo: false, regra: 'Fim de semana: 07h às 07h' }
      : { inicio: em(dia, 19), fim: em(dia, 7, 0, 1), diaTodo: false, regra: 'Dia de semana: 19h às 07h' };
  }
  if (subtipo === 'estagio_cpu') {
    return { inicio: em(dia, 6), fim: em(dia, 18), diaTodo: false, regra: ehFimDeSemana(dia) ? 'Estágio CPU: 06h às 18h' : 'Atenção: o estágio CPU costuma ser no fim de semana' };
  }
  const r = ROTINA[subtipo];
  if (r) {
    if (r.diaTodo) return { inicio: em(dia, 0, 0, r.diaSeguinte ? 1 : 0), fim: null, diaTodo: true, regra: r.regra };
    const dd = r.diaSeguinte ? 1 : 0;
    return { inicio: em(dia, ...r.hora, dd), fim: r.fim ? em(dia, ...r.fim, dd) : null, diaTodo: false, regra: r.regra };
  }
  return null;
}

/** Próximo sábado a partir de um dia (o próprio dia, se já for sábado ou domingo). */
export function proximoFimDeSemana(dia) {
  if (ehFimDeSemana(dia)) return dia;
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + (6 - dia.getDay()));
}

const OP = { categoria: 'operacional', prioridade: 'critico', lembretes: [1440, 120, 30] };
const RT = { categoria: 'rotina', prioridade: 'importante', lembretes: [120, 30] };

/** Abas exibidas ao tocar no botão dourado, agrupadas por escala. */
export const MODELOS = [
  // ---- Serviço Interno
  { grupo: 'Serviço Interno', id: 'respondente', rotulo: 'Respondente', subtipo: 'respondente', titulo: 'Respondente', local: 'EsFO', escala: { funcao: 'Respondente' }, ...OP },
  { grupo: 'Serviço Interno', id: 'cmt_guarda', rotulo: 'Cmt. da Guarda', subtipo: 'cmt_guarda', titulo: 'Cmt. da Guarda', local: 'Corpo da Guarda', escala: { funcao: 'Cmt. da Guarda', posto: 'Guarda' }, ...OP },
  { grupo: 'Serviço Interno', id: 'sentinela_guarda', rotulo: 'Sentinela da Guarda', subtipo: 'sentinela_guarda', titulo: 'Sentinela da Guarda', local: 'Corpo da Guarda', escala: { funcao: 'Sentinela', posto: 'Guarda' }, ...OP },
  { grupo: 'Serviço Interno', id: 'sentinela_posto2', rotulo: 'Sentinela do Posto II', subtipo: 'sentinela_posto2', titulo: 'Sentinela do Posto II', local: 'Posto II', escala: { funcao: 'Sentinela', posto: 'Posto II' }, ...OP },
  { grupo: 'Serviço Interno', id: 'dia_esfo', rotulo: 'Dia-à-EsFO', subtipo: 'dia_esfo', titulo: 'Dia-à-EsFO', local: 'EsFO', escala: { funcao: 'Dia-à-EsFO' }, ...OP },
  { grupo: 'Serviço Interno', id: 'cmt_bloco3', rotulo: 'Cmt. do Bloco III', subtipo: 'cmt_bloco3', titulo: 'Cmt. do Bloco III', local: 'Bloco III', escala: { funcao: 'Cmt. do Bloco III', posto: 'Bloco III' }, ...OP },
  { grupo: 'Serviço Interno', id: 'plantao_rondante', rotulo: 'Plantão Rondante – Postos Externos', subtipo: 'plantao_rondante', titulo: 'Plantão Rondante – Postos Externos', local: 'Postos externos', escala: { funcao: 'Plantão Rondante' }, ...OP },
  { grupo: 'Serviço Interno', id: 'plantao_bloco3', rotulo: 'Plantão do Bloco III', subtipo: 'plantao_bloco3', titulo: 'Plantão do Bloco III', local: 'Bloco III', escala: { funcao: 'Plantão', posto: 'Bloco III' }, ...OP },
  { grupo: 'Serviço Interno', id: 'sobreaviso', rotulo: 'Sobreaviso', subtipo: 'sobreaviso', titulo: 'Sobreaviso', local: '', escala: { funcao: 'Sobreaviso' }, ...OP, prioridade: 'importante' },
  // ---- Missões de Rotina
  { grupo: 'Missões de Rotina', id: 'cafe_instrutores', rotulo: 'Café dos Instrutores', subtipo: 'cafe_instrutores', titulo: 'Café dos Instrutores', local: 'Sala dos instrutores',
    obs: 'Organizar a sala, trocar a garrafa de café do dia anterior e repor; água quente pela manhã e no almoço; limpar a sala do cadete. Aguardar na sala para a revista.', ...RT },
  { grupo: 'Missões de Rotina', id: 'copa', rotulo: 'Copa', subtipo: 'copa', titulo: 'Copa', local: 'Copa',
    obs: 'Limpar geladeira, micro-ondas, chão e superfícies. Na quinta-feira, conferir a validade dos alimentos em todas as geladeiras.', ...RT },
  { grupo: 'Missões de Rotina', id: 'viaturas_pm', rotulo: 'Viaturas PM', subtipo: 'viaturas_pm', titulo: 'Viaturas PM', local: 'Pátio das viaturas',
    obs: 'Lavar e limpar as viaturas EsFO e a Vtr Citroën C4 branca (Cmd).', ...RT },
  { grupo: 'Missões de Rotina', id: 'salas_comando', rotulo: 'Salas: Comando, Coordenação, Subcomando', subtipo: 'salas_comando', titulo: 'Salas do Comando e Coordenação', local: 'Coordenação',
    obs: 'Limpeza e enceramento após o expediente.', ...RT },
  { grupo: 'Missões de Rotina', id: 'bloco_salas', rotulo: 'Bloco de Salas de Aula', subtipo: 'bloco_salas', titulo: 'Bloco de Salas de Aula', local: 'Bloco de salas de aula',
    obs: 'Banheiro do bloco, Sala 13 e auditório da EsFO: limpeza, organização e retirada de resíduos.', ...RT },
  { grupo: 'Missões de Rotina', id: 'lavanderia', rotulo: 'Lavanderia', subtipo: 'lavanderia', titulo: 'Lavanderia', local: 'Lavanderia',
    obs: 'Verificar os filtros das secadoras; se estiverem sujos, avisar o Cmt. do Bloco III. Dar o pronto ao Cmt. do Bloco ou Dia-à-EsFO.', ...RT },
  { grupo: 'Missões de Rotina', id: 'museu_esfo', rotulo: 'Museu EsFO', subtipo: 'museu_esfo', titulo: 'Museu EsFO', local: 'Museu EsFO',
    obs: 'Friso em frente à coordenação e corredores, mobiliário e caixas de vidro da espada e do espadim.', ...RT },
  { grupo: 'Missões de Rotina', id: 'manutencao_adm', rotulo: 'Manutenção prédio ADM', subtipo: 'manutencao_adm', titulo: 'Manutenção prédio ADM', local: 'Bloco ADM',
    obs: 'Banheiros do bloco ADM, corredores, grimpas e lixo dos banheiros, da copa e do entorno.', ...RT },
  // ---- Estágio e outras escalas
  { grupo: 'Estágio e outras escalas', id: 'estagio_cpu', rotulo: 'Estágio CPU', subtipo: 'estagio_cpu', titulo: 'Estágio CPU', local: '', escala: { funcao: 'Estagiário' }, ...OP },
  { grupo: 'Estágio e outras escalas', id: 'representacao', rotulo: 'Representação', subtipo: 'representacao', titulo: 'Representação – ', hora: 17, local: '', escala: { funcao: 'Representação' },
    obs: 'Contatar o cadete mais antigo da representação para as orientações. Cumprir os horários e o fardamento da escala.', ...OP },
  { grupo: 'Estágio e outras escalas', id: 'desfile', rotulo: 'Desfile', subtipo: 'desfile', categoria: 'administrativo', prioridade: 'importante', titulo: 'Desfile – ', diaTodo: true, local: 'APMG', lembretes: [1440] },
  { grupo: 'Estágio e outras escalas', id: 'funcao_comando', rotulo: 'Função de comando (semana)', subtipo: 'funcao_comando', categoria: 'administrativo', prioridade: 'importante', titulo: '', diaTodo: true, local: 'Batalhão EsFO', lembretes: [1440] },
  { grupo: 'Estágio e outras escalas', id: 'suplencia', rotulo: 'Suplência de comando', subtipo: 'suplencia', categoria: 'administrativo', prioridade: 'importante', titulo: 'Suplente – ', diaTodo: true, local: 'Batalhão EsFO', lembretes: [1440],
    obs: 'Procurar o titular da função até sábado às 19h.' },
  { grupo: 'Estágio e outras escalas', id: 'mce', rotulo: 'MCE (Escala Especial / LC)', subtipo: 'mce', categoria: 'administrativo', prioridade: 'critico', titulo: 'MCE – Escala Especial ', hora: 14, local: 'EsFO / APMG', lembretes: [1440, 120, 30],
    obs: 'Apresentar-se ao Dia-à-EsFO. Participar do hasteamento e do arriamento da Bandeira enquanto estiver na APMG.' },
  { grupo: 'Estágio e outras escalas', id: 'escala_especial', rotulo: 'Escala especial', subtipo: 'escala_especial', titulo: '', hora: 7, ...OP },
  // ---- Acadêmico
  { grupo: 'Acadêmico', id: 'prova', rotulo: 'Prova', subtipo: 'prova', categoria: 'academico', prioridade: 'critico', titulo: 'Prova de ', hora: 8, lembretes: [2880, 1440, 120] },
  { grupo: 'Acadêmico', id: 'trabalho', rotulo: 'Trabalho', subtipo: 'trabalho', categoria: 'academico', prioridade: 'importante', titulo: 'Trabalho de ', diaTodo: true, lembretes: [2880, 1440] },
];

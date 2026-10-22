export const CATEGORIAS = {
    operacional: { rotulo: 'Operacional / Escala', icone: 'shield-checkmark' },
    academico: { rotulo: 'Acadêmico', icone: 'school' },
    administrativo: { rotulo: 'Administrativo', icone: 'document-text' },
    rotina: { rotulo: 'Missão de rotina', icone: 'brush' },
    pessoal: { rotulo: 'Pessoal', icone: 'person' },
};
export const SUBTIPOS = {
    respondente: { rotulo: 'Respondente', categoria: 'operacional', icone: 'shield' },
    cmt_guarda: { rotulo: 'Cmt. da Guarda', categoria: 'operacional', icone: 'shield' },
    sentinela_guarda: { rotulo: 'Sentinela da Guarda', categoria: 'operacional', icone: 'shield' },
    sentinela_posto2: { rotulo: 'Sentinela do Posto II', categoria: 'operacional', icone: 'shield' },
    dia_esfo: { rotulo: 'Dia-à-EsFO', categoria: 'operacional', icone: 'shield' },
    cmt_bloco3: { rotulo: 'Cmt. do Bloco III', categoria: 'operacional', icone: 'shield' },
    plantao_rondante: { rotulo: 'Plantão Rondante – Postos Externos', categoria: 'operacional', icone: 'walk' },
    plantao_bloco3: { rotulo: 'Plantão do Bloco III', categoria: 'operacional', icone: 'shield' },
    sobreaviso: { rotulo: 'Sobreaviso', categoria: 'operacional', icone: 'time' },
    estagio_cpu: { rotulo: 'Estágio CPU', categoria: 'operacional', icone: 'car' },
    escala_especial: { rotulo: 'Escala especial', categoria: 'operacional', icone: 'flag' },
    guarda: { rotulo: 'Serviço de guarda', categoria: 'operacional', icone: 'shield' },
    oficial_dia: { rotulo: 'Oficial de dia', categoria: 'operacional', icone: 'star' },
    escala_outro: { rotulo: 'Outra escala', categoria: 'operacional', icone: 'time' },
    prova: { rotulo: 'Prova', categoria: 'academico', icone: 'create' },
    trabalho: { rotulo: 'Trabalho', categoria: 'academico', icone: 'document-attach' },
    seminario: { rotulo: 'Seminário', categoria: 'academico', icone: 'people' },
    aula: { rotulo: 'Instrução / aula', categoria: 'academico', icone: 'book' },
    documento: { rotulo: 'Documento / requerimento', categoria: 'administrativo', icone: 'folder-open' },
    formatura: { rotulo: 'Formatura / apresentação', categoria: 'administrativo', icone: 'flag' },
    cafe_instrutores: { rotulo: 'Café dos Instrutores', categoria: 'rotina', icone: 'cafe' },
    copa: { rotulo: 'Copa', categoria: 'rotina', icone: 'brush' },
    viaturas_pm: { rotulo: 'Viaturas PM', categoria: 'rotina', icone: 'car' },
    salas_comando: { rotulo: 'Salas: Comando, Coordenação, Subcomando', categoria: 'rotina', icone: 'brush' },
    bloco_salas: { rotulo: 'Bloco de Salas de Aula', categoria: 'rotina', icone: 'brush' },
    lavanderia: { rotulo: 'Lavanderia', categoria: 'rotina', icone: 'brush' },
    museu_esfo: { rotulo: 'Museu EsFO', categoria: 'rotina', icone: 'brush' },
    manutencao_adm: { rotulo: 'Manutenção prédio ADM', categoria: 'rotina', icone: 'brush' },
    pessoal: { rotulo: 'Pessoal', categoria: 'pessoal', icone: 'person' },
};
export const PRIORIDADES = {
    critico: { rotulo: 'Crítico', peso: 3 },
    importante: { rotulo: 'Importante', peso: 2 },
    rotineiro: { rotulo: 'Rotineiro', peso: 1 },
};
export const subtiposDe = (c) => Object.keys(SUBTIPOS).filter((s) => SUBTIPOS[s].categoria === c);
/** Subtipos que contam como "dia de serviço" no calendário de escalas. */
export const SUBTIPOS_ESCALA = ['respondente', 'cmt_guarda', 'sentinela_guarda', 'sentinela_posto2', 'dia_esfo', 'cmt_bloco3', 'plantao_rondante', 'plantao_bloco3', 'sobreaviso', 'estagio_cpu', 'escala_especial', 'guarda', 'oficial_dia', 'escala_outro'];
/** Opções de antecedência oferecidas na tela de cadastro (minutos). */
export const OPCOES_LEMBRETE = [
    { min: 2880, rotulo: '2 dias' },
    { min: 1440, rotulo: '24 h' },
    { min: 120, rotulo: '2 h' },
    { min: 30, rotulo: '30 min' },
    { min: 10, rotulo: '10 min' },
];
/**
 * Regra de lembretes padrão.
 * - Operacional: 24h, 2h e 30min (pedido explícito para eventos de escala).
 * - Prova: 2 dias e 24h para revisar, mais 2h para chegar no horário.
 * - Trabalho/seminário: 2 dias e 24h antes do prazo.
 * - Crítico sempre ganha o aviso de 30min.
 */
export function lembretesPadrao(subtipo, prioridade) {
    const cat = SUBTIPOS[subtipo].categoria;
    let base;
    if (cat === 'operacional')
        base = [1440, 120, 30];
    else if (cat === 'rotina')
        base = [120, 30];
    else if (subtipo === 'prova')
        base = [2880, 1440, 120];
    else if (subtipo === 'trabalho' || subtipo === 'seminario')
        base = [2880, 1440];
    else if (prioridade === 'rotineiro')
        base = [60];
    else
        base = [1440, 60];
    if (prioridade === 'critico' && !base.includes(30))
        base.push(30);
    return [...new Set(base)].sort((a, b) => b - a);
}
export function rotuloAntecedencia(min) {
    if (min % 1440 === 0)
        return min === 1440 ? '24 h' : `${min / 1440} dias`;
    if (min % 60 === 0)
        return `${min / 60} h`;
    return `${min} min`;
}

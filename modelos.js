/**
 * Modelos pré-preenchidos (abas da adição) e regras de horário dos serviços.
 *
 * Para mudar um horário ou uma unidade, edite apenas este arquivo.
 */

/** Unidades do Estágio CPU, agrupadas por Comando Regional. */
export const UNIDADES_CPU = [
  { crpm: '1º CRPM', unidades: ['12º BPM', '13º BPM', '20º BPM', '23º BPM', '33º BPM'] },
  { crpm: '6º CRPM', unidades: ['17º BPM', '22º BPM', '29º BPM', '34º BPM'] },
];
export const crpmDa = (unidade) => UNIDADES_CPU.find((g) => g.unidades.includes(unidade))?.crpm || '';

const ehFimDeSemana = (d) => d.getDay() === 0 || d.getDay() === 6;
const em = (dia, h, diasDepois = 0) => new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + diasDepois, h, 0, 0, 0).getTime();

/**
 * Horário automático por tipo de serviço, para a data escolhida.
 *  - Sentinela da Guarda e do Posto II:
 *      dias de semana (seg–sex) 19h → 07h do dia seguinte;
 *      sábado e domingo        07h → 07h do dia seguinte.
 *  - Estágio CPU: 06h → 18h (fins de semana).
 * Retorna { inicio, fim, regra } ou null quando o tipo não tem regra.
 */
export function horarioPadrao(subtipo, dia) {
  if (subtipo === 'sentinela_guarda' || subtipo === 'sentinela_posto2') {
    return ehFimDeSemana(dia)
      ? { inicio: em(dia, 7), fim: em(dia, 7, 1), regra: 'Fim de semana: 07h às 07h' }
      : { inicio: em(dia, 19), fim: em(dia, 7, 1), regra: 'Dia de semana: 19h às 07h' };
  }
  if (subtipo === 'estagio_cpu') {
    return { inicio: em(dia, 6), fim: em(dia, 18), regra: ehFimDeSemana(dia) ? 'Estágio CPU: 06h às 18h' : 'Atenção: o estágio CPU costuma ser no fim de semana' };
  }
  return null;
}

/** Próximo sábado a partir de um dia (o próprio dia, se já for sábado ou domingo). */
export function proximoFimDeSemana(dia) {
  if (ehFimDeSemana(dia)) return dia;
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + (6 - dia.getDay()));
}

/** Abas exibidas ao tocar no botão dourado. */
export const MODELOS = [
  { id: 'sentinela_guarda', rotulo: 'Sentinela da Guarda', subtipo: 'sentinela_guarda', categoria: 'operacional', prioridade: 'critico',
    titulo: 'Sentinela da Guarda', local: 'Corpo da Guarda', escala: { funcao: 'Sentinela', posto: 'Guarda' }, lembretes: [1440, 120, 30] },
  { id: 'sentinela_posto2', rotulo: 'Sentinela do Posto II', subtipo: 'sentinela_posto2', categoria: 'operacional', prioridade: 'critico',
    titulo: 'Sentinela do Posto II', local: 'Posto II', escala: { funcao: 'Sentinela', posto: 'Posto II' }, lembretes: [1440, 120, 30] },
  { id: 'estagio_cpu', rotulo: 'Estágio CPU', subtipo: 'estagio_cpu', categoria: 'operacional', prioridade: 'critico',
    titulo: 'Estágio CPU', local: '', escala: { funcao: 'Estagiário' }, lembretes: [1440, 120, 30] },
  { id: 'prova', rotulo: 'Prova', subtipo: 'prova', categoria: 'academico', prioridade: 'critico',
    titulo: 'Prova de ', hora: 8, lembretes: [2880, 1440, 120] },
  { id: 'trabalho', rotulo: 'Trabalho', subtipo: 'trabalho', categoria: 'academico', prioridade: 'importante',
    titulo: 'Trabalho de ', diaTodo: true, lembretes: [2880, 1440] },
  { id: 'escala_especial', rotulo: 'Escala especial', subtipo: 'escala_especial', categoria: 'operacional', prioridade: 'critico',
    titulo: '', hora: 7, lembretes: [1440, 120, 30] },
];

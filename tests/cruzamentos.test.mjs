// Dados FICTÍCIOS.
import './ambiente.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { colegasNaEscala, livresParaTroca, casaColega, conflitos, resumoFaltas, discDaSigla, opcoesDisciplina, textoResumo } from '../cruzamentos.js';

const L = (data, subtipo, nome, grad = 'Cad. 1º PM') => ({ data, subtipo, nome, grad });
const docs = [{ tipo: 'interna', importadoEm: 1, linhas: [
  L('2026-10-27', 'sentinela_guarda', 'Ana Teste'), L('2026-10-28', 'sentinela_guarda', 'Bruno Teste'), L('2026-10-28', 'sentinela_guarda', 'Eu Mesmo'),
  L('2026-10-28', 'cmt_guarda', 'Carla Antiga', 'Cad. 3º PM'), L('2026-10-29', 'sobreaviso', 'Diego Teste'),
  L('2026-10-20', 'sentinela_guarda', 'Eva Livre'), L('2026-10-21', 'sentinela_guarda', 'Fabio Livre'), L('2026-10-22', 'sentinela_guarda', 'Fabio Livre'),
] }];
const cfg = { nomeCompleto: 'Eu Mesmo' };

test('quem está na escala com você', () => {
  const g = colegasNaEscala(docs, '2026-10-28', cfg);
  assert.deepEqual(g.map((x) => [x.rotulo, x.nomes.map((n) => n.nome + (n.eu ? '*' : ''))]), [['Sentinela da Guarda', ['Bruno Teste', 'Eu Mesmo*']], ['Cmt. da Guarda', ['Carla Antiga']]]);
  assert.equal(colegasNaEscala(docs, '2026-12-01', cfg), null);
});

test('livres para troca: mesma turma, sem serviço na véspera/dia/seguinte, menos escalados primeiro', () => {
  const l = livresParaTroca(docs, '2026-10-28', cfg);
  assert.deepEqual(l.map((x) => [x.nome, x.servicos]), [['Eva Livre', 1], ['Fabio Livre', 2]]);
  assert.ok(casaColega('Fabio Livre', { nomeGuerra: 'livre' }));
  assert.ok(!casaColega('Fabio Livre', { nomeGuerra: 'liv' }));
});

test('conflitos: sobreposição, prova depois de serviço e serviço em horário de aula', () => {
  const h = (d, hh) => new Date(2026, 9, d, hh).getTime();
  const itens = [
    { chave: 'a', titulo: 'Sentinela', subtipo: 'sentinela_guarda', inicio: h(28, 7), fim: h(29, 7), status: 'pendente' },
    { chave: 'b', titulo: 'MCE', subtipo: 'mce', inicio: h(28, 14), fim: h(28, 18), status: 'pendente' },
    { chave: 'c', titulo: 'Prova DPM', subtipo: 'prova', inicio: h(29, 8), fim: h(29, 10), status: 'pendente' },
  ];
  const qts = [{ dias: [{ data: '2026-10-28', aulas: [{ n: 1, ini: '07:30', fim: '08:20', sigla: 'APHP', local: '', instrutor: '' }] }] }];
  const c = conflitos(itens, qts, h(27, 12));
  const t = c.map((x) => x.texto);
  assert.ok(t.includes('Sentinela e MCE no mesmo horário'));
  assert.ok(t.some((x) => /Prova DPM 1 h depois de sair de Sentinela/.test(x)));
  assert.ok(t.some((x) => /Sentinela no horário de aula \(APHP 07:30\)/.test(x)));
});

test('faltas por disciplina com limite em % das H.A.', () => {
  const sem = [{ legenda: { DPM1: { nome: 'DIREITO PENAL MILITAR I', ha: { dadas: 36, total: 40 } }, IND: { ha: { dadas: 0, total: 0 } } } }];
  const r = resumoFaltas(sem, { '2026-10-29|6': 'DPM1', '2026-10-29|7': 'DPM1' }, 25);
  assert.deepEqual(r.DPM1, { faltas: 2, total: 40, permitidas: 10 });
});

test('provas ligadas à sigla do QTS e opções do campo disciplina', () => {
  assert.ok(discDaSigla('DPM1 – Direito Penal Militar I', 'DPM1', 'DIREITO PENAL MILITAR I'));
  assert.ok(discDaSigla('Direito Penal Militar I', 'DPM1', 'DIREITO PENAL MILITAR I'));
  assert.ok(!discDaSigla('DDM', 'DPM1', 'DIREITO PENAL MILITAR I'));
  assert.deepEqual(opcoesDisciplina([{ legenda: { DPM1: { nome: 'X' }, IND: { nome: 'INDISPONÍVEL' } } }]), ['DPM1 – X']);
});

test('texto do resumo da noite', () => {
  assert.equal(textoResumo({ rotuloDia: 'Amanhã' }), null);
  const r = textoResumo({ rotuloDia: 'Amanhã (qua 28/10)', itens: [{ titulo: 'Sentinela da Guarda', hora: '19:00', local: 'Corpo da Guarda' }], aulas: [{ ini: '07:30', sigla: 'APHP' }], revista: 'Revista 06:00', pendencias: ['Separou para Sentinela da Guarda? Falta: Colete.'] });
  assert.equal(r.titulo, 'Amanhã (qua 28/10): 1 compromisso, 1 aula');
  assert.match(r.corpo, /Aulas: APHP 07:30 · Sentinela da Guarda 19:00 – Corpo da Guarda · Revista 06:00 · Separou/);
});

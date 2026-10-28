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

test('fardamento: gandola seg/ter, combat shirt no resto; DAG branca qua–sex', async () => {
  const { fardamentoDoDia } = await import('../cruzamentos.js');
  const d = (dia) => new Date(2026, 9, dia, 12).getTime(); // 26/10 = segunda
  assert.deepEqual([26, 27, 28, 29, 30, 31, 25].map((x) => [fardamentoDoDia(d(x)).farda.includes('gandola') ? 'G' : 'C', fardamentoDoDia(d(x)).dag.includes('branca') ? 'B' : 'P']),
    [['G', 'P'], ['G', 'P'], ['C', 'B'], ['C', 'B'], ['C', 'B'], ['C', 'P'], ['C', 'P']]);
  const f = fardamentoDoDia(d(29), { itens: [{ titulo: 'Sentinela', subtipo: 'sentinela_guarda', inicio: d(29) + 7 * 3600000, escala: {} }], aulas: [{ sigla: 'EFM II', ini: '07:30' }], fardamentoPadrao: '4º A' });
  assert.deepEqual(f.extras.map((x) => x.texto), ['EFM às 07:30: levar o uniforme de educação física', 'Sentinela: 4º A']);
});

test('licença: saída sexta, retorno domingo, bloqueada por serviço ou LC', async () => {
  const { licencaDoFimDeSemana } = await import('../cruzamentos.js');
  const qua = new Date(2026, 9, 28, 10).getTime();
  const l = licencaDoFimDeSemana([], {}, qua);
  assert.deepEqual([new Date(l.saida).getDate(), new Date(l.saida).getHours(), new Date(l.retorno).getDate(), new Date(l.retorno).getHours(), l.livre], [30, 18, 1, 19, true]);
  const sab = new Date(2026, 9, 31, 7).getTime();
  const b = licencaDoFimDeSemana([{ titulo: 'MCE – Licença Cassada 3', subtipo: 'mce', inicio: sab + 12 * 3600000, fim: sab + 24 * 3600000 }, { titulo: 'Sentinela', subtipo: 'sentinela_guarda', inicio: sab, fim: sab + 24 * 3600000 }], {}, qua);
  assert.equal(b.livre, false);
  assert.equal(b.bloqueios.length, 2);
  // no domingo depois do retorno, já mostra o próximo fim de semana
  const seg = new Date(2026, 10, 1, 20).getTime();
  assert.equal(new Date(licencaDoFimDeSemana([], {}, seg).saida).getDate(), 6);
});

test('equilíbrio na turma pela escala completa', async () => {
  const { equilibrioTurma } = await import('../cruzamentos.js');
  const e = equilibrioTurma(docs, cfg, 2026, 9);
  assert.equal(e.meu, 1);
  assert.equal(e.n, 6);
  assert.equal(e.max, 2);
  assert.equal(equilibrioTurma(docs, cfg, 2026, 11), null);
});

test('licença: exceção num fim de semana (feriado) muda só aquele', async () => {
  const { licencaDoFimDeSemana } = await import('../cruzamentos.js');
  const qua = new Date(2026, 9, 28, 10).getTime();
  const cfgL = { excecoes: { '2026-10-30': { saida: '2026-10-30T18:00', retorno: '2026-11-02T07:00' } } };
  const l = licencaDoFimDeSemana([], cfgL, qua);
  assert.deepEqual([new Date(l.retorno).getDate(), new Date(l.retorno).getHours(), l.excecao], [2, 7, true]);
  // domingo à noite ainda está de licença (retorno só na segunda)
  assert.equal(new Date(licencaDoFimDeSemana([], cfgL, new Date(2026, 10, 1, 21).getTime()).retorno).getDate(), 2);
  // o fim de semana seguinte volta ao padrão
  const prox = licencaDoFimDeSemana([], cfgL, new Date(2026, 10, 3, 10).getTime());
  assert.deepEqual([new Date(prox.retorno).getDate(), prox.excecao], [8, false]);
});

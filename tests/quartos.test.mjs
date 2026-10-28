import test from 'node:test';
import assert from 'node:assert/strict';
import { lerQuartos, ehTextoQuartos, linhasQuartos, ehMeuNome, horariosDosQuartos, lembretesQuartos, dataProvavel, subtipoDoPosto } from '../quartos.js';

const TXT = `*GUARDA*
Como deixar:

Alfa 19:00 às 20:40 / 00:00 às 01:50
B. Bravo 20:40 às 22:20 / 01:50 às 03:40
Charlie 22:20 às 00:00 / 03:40 às 05:30

*POSTO II*

Delta 19:00 às 20:40 / 00:00 às 01:50
Echo 20h40 as 22h20 - 01h50 as 03h40`;

test('lê postos e quartos do texto do WhatsApp', () => {
  const l = lerQuartos(TXT);
  assert.equal(l.postos.length, 2);
  assert.equal(l.postos[0].posto, 'GUARDA');
  assert.equal(l.postos[0].subtipo, 'sentinela_guarda');
  assert.equal(l.postos[1].subtipo, 'sentinela_posto2');
  assert.deepEqual(l.postos[0].linhas[2], { nome: 'Charlie', faixas: [['22:20', '00:00'], ['03:40', '05:30']] });
  assert.equal(l.postos[0].linhas[1].nome, 'B. Bravo');
  assert.deepEqual(l.postos[1].linhas[1].faixas, [['20:40', '22:20'], ['01:50', '03:40']]);
  assert.ok(ehTextoQuartos(TXT));
  assert.ok(!ehTextoQuartos('Guarda amanhã 7h às 7h'));
});

test('data no texto e data provável', () => {
  assert.equal(lerQuartos('Guarda 30/10\nA 19:00 às 20:00\nB 20:00 às 21:00', new Date(2026, 9, 28)).data, '2026-10-30');
  assert.equal(dataProvavel({ data: '' }, new Date(2026, 9, 28, 20, 0).getTime()), '2026-10-28');
  assert.equal(dataProvavel({ data: '' }, new Date(2026, 9, 29, 2, 0).getTime()), '2026-10-28');
});

test('linhas planas e nome do cadete', () => {
  const ls = linhasQuartos(lerQuartos(TXT), '2026-10-28');
  const eu = ls.filter((x) => ehMeuNome(x.nome, { nomeGuerra: 'CHARLIE' }));
  assert.equal(eu.length, 1);
  assert.equal(eu[0].quartos, '22:20-00:00, 03:40-05:30');
  assert.equal(eu[0].secao, 'GUARDA');
  assert.ok(ehMeuNome('B. Bravo', { nomeGuerra: 'Bravo' }));
  assert.ok(!ehMeuNome('Delta', { nomeGuerra: 'Bravo' }));
  assert.equal(subtipoDoPosto('Rondante'), 'plantao_rondante');
});

test('quartos que passam da meia-noite e lembretes 15 min antes', () => {
  const ini = new Date(2026, 9, 28, 7, 0).getTime();
  const q = horariosDosQuartos('22:20-00:00, 03:40-05:30', '2026-10-28', ini);
  assert.equal(new Date(q[0].ini).getHours(), 22);
  assert.equal(new Date(q[0].fim).getDate(), 29);
  assert.equal(new Date(q[1].ini).getDate(), 29);
  assert.equal(new Date(q[1].ini).getHours(), 3);
  const it = { id: 'x', titulo: 'Sentinela', inicio: ini, status: 'pendente', escala: { posto: 'Guarda', quartos: '22:20-00:00, 03:40-05:30' } };
  const l = lembretesQuartos([it], ini, ini + 2 * 86400000);
  assert.equal(l.length, 2);
  assert.equal(new Date(l[0].dispara).getHours(), 22);
  assert.equal(new Date(l[0].dispara).getMinutes(), 5);
  assert.ok(l[0].critico);
});

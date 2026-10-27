// QTS FICTÍCIO (disciplinas e nomes inventados) com as posições do PDF real.
import './ambiente.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ehQts, lerQts, blocosDoDia, aulaAgora, guardarSemana, semanaDoDia } from '../qts.js';

const it = (p, s, x, y, w) => ({ p, s, x, y, w: w ?? s.length * 5 });
function qts() {
  const o = [it(1, 'Quadro de Trabalho Semanal', 89, 63), it(1, 'Sigla', 45, 483), it(1, 'Disciplina', 86, 483), it(1, 'Instrutor(es)', 300, 483), it(1, 'H.A.', 514, 483),
    it(1, 'TST', 45, 498), it(1, 'TESTE DE SISTEMAS', 86, 498), it(1, 'CAP FULANO TESTE', 300, 498), it(1, '5/20', 514, 499),
    it(1, 'EFX', 45, 514), it(1, 'EXERCÍCIO FÍSICO', 86, 514), it(1, 'TEN BELTRANO', 300, 514), it(1, 'Adj:', 300, 524), it(1, 'CICRANO AUXILIAR', 318, 524), it(1, '40/60', 514, 515),
    it(1, 'IND', 45, 540), it(1, 'INDISPONÍVEL', 86, 540), it(1, '580/0', 514, 541), it(1, '1 / 3', 519, 822)];
  const dia = (p, data, dow, aulas) => {
    o.push(it(p, 'Quadro de Trabalho Semanal', 89, 63), it(p, `1º CFO PM 2026 - 1º Pelotão - Semana 34 - DIA ${data} (${dow})`, 45, 90),
      it(p, 'Aula', 45, 105), it(p, 'Horario', 70, 105), it(p, 'Disciplina', 147, 105), it(p, 'Faltas', 198, 105), it(p, 'Ass. Instrutor', 249, 105), it(p, 'Ass. Instrutor-Adjunto', 402, 105));
    const hs = ['07:30 - 08:20', '08:20 - 09:10', '13:30 - 14:20', '14:20 - 15:10'];
    aulas.forEach(([sig, local, inst, adj], k) => {
      const y = 121 + k * 39;
      o.push(it(p, String(k + 1), 45, y), it(p, hs[k], 70, y), it(p, sig, 147, y));
      if (local) o.push(it(p, local, 147, y + 9));
      if (inst) o.push(it(p, inst, 249, y - 3));
      if (adj) o.push(it(p, adj, 402, y - 3));
    });
    o.push(it(p, 'Observacoes do Chefe de Turma:', 45, 300));
  };
  dia(2, '26/10/2026', 'Seg', [['TST', 'Sala 13', 'FULANO TESTE'], ['TST', 'Sala 13', 'FULANO TESTE'], ['* * *'], ['EFX', '', 'BELTRANO', 'CICRANO AUXILIAR']]);
  dia(3, '27/10/2026', 'Ter', [['IND'], ['IND'], ['IND'], ['IND']]);
  return o;
}

test('lê o QTS: legenda com H.A., aulas com local e adjunto', () => {
  const o = qts();
  assert.ok(ehQts(o));
  const q = lerQts(o);
  assert.equal(q.semana, 34);
  assert.equal(q.turma, '1º CFO PM 2026 - 1º Pelotão');
  assert.equal(q.id, 'qts-2026-10-26');
  assert.deepEqual(q.legenda.TST, { nome: 'TESTE DE SISTEMAS', instrutor: 'CAP FULANO TESTE', adjuntos: [], ha: { dadas: 5, total: 20 } });
  assert.deepEqual(q.legenda.EFX.adjuntos, ['CICRANO AUXILIAR']);
  const seg = q.dias[0];
  assert.deepEqual(seg.aulas.map((a) => [a.ini, a.sigla, a.local]), [['07:30', 'TST', 'Sala 13'], ['08:20', 'TST', 'Sala 13'], ['13:30', '', ''], ['14:20', 'EFX', '']]);
  assert.deepEqual(seg.aulas[3].adjuntos, ['CICRANO AUXILIAR']);
  const bl = blocosDoDia(seg.aulas);
  assert.deepEqual(bl.map((b) => [b.sigla, b.ini, b.fim, b.qtd]), [['TST', '07:30', '09:10', 2], ['', '13:30', '14:20', 1], ['EFX', '14:20', '15:10', 1]]);
});

test('aula agora e próxima (ignora indisponível e sem aula)', () => {
  const q = lerQts(qts());
  const { atual, proxima } = aulaAgora([q], new Date(2026, 9, 26, 8, 0).getTime());
  assert.equal(atual.sigla, 'TST');
  assert.equal(proxima.sigla, 'EFX');
  const tarde = aulaAgora([q], new Date(2026, 9, 26, 15, 30).getTime());
  assert.equal(tarde.atual, null);
  assert.equal(tarde.proxima, null);
});

test('guarda as semanas sem duplicar e acha a semana do dia', () => {
  const q = lerQts(qts());
  let l = guardarSemana([], q);
  l = guardarSemana(l, q);
  assert.equal(l.length, 1);
  assert.equal(semanaDoDia(l, '2026-10-27').id, q.id);
  assert.equal(semanaDoDia(l, '2026-12-01').id, q.id, 'a mais próxima');
});

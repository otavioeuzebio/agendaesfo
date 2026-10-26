import './ambiente.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mesclarEstados } from '../store.js';

const est = (missoes, extra = {}) => ({ versao: 1, config: { nome: '', tema: 'auto', atualizadoEm: 0 }, missoes, ciclos: [], avisados: {}, removidos: {}, ...extra });
const agora = Date.now();

test('a versão mais recente de cada missão vence', () => {
  const a = est([{ id: 'x', titulo: 'velho', atualizadoEm: agora - 10 }, { id: 'so-a', atualizadoEm: agora }]);
  const b = est([{ id: 'x', titulo: 'novo', atualizadoEm: agora }, { id: 'so-b', atualizadoEm: agora }]);
  const r = mesclarEstados(a, b);
  assert.equal(r.missoes.find((m) => m.id === 'x').titulo, 'novo');
  assert.deepEqual(r.missoes.map((m) => m.id).sort(), ['so-a', 'so-b', 'x']);
});

test('apagar em um aparelho apaga no outro (mas edição posterior ressuscita)', () => {
  const a = est([], { removidos: { x: agora } });
  const b = est([{ id: 'x', atualizadoEm: agora - 5 }, { id: 'y', atualizadoEm: agora + 5 }], { removidos: { y: agora } });
  const r = mesclarEstados(a, b);
  assert.deepEqual(r.missoes.map((m) => m.id), ['y']);
  assert.ok(r.removidos.x && r.removidos.y);
});

test('ciclos apagados e configurações', () => {
  const a = est([], { ciclos: [{ id: 'c1', atualizadoEm: agora - 100 }], config: { nome: 'A', tema: 'escuro', atualizadoEm: agora - 50 } });
  const b = est([], { removidos: { 'ciclo:c1': agora }, config: { nome: 'B', tema: 'claro', atualizadoEm: agora } });
  const r = mesclarEstados(a, b);
  assert.equal(r.ciclos.length, 0);
  assert.equal(r.config.nome, 'B');
  assert.equal(r.config.tema, 'escuro', 'tema é de cada aparelho');
});

test('avisos já exibidos são unidos', () => {
  const r = mesclarEstados(est([], { avisados: { a: 1, b: 5 } }), est([], { avisados: { b: 9, c: 2 } }));
  assert.deepEqual(r.avisados, { a: 1, b: 9, c: 2 });
});

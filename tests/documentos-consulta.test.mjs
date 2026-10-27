import './ambiente.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardarDoc, listarDocs, apagarDoc, ehMeu, filtrar, agrupar, datasDoDoc } from '../documentos.js';

const linhas = [
  { data: '2026-10-28', subtipo: 'sentinela_guarda', nome: 'Ana Teste Primeira' },
  { data: '2026-10-28', subtipo: 'sentinela_guarda', nome: 'Bruno Teste Segundo' },
  { data: '2026-10-29', subtipo: 'respondente', nome: 'Carla Teste Terceira' },
];

test('guarda, substitui e apaga documentos no aparelho', () => {
  const id = guardarDoc('u1', { tipo: 'interna', titulo: 'Serviço Interno', linhas });
  guardarDoc('u1', { tipo: 'interna', titulo: 'Serviço Interno (de novo)', linhas });
  assert.equal(listarDocs('u1').length, 1);
  assert.equal(listarDocs('u1')[0].titulo, 'Serviço Interno (de novo)');
  assert.equal(listarDocs('u2').length, 0, 'cada conta tem os seus');
  apagarDoc('u1', id);
  assert.equal(listarDocs('u1').length, 0);
});

test('busca, agrupamento, meu nome e dia de abertura', () => {
  assert.deepEqual(filtrar(linhas, 'segundo').map((l) => l.nome), ['Bruno Teste Segundo']);
  assert.deepEqual(agrupar(linhas, (l) => l.data).map((g) => [g.chave, g.itens.length]), [['2026-10-28', 2], ['2026-10-29', 1]]);
  assert.ok(ehMeu('BRUNO teste segundo', { nomeCompleto: 'Bruno Teste Segundo' }));
  assert.ok(!ehMeu('Bruno', { nomeCompleto: 'Bruno Teste Segundo' }));
  assert.equal(datasDoDoc({ linhas }, '2026-10-29').abrir, '2026-10-29');
  assert.equal(datasDoDoc({ linhas }, '2026-10-01').abrir, '2026-10-28');
  assert.equal(datasDoDoc({ linhas }, '2026-12-01').abrir, '2026-10-29');
});

test('nunca guarda CPF, mesmo colado ao nome', () => {
  guardarDoc('u3', { tipo: 'representacao', titulo: 'R', linhas: [{ data: '2026-10-30', nome: 'Fulano Teste 000.111.222-33', detalhe: 'Titular' }] });
  const txt = JSON.stringify(listarDocs('u3'));
  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(txt));
  assert.equal(listarDocs('u3')[0].linhas[0].nome, 'Fulano Teste');
});

test('junta escalas de dois aparelhos: mais nova vence e apagada some', async () => {
  const { mesclarDocs } = await import('../documentos.js');
  const a = [{ id: 'x', importadoEm: 10, titulo: 'velha' }, { id: 'y', importadoEm: 5 }];
  const b = [{ id: 'x', importadoEm: 20, titulo: 'nova' }, { id: 'z', importadoEm: 7 }];
  const r = mesclarDocs(a, b, {}, { y: Date.now() });
  assert.deepEqual(r.docs.map((d) => d.id).sort(), ['x', 'z']);
  assert.equal(r.docs.find((d) => d.id === 'x').titulo, 'nova');
  assert.ok(r.removidos.y);
});

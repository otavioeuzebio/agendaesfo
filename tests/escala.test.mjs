// Escalas FICTÍCIAS (nomes inventados) montadas com as mesmas posições dos PDFs reais.
import './ambiente.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lerEscalaInterna, lerEscalaRotina, detectarTipo, filtrarPorNomeCompleto, filtrarPorNomeGuerra } from '../escalaPdf.js';

const it = (s, x, y, p = 1) => ({ p, s, x, y, w: s.length * 5 });

function interna() {
  const out = [it('PREVISÃO DE ESCALA DE SERVIÇO INTERNO', 150, 20), it('Data:', 40, 50), it('3 out. 26 (sábado)', 70, 50),
    it('FUNÇÃO', 40, 70), it('GRAD', 200, 70), it('NOME COMPLETO', 260, 70)];
  const linhas = [
    ['Respondente', ['Ana Teste Primeira']],
    ['Sentinelas da Guarda', ['Bruno Teste Segundo', 'Carlos Teste Terceiro', 'Diego Teste Quarto']],
    ['Sobreaviso', ['Eva Teste Quinta']],
  ];
  let y = 85;
  for (const [rot, nomes] of linhas) {
    const y0 = y;
    for (const n of nomes) { out.push(it('Cad.', 200, y), it(n, 260, y)); y += 12; }
    out.push(it(rot, 40, (y0 + y - 12) / 2));
  }
  return out;
}

function rotina() {
  const dias = ['DOM. 25/10', 'SEG. 26/10', 'TER. 27/10'];
  const out = [it('ESCALA DA ROTINA', 200, 20), it('SEÇÕES', 30, 60), ...dias.map((d, i) => it(d, 160 + i * 100, 60))];
  const sec = [['Copa', [['GAMA', 'DELTA', 'OMEGA']]], ['Viaturas PM', [['ALFA', 'BETA', 'XXX'], ['SIGMA', 'TAU', 'RHO']]]];
  let y = 80;
  for (const [rot, filas] of sec) {
    const y0 = y;
    for (const fila of filas) { fila.forEach((n, i) => out.push(it(n, 160 + i * 100, y))); y += 14; }
    out.push(it(rot, 30, (y0 + y - 14) / 2));
  }
  out.push(it('Orientações', 30, y + 20));
  return out;
}

test('detecta o tipo da escala', () => {
  assert.equal(detectarTipo(interna()), 'interna');
  assert.equal(detectarTipo(rotina()), 'rotina');
});

test('escala interna: funções em células mescladas e sobreaviso', () => {
  const l = lerEscalaInterna(interna());
  assert.equal(l.length, 5);
  assert.ok(l.every((x) => x.data === '2026-10-03'));
  assert.deepEqual(l.filter((x) => x.subtipo === 'sentinela_guarda').map((x) => x.nome), ['Bruno Teste Segundo', 'Carlos Teste Terceiro', 'Diego Teste Quarto']);
  const [meu] = filtrarPorNomeCompleto(l, 'carlos teste TERCEIRO');
  assert.equal(meu.subtipo, 'sentinela_guarda');
  assert.equal(l.find((x) => x.subtipo === 'sobreaviso').detalhe, 'Guarda');
});

test('escala da rotina: colunas por dia e seções com várias linhas', () => {
  const c = lerEscalaRotina(rotina(), new Date(2026, 9, 26));
  assert.equal(c.length, 8); // XXX não conta
  assert.deepEqual(filtrarPorNomeGuerra(c, 'tau').map((x) => [x.data, x.subtipo]), [['2026-10-26', 'viaturas_pm']]);
  assert.deepEqual(filtrarPorNomeGuerra(c, 'Omega').map((x) => [x.data, x.subtipo]), [['2026-10-27', 'copa']]);
});

test('escala interna: data errada, cabeçalho repetido, quebra de página e rótulo faltando', () => {
  const its = [it('PREVISÃO DE ESCALA DE SERVIÇO INTERNO', 150, 20),
    // mês digitado errado ("set." numa sexta de outubro)
    it('Data:', 40, 50), it('16 set. 26 (sexta-feira)', 70, 50),
    it('FUNÇÃO', 40, 70), it('GRAD', 200, 70), it('NOME COMPLETO', 260, 70),
    it('Cad.', 200, 85), it('Rui Primeiro', 260, 85), it('Respondente', 40, 85),
    it('Cad.', 200, 97), it('Rui Segundo', 260, 97), it('Sobreaviso', 40, 97),
    // dia 17: a função "Sentinelas da Guarda" é cortada pela quebra de página
    it('Data:', 40, 700), it('17 out. 26 (sábado)', 70, 700),
    it('FUNÇÃO', 40, 720), it('GRAD', 200, 720), it('NOME COMPLETO', 260, 720),
    it('Cad.', 200, 735), it('Sol Um', 260, 735), it('Cmt. da Guarda', 40, 735),
    it('Cad.', 200, 747), it('Sol Dois', 260, 747), it('Cad.', 200, 759), it('Sol Tres', 260, 759), it('Sentinelas da Guarda', 40, 753),
    // página 2: topo repete uma data antiga
    it('Data:', 40, 30, 2), it('16 out. 26 (sexta-feira)', 70, 30, 2),
    it('Cad.', 200, 50, 2), it('Sol Quatro', 260, 50, 2),
    it('Cad.', 200, 62, 2), it('Sol Cinco', 260, 62, 2), it('Cad.', 200, 74, 2), it('Sol Seis', 260, 74, 2), it('Sentinelas do Posto II', 40, 68, 2),
    it('Cad.', 200, 86, 2), it('Sol Sete', 260, 86, 2), it('Sobreaviso', 40, 86, 2),
    // "Dia-à-EsFO" e "Cmt. do Bloco III" e o rótulo da função seguinte faltando entre dois sobreavisos
    it('FUNÇÃO', 40, 120, 2), it('GRAD', 200, 120, 2), it('NOME COMPLETO', 260, 120, 2),
    it('Cad.', 200, 135, 2), it('Lu Um', 260, 135, 2), it('Plantões Rondantes', 40, 135, 2),
    it('Cad.', 200, 147, 2), it('Lu Dois', 260, 147, 2), it('Sobreaviso', 40, 147, 2),
    it('Cad.', 200, 159, 2), it('Lu Tres', 260, 159, 2), it('Cad.', 200, 171, 2), it('Lu Quatro', 260, 171, 2), it('Cad.', 200, 183, 2), it('Lu Cinco', 260, 183, 2),
    it('Cad.', 200, 195, 2), it('Lu Seis', 260, 195, 2), it('Sobreaviso', 40, 195, 2),
  ];
  const l = lerEscalaInterna(its);
  const de = (nome) => l.find((x) => x.nome === nome);
  assert.equal(de('Rui Primeiro').data, '2026-10-16', 'mês corrigido pelo dia da semana');
  assert.equal(de('Sol Quatro').data, '2026-10-17', 'cabeçalho antigo no topo da página é ignorado');
  assert.equal(de('Sol Quatro').subtipo, 'sentinela_guarda', 'linha cortada pela página continua a função anterior');
  assert.equal(de('Sol Cinco').subtipo, 'sentinela_posto2');
  assert.equal(de('Sol Sete').detalhe, 'Guarda');
  assert.deepEqual(['Lu Tres', 'Lu Quatro', 'Lu Cinco'].map((n) => de(n).subtipo), ['plantao_bloco3', 'plantao_bloco3', 'plantao_bloco3'], 'rótulo faltando é deduzido');
  assert.equal(de('Lu Seis').detalhe, 'Plantões do Bloco III');
});

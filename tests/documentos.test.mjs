// Documentos FICTÍCIOS (nomes inventados) com as mesmas posições dos PDFs reais da EsFO.
import './ambiente.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectarTipoExtra, lerDocumento, minhasLinhas, missoesDoDocumento, registrosDisciplina, codigosMce, sextaDasMce, casaNome } from '../escalasExtras.js';

const it = (s, x, y, p = 1, w) => ({ p, s, x, y, w: w ?? s.length * 5 });
const hora = (ms) => { const d = new Date(ms); return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

function desfile() {
  return [it('ESCALA DE DESFILE', 238, 151), it('25 out. 26 a 31 out. 26', 238, 165),
    it('BANDEIRA DO BRASIL', 59, 191), it('Aluno Oficial', 219, 191), it('Ana Teste Primeira', 343, 192),
    it('G3', 117, 293), it('Cad. 1º PM', 222, 293), it('Bruno', 355, 294), it('Teste Segundo', 390, 294),
    it('São José dos Pinhais, 21 de outubro de 2026.', 313, 438)];
}

function representacao() {
  const out = [it('ESCALA DE REPRESENTACÃO', 200, 140),
    it('a) Evento: Escala de Representação – Associação Fictícia;', 60, 170), it('b) Data: 30 out. 26 – (sexta-feira);', 60, 185),
    it('c) Horário: 17h00min ao término;', 60, 200), it('d) Locais: Rua Inventada, 100 – Curitiba;', 60, 215),
    it('e) Fardamento: 6º RUPM “A1/A2”.', 60, 230), it('f) Efetivo: 2 Cadetes.', 60, 245), it('g) Observação: Contato com o mais antigo.', 60, 260),
    it('GRAD', 140, 300), it('NOME COMPLETO', 266, 300), it('CPF', 471, 300)];
  const linhas = [['1', 'Cad. 3º PM', 'Carla Teste Antiga'], ['2', 'Cad. 1º PM', 'Diego Teste Quebrado']];
  let y = 320;
  for (const [n, g, nome] of linhas) { out.push(it(n, 96, y), it(g, 128, y), it(nome, 240, y), it('000.000.000-00', 444, y)); y += 25; }
  out.push(it('Nomelongo', 280, y - 10));
  out.push(it('SOBREAVISO', 250, 400, 2), it('1', 96, 420, 2), it('Cad. 1º PM', 128, 420, 2), it('Eva Teste Reserva', 240, 420, 2), it('111.111.111-11', 444, 420, 2));
  return out;
}

function anotados() {
  const out = [it('Planilha de Anotados n° 39/2026', 200, 100),
    it('1. Ciência até as 09h30min de segunda-feira (26/10/2026), no eProtocolo;', 36, 130),
    it('2. Defesa até as 09h30min de quarta-feira (28/10/2026);', 36, 145),
    it('3. O cumprimento das Medidas Corretivas Escolares (MCE) ocorrerá entre sexta-feira (30/10/2026) e domingo (01/11/2026), podendo mudar.', 36, 160),
    it('Fato Observado Positivo (FO+)', 219, 200),
    it('N°', 38, 220, 1, 11), it('Data', 75, 220, 1, 22), it('Anotador', 134, 220, 1, 44), it('Pel.', 218, 220, 1, 18), it('Cadete', 278, 220, 1, 33), it('Descrição', 420, 220, 1, 48),
    // linha com descrição em 3 linhas, centralizada na data
    it('1', 41, 250, 1, 6), it('17/10/26', 66, 250, 1, 39), it('CAD. FULANO', 130, 250, 1, 50), it('1º PM A', 208, 250, 1, 37), it('TESTEIRO', 270, 250, 1, 45),
    it('(FO+) Proatividade', 339, 238, 1, 120), it('exemplar na', 339, 250, 1, 80), it('missão.', 339, 262, 1, 40),
    it('1° CFO/1', 274, 300),
    it('N°', 38, 320, 1, 11), it('Data', 75, 320, 1, 22), it('Anotador', 134, 320, 1, 44), it('Pel.', 218, 320, 1, 18), it('Cadete', 278, 320, 1, 33), it('Alteração Administrativa Disciplinar', 360, 320, 1, 189),
    it('1', 41, 340, 1, 6), it('19/10/26', 66, 340, 1, 39), it('CAP. BELTRANO', 128, 340, 1, 60), it('1º PM A', 208, 340, 1, 37), it('TESTEIRO', 270, 340, 1, 45), it('Vidro sujo.', 420, 340, 1, 50),
    it('2', 41, 360, 1, 6), it('19/10/26', 66, 360, 1, 39), it('CAP. BELTRANO', 128, 360, 1, 60), it('1º PM B', 208, 360, 1, 37), it('OUTRO', 275, 360, 1, 30), it('Chão sujo.', 420, 360, 1, 50),
    it('São José dos Pinhais, datado eletronicamente.', 300, 420)];
  return out;
}

function namce() {
  const out = [it('Nota de Aplicação de Medida Corretiva Escolar n° 26/2026', 150, 100), it('1° CFO/1', 274, 200),
    it('N°', 41, 220, 1, 12), it('Data', 83, 220, 1, 24), it('Cadete', 146, 220, 1, 37), it('Alteração Administrativa Disciplinar', 238, 220, 1, 189), it('MCE', 500, 220, 1, 24),
    it('1', 42, 245, 1, 6), it('08/07/26', 75, 245, 1, 39), it('TESTEIRO', 142, 245, 1, 44), it('Avançar ao rancho antes das 12h', 235, 239, 1, 196), it('sem liberação.', 284, 251, 1, 98), it('Eesp2 + Eesp3', 475, 240, 1, 75),
    it('2', 42, 270, 1, 6), it('09/07/26', 75, 270, 1, 39), it('TESTEIRO', 142, 270, 1, 44), it('Toalha manchada.', 260, 270, 1, 120), it('ANULADA', 490, 270, 1, 45),
    it('3', 42, 295, 1, 6), it('10/07/26', 75, 295, 1, 39), it('TESTEIRO', 142, 295, 1, 44), it('Armário sujo.', 270, 295, 1, 90), it('LC1', 505, 295, 1, 20),
    it('TABELA DE MEDIDAS CORRETIVAS ESCOLARES (MCEs)', 150, 100, 2)];
  return out;
}

test('detecta os novos documentos', () => {
  assert.equal(detectarTipoExtra(desfile()), 'desfile');
  assert.equal(detectarTipoExtra(representacao()), 'representacao');
  assert.equal(detectarTipoExtra(anotados()), 'anotados');
  assert.equal(detectarTipoExtra(namce()), 'namce');
  assert.equal(detectarTipoExtra([it('ESCALA DE SUPLÊNCIA BATALHÃO EsFO', 200, 100), it('25 de out. de 2026 a 31 de out. de 2026', 200, 115)]), 'suplencia');
  assert.equal(detectarTipoExtra([it('PREVISÃO DE ESCALA DE SERVIÇO INTERNO', 150, 20)]), null);
});

test('nome: completo, parte do completo ou nome de guerra', () => {
  const cfg = { nomeCompleto: 'Bruno Teste Segundo da Silva', nomeGuerra: 'Segundo' };
  assert.ok(casaNome('Bruno Teste Segundo', cfg));
  assert.ok(casaNome('SEGUNDO', cfg));
  assert.ok(!casaNome('Bruno da Silva', { nomeCompleto: 'Carlos da Silva' }));
  assert.ok(!casaNome('Bruno Teste Segundo', cfg, { soGuerra: true }));
});

test('desfile: função da semana', () => {
  const d = lerDocumento('desfile', desfile());
  assert.deepEqual(d.periodo, { ini: '2026-10-25', fim: '2026-10-31' });
  assert.equal(d.linhas.length, 2);
  const m = missoesDoDocumento(d, minhasLinhas(d, { nomeCompleto: 'Bruno Teste Segundo' }));
  assert.equal(m.length, 1);
  assert.equal(m[0].titulo, 'Desfile – G3');
  assert.ok(m[0].diaTodo && m[0].fim > m[0].inicio);
  assert.equal(typeof m[0].checklist[0].t, 'string');
});

test('representação: dados do evento, nome quebrado, sobreaviso e sem CPF', () => {
  const d = lerDocumento('representacao', representacao());
  assert.equal(d.evento, 'Associação Fictícia');
  assert.deepEqual(d.linhas.map((l) => [l.detalhe, l.nome]), [['Titular', 'Carla Teste Antiga'], ['Titular', 'Diego Teste Quebrado Nomelongo'], ['Sobreaviso', 'Eva Teste Reserva']]);
  assert.ok(!JSON.stringify(d).includes('000.000.000-00'));
  const [m] = missoesDoDocumento(d, minhasLinhas(d, { nomeCompleto: 'Diego Teste Quebrado Nomelongo' }));
  assert.equal(hora(m.inicio), '30/10 17:00');
  assert.equal(m.prioridade, 'critico');
  assert.match(m.checklist[0].t, /Carla Teste Antiga/);
  const [s] = missoesDoDocumento(d, minhasLinhas(d, { nomeCompleto: 'Eva Teste Reserva' }));
  assert.match(s.titulo, /^Sobreaviso/);
});

test('suplência: função escolhida e prazo de sábado 19h', () => {
  const d = lerDocumento('suplencia', [it('ESCALA DE SUPLÊNCIA BATALHÃO EsFO', 200, 100), it('25 de out. de 2026 a 31 de out. de 2026', 200, 115),
    it('O Cadete auxiliar deverá procurar o', 200, 700), it('responsável da função até a sábado às 19h00.', 200, 712)]);
  assert.ok(d.semTexto);
  const m = missoesDoDocumento(d, [], { funcao: 'P/3' });
  assert.deepEqual(m.map((x) => [x.titulo, hora(x.inicio)]), [['Procurar o titular – P/3', '24/10 19:00'], ['Suplente – P/3', '25/10 0:00']]);
  assert.equal(missoesDoDocumento(d, [], {}).length, 0);
});

test('planilha de anotados: FO+ e AAD, prazos e possível MCE', () => {
  const d = lerDocumento('anotados', anotados());
  assert.equal(d.numero, '39/2026');
  assert.deepEqual(d.mce, { ini: '2026-10-30', fim: '2026-11-01' });
  assert.equal(hora(d.ciencia), '26/10 9:30');
  assert.equal(d.linhas.length, 3);
  const meu = minhasLinhas(d, { nomeGuerra: 'Testeiro' });
  assert.deepEqual(meu.map((l) => [l.tipoAnot, l.texto]), [['FO+', '(FO+) Proatividade exemplar na missão.'], ['AAD', 'Vidro sujo.']]);
  assert.equal(meu[1].anotador, 'CAP. BELTRANO');
  const m = missoesDoDocumento(d, meu);
  assert.deepEqual(m.map((x) => x.titulo), ['Tomar ciência – Planilha 39/2026', 'Prazo de defesa – Planilha 39/2026', 'Possível MCE – Planilha 39/2026']);
  const r = registrosDisciplina(d, meu);
  assert.equal(r[0].texto, 'Proatividade exemplar na missão.');
  // só FO+: só a ciência
  assert.equal(missoesDoDocumento(d, meu.slice(0, 1)).length, 1);
});

test('NAMCE: códigos viram horários do fim de semana; anulada não', () => {
  assert.deepEqual(codigosMce('Eesp1 + Eesp2 +  Eesp3'), { codigos: ['EEsp 1', 'EEsp 2', 'EEsp 3'], situacao: '' });
  assert.equal(codigosMce('TRANSFERIDA').situacao, 'transferida');
  assert.equal(sextaDasMce(new Date(2026, 9, 27)), '2026-10-30');
  assert.equal(sextaDasMce(new Date(2026, 10, 1)), '2026-10-30');
  const d = lerDocumento('namce', namce());
  const meu = minhasLinhas(d, { nomeGuerra: 'TESTEIRO' });
  assert.equal(meu.length, 3);
  const m = missoesDoDocumento(d, meu, { sexta: '2026-10-30' });
  assert.deepEqual(m.map((x) => [x.titulo, hora(x.inicio), hora(x.fim)]), [
    ['MCE – Escala Especial 2', '30/10 18:00', '30/10 22:00'],
    ['MCE – Licença Cassada 1', '30/10 19:00', '31/10 7:00'],
    ['MCE – Escala Especial 3', '31/10 7:15', '31/10 11:15']]);
  assert.deepEqual(registrosDisciplina(d, meu).map((r) => r.mce), ['EEsp 2 + EEsp 3', 'anulada', 'LC 1']);
});

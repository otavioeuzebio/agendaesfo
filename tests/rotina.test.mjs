import './ambiente.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { configRevista, revistaDoDia, situacaoAlimento, alimentosEmAlerta, lembretesExtras, relatoriosACriar, REVISTA_PADRAO } from '../rotina.js';

const qua = new Date(2026, 9, 28, 5, 0).getTime(); // quarta-feira
const H = 3600000;

test('revista: padrão seg–sex 06h; estado do dia', () => {
  const r = configRevista({});
  assert.deepEqual([r.ativo, r.hora, r.dias], [true, '06:00', [1, 2, 3, 4, 5]]);
  assert.equal(r.itens.length, REVISTA_PADRAO.length);
  const cfg = { revistaHoje: { data: '2026-10-28', ok: [0, 2], feita: false } };
  assert.deepEqual(revistaDoDia(cfg, qua).ok, [0, 2]);
  assert.deepEqual(revistaDoDia(cfg, qua + 24 * H).ok, [], 'zera no dia seguinte');
});

test('lembretes: revista no horário, só nos dias marcados e não depois de pronta', () => {
  const l = lembretesExtras({}, qua, qua + 4 * 24 * H).filter((x) => x.chave === 'revista');
  assert.deepEqual(l.map((x) => new Date(x.dispara).getDate()), [28, 29, 30], 'qua, qui, sex (sáb fora)');
  assert.equal(new Date(l[0].dispara).getHours(), 6);
  const pronta = lembretesExtras({ revistaHoje: { data: '2026-10-28', feita: true } }, qua, qua + 3 * H);
  assert.equal(pronta.filter((x) => x.chave === 'revista').length, 0);
  assert.equal(lembretesExtras({ revista: { ativo: false } }, qua, qua + 4 * 24 * H).filter((x) => x.chave === 'revista').length, 0);
});

test('geladeira: véspera, dia e quinta da Copa', () => {
  const cfg = { revista: { ativo: false }, geladeira: [{ id: 'a', item: 'Iogurte', validade: '2026-10-30' }] };
  const l = lembretesExtras(cfg, qua, qua + 4 * 24 * H);
  assert.deepEqual(l.map((x) => [x.titulo, new Date(x.dispara).getDate(), new Date(x.dispara).getHours()]), [
    ['Quinta: conferência da geladeira', 29, 18], ['Vence amanhã: Iogurte', 29, 8], ['Vence hoje: Iogurte', 30, 7]].sort((a, b) => a[1] - b[1] || a[2] - b[2]));
  assert.equal(situacaoAlimento('2026-10-27', qua).estado, 'vencido');
  assert.equal(situacaoAlimento('2026-10-29', qua).estado, 'amanha');
  assert.deepEqual(alimentosEmAlerta({ geladeira: [{ item: 'x', validade: '2026-11-20' }, { item: 'y', validade: '2026-10-28' }] }, qua).map((a) => a.item), ['y']);
});

test('relatório do estágio: criado uma vez, com prazo após o fim', () => {
  const est = { id: 'e1', subtipo: 'estagio_cpu', status: 'pendente', inicio: qua + 24 * H, fim: qua + 36 * H, local: '13º BPM' };
  const [r] = relatoriosACriar([est], {}, qua);
  assert.equal(r.id, 'rel-e1');
  assert.equal(r.inicio, est.fim + 48 * H);
  assert.match(r.titulo, /13º BPM/);
  assert.equal(r.checklist.length, 3);
  assert.equal(relatoriosACriar([est, r], {}, qua).length, 0, 'já existe');
  assert.equal(relatoriosACriar([est], { relatoriosCriados: ['e1'] }, qua).length, 0, 'apagado não volta');
  assert.equal(relatoriosACriar([est], { prazoRelatorioHoras: 0 }, qua).length, 0, 'desligado');
  assert.equal(relatoriosACriar([{ ...est, status: 'pulado' }], {}, qua).length, 0, 'trocado');
});

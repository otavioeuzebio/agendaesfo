import './ambiente.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { horarioPadrao } from '../modelos.js';
import { linhasParaMissoes, relatorioHoras, mediasAcademicas, checklistPadrao, idEscala } from '../extras.js';

const H = 3600000;
const qua = new Date(2026, 9, 28); // quarta
const sab = new Date(2026, 9, 31); // sábado

test('serviço interno: 19h→07h em dia de semana e 07h→07h no fim de semana', () => {
  const s = horarioPadrao('sentinela_guarda', qua);
  assert.equal(new Date(s.inicio).getHours(), 19);
  assert.equal((s.fim - s.inicio) / H, 12);
  const f = horarioPadrao('sentinela_posto2', sab);
  assert.equal(new Date(f.inicio).getHours(), 7);
  assert.equal((f.fim - f.inicio) / H, 24);
});

test('estágio CPU 06h→18h e rotinas', () => {
  const c = horarioPadrao('estagio_cpu', sab);
  assert.deepEqual([new Date(c.inicio).getHours(), new Date(c.fim).getHours()], [6, 18]);
  const l = horarioPadrao('lavanderia', qua);
  assert.equal(l.diaTodo, true);
  assert.equal(new Date(l.inicio).getDate(), 29, 'lavanderia é no dia seguinte');
  assert.equal(new Date(horarioPadrao('cafe_instrutores', qua).inicio).getMinutes(), 45);
});

test('escala → missões: ids fixos, sem duplicar, com checklist', () => {
  const linhas = [
    { data: '2026-10-28', subtipo: 'sentinela_guarda', funcao: 'Sentinelas da Guarda', detalhe: '', nome: 'Fulano' },
    { data: '2026-10-28', subtipo: 'sentinela_guarda', funcao: 'Sentinelas da Guarda', detalhe: '', nome: 'Fulano' },
    { data: '2026-10-31', subtipo: 'sobreaviso', detalhe: 'Guarda', nome: 'Fulano' },
  ];
  const ms = linhasParaMissoes(linhas);
  assert.equal(ms.length, 2);
  assert.equal(ms[0].id, 'esc-2026-10-28-sentinela_guarda');
  assert.equal(ms[1].titulo, 'Sobreaviso – Guarda');
  assert.equal(ms[1].id, idEscala(linhas[2]));
  assert.ok(ms[0].checklist.length > 0 && ms[0].checklist.every((c) => c.ok === false));
});

test('relatório de horas: ignora trocados e futuros; sobreaviso à parte', () => {
  const agora = new Date(2026, 10, 10).getTime();
  const base = (subtipo, dia, h, extra = {}) => { const i = new Date(2026, 9, dia, 19).getTime(); return { subtipo, inicio: i, fim: i + h * H, status: 'pendente', ...extra }; };
  const r = relatorioHoras([
    base('sentinela_guarda', 1, 12), base('sentinela_guarda', 2, 24),
    base('sentinela_posto2', 3, 12, { status: 'pulado' }),
    base('sobreaviso', 4, 24),
    { subtipo: 'estagio_cpu', inicio: new Date(2026, 10, 20, 6).getTime(), fim: new Date(2026, 10, 20, 18).getTime(), status: 'pendente' },
    base('copa', 5, 0, { fim: null }),
  ], agora);
  assert.equal(r.total.qtd, 2);
  assert.equal(r.total.horas, 36);
  assert.equal(r.sobreaviso.qtd, 1);
  assert.equal(r.rotina.qtd, 1);
});

test('médias: ponderada e nota necessária', () => {
  const m = (id, nota, peso, disciplina = 'Direito') => ({ id, subtipo: 'prova', titulo: 'P' + id, inicio: id, disciplina, nota, peso });
  const [d] = mediasAcademicas([m(1, 6, 2), m(2, null, 1)], 7);
  assert.equal(d.media, 6);
  assert.equal(d.precisa, 9); // (7*3 - 12) / 1
  assert.equal(d.situacao, 'em-aberto');
  assert.equal(mediasAcademicas([m(1, 10, 3), m(2, null, 1)], 7)[0].situacao, 'garantida');
  assert.equal(mediasAcademicas([m(1, 2, 3), m(2, null, 1)], 7)[0].situacao, 'impossivel');
  assert.equal(mediasAcademicas([m(1, 8, 1), m(2, 7, 1)], 7)[0].situacao, 'aprovado');
});

test('checklist padrão existe para os serviços', () => {
  for (const s of ['sentinela_guarda', 'estagio_cpu', 'prova', 'copa', 'sobreaviso']) assert.ok(checklistPadrao(s).length >= 3, s);
  assert.deepEqual(checklistPadrao('pessoal'), []);
});

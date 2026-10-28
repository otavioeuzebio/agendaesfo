/**
 * Agenda do Cadete — interface.
 *
 * Organização:
 *   1. utilidades e estado da interface
 *   2. cartões e trechos reutilizáveis
 *   3. vistas: Painel, Escalas, Missões, Ajustes
 *   4. folhas: Adição rápida, Missão, Ciclo, Plantão
 *   5. relógio, lembretes, instalação e service worker
 *
 * Os dados vivem em store.js (localStorage). Toda gravação dispara
 * `renderizar()`, então a tela sempre reflete o que está salvo.
 */
import { store, novoId, pedirArmazenamentoPersistente, usarConta } from './store.js';
import { iniciarPortao, sairDaConta, aguardarChave } from './portao.js';
import { listarAcessos, definirAcesso, removerAcesso, mensagemErro, definirPapel, papelDaConta } from './acesso.js';
import { itensNoIntervalo, proximoCritico, atrasadas, plantoesDoCiclo, lembretesVencidos, fimEfetivo, proximas } from './agenda.js';
import { checklistPadrao, pendentesChecklist, relatorioHoras, textoRelatorio, mediasAcademicas, mediaGeral, SUBTIPOS_AVALIACAO, linhasParaMissoes, avisoVespera, quadroDoPosto, SERVICOS_ARMADOS } from './extras.js';
import * as nuvem from './nuvem.js';
import { fardamentoDoDia, licencaDoFimDeSemana, LICENCA_PADRAO, equilibrioTurma, colegasNaEscala, livresParaTroca, casaColega, conflitos as conflitosAgenda, resumoFaltas, chaveAula, LIMITE_FALTAS_PADRAO, discDaSigla, opcoesDisciplina, textoResumo } from './cruzamentos.js';
import { listarDocs, guardarDoc, apagarDoc, ehMeu, filtrar, agrupar as agruparLinhas, datasDoDoc, TIPOS_CONSULTA } from './documentos.js';
import { ehQts, lerQts, blocosDoDia, aulaAgora, guardarSemana, semanaDoDia, siglaBase, ehIndisponivel, editarAulas, restaurarAulas } from './qts.js';
import { configRevista, diaDeRevista, revistaDoDia, situacaoAlimento, ROTULO_ALIMENTO, alimentosEmAlerta, lembretesExtras, relatoriosACriar, PRAZO_RELATORIO_PADRAO, ymd as ymdR } from './rotina.js';
import { gcalConfigurado, sincronizarAgenda, desconectar as gcalDesconectar } from './gcal.js';
import { gerarICS, baixar } from './ics.js';
import { MODELOS, UNIDADES_CPU, crpmDa, horarioPadrao, proximoFimDeSemana, GRUPOS_SOBREAVISO, POSICOES_SALAS } from './modelos.js';

/** Opções extras por tipo, gravadas em missao.detalhe. */
const OPCOES_TIPO = { sobreaviso: { rotulo: 'Sobreaviso de', itens: GRUPOS_SOBREAVISO }, salas_comando: { rotulo: 'Sua posição na escala', itens: POSICOES_SALAS } };
import { interpretarRapido } from './quickParse.js';
import { CATEGORIAS, SUBTIPOS, PRIORIDADES, subtiposDe, SUBTIPOS_ESCALA, OPCOES_LEMBRETE, lembretesPadrao, rotuloAntecedencia } from './catalog.js';
import { DIAS_CURTOS, MESES, inicioDoDia, somaDias, mesmoDia, hhmm, ddmm, rotuloDia, dataPorExtenso, contagem, BLOCOS, blocoDe, gradeDoMes, semanaDe } from './dates.js';

/* ============ 1. utilidades e estado ============ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');
const paraData = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const paraHora = (ms) => hhmm(ms);
const deCampos = (data, hora) => { const [a, m, d] = data.split('-').map(Number); const [h, mi] = (hora || '00:00').split(':').map(Number); return new Date(a, m - 1, d, h, mi).getTime(); };
const corCat = (c) => `var(--c-${c})`;
const corPri = (p) => `var(--p-${p})`;
const DIA = 86400000;

const ui = {
  vista: 'painel',
  diaPainel: inicioDoDia(Date.now()),
  esc: { modo: 'mes', ref: inicioDoDia(Date.now()), sel: inicioDoDia(Date.now()) },
  mis: { status: 'pendente', cat: 'todas', busca: '' },
  instalar: null, // evento beforeinstallprompt
  diaAlvo: null,
  conta: null,    // { email, uid, admin } quando há login
  adm: null,      // lista de acessos carregada (administrador)
  admErro: '',  // dia usado pelas abas de modelos (dia selecionado na tela atual)
  rel: { modo: 'mes', ref: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }, // relatório de horas
  turma: { carregado: false, carregando: false, perfil: null, avisos: [], trocas: [], escalas: [], erro: '', editarPerfil: false },
  imp: null,      // importação de escala em andamento
  stats: null,    // estatísticas (administrador)
  senhaErro: '',
};
const temNuvem = () => !!ui.conta;

function toast(msg, acao) {
  const t = $('#toast');
  t.textContent = msg;
  if (acao) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-acao'; b.textContent = acao.rotulo;
    b.onclick = () => { t.hidden = true; acao.fn(); };
    t.append(' ', b);
  }
  t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), acao ? 6000 : 2600);
}

/** Remove itens do histórico com opção de desfazer por alguns segundos. */
function removerHistorico(chaves) {
  if (!chaves.length) return;
  const antes = store.snapshot();
  store.removerDoHistorico(chaves);
  vibrar(20);
  toast(chaves.length === 1 ? 'Removida do histórico' : `${chaves.length} missões removidas do histórico`,
    { rotulo: 'Desfazer', fn: () => { store.restaurar(antes); toast('Restaurado'); } });
}
function vibrar(ms = 15) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

/** Encontra um item (missão ou plantão de ciclo) pela chave. */
function acharItem(chave) {
  if (chave.startsWith('ciclo:')) {
    const [, id, ini] = chave.split(':');
    const c = store.get().ciclos.find((x) => x.id === id);
    if (!c) return null;
    return plantoesDoCiclo({ ...c, ativo: true }, +ini - 1, +ini + 1).find((p) => p.inicio === +ini) || null;
  }
  const m = store.get().missoes.find((x) => x.id === chave);
  return m ? { ...m, origem: 'missao', chave: m.id } : null;
}

/* ============ 2. trechos reutilizáveis ============ */
function horario(it) {
  if (it.diaTodo) return it.fim && !mesmoDia(it.inicio, it.fim) ? `Até ${ddmm(it.fim)}` : 'Dia todo';
  let t = hhmm(it.inicio);
  if (it.fim) t += ` → ${mesmoDia(it.inicio, it.fim) ? '' : ddmm(it.fim) + ' '}${hhmm(it.fim)}`;
  return t;
}

const svgLixo = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const svgCheck = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';

function cartao(it, agora, { mostrarDia = false, remover = false } = {}) {
  const feito = it.status === 'concluida';
  const pulado = it.status === 'pulado';
  const atrasada = it.status === 'pendente' && fimEfetivo(it) < agora;
  const tipo = SUBTIPOS[it.subtipo]?.rotulo || '';
  return `<div class="item${feito ? ' feito' : ''}${pulado ? ' pulado' : ''}${atrasada ? ' atrasada' : ''}" style="--cor:${corCat(it.categoria)}">
    <span class="faixa"></span>
    <button class="corpo" type="button" data-abrir="${esc(it.chave)}" aria-label="${esc(tipo + ': ' + it.titulo + ', ' + horario(it))}">
      <span class="it-1"><span class="it-h">${mostrarDia ? esc(rotuloDia(it.inicio, agora)) + ' · ' : ''}${esc(horario(it))}</span><span class="it-tipo">${esc(tipo)}</span></span>
      <span class="it-t">${esc(it.titulo)}</span>
      <span class="it-1">
        ${it.prioridade !== 'rotineiro' ? `<span class="pill" style="--pc:${corPri(it.prioridade)}">${PRIORIDADES[it.prioridade].rotulo}</span>` : ''}
        ${it.origem === 'ciclo' ? '<span class="pill ciclo">Ciclo</span>' : ''}
        ${atrasada ? '<span class="pill" style="--pc:var(--danger)">Atrasada</span>' : ''}
        ${pulado ? '<span class="pill" style="--pc:var(--muted)">Trocado / dispensado</span>' : ''}
        ${it.local ? `<span class="it-m">${esc(it.local)}</span>` : ''}
        ${it.escala?.oficial ? `<span class="it-m">Of. CPU: ${esc(it.escala.oficial)}</span>` : ''}
        ${it.detalhe ? `<span class="it-m">${esc(it.detalhe)}</span>` : ''}
      </span>
    </button>
    <span class="acoes-it">${pulado ? '' : `<button class="check" type="button" data-check="${esc(it.chave)}" role="checkbox" aria-checked="${feito}" aria-label="${feito ? 'Marcar como pendente' : 'Marcar como concluída'}">${svgCheck}</button>`}${
      remover ? `<button class="lixo" type="button" data-remover="${esc(it.chave)}" aria-label="Remover do histórico: ${esc(it.titulo)}">${svgLixo}</button>` : ''}</span>
  </div>`;
}

function chip({ rotulo, cor, ativo, dados, peq }) {
  return `<button type="button" class="chip${peq ? ' peq' : ''}" aria-pressed="${!!ativo}" ${dados} ${cor ? `style="--cor:${cor}"` : ''}>${cor ? '<span class="p"></span>' : ''}${esc(rotulo)}</button>`;
}

/** "sex 30/10 às 19:00" — data absoluta (serve também para avisos que chegam depois). */
const dataCurta = (it) => `${DIAS_CURTOS[new Date(it.inicio).getDay()].toLowerCase()} ${ddmm(it.inicio)}${it.diaTodo ? '' : ' às ' + hhmm(it.inicio)}`;
function textoLembrete(it, min) {
  // véspera de serviço armado: "Amanhã: guarda 07h. Separou o 4º A?"
  if (SERVICOS_ARMADOS.includes(it.subtipo) && min >= 600) {
    const dispara = (it.diaTodo ? it.inicio + 8 * 3600000 : it.inicio) - min * 60000;
    return avisoVespera(it, dispara, store.get().config.fardamentoPadrao);
  }
  const titulo = `${SUBTIPOS[it.subtipo]?.rotulo || 'Missão'} em ${rotuloAntecedencia(min)}`;
  const pend = it.origem === 'missao' ? pendentesChecklist(it) : 0;
  const corpo = [it.titulo, dataCurta(it), it.local, pend && min >= 60 ? `Checklist: ${pend} pendente${pend > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  return { titulo, corpo };
}
/** Serviços (escala) acontecendo agora. */
function emServicoAgora(agora) {
  return itensNoIntervalo(agora - 3 * DIA, agora + 1).filter((i) => i.status === 'pendente' && !i.diaTodo && SUBTIPOS_ESCALA.includes(i.subtipo) && i.inicio <= agora && fimEfetivo(i) > agora);
}
function linhaChecklist(m, i, c) {
  return `<label class="ck${c.ok ? ' ok' : ''}"><input type="checkbox" data-ck="${esc(m.id)}:${i}" ${c.ok ? 'checked' : ''}><span>${esc(c.t)}</span><span></span></label>`;
}
function cartaoEmServico(it, agora) {
  const fim = fimEfetivo(it);
  const pct = Math.min(100, Math.max(0, ((agora - it.inicio) / (fim - it.inicio)) * 100));
  const m = it.origem === 'missao' ? store.get().missoes.find((x) => x.id === it.id) : null;
  const contatos = store.get().config.contatos || [];
  const quadro = quadroDoPosto(it.escala?.quartos, it.inicio, fim);
  return `<div class="em-servico" role="region" aria-label="Em serviço">
    <span class="lbl">Em serviço · ${esc(SUBTIPOS[it.subtipo]?.rotulo || '')}</span>
    <h2>${esc(it.titulo)}</h2>
    <div class="cd"><b class="num" data-cd-fim="${fim}">${contagem(fim - agora)}</b><small>para a rendição · ${ddmm(fim)} às ${hhmm(fim)}</small></div>
    <div class="barra-p" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></div>
    ${it.local || it.detalhe ? `<small>${esc([it.local, it.detalhe].filter(Boolean).join(' · '))}</small>` : ''}
    ${quadro.length ? `<div class="quadro"><span class="lbl">Seus horários no posto</span>${quadro.map((q) => {
      const st = agora >= q.fim ? 'feito' : agora >= q.ini ? 'agora' : '';
      return `<span class="q ${st}"><b>${hhmm(q.ini)}–${hhmm(q.fim)}</b>${st === 'agora' ? ' · no posto agora' : st === 'feito' ? ' · cumprido' : q === quadro.find((x) => agora < x.ini) ? ` · próximo em ${contagem(q.ini - agora)}` : ''}</span>`;
    }).join('')}</div>` : (it.origem === 'missao' ? '<small>Dica: em Detalhes, preencha "Seus horários no posto" (ex.: 19h-21h, 01h-03h) para ver o quadro aqui.</small>' : '')}
    ${htmlColegas(ymdL(it.inicio), { compacto: true })}
    ${contatos.length ? `<div class="contatos">${contatos.map((c) => `<a href="tel:${esc(c.tel.replace(/[^\d+]/g, ''))}">📞 ${esc(c.nome)}</a>`).join('')}</div>` : '<small>Cadastre contatos úteis (Cmt. da Guarda, Oficial de Dia…) em Ajustes para ligar daqui.</small>'}
    <div class="linha"><button class="btn" type="button" data-abrir="${esc(it.chave)}">Detalhes</button><button class="btn ouro dir" type="button" data-check="${esc(it.chave)}">Encerrar serviço</button></div>
    ${m?.checklist?.length ? `<details class="ck-serv"${(ui.ckServAberto ?? (pendentesChecklist(m) > 0 && agora < it.inicio + 3600000)) ? ' open' : ''}><summary>Checklist · ${m.checklist.length - pendentesChecklist(m)}/${m.checklist.length} conferidos</summary><div class="checklist">${m.checklist.map((c, i) => linhaChecklist(m, i, c)).join('')}</div></details>` : ''}
    <small>Durante o serviço, só os lembretes críticos tocam; os demais chegam em silêncio.</small>
  </div>`;
}

/** Turmas da EsFO (mesma grafia das Planilhas de Anotados). */
const TURMAS = ['3° CFO', 'CHOE', '1° CFO/1', '1° CFO/2'];

/* ---- Escalas completas (todos os cadetes) ---- */
/** Guarda o documento e manda para os outros aparelhos (junto da agenda criptografada). */
function guardarDocSinc(doc) {
  const id = guardarDoc(ui.conta?.uid, doc);
  if (temNuvem()) nuvem.agendarSincronizacao();
  return id;
}
/** Documentos para consulta: os PDFs lidos neste aparelho + as escalas publicadas na turma. */
function docsConsulta() {
  const locais = listarDocs(ui.conta?.uid).map((d) => ({ ...d, origem: 'aparelho' }));
  const ids = new Set(locais.map((d) => d.id));
  const turma = (ui.turma.escalas || []).filter((e) => TIPOS_CONSULTA[e.tipo] && e.linhas?.length)
    .map((e) => ({ id: 'turma-' + e.id, tipo: e.tipo, titulo: e.titulo, linhas: e.linhas, meta: {}, origem: 'turma', importadoEm: e.criadoEm?.toMillis?.() || 0 }))
    .filter((d) => !ids.has(d.id));
  return [...locais, ...turma];
}
function renderTodos(agora) {
  const docs = docsConsulta();
  const T = ui.todos ||= { doc: '', busca: '', data: '' };
  if (!docs.find((d) => d.id === T.doc)) T.doc = docs[0]?.id || '';
  const doc = docs.find((d) => d.id === T.doc);
  const cfg = store.get().config;
  const hoje = paraData(agora);
  const nome = (l) => `<span class="${ehMeu(l.nome, cfg) ? 'eu' : ''}">${esc([l.grad, l.nome].filter(Boolean).join(' '))}</span>`;
  const f = (d) => d ? d.split('-').reverse().slice(0, 2).join('/') : '';
  let corpo = '';
  if (!doc) corpo = '<div class="vazio">Nenhuma escala guardada. Importe um PDF (Serviço Interno, Rotina, Desfile, Representação, Planilha de Anotados ou NAMCE) pelo botão dourado e ele fica disponível aqui para consulta.</div>';
  else {
    const busca = T.busca.trim();
    const linhas = filtrar(doc.linhas, busca);
    if (doc.tipo === 'interna' || doc.tipo === 'rotina') {
      const { datas, abrir } = datasDoDoc(doc, hoje);
      if (!datas.includes(T.data)) T.data = abrir;
      const doDia = busca ? linhas : linhas.filter((l) => l.data === T.data);
      const porData = agruparLinhas(doDia, (l) => l.data);
      corpo = `${busca ? '' : `<div class="semana todos-dias" role="group" aria-label="Escolher dia">${datas.map((d) => `<button type="button" data-todosdata="${d}" aria-pressed="${d === T.data}"><span>${d === hoje ? 'HOJE' : DIAS_CURTOS[new Date(d + 'T12:00').getDay()].toUpperCase()}</span><b class="num">${+d.slice(8)}</b><i class="pt" style="${doc.linhas.some((l) => l.data === d && ehMeu(l.nome, cfg)) ? '' : 'visibility:hidden'}"></i></button>`).join('')}</div>`}
        ${porData.length ? porData.map((g) => `<div class="secao">${busca || porData.length > 1 ? `<h2 class="lbl">${esc(rotuloDia(new Date(g.chave + 'T12:00').getTime(), agora))} · ${f(g.chave)}</h2>` : ''}
          ${agruparLinhas(g.itens, (l) => `${l.subtipo}|${l.detalhe || ''}`).map((fn) => {
            const l0 = fn.itens[0];
            const rot = (SUBTIPOS[l0.subtipo]?.rotulo || l0.funcao || 'Função') + (l0.detalhe && l0.subtipo !== 'sobreaviso' ? ' · ' + l0.detalhe : l0.subtipo === 'sobreaviso' && l0.detalhe ? ' · ' + l0.detalhe : '');
            return `<div class="func${fn.itens.some((l) => ehMeu(l.nome, cfg)) ? ' minha' : ''}"><span class="lbl">${esc(rot)}</span><div class="nomes">${fn.itens.map(nome).join('')}</div></div>`;
          }).join('')}</div>`).join('') : `<div class="vazio">${busca ? 'Ninguém com esse nome nesta escala.' : 'Nada neste dia.'}</div>`}`;
    } else if (doc.tipo === 'desfile') {
      corpo = `${doc.linhas[0]?.data ? `<small class="cinza">Semana ${f(doc.linhas[0].data)} a ${f(doc.linhas[0].ate)}</small>` : ''}
        ${linhas.map((l) => `<div class="func${ehMeu(l.nome, cfg) ? ' minha' : ''}"><span class="lbl">${esc(l.detalhe)}</span><div class="nomes">${nome(l)}</div></div>`).join('') || '<div class="vazio">Ninguém com esse nome.</div>'}`;
    } else if (doc.tipo === 'representacao') {
      const l0 = doc.linhas[0] || {};
      corpo = `<div class="cartao-n"><h3>${esc(l0.evento || doc.titulo)}</h3><p>${esc([l0.data && f(l0.data), l0.horarioTxt, l0.local, l0.fardamento && 'Fardamento: ' + l0.fardamento].filter(Boolean).join('\n'))}</p></div>
        ${agruparLinhas(linhas, (l) => l.detalhe).map((g) => `<div class="func"><span class="lbl">${esc(g.chave === 'Titular' ? 'Escalados' : g.chave)} (${g.itens.length})</span><div class="nomes">${g.itens.map(nome).join('')}</div></div>`).join('') || '<div class="vazio">Ninguém com esse nome.</div>'}`;
    } else {
      // Planilha de Anotados / NAMCE: por turma
      corpo = agruparLinhas(linhas, (l) => l.secao || '').map((g) => `<div class="secao"><h2 class="lbl">${esc(g.chave)} <small>${g.itens.length}</small></h2>
        ${g.itens.map((l) => `<div class="imp-item anot ${l.tipoAnot === 'FO+' ? 'pos' : 'neg'}${ehMeu(l.nome, cfg) ? ' minha' : ''}"><span><b>${esc(l.nome)}</b>${l.pel ? ' · ' + esc(l.pel) : ''} · ${esc(f(l.data))}<br>${esc(l.texto)}
          <small>${esc([l.tipoAnot, l.anotador, l.mce && 'MCE: ' + l.mce].filter(Boolean).join(' · '))}</small></span></div>`).join('')}</div>`).join('') || '<div class="vazio">Ninguém com esse nome.</div>';
    }
  }
  $('#v-escalas').innerHTML = `<div class="secao" style="gap:14px">
    <div class="linha"><button class="btn" type="button" data-acao="esc-minha">‹ Minha agenda</button><h2 class="titulo-vista" style="margin:0">Escalas completas</h2></div>
    ${docs.length ? `<div class="campo"><label class="lbl" for="td-doc">Documento</label><select id="td-doc">${docs.map((d) => `<option value="${esc(d.id)}"${d.id === T.doc ? ' selected' : ''}>${esc(d.titulo || TIPOS_CONSULTA[d.tipo])}${d.origem === 'turma' ? ' (turma)' : ''}</option>`).join('')}</select></div>
      <div class="linha"><div class="campo" style="flex:1"><input id="td-busca" type="search" placeholder="Buscar nome, função ou pelotão" value="${esc(T.busca)}"></div>
        ${cfg.nomeGuerra || cfg.nomeCompleto ? `<button class="btn" type="button" data-acao="td-eu">Eu</button>` : ''}</div>` : ''}
    ${corpo}
    ${doc ? `<p class="dica">${doc.origem === 'turma' ? 'Publicada na turma.' : `Lida neste aparelho ${esc(rotuloDia(doc.importadoEm, agora).toLowerCase())}; fica só aqui (não vai para a nuvem).`} Seu nome aparece destacado.</p>
      ${doc.origem === 'aparelho' ? '<button class="btn link" type="button" data-acao="td-apagar">Apagar este documento do aparelho</button>' : ''}` : ''}
  </div>`;  const sel = $('.todos-dias [aria-pressed="true"]');
  if (sel) sel.parentElement.scrollLeft = sel.offsetLeft - sel.parentElement.clientWidth / 2 + sel.clientWidth / 2;
}

/* ---- QTS (Quadro de Trabalho Semanal) ---- */
/** Alterações do QTS publicadas na turma: entram no QTS de quem tem a mesma semana e o mesmo pelotão. */
function aplicarAltsQts() {
  const cfg = store.get().config;
  const feitas = new Set(cfg.qtsAltAplicadas || []);
  let qts = cfg.qts || [], novas = [];
  for (const e of (ui.turma.escalas || []).filter((x) => x.tipo === 'qts-alt' && !feitas.has(x.id)).sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0))) {
    const l = e.linhas?.[0]; if (!l) continue;
    const sem = qts.find((x) => x.id === l.semId && x.turma === l.qtsTurma);
    if (!sem) continue; // ainda não importou esta semana: aplica quando importar
    qts = editarAulas(qts, l.semId, l.dia, l.ns, { ...l.mudanca, nota: [l.mudanca.nota, 'publicado na turma'].filter(Boolean).join(' · ') });
    novas.push(e.id);
  }
  if (!novas.length) return;
  store.setConfig({ qts, qtsAltAplicadas: [...feitas, ...novas].slice(-300) });
  toast(novas.length === 1 ? 'O QTS foi alterado pela turma' : `${novas.length} alterações do QTS recebidas da turma`);
}
/** Abre o editor de aulas do dia (de uma faixa de aulas ou do dia inteiro). */
function abrirEdicaoQts(dia, primeira, ultima) {
  const sems = store.get().config.qts || [];
  const sem = semanaDoDia(sems, dia);
  const d = sem?.dias.find((x) => x.data === dia); if (!d) return;
  const sel = primeira ? d.aulas.filter((a) => a.n >= +primeira && a.n <= +ultima).map((a) => a.n) : [];
  const a0 = d.aulas.find((a) => a.n === sel[0]) || {};
  ui.edQts = { semId: sem.id, dia, sel, sigla: a0.sigla ?? '', local: a0.local || '', instrutor: a0.instrutor || '', nota: a0.nota || '', ini: a0.ini || '', fim: a0.fim || '', novaSig: '', novoNome: '' };
  desenharEdicaoQts();
  abrirFolha('#dlg-qts');
}
function desenharEdicaoQts() {
  const e = ui.edQts, sems = store.get().config.qts || [];
  const sem = sems.find((s) => s.id === e.semId), d = sem.dias.find((x) => x.data === e.dia);
  const siglas = Object.entries(sem.legenda || {}).filter(([k]) => !ehIndisponivel(k)).sort((a, b) => a[0].localeCompare(b[0]));
  const valor = e.sigla === '__nova' ? '__nova' : ehIndisponivel(e.sigla) ? 'IND' : siglas.some(([k]) => k === siglaBase(e.sigla)) ? siglaBase(e.sigla) : e.sigla ? '__nova' : '';
  const algumaAlterada = d.aulas.some((a) => e.sel.includes(a.n) && a.alterada);
  $('#qts-ed-t').textContent = `Alterar aulas · ${DIAS_CURTOS[d.dow]} ${ddmm(new Date(e.dia + 'T12:00').getTime())}`;
  $('#qts-ed-corpo').innerHTML = `
    <span class="lbl">Aulas <small>toque para escolher quais mudam</small></span>
    <div class="eq-aulas">${d.aulas.map((a) => `<button type="button" class="eq-aula${e.sel.includes(a.n) ? ' sel' : ''}${a.alterada ? ' mudou' : ''}" data-edn="${a.n}" aria-pressed="${e.sel.includes(a.n)}">
      <b>${a.n}ª</b><small>${a.ini}</small><span>${esc(siglaBase(a.sigla) || '—')}</span></button>`).join('')}</div>
    <div class="campo"><label class="lbl" for="eq-sig">Fica</label><select id="eq-sig">
      <option value=""${valor === '' ? ' selected' : ''}>Sem aula</option>
      ${siglas.map(([k, l]) => `<option value="${esc(k)}"${valor === k ? ' selected' : ''}>${esc(k)} – ${esc(capitaliza(l.nome))}</option>`).join('')}
      <option value="IND"${valor === 'IND' ? ' selected' : ''}>Indisponível</option>
      <option value="__nova"${valor === '__nova' ? ' selected' : ''}>Outra disciplina…</option></select></div>
    ${valor === '__nova' ? `<div class="dupla"><div class="campo"><label class="lbl" for="eq-nsig">Sigla</label><input id="eq-nsig" maxlength="12" value="${esc(e.sigla === '__nova' ? e.novaSig : e.sigla)}" placeholder="Ex.: TIRO"></div>
      <div class="campo"><label class="lbl" for="eq-nnome">Nome</label><input id="eq-nnome" value="${esc(e.novoNome)}" placeholder="Ex.: Instrução de Tiro"></div></div>` : ''}
    ${valor !== '' && valor !== 'IND' ? `<div class="dupla"><div class="campo"><label class="lbl" for="eq-local">Local</label><input id="eq-local" value="${esc(e.local)}" placeholder="Ex.: Aud. EsFO, BPEC"></div>
      <div class="campo"><label class="lbl" for="eq-inst">Instrutor</label><input id="eq-inst" value="${esc(e.instrutor)}"></div></div>` : ''}
    ${e.sel.length === 1 ? `<div class="dupla"><div class="campo"><label class="lbl" for="eq-ini">Início</label><input id="eq-ini" type="time" value="${esc(e.ini)}"></div><div class="campo"><label class="lbl" for="eq-fim">Fim</label><input id="eq-fim" type="time" value="${esc(e.fim)}"></div></div>` : ''}
    <div class="campo"><label class="lbl" for="eq-nota">Motivo / observação</label><input id="eq-nota" value="${esc(e.nota)}" placeholder="Ex.: aula antecipada, instrutor em missão"></div>
    ${temNuvem() && ui.conta && (ui.conta.admin || ui.conta.papel === 'escalante') ? `<label class="linha"><input type="checkbox" id="eq-pub" ${e.publicar ? 'checked' : ''}> <span>Publicar para a turma (${esc(sem.turma || 'este pelotão')})</span></label>` : ''}
    <button class="btn pri" type="button" data-eq="salvar" ${e.sel.length ? '' : 'disabled'}>${e.sel.length ? `Salvar ${e.sel.length} aula${e.sel.length > 1 ? 's' : ''}` : 'Escolha as aulas'}</button>
    ${algumaAlterada ? '<button class="btn" type="button" data-eq="restaurar">Voltar ao que veio no PDF</button>' : ''}
    <p class="dica">A mudança vale só para você (e seus aparelhos). Se importar de novo o PDF da mesma semana, as aulas alteradas aqui continuam como você deixou.</p>`;
}
function lerCamposEdQts() {
  const e = ui.edQts;
  const v = (id) => $('#' + id)?.value ?? null;
  if (v('eq-local') != null) e.local = v('eq-local');
  if (v('eq-inst') != null) e.instrutor = v('eq-inst');
  if (v('eq-nota') != null) e.nota = v('eq-nota');
  if (v('eq-ini') != null) e.ini = v('eq-ini');
  if (v('eq-fim') != null) e.fim = v('eq-fim');
  if (v('eq-nsig') != null) e.novaSig = v('eq-nsig');
  if (v('eq-nnome') != null) e.novoNome = v('eq-nnome');
  if ($('#eq-pub')) e.publicar = $('#eq-pub').checked;
}
$('#qts-ed-corpo').addEventListener('change', (ev) => {
  if (ev.target.id !== 'eq-sig') return;
  const e = ui.edQts; lerCamposEdQts();
  e.sigla = ev.target.value;
  const sem = (store.get().config.qts || []).find((s) => s.id === e.semId);
  const lg = sem?.legenda?.[e.sigla];
  if (lg) e.instrutor = capitaliza(lg.instrutor || '');
  desenharEdicaoQts();
});
$('#qts-ed-corpo').addEventListener('click', (ev) => {
  const e = ui.edQts;
  const n = ev.target.closest('[data-edn]');
  if (n) { lerCamposEdQts(); const k = +n.dataset.edn; e.sel = e.sel.includes(k) ? e.sel.filter((x) => x !== k) : [...e.sel, k].sort((a, b) => a - b); return desenharEdicaoQts(); }
  const b = ev.target.closest('[data-eq]'); if (!b) return;
  const sems = store.get().config.qts || [];
  if (b.dataset.eq === 'restaurar') {
    store.setConfig({ qts: restaurarAulas(sems, e.semId, e.dia, e.sel) });
    fecharFolha('#dlg-qts'); toast('Aulas voltaram ao QTS original'); return;
  }
  lerCamposEdQts();
  let sigla = e.sigla, nome = '';
  if (e.sigla === '__nova' || (e.sigla && !['IND'].includes(e.sigla) && !(sems.find((s) => s.id === e.semId)?.legenda || {})[siglaBase(e.sigla)])) {
    sigla = (e.novaSig || '').trim().toUpperCase(); nome = (e.novoNome || '').trim();
    if (!sigla) { toast('Informe a sigla da disciplina'); return; }
  }
  if (e.sel.length === 1 && e.ini && e.fim && e.fim <= e.ini) { toast('O fim precisa ser depois do início'); return; }
  const mudanca = { sigla, nome: nome || sigla, local: e.local, instrutor: e.instrutor, nota: e.nota, ini: e.ini, fim: e.fim };
  store.setConfig({ qts: editarAulas(sems, e.semId, e.dia, e.sel, mudanca) });
  fecharFolha('#dlg-qts'); vibrar(20); toast(`${e.sel.length} aula${e.sel.length > 1 ? 's' : ''} alterada${e.sel.length > 1 ? 's' : ''}`);
  if (e.publicar) {
    const sem = sems.find((s) => s.id === e.semId);
    const d = sem.dias.find((x) => x.data === e.dia);
    const desc = `${DIAS_CURTOS[d.dow]} ${ddmm(new Date(e.dia + 'T12:00').getTime())}, ${e.sel.map((n) => n + 'ª').join(', ')} aula${e.sel.length > 1 ? 's' : ''}: ${sigla || 'sem aula'}${e.local ? ' (' + e.local + ')' : ''}`;
    nuvem.publicarEscala({ tipo: 'qts-alt', titulo: `QTS alterado · ${desc}`, linhas: [{ semId: e.semId, qtsTurma: sem.turma, semana: sem.semana, dia: e.dia, ns: e.sel, mudanca }] })
      .then(() => { toast('Alteração publicada para a turma'); ui.turma.carregado = false; carregarTurma(); })
      .catch((err) => toast('Não publicou: ' + mensagemErro(err)));
  }
});
function faltasDoBloco(dia, b) {
  const f = store.get().config.faltas || {};
  let n = 0; for (let i = b.primeira; i <= b.ultima; i++) if (f[chaveAula(dia, i)]) n++;
  return n;
}
const corSigla = (s) => { let h = 0; for (const c of siglaBase(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 45%)`; };
const ymdL = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nomeDisc = (sem, sigla) => sem?.legenda?.[siglaBase(sigla)]?.nome || '';
const capitaliza = (t) => String(t || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Dos|Das|E)\b/g, (m) => m.toLowerCase())
  .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix)\b/g, (m) => m.toUpperCase()).replace(/\b(\d+\S*)/g, (m) => m.toUpperCase());
function rotuloQuando(dataYmd, hhmmTxt, agora) {
  const d = new Date(`${dataYmd}T${hhmmTxt}:00`).getTime();
  return `${rotuloDia(d, agora).toLowerCase()} às ${hhmmTxt}`;
}
/** Aula agora / próxima no painel. */
function cartaoAula(agora) {
  const sems = store.get().config.qts || [];
  if (!sems.length || !mesmoDia(ui.diaPainel, inicioDoDia(agora))) return '';
  const { atual, proxima } = aulaAgora(sems, agora);
  if (!atual && !proxima) return '';
  const linha = (b, tipo) => `<div class="aula-mini" style="--cor:${corSigla(b.sigla)}"><span class="sig">${esc(b.sigla)}</span>
    <span><b>${tipo}</b> ${esc(capitaliza(nomeDisc(b.semana, b.sigla)) || b.sigla)}${b.local ? ' · ' + esc(b.local) : ''}
    <small>${tipo === 'Agora' ? `até ${b.fim} · faltam ${contagem(b.fimMs - agora)}` : `${esc(rotuloQuando(b.data, b.ini, agora))}${b.iniMs - agora < 6 * 3600000 ? ' · em ' + contagem(b.iniMs - agora) : ''}`}</small></span></div>`;
  return `<button type="button" class="cartao-aula" data-ir="qts">${atual ? linha(atual, 'Agora') : ''}${proxima ? linha(proxima, atual ? 'Depois' : 'Próxima') : ''}</button>`;
}

function renderQts(agora) {
  const sems = store.get().config.qts || [];
  const q = ui.qts ||= { dia: ymdL(agora), modo: 'dia' };
  if (!sems.length) {
    $('#v-qts').innerHTML = `<div class="secao" style="gap:14px"><h2 class="titulo-vista">QTS</h2>
      <div class="vazio">Importe o PDF do <b>Quadro de Trabalho Semanal</b> para ver as aulas da semana, a aula de agora e a carga horária de cada disciplina.</div>
      <button class="btn ouro" type="button" data-acao="importar-pdf">Importar QTS (PDF)</button></div>`;
    return;
  }
  const sem = semanaDoDia(sems, q.dia);
  if (!sem.dias.some((d) => d.data === q.dia)) q.dia = (sem.dias.find((d) => d.data >= ymdL(agora)) || sem.dias[0]).data;
  const iSem = sems.indexOf(sem);
  const hoje = ymdL(agora);
  const { atual, proxima } = aulaAgora(sems, agora);
  const f = (d) => d.split('-').reverse().slice(0, 2).join('/');
  const diaSel = sem.dias.find((d) => d.data === q.dia);

  const blocoHtml = (b, dia) => {
    const ed = `<button type="button" class="ed-aula" data-qtsed="${dia}|${b.primeira}|${b.ultima}" aria-label="Alterar ${b.ini}–${b.fim}">✎</button>`;
    const marca = b.alterada ? `<small class="alterado">Alterado${b.nota ? ': ' + esc(b.nota) : ''}</small>` : '';
    if (!b.sigla || ehIndisponivel(b.sigla)) return `<div class="aula vaga${b.alterada ? ' mudou' : ''}"><span class="h">${b.ini}–${b.fim}</span><span>${!b.sigla ? 'Sem aula' : 'Indisponível'}${marca ? '<br>' + marca : ''}</span>${ed}</div>`;
    const lg = sem.legenda?.[siglaBase(b.sigla)] || {};
    const agoraAqui = dia === hoje && b.ini <= hhmm(agora) && hhmm(agora) < b.fim;
    const passou = dia < hoje || (dia === hoje && b.fim <= hhmm(agora));
    return `<div class="aula${agoraAqui ? ' agora' : ''}${passou ? ' passou' : ''}${b.alterada ? ' mudou' : ''}" style="--cor:${corSigla(b.sigla)}">${ed}
      <span class="h">${b.ini}<small>${b.fim}</small></span>
      <div><div class="aula-t"><span class="sig">${esc(b.sigla)}</span>${agoraAqui ? '<span class="tag-agora">agora</span>' : ''}</div>
        <b>${esc(capitaliza(lg.nome) || b.sigla)}</b>${marca}
        <small>${[b.local && '📍 ' + esc(b.local), esc(capitaliza(lg.instrutor || b.instrutor)), `${b.qtd} aula${b.qtd > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</small>
        ${b.adjuntos?.length ? `<small>Adj.: ${b.adjuntos.map((a) => esc(capitaliza(a))).join(', ')}</small>` : ''}
        ${passou || agoraAqui ? (() => { const nf = faltasDoBloco(dia, b); return `<button type="button" class="falta${nf ? ' on' : ''}" data-falta="${dia}|${b.primeira}|${b.ultima}|${esc(b.sigla)}">${nf ? `Faltei (${nf} aula${nf > 1 ? 's' : ''}) · desfazer` : 'Marcar falta'}</button>`; })() : ''}</div></div>`;
  };
  const resumoDia = (d) => {
    const bl = blocosDoDia(d.aulas).filter((b) => b.sigla);
    if (!bl.length) return '<span class="cinza">Sem aula</span>';
    if (bl.every((b) => ehIndisponivel(b.sigla))) return '<span class="cinza">Indisponível</span>';
    return bl.filter((b) => !ehIndisponivel(b.sigla)).map((b) => `<span class="sig" style="--cor:${corSigla(b.sigla)}" title="${esc(b.ini)}–${esc(b.fim)}">${esc(b.sigla)}</span><small>${b.ini}</small>`).join('');
  };
  const contaSemana = {};
  for (const d of sem.dias) for (const a of d.aulas) if (a.sigla && !ehIndisponivel(a.sigla)) contaSemana[siglaBase(a.sigla)] = (contaSemana[siglaBase(a.sigla)] || 0) + 1;
  const discs = Object.entries(sem.legenda || {}).filter(([s, l]) => !ehIndisponivel(s) && l.ha?.total);
  const cfgQ = store.get().config;
  const pctFaltas = +(cfgQ.limiteFaltasPct ?? LIMITE_FALTAS_PADRAO);
  const faltas = resumoFaltas(sems, cfgQ.faltas, pctFaltas);
  const medias = mediasAcademicas(store.get().missoes, +(cfgQ.mediaMinima ?? 7));

  $('#v-qts').innerHTML = `<div class="secao" style="gap:14px">
    <h2 class="titulo-vista">QTS</h2>
    <div class="cal-cab"><button type="button" data-qtsnav="-1" aria-label="Semana anterior" ${iSem <= 0 ? 'disabled' : ''}>‹</button>
      <h2>Semana ${esc(sem.semana)}<small>${f(sem.dias[0].data)} a ${f(sem.dias[sem.dias.length - 1].data)}</small></h2>
      <button type="button" data-qtsnav="1" aria-label="Próxima semana" ${iSem >= sems.length - 1 ? 'disabled' : ''}>›</button></div>
    <small class="cinza" style="text-align:center">${esc(sem.turma || '')}</small>
    ${atual || proxima ? `<div class="aula-destaque">${atual ? `<div style="--cor:${corSigla(atual.sigla)}"><span class="lbl">Agora</span><b>${esc(capitaliza(nomeDisc(atual.semana, atual.sigla)) || atual.sigla)}</b><small>até ${atual.fim}${atual.local ? ' · ' + esc(atual.local) : ''} · faltam <span data-cd-fim="${atual.fimMs}">${contagem(atual.fimMs - agora)}</span></small></div>` : ''}
      ${proxima ? `<div style="--cor:${corSigla(proxima.sigla)}"><span class="lbl">${atual ? 'Depois' : 'Próxima aula'}</span><b>${esc(capitaliza(nomeDisc(proxima.semana, proxima.sigla)) || proxima.sigla)}</b><small>${esc(rotuloQuando(proxima.data, proxima.ini, agora))}${proxima.local ? ' · ' + esc(proxima.local) : ''}</small></div>` : ''}</div>` : ''}
    <div class="linha">${chip({ rotulo: 'Dia', ativo: q.modo === 'dia', dados: 'data-qtsmodo="dia"', peq: true })}${chip({ rotulo: 'Semana', ativo: q.modo === 'semana', dados: 'data-qtsmodo="semana"', peq: true })}${chip({ rotulo: 'Disciplinas', ativo: q.modo === 'disc', dados: 'data-qtsmodo="disc"', peq: true })}
      <button class="btn link dir" type="button" data-acao="importar-pdf">Importar QTS</button></div>
    ${q.modo === 'dia' ? `
      <div class="semana" role="group" aria-label="Escolher dia">${sem.dias.map((d) => `<button type="button" data-qtsdia="${d.data}" aria-pressed="${d.data === q.dia}">
        <span>${d.data === hoje ? 'HOJE' : DIAS_CURTOS[d.dow].toUpperCase()}</span><b class="num">${+d.data.slice(8)}</b>
        <i class="pt" style="${d.aulas.some((a) => a.sigla && !ehIndisponivel(a.sigla)) ? '' : 'visibility:hidden'}"></i></button>`).join('')}</div>
      <div class="secao"><div class="linha"><h2 class="lbl" style="margin:0">${esc(rotuloDia(new Date(q.dia + 'T12:00').getTime(), agora))} · ${f(q.dia)}</h2>
        <button class="btn link dir" type="button" data-qtsed="${q.dia}||">Alterar aulas</button>${diaSel.aulas.some((a) => a.alterada) ? `<button class="btn link" type="button" data-acao="qts-desfazer-dia">Desfazer alterações</button>` : ''}</div>
        ${blocosDoDia(diaSel.aulas).map((b, i, arr) => (i && arr[i - 1].fim <= '12:00' && b.ini >= '13:00' ? '<div class="almoco">Almoço</div>' : '') + blocoHtml(b, q.dia)).join('')}</div>`
    : q.modo === 'semana' ? `
      <div class="qts-semana">${sem.dias.map((d) => `<button type="button" class="qts-dia${d.data === hoje ? ' hoje' : ''}" data-qtsdia="${d.data}" data-qtsir="dia">
        <span class="d"><b>${DIAS_CURTOS[d.dow]}</b><small>${f(d.data)}</small></span><span class="r">${resumoDia(d)}</span></button>`).join('')}</div>`
    : `
      <div class="secao">${discs.length ? discs.map(([s, l]) => {
        const pct = Math.min(100, Math.round((l.ha.dadas / l.ha.total) * 100));
        return `<div class="disc-qts" style="--cor:${corSigla(s)}"><div class="disc-cab"><span class="sig">${esc(s)}</span><b>${esc(capitaliza(l.nome))}</b></div>
          <small>${esc(capitaliza(l.instrutor))}${l.adjuntos?.length ? ' · Adj.: ' + l.adjuntos.map((a) => esc(capitaliza(a))).join(', ') : ''}</small>
          <div class="barra-ha" role="img" aria-label="${l.ha.dadas} de ${l.ha.total} horas-aula"><i style="width:${pct}%"></i></div>
          <small><b>${l.ha.dadas}/${l.ha.total}</b> H.A. (${pct}%)${pct >= 100 ? ' · concluída' : ` · faltam ${l.ha.total - l.ha.dadas}`}${contaSemana[s] ? ` · ${contaSemana[s]} nesta semana` : ''}</small>
          ${(() => { const f = faltas[s] || { faltas: 0, permitidas: Math.floor((l.ha.total * pctFaltas) / 100) }; const risco = f.permitidas && f.faltas >= f.permitidas * 0.75;
            return `<small class="${f.faltas > f.permitidas ? 'erro' : risco ? 'alerta' : ''}">Faltas: <b>${f.faltas}</b> de ${f.permitidas} permitidas${f.faltas > f.permitidas ? ' · passou do limite' : f.faltas === f.permitidas && f.faltas ? ' · no limite' : risco ? ' · perto do limite' : ''}</small>`; })()}
          ${(() => { const d = medias.find((x) => discDaSigla(x.disciplina, s, l.nome)); if (!d) return '';
            const prox = d.proxima ? `próxima: ${esc(d.proxima.titulo)} ${ddmm(d.proxima.inicio)}${d.precisa != null && d.situacao === 'em-aberto' ? ` · precisa de ${(Math.round(d.precisa * 10) / 10).toLocaleString('pt-BR')}` : ''}` : '';
            return `<small>Média: <b>${d.media == null ? '–' : (Math.round(d.media * 100) / 100).toLocaleString('pt-BR')}</b>${prox ? ' · ' + prox : ''}</small>`; })()}</div>`;
      }).join('') : '<div class="vazio">A legenda deste QTS não trouxe a carga horária.</div>'}
      <div class="linha"><label class="lbl" for="qts-pct">Limite de faltas (% das H.A.)</label><div class="campo" style="width:90px"><input id="qts-pct" type="number" min="0" max="100" step="1" inputmode="numeric" value="${esc(pctFaltas)}"></div></div>
      <p class="dica">H.A. = horas-aula dadas / previstas, como está na legenda do QTS. Marque as faltas no dia (aba Dia). Provas lançadas com a disciplina do QTS (ex.: "DPM1 – Direito Penal Militar I") aparecem aqui com a média.</p></div>`}
  </div>`;
}

/** Fardamento do dia (regra da semana + fardamento de serviço/representação + EFM). */
function fardaDoDia(diaMs) {
  const cfg = store.get().config;
  const d0 = inicioDoDia(diaMs).getTime();
  const itens = itensNoIntervalo(d0, d0 + DIA).filter((i) => i.status === 'pendente' && i.inicio >= d0 && i.inicio < d0 + DIA);
  const sem = semanaDoDia(cfg.qts || [], ymdL(d0));
  const aulas = sem?.dias.find((x) => x.data === ymdL(d0))?.aulas.filter((a) => a.sigla && !ehIndisponivel(a.sigla)) || [];
  return fardamentoDoDia(d0, { itens, aulas, fardamentoPadrao: cfg.fardamentoPadrao || '' });
}
function cartaoFarda(dia, agora) {
  const f = fardaDoDia(dia.getTime());
  return `<div class="farda"><span class="lbl">Fardamento · ${esc(rotuloDia(dia.getTime(), agora))}</span>
    <div><b>${esc(f.farda)}</b><span>Agasalho DAG: ${esc(f.dag.toLowerCase())}</span></div>
    ${f.extras.map((x) => `<small>${esc(x.texto)}</small>`).join('')}</div>`;
}
/** Licença do fim de semana: aparece de quinta até o retorno. */
function cartaoLicenca(agora) {
  const cfg = store.get().config;
  const itens = itensNoIntervalo(agora - DIA, agora + 9 * DIA).filter((i) => i.status === 'pendente').map((i) => ({ ...i, fim: fimEfetivo(i) }));
  const l = licencaDoFimDeSemana(itens, cfg.licenca, agora);
  if (!l || l.saida - agora > 2 * DIA + 6 * 3600000) return '';
  const quando = (ms) => `${DIAS_CURTOS[new Date(ms).getDay()].toLowerCase()} ${ddmm(ms)} ${hhmm(ms)}`;
  const fora = agora >= l.saida;
  const dl = (ms) => { const d = new Date(ms); return `${ymdL(ms)}T${hhmm(ms)}`; };
  if (ui.editLicenca === l.chave) return `<div class="licenca"><span class="lbl">Licença deste fim de semana</span>
    <div class="dupla"><div class="campo"><label class="lbl" for="lx-saida">Saída</label><input id="lx-saida" type="datetime-local" value="${dl(l.saida)}"></div>
      <div class="campo"><label class="lbl" for="lx-ret">Retorno</label><input id="lx-ret" type="datetime-local" value="${dl(l.retorno)}"></div></div>
    <div class="linha"><button class="btn pri" type="button" data-acao="lx-salvar" data-k="${l.chave}">Salvar</button><button class="btn" type="button" data-acao="lx-cancelar">Cancelar</button>
      ${l.excecao ? `<button class="btn link dir" type="button" data-acao="lx-padrao" data-k="${l.chave}">Voltar ao padrão</button>` : ''}</div>
    <small>Vale só para este fim de semana (feriado, licença estendida…).</small></div>`;
  return `<div class="licenca${l.livre ? '' : ' presa'}"><div class="linha"><span class="lbl">Licença do fim de semana${l.excecao ? ' · alterada' : ''}</span><button class="btn link dir" type="button" data-acao="lx-editar" data-k="${l.chave}">Alterar</button></div>
    ${l.livre ? `<b>${fora ? `Retorno até ${quando(l.retorno)}` : `Saída ${quando(l.saida)} · retorno ${quando(l.retorno)}`}</b>${fora ? `<small>faltam <span data-cd-fim="${l.retorno}">${contagem(l.retorno - agora)}</span></small>` : ''}`
      : `<b>Com compromisso no fim de semana</b>${l.bloqueios.map((b) => `<small>${esc(b)}</small>`).join('')}<small>Retorno (se sair): ${quando(l.retorno)}</small>`}
  </div>`;
}
function lembretesLicenca(de, ate) {
  const cfg = store.get().config;
  if (cfg.licenca?.ativo === false) return [];
  const itens = itensNoIntervalo(de - DIA, ate + 9 * DIA).filter((i) => i.status === 'pendente').map((i) => ({ ...i, fim: fimEfetivo(i) }));
  const out = [];
  for (let t = de; t <= ate + DIA; t += 7 * DIA) {
    const l = licencaDoFimDeSemana(itens, cfg.licenca, t);
    if (!l) break;
    const dispara = l.retorno - 3 * 3600000;
    if (dispara >= de && dispara <= ate && !out.some((x) => x.dispara === dispara)) out.push({ dispara, titulo: `Retorno à APMG até ${hhmm(l.retorno)}`, corpo: `${DIAS_CURTOS[new Date(l.retorno).getDay()]} ${ddmm(l.retorno)} · confira farda e material para a semana.`, chave: 'licenca', tag: `licenca:${ymdL(l.retorno)}`, critico: false });
  }
  return out;
}

/** Revista matinal no painel: aparece nos dias de revista, até 12h, enquanto não estiver pronta. */
function cartaoRevista(agora) {
  const cfg = store.get().config;
  const h = new Date(agora).getHours();
  if (!diaDeRevista(cfg, agora) || h >= 12 || !mesmoDia(ui.diaPainel, inicioDoDia(agora))) return '';
  const r = revistaDoDia(cfg, agora);
  if (r.feita) return '';
  return `<div class="revista" role="region" aria-label="Revista matinal">
    <div class="rev-cab"><span class="lbl">Revista matinal · ${configRevista(cfg).hora}</span><small>${r.ok.length}/${r.itens.length}</small></div>
    <div class="checklist">${r.itens.map((t, i) => `<label class="ck${r.ok.includes(i) ? ' ok' : ''}"><input type="checkbox" data-rev="${i}" ${r.ok.includes(i) ? 'checked' : ''}><span>${esc(t)}</span><span></span></label>`).join('')}</div>
    <button class="btn ouro" type="button" data-acao="revista-pronta">Alojamento pronto para a revista</button>
  </div>`;
}

/* ============ 3. vistas ============ */
function renderTopo(agora) {
  const { config } = store.get();
  $('#nome-cadete').textContent = config.nome || 'Cadete';
  const ext = dataPorExtenso(agora);
  $('#hoje').textContent = ext.charAt(0).toUpperCase() + ext.slice(1);
  // em serviço, o cartão grande do painel já mostra a contagem
  $('#contagem').hidden = ui.vista !== 'painel' || emServicoAgora(agora).length > 0;
  renderContagem(agora);
}

function renderContagem(agora) {
  const el = $('#contagem');
  if (el.hidden) return;
  const it = proximoCritico(agora);
  if (!it) {
    el.className = 'contagem';
    el.dataset.abrir = '';
    el.innerHTML = `<span class="lbl">Próximo compromisso</span><span class="t">Nada pendente pela frente</span><span class="m">Toque no botão dourado para lançar escala, prova ou trabalho.</span>`;
    return;
  }
  const tipo = SUBTIPOS[it.subtipo]?.rotulo || '';
  const andamento = !it.diaTodo && it.inicio <= agora && fimEfetivo(it) > agora;
  const falta = (andamento ? fimEfetivo(it) : it.inicio) - agora;
  const urgente = !andamento && !it.diaTodo && falta < 2 * 3600000;
  el.className = 'contagem' + (urgente ? ' urgente' : '');
  el.dataset.abrir = it.chave;
  el.innerHTML = `<span class="lbl">${andamento ? 'Em andamento' : 'Próximo'} · ${esc(tipo)}</span>
    <span class="t">${esc(it.titulo)}</span>
    <span class="cd"><b class="num">${it.diaTodo ? esc(rotuloDia(it.inicio, agora)) : contagem(falta)}</b>${it.diaTodo ? '' : `<span class="m">${andamento ? 'para terminar' : 'para começar'}</span>`}</span>
    <span class="m">${esc(rotuloDia(it.inicio, agora))}${it.diaTodo ? '' : ' às ' + hhmm(it.inicio)}${it.local ? ' · ' + esc(it.local) : ''}</span>`;
}

function renderPainel(agora) {
  const hoje = inicioDoDia(agora);
  if (ui.diaPainel < hoje) ui.diaPainel = hoje;
  const dia = ui.diaPainel;
  const doDia = itensNoIntervalo(dia.getTime(), somaDias(dia, 1).getTime());
  const pend = doDia.filter((i) => i.status === 'pendente');
  const atr = atrasadas(agora);
  const semana = Array.from({ length: 7 }, (_, i) => somaDias(hoje, i));
  const servicoNaSemana = new Set(itensNoIntervalo(hoje.getTime(), somaDias(hoje, 7).getTime())
    .filter((i) => SUBTIPOS_ESCALA.includes(i.subtipo)).flatMap((i) => [paraData(i.inicio)]));

  const avisos = [];
  if (!store.get().config.nome) avisos.push(`<div class="aviso"><p>Coloque seu nome para aparecer no topo do app.</p><button class="btn" type="button" data-ir="ajustes">Pôr meu nome</button></div>`);
  if (ui.instalar) avisos.push(`<div class="aviso"><p>Instale o app na tela inicial para abrir como aplicativo e usar offline.</p><button class="btn ouro" type="button" data-acao="instalar">Instalar</button></div>`);
  if ('Notification' in window && Notification.permission === 'default' && store.get().missoes.length + store.get().ciclos.length > 0)
    avisos.push(`<div class="aviso"><p>Ative os avisos para receber lembretes enquanto o app estiver aberto.</p><button class="btn" type="button" data-acao="notificar">Ativar avisos</button></div>`);
  const nAviso = avisoNovo();
  if (nAviso) avisos.push(`<div class="aviso mural-topo"><p><b>Aviso:</b> ${esc(nAviso.titulo)}</p><button class="btn" type="button" data-ir="turma">Ver mural</button></div>`);
  const recebidas = ui.turma.trocas.filter((t) => !t.enviada && t.status === 'pendente').length;
  if (recebidas) avisos.push(`<div class="aviso"><p>${recebidas === 1 ? 'Um colega pediu' : recebidas + ' pedidos de'} troca de serviço para você.</p><button class="btn pri" type="button" data-ir="turma">Responder</button></div>`);
  const cfgP = store.get().config;
  const confl = conflitosAgenda(itensNoIntervalo(agora - DIA, agora + 15 * DIA).map((i) => ({ ...i, fim: fimEfetivo(i) })), cfgP.qts || [], agora);
  if (confl.length) avisos.push(`<div class="aviso conflito"><p><b>Conflito${confl.length > 1 ? 's' : ''} na agenda</b></p>${confl.slice(0, 3).map((c) => `<button type="button" class="btn link" data-abrir="${esc(c.chaves[c.chaves.length - 1])}">${esc(rotuloDia(c.quando, agora))} ${hhmm(c.quando)} · ${esc(c.texto)}</button>`).join('')}${confl.length > 3 ? `<small>e mais ${confl.length - 3}</small>` : ''}</div>`);
  if (temNuvem() && ['sem-chave', 'chave-diferente'].includes(nuvem.statusNuvem().cofre))
    avisos.push(`<div class="aviso" style="border-color:var(--p-importante)"><p><b>Sincronização desligada neste aparelho.</b> O que você importa no PC ou no celular não passa para o outro até ligar.</p><button class="btn pri" type="button" data-ir="ajustes">Ligar agora</button></div>`);
  const alertaGel = alimentosEmAlerta(cfgP, agora);
  if (alertaGel.length) avisos.push(`<div class="aviso gel"><p><b>Geladeira:</b> ${alertaGel.slice(0, 3).map((a) => `${esc(a.item)} · ${ROTULO_ALIMENTO[a.estado].toLowerCase()}`).join('; ')}${alertaGel.length > 3 ? '…' : ''}</p><button class="btn" type="button" data-ir-rotina>Ver geladeira</button></div>`);
  if (store.falhouGravar()) avisos.push(`<div class="aviso" style="border-color:var(--danger)"><p>O navegador recusou salvar os dados. Libere espaço ou saia da navegação anônima e faça um backup em Ajustes.</p></div>`);

  // linha do tempo
  const porBloco = {};
  for (const it of doDia) (porBloco[blocoDe(it.inicio, it.diaTodo, dia)] ||= []).push(it);
  const linha = doDia.length
    ? BLOCOS.filter((b) => b.id !== 'diaTodo' || porBloco.diaTodo).map((b) => {
        const itens = porBloco[b.id] || [];
        return `<div class="bloco"><div class="trilho"><i class="${itens.length ? 'on' : ''}"></i><u></u></div>
          <div class="bloco-c"><div class="bloco-h"><span class="lbl">${b.rotulo}</span>${b.faixa ? `<small>${b.faixa}</small>` : ''}${itens.length ? '' : '<small>· Livre</small>'}</div>
          ${itens.map((i) => cartao(i, agora)).join('')}</div></div>`;
      }).join('')
    : `<div class="vazio">Nenhuma missão ${mesmoDia(dia, hoje) ? 'hoje' : 'neste dia'}. Toque no botão dourado para lançar.</div>`;

  const servicos = emServicoAgora(agora);
  $('#v-painel').innerHTML = `<div class="secao" style="gap:18px">
    ${servicos.map((i) => cartaoEmServico(i, agora)).join('')}
    ${cartaoAula(agora)}
    ${cartaoRevista(agora)}
    ${cartaoLicenca(agora)}
    ${avisos.join('')}
    <div class="resumo">
      <div><b class="num">${pend.length}</b><span>pendentes ${mesmoDia(dia, hoje) ? 'hoje' : esc(rotuloDia(dia.getTime(), agora).toLowerCase())}</span></div>
      <div><b class="num" style="color:var(--p-critico)">${pend.filter((i) => i.prioridade === 'critico').length}</b><span>críticas</span></div>
      <div><b class="num" style="color:${atr.length ? 'var(--danger)' : 'var(--muted)'}">${atr.length}</b><span>atrasadas</span></div>
    </div>
    ${atr.length ? `<div class="secao"><h2 class="lbl" style="color:var(--danger)">Atrasadas · conclua ou ajuste</h2>${atr.slice(0, 5).map((i) => cartao(i, agora, { mostrarDia: true })).join('')}</div>` : ''}
    <div class="semana" role="group" aria-label="Escolher dia">
      ${semana.map((d) => `<button type="button" data-diapainel="${d.getTime()}" aria-pressed="${mesmoDia(d, dia)}">
        <span>${mesmoDia(d, hoje) ? 'HOJE' : DIAS_CURTOS[d.getDay()].toUpperCase()}</span><b class="num">${d.getDate()}</b>
        ${servicoNaSemana.has(paraData(d.getTime())) ? '<i class="pt" title="Dia de serviço"></i>' : '<i class="pt" style="visibility:hidden"></i>'}</button>`).join('')}
    </div>
    ${cartaoFarda(dia, agora)}
    <div class="secao"><h2 class="lbl">Linha do tempo · ${esc(rotuloDia(dia.getTime(), agora))}</h2>${linha}</div>
  </div>`;
}

function renderEscalas(agora) {
  const e = ui.esc;
  if (e.todos) return renderTodos(agora);
  const dias = e.modo === 'mes' ? gradeDoMes(e.ref.getFullYear(), e.ref.getMonth()) : semanaDe(e.ref);
  const de = dias[0].getTime(), ate = somaDias(dias[dias.length - 1], 1).getTime();
  const itens = itensNoIntervalo(de, ate, { incluirPulados: true });
  const mapa = new Map();
  for (const it of itens) {
    for (let d = inicioDoDia(Math.max(it.inicio, de)); d.getTime() <= Math.min(fimEfetivo(it), ate - 1); d = somaDias(d, 1)) {
      const k = paraData(d.getTime());
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(it);
    }
  }
  const hoje = inicioDoDia(agora);
  let diasServico = 0;
  const celulas = dias.map((d) => {
    const k = paraData(d.getTime());
    const lista = (mapa.get(k) || []).filter((i) => i.status !== 'pulado');
    const servico = lista.some((i) => SUBTIPOS_ESCALA.includes(i.subtipo));
    const fora = e.modo === 'mes' && d.getMonth() !== e.ref.getMonth();
    if (servico && !fora) diasServico++;
    const cats = [...new Set(lista.filter((i) => !SUBTIPOS_ESCALA.includes(i.subtipo)).map((i) => i.categoria))];
    return `<button type="button" class="dia${servico ? ' servico' : ''}${fora ? ' fora' : ''}${mesmoDia(d, hoje) ? ' hoje' : ''}" data-diaesc="${d.getTime()}" aria-pressed="${mesmoDia(d, e.sel)}"
      aria-label="${d.getDate()} de ${MESES[d.getMonth()]}${servico ? ', dia de serviço' : ''}${lista.length ? ', ' + lista.length + ' missões' : ''}">
      <span class="n">${d.getDate()}</span><span class="pts">${servico ? `<i class="barra" style="--cor:var(--c-operacional)"></i>` : ''}${cats.map((c) => `<i style="--cor:${corCat(c)}"></i>`).join('')}</span></button>`;
  }).join('');

  const doDia = (mapa.get(paraData(e.sel.getTime())) || []).sort((a, b) => a.inicio - b.inicio);
  const { ciclos } = store.get();
  const titulo = e.modo === 'mes' ? `${MESES[e.ref.getMonth()]} ${e.ref.getFullYear()}` : `Semana de ${ddmm(dias[0].getTime())}`;

  $('#v-escalas').innerHTML = `<div class="secao" style="gap:14px">
    <div class="cal-cab"><button type="button" data-nav="-1" aria-label="Anterior">‹</button><h2>${titulo}</h2><button type="button" data-nav="1" aria-label="Próximo">›</button></div>
    <div class="linha">
      ${chip({ rotulo: 'Mês', ativo: e.modo === 'mes', dados: 'data-modo="mes"', peq: true })}
      ${chip({ rotulo: 'Semana', ativo: e.modo === 'semana', dados: 'data-modo="semana"', peq: true })}
      ${chip({ rotulo: 'Hoje', ativo: false, dados: 'data-modo="hoje"', peq: true })}
      ${chip({ rotulo: 'Todos', ativo: false, dados: 'data-acao="esc-todos"', peq: true })}
      <span class="dir it-m"><b style="color:var(--c-operacional)" class="num">${diasServico}</b> dia${diasServico === 1 ? '' : 's'} de serviço</span>
    </div>
    <div class="cal${e.modo === 'semana' ? ' semanal' : ''}">${DIAS_CURTOS.map((d) => `<span class="dow">${d}</span>`).join('')}${celulas}</div>
    <div class="legenda"><span><i class="barra" style="--cor:var(--c-operacional)"></i>Serviço / estágio</span>${['academico', 'rotina', 'administrativo', 'pessoal'].map((c) => `<span><i style="--cor:${corCat(c)}"></i>${CATEGORIAS[c].rotulo}</span>`).join('')}</div>
    <div class="secao"><h2 class="lbl">${esc(rotuloDia(e.sel.getTime(), agora))} <small>${doDia.length ? doDia.length + ' missão' + (doDia.length > 1 ? 'ões' : '') : 'livre'}</small></h2>
      ${doDia.map((i) => cartao(i, agora)).join('')}
      <button class="btn" type="button" data-acao="missao-no-dia">+ Missão neste dia</button>
    </div>
    <div class="secao"><h2 class="lbl">Ciclos de escala <small>rodízios que se repetem</small></h2>
      ${ciclos.length ? ciclos.map((c) => {
        const prox = plantoesDoCiclo(c, agora, agora + 120 * DIA).find((p) => p.status === 'pendente');
        return `<button type="button" class="ciclo-card" data-ciclo="${esc(c.id)}">
          <span class="padrao">${c.duracaoMin / 60}×${(c.periodoMin - c.duracaoMin) / 60}${c.ativo ? '' : ' · pausado'}</span>
          <b>${esc(c.titulo)}</b>
          <span class="it-m">${prox ? `Próximo: ${esc(rotuloDia(prox.inicio, agora))} às ${hhmm(prox.inicio)}` : 'Sem plantões futuros'}${c.local ? ' · ' + esc(c.local) : ''}</span></button>`;
      }).join('') : '<div class="vazio">Cadastre seu rodízio (24×72, 12×36…) e os plantões aparecem sozinhos no calendário.</div>'}
      <button class="btn pri" type="button" data-acao="novo-ciclo">+ Novo ciclo de escala</button>
    </div>
  </div>`;
}

const chipsMissoes = (f) => `<div class="chips">
      ${chip({ rotulo: 'Pendentes', ativo: f.status === 'pendente', dados: 'data-mstatus="pendente"' })}
      ${chip({ rotulo: 'Concluídas', ativo: f.status === 'concluida', dados: 'data-mstatus="concluida"' })}
      ${chip({ rotulo: 'Horas', ativo: f.status === 'horas', dados: 'data-mstatus="horas"' })}
      ${chip({ rotulo: 'Notas', ativo: f.status === 'notas', dados: 'data-mstatus="notas"' })}
      ${chip({ rotulo: 'Rotina', ativo: f.status === 'rotina', dados: 'data-mstatus="rotina"' })}
    </div>`;

function renderHoras(agora) {
  const r = ui.rel;
  const ano = r.ref.getFullYear(), mes = r.ref.getMonth();
  const de = r.modo === 'mes' ? new Date(ano, mes, 1) : new Date(ano, 0, 1);
  const ate = r.modo === 'mes' ? new Date(ano, mes + 1, 1) : new Date(ano + 1, 0, 1);
  // conta cada serviço pelo dia em que começou
  const itens = itensNoIntervalo(de.getTime() - 3 * DIA, ate.getTime(), { incluirPulados: true }).filter((i) => i.inicio >= de.getTime() && i.inicio < ate.getTime());
  const rel = relatorioHoras(itens, agora);
  let anterior = null;
  if (r.modo === 'mes') {
    const de2 = new Date(ano, mes - 1, 1), ate2 = new Date(ano, mes, 1);
    anterior = relatorioHoras(itensNoIntervalo(de2.getTime() - 3 * DIA, ate2.getTime(), { incluirPulados: true }).filter((i) => i.inicio >= de2.getTime() && i.inicio < ate2.getTime()), agora);
  }
  const titulo = r.modo === 'mes' ? `${MESES[mes]} ${ano}` : `Ano de ${ano}`;
  const h = (x) => (Math.round(x * 10) / 10).toLocaleString('pt-BR');
  const futuros = itens.filter((i) => SUBTIPOS_ESCALA.includes(i.subtipo) && i.status === 'pendente' && fimEfetivo(i) > agora).length;
  ui.relTexto = textoRelatorio(`Relatório de serviços · ${titulo}${store.get().config.nome ? ' · ' + store.get().config.nome : ''}`, rel);
  $('#v-missoes').innerHTML = `<div class="secao" style="gap:14px">
    <h2 class="titulo-vista">Missões</h2>
    ${chipsMissoes(ui.mis)}
    <div class="cal-cab"><button type="button" data-relnav="-1" aria-label="Anterior">‹</button><h2>${titulo}</h2><button type="button" data-relnav="1" aria-label="Próximo">›</button></div>
    <div class="linha">${chip({ rotulo: 'Mês', ativo: r.modo === 'mes', dados: 'data-relmodo="mes"', peq: true })}${chip({ rotulo: 'Ano', ativo: r.modo === 'ano', dados: 'data-relmodo="ano"', peq: true })}</div>
    <div class="cartoes-n">
      <div><b class="num">${rel.total.qtd}</b><span>serviços cumpridos</span></div>
      <div><b class="num">${h(rel.total.horas)}</b><span>horas de serviço</span></div>
      <div><b class="num">${rel.sobreaviso.qtd}</b><span>sobreavisos</span></div>
    </div>
    ${rel.linhas.length ? `<table class="tabela"><thead><tr><th>Tipo</th><th class="n">Qtd.</th><th class="n">Horas</th></tr></thead><tbody>
      ${rel.linhas.map((l) => `<tr><td>${esc(l.rotulo)}</td><td class="n">${l.qtd}</td><td class="n">${h(l.horas)}</td></tr>`).join('')}
      ${rel.sobreaviso.qtd ? `<tr><td>Sobreaviso <small class="cinza">(à parte)</small></td><td class="n">${rel.sobreaviso.qtd}</td><td class="n">${h(rel.sobreaviso.horas)}</td></tr>` : ''}
      <tr class="total"><td>Total de serviço</td><td class="n">${rel.total.qtd}</td><td class="n">${h(rel.total.horas)}</td></tr></tbody></table>`
      : `<div class="vazio">Nenhum serviço cumprido em ${esc(titulo.toLowerCase())}.</div>`}
    ${rel.equilibrio ? `<div class="secao"><h2 class="lbl">Equilíbrio da escala</h2>
      <div class="cartoes-n">
        <div><b class="num">${rel.equilibrio.guardas}</b><span>guardas</span></div>
        <div><b class="num">${rel.equilibrio.estagios}</b><span>estágios CPU</span></div>
        <div><b class="num">${h(rel.equilibrio.mediaFolga)}</b><span>horas de folga em média</span></div>
      </div>
      <p class="dica">Menor folga entre dois serviços: <b>${h(rel.equilibrio.menorFolga)} h</b>${rel.equilibrio.seguidos ? ` · <span style="color:var(--danger)">${rel.equilibrio.seguidos} vez${rel.equilibrio.seguidos > 1 ? 'es' : ''} com menos de 24 h de folga</span>` : ' · nenhuma folga menor que 24 h'}.${anterior ? ` Mês anterior: ${anterior.total.qtd} serviços (${h(anterior.total.horas)} h).` : ''}</p></div>` : ''}
    ${r.modo === 'mes' ? (() => { const eq = equilibrioTurma(listarDocs(ui.conta?.uid), store.get().config, ano, mes); if (!eq) return '';
      const cor = eq.meu > eq.media + 1 ? 'var(--danger)' : eq.meu < eq.media - 1 ? 'var(--ok)' : 'var(--fg)';
      return `<div class="secao"><h2 class="lbl">Você na turma <small>escala completa · todos os ${esc(eq.grad)} · ${eq.n} cadetes</small></h2>
        <div class="cartoes-n"><div><b class="num" style="color:${cor}">${eq.meu}</b><span>seus serviços</span></div>
          <div><b class="num">${h(eq.media)}</b><span>média da turma</span></div>
          <div><b class="num">${eq.min}–${eq.max}</b><span>menor e maior</span></div></div>
        <p class="dica">Pela escala do mês (sem contar sobreaviso). Você é o ${eq.posicao}º mais escalado${eq.meu > eq.media + 1 ? ' — acima da média, vale conversar com o escalante ou priorizar trocas' : eq.meu < eq.media - 1 ? ' — abaixo da média' : ' — dentro da média'}.</p></div>`; })() : ''}
    <p class="dica">Conta os serviços já terminados (ou marcados como cumpridos), exceto os trocados/dispensados. ${rel.rotina.qtd ? `Missões de rotina: <b>${rel.rotina.qtd}</b>. ` : ''}${futuros ? `Ainda previstos no período: <b>${futuros}</b>.` : ''}</p>
    ${rel.total.qtd || rel.sobreaviso.qtd ? '<button class="btn pri" type="button" data-acao="compartilhar-rel">Compartilhar relatório</button>' : ''}
  </div>`;
}

function renderNotas() {
  const { missoes, config } = store.get();
  const minima = +(config.mediaMinima ?? 7);
  const discs = mediasAcademicas(missoes, minima);
  const geral = mediaGeral(discs);
  const fmt = (x) => (x == null ? '–' : (Math.round(x * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
  const sit = {
    'garantida': ['var(--ok)', 'Média mínima já garantida'],
    'em-aberto': ['var(--p-importante)', ''],
    'impossivel': ['var(--danger)', 'Mesmo com 10 nas restantes não alcança a mínima'],
    'aprovado': ['var(--ok)', 'Acima da média mínima'],
    'abaixo': ['var(--danger)', 'Abaixo da média mínima'],
    'sem-notas': ['var(--muted)', 'Lance as notas quando saírem'],
  };
  $('#v-missoes').innerHTML = `<div class="secao" style="gap:14px">
    <h2 class="titulo-vista">Missões</h2>
    ${chipsMissoes(ui.mis)}
    <div class="linha"><label class="lbl" for="nt-min">Média mínima</label><div class="campo" style="width:90px"><input id="nt-min" type="number" min="0" max="10" step="0.5" inputmode="decimal" value="${esc(minima)}"></div>
      <button class="btn pri dir" type="button" data-acao="nova-prova">+ Prova ou trabalho</button></div>
    ${discs.length ? `<div class="cartoes-n">
      <div><b class="num" style="color:${geral.media == null ? 'var(--muted)' : geral.media >= minima ? 'var(--ok)' : 'var(--danger)'}">${fmt(geral.media)}</b><span>média geral</span></div>
      <div><b class="num">${geral.finalizadas}</b><span>matérias finalizadas</span></div>
      <div><b class="num">${geral.total - geral.finalizadas}</b><span>em andamento</span></div></div>
      <p class="dica">Média geral = soma das médias das matérias finalizadas ÷ quantidade de matérias finalizadas. A média de cada matéria usa o peso de cada avaliação.</p>` : ''}
    ${discs.length ? discs.map((d) => {
      const [cor, txt] = sit[d.situacao];
      const so1 = d.proxima && d.pesosFaltam === d.proxima.peso;
      const msg = d.situacao === 'em-aberto'
        ? `${so1 ? 'Na próxima' : 'Na próxima (e nas demais)'} — <b>${esc(d.proxima.titulo)}</b>, ${ddmm(d.proxima.inicio)}, peso ${fmt(d.proxima.peso)} — precisa tirar pelo menos <b>${fmt(d.precisa)}</b> para fechar com ${fmt(minima)}.`
        : d.situacao === 'garantida' && d.proxima ? `${txt}: mesmo tirando 0 em ${esc(d.proxima.titulo)} a média fica acima de ${fmt(minima)}.`
        : d.situacao === 'impossivel' && d.proxima ? `${txt} (precisaria de ${fmt(d.precisa)} em ${esc(d.proxima.titulo)}).` : txt;
      return `<div class="disc" style="--cor:${cor}">
        <div class="disc-cab"><b>${esc(d.disciplina)}</b><span class="disc-media" style="color:${cor}">${fmt(d.media)}</span></div>
        ${d.avaliacoes.map((a) => `<button type="button" class="disc-av" data-abrir="${esc(a.id)}"><b>${esc(a.titulo)}</b><span>${ddmm(a.inicio)} · peso ${fmt(a.peso)}</span><span class="num">${a.nota == null ? '—' : fmt(a.nota)}</span></button>`).join('')}
        <p style="color:${cor}">${msg}</p></div>`;
    }).join('') : '<div class="vazio">Lance provas e trabalhos com a disciplina, o peso e a nota para ver as médias e quanto falta para passar.</div>'}
    ${blocoDisciplina(config)}
  </div>`;
}

/** Rotina do alojamento: revista matinal, geladeira e prazo do relatório de estágio. */
function renderRotina(agora) {
  const cfg = store.get().config;
  const r = configRevista(cfg);
  const gel = [...(cfg.geladeira || [])].map((a) => ({ ...a, ...situacaoAlimento(a.validade, agora) })).sort((a, b) => a.dias - b.dias);
  const cor = { vencido: 'var(--danger)', hoje: 'var(--danger)', amanha: 'var(--p-importante)', logo: 'var(--p-importante)', ok: 'var(--ok)' };
  const prazo = cfg.prazoRelatorioHoras ?? PRAZO_RELATORIO_PADRAO;
  $('#v-missoes').innerHTML = `<div class="secao" style="gap:14px">
    <h2 class="titulo-vista">Missões</h2>
    ${chipsMissoes(ui.mis)}

    <div class="ajuste"><h3>Revista matinal</h3>
      <p>Checklist no painel nos dias de revista e um aviso no horário. Os itens vêm das AAD mais comuns nas planilhas.</p>
      <label class="linha"><input type="checkbox" id="rv-ativo" ${r.ativo ? 'checked' : ''}> <span>Ligada</span></label>
      <div class="dupla"><div class="campo"><label class="lbl" for="rv-hora">Horário do aviso</label><input id="rv-hora" type="time" value="${esc(r.hora)}"></div>
        <div class="campo"><span class="lbl">Dias</span><div class="dias-rev">${DIAS_CURTOS.map((d, i) => `<label><input type="checkbox" data-rvdia="${i}" ${r.dias.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></div></div>
      <div class="imp-lista">${r.itens.map((t, i) => `<div class="imp-item anot"><span>${esc(t)}</span><button class="btn link" type="button" data-rvrm="${i}" aria-label="Remover item">${svgLixo}</button></div>`).join('')}</div>
      <div class="linha"><div class="campo" style="flex:1"><input id="rv-novo" placeholder="Novo item (ex.: coturno engraxado)"></div><button class="btn" type="button" data-acao="rv-add">Adicionar</button></div>
      <div class="linha"><button class="btn pri" type="button" data-acao="rv-salvar">Salvar revista</button>${cfg.revista?.itens?.length ? '<button class="btn link dir" type="button" data-acao="rv-padrao">Voltar aos itens padrão</button>' : ''}</div>
    </div>

    <div class="ajuste"><h3>Resumo da noite</h3>
      <p>Um aviso só com o dia seguinte: aulas do QTS, serviços e missões, revista, geladeira e o que falta separar no checklist.</p>
      <div class="linha"><label class="linha"><input type="checkbox" id="rs-ativo" ${(cfg.resumo?.ativo ?? true) ? 'checked' : ''}> <span>Ligado</span></label>
        <div class="campo" style="width:120px"><label class="lbl" for="rs-hora">Horário</label><input id="rs-hora" type="time" value="${esc(cfg.resumo?.hora || '21:00')}"></div>
        <button class="btn pri" type="button" data-acao="rs-salvar" style="align-self:flex-end">Salvar</button></div>
      ${(() => { const r = resumoDoDia(ymdR(agora + DIA)); return r ? `<p class="dica"><b>Prévia:</b> ${esc(r.titulo)} — ${esc(r.corpo)}</p>` : '<p class="dica">Prévia: nada para amanhã ainda.</p>'; })()}
    </div>

    <div class="ajuste"><h3>Licença do fim de semana</h3>
      <p>Cartão no Painel de quinta até o retorno (avisa se houver serviço, MCE ou LC no fim de semana) e aviso 3 h antes do retorno.</p>
      ${(() => { const l = { ...LICENCA_PADRAO, ...(cfg.licenca || {}) }; const dia = (id, v) => `<select id="${id}">${DIAS_CURTOS.map((d, i) => `<option value="${i}"${i === +v ? ' selected' : ''}>${d}</option>`).join('')}</select>`;
        return `<label class="linha"><input type="checkbox" id="lc-ativo" ${l.ativo === false ? '' : 'checked'}> <span>Ligado</span></label>
        <div class="dupla"><div class="campo"><span class="lbl">Saída</span><div class="linha">${dia('lc-sdia', l.saidaDia)}<input id="lc-shora" type="time" value="${esc(l.saidaHora)}"></div></div>
          <div class="campo"><span class="lbl">Retorno</span><div class="linha">${dia('lc-rdia', l.retornoDia)}<input id="lc-rhora" type="time" value="${esc(l.retornoHora)}"></div></div></div>`; })()}
      <button class="btn pri" type="button" data-acao="lc-salvar">Salvar licença</button>
      <p class="dica">Ajuste para os horários que valem na EsFO.</p>
    </div>

    <div class="ajuste"><h3>Geladeira</h3>
      <p>Avisa na véspera e no dia do vencimento, e na quinta-feira (conferência da Copa) lista o que é seu.</p>
      <div class="dupla"><div class="campo"><label class="lbl" for="gl-item">Alimento</label><input id="gl-item" placeholder="Ex.: iogurte"></div>
        <div class="campo"><label class="lbl" for="gl-val">Validade</label><input id="gl-val" type="date" value="${ymdR(agora + 3 * DIA)}"></div></div>
      <button class="btn pri" type="button" data-acao="gl-add">Guardar na lista</button>
      ${gel.length ? `<div class="imp-lista">${gel.map((a) => `<div class="imp-item anot" style="border-left-color:${cor[a.estado]}"><span><b>${esc(a.item)}</b><small>${ddmm(new Date(a.validade + 'T12:00').getTime())} · <span style="color:${cor[a.estado]}">${ROTULO_ALIMENTO[a.estado]}${a.estado === 'logo' || a.estado === 'ok' ? ` (${a.dias} dias)` : ''}</span></small></span><button class="btn link" type="button" data-glrm="${esc(a.id)}" aria-label="Tirar da lista">${svgLixo}</button></div>`).join('')}</div>`
        : '<div class="vazio">Nada na lista. Ao guardar algo na geladeira, anote aqui a validade.</div>'}
    </div>

    <div class="ajuste"><h3>Relatório do estágio CPU</h3>
      <p>Depois de cada estágio, o app cria sozinho o prazo do relatório (redigir, assinar e entregar).</p>
      <div class="linha"><div class="campo" style="width:120px"><label class="lbl" for="rl-horas">Prazo (horas)</label><input id="rl-horas" type="number" min="0" step="1" inputmode="numeric" value="${esc(prazo)}"></div>
        <button class="btn pri" type="button" data-acao="rl-salvar" style="align-self:flex-end">Salvar prazo</button></div>
      <p class="dica">Use 0 para desligar. Conta a partir do fim do estágio.</p>
    </div>
  </div>`;
}

/** Cria o prazo do relatório para estágios novos (uma vez por estágio). */
function aplicarRelatorios() {
  const cfg = store.get().config;
  const novos = relatoriosACriar(store.get().missoes, cfg);
  if (!novos.length) return;
  store.salvarMissoes(novos);
  store.setConfig({ relatoriosCriados: [...(cfg.relatoriosCriados || []), ...novos.map((m) => m.origemEstagio)].slice(-200) });
}

/** Histórico disciplinar (FO+, AAD e MCE) importado da Planilha de Anotados e da NAMCE. */
function blocoDisciplina(config) {
  const regs = [...(config.disciplina || [])].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const pos = regs.filter((r) => r.tipo === 'FO+').length, neg = regs.length - pos;
  const missoesMce = store.get().missoes.filter((m) => m.subtipo === 'mce' && m.id.startsWith('doc-mce-') && m.status !== 'pulado');
  const mceDoRegistro = (r) => { const num = (r.doc.match(/NAMCE\s+(.*)/) || [])[1]; if (!num || !r.mce) return [];
    const cods = r.mce.split('+').map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '')); const pref = `doc-mce-${num.replace(/[^0-9a-z]/gi, '').toLowerCase()}-`;
    return missoesMce.filter((m) => m.id.startsWith(pref) && cods.includes(m.id.slice(pref.length))); };
  const mcePagas = { total: missoesMce.length, feitas: missoesMce.filter((m) => m.status === 'concluida').length };
  return `<div class="secao"><h2 class="lbl">Disciplina</h2>
    ${regs.length ? `<div class="cartoes-n">
      <div><b class="num" style="color:var(--ok)">${pos}</b><span>FO+</span></div>
      <div><b class="num" style="color:${neg ? 'var(--danger)' : 'var(--muted)'}">${neg}</b><span>AAD</span></div>
      <div><b class="num">${mcePagas.feitas}/${mcePagas.total}</b><span>MCE cumpridas</span></div></div>
      <div class="imp-lista">${regs.map((r) => `<div class="imp-item anot ${r.tipo === 'FO+' ? 'pos' : 'neg'}"><span><b>${esc(r.tipo)} · ${esc((r.data || '').split('-').reverse().join('/'))}</b> ${esc(r.texto)}
        <small>${esc(r.doc)}${r.anotador ? ' · ' + esc(r.anotador) : ''}${r.mce && !mceDoRegistro(r).length ? ' · MCE: ' + esc(r.mce) : ''}</small>
        ${mceDoRegistro(r).length ? `<span class="mce-st">${mceDoRegistro(r).map((m) => `<button type="button" class="chip peq${m.status === 'concluida' ? ' feito' : ''}" data-check="${esc(m.id)}" aria-pressed="${m.status === 'concluida'}">${esc(m.detalhe || m.titulo)} · ${m.status === 'concluida' ? 'cumprida ✓' : 'pendente'}</button>`).join('')}</span>` : ''}</span>
        <button class="btn link" type="button" data-disc-rm="${esc(r.id)}" aria-label="Remover">${svgLixo}</button></div>`).join('')}</div>`
      : '<div class="vazio">Importe a Planilha de Anotados ou a NAMCE (botão dourado › PDF) para guardar aqui seus FO+, AAD e MCE.</div>'}
  </div>`;
}

function renderMissoes(agora) {
  const f = ui.mis;
  if (f.status === 'horas') return renderHoras(agora);
  if (f.status === 'notas') return renderNotas();
  if (f.status === 'rotina') return renderRotina(agora);
  let lista = f.status === 'pendente'
    ? itensNoIntervalo(agora - 30 * DIA, agora + 90 * DIA).filter((i) => i.status === 'pendente')
    : itensNoIntervalo(agora - 120 * DIA, agora + 365 * DIA).filter((i) => i.status === 'concluida').reverse();
  if (f.cat !== 'todas') lista = lista.filter((i) => i.categoria === f.cat);
  if (f.busca.trim()) {
    const q = f.busca.trim().toLowerCase();
    lista = lista.filter((i) => (i.titulo + ' ' + (i.local || '') + ' ' + (i.obs || '')).toLowerCase().includes(q));
  }
  const concluidas = f.status === 'concluida';
  // agrupa por dia
  const grupos = [];
  for (const it of lista) {
    const atras = f.status === 'pendente' && fimEfetivo(it) < agora;
    const k = atras ? 'Atrasadas' : rotuloDia(it.inicio, agora);
    let g = grupos.find((x) => x.k === k);
    if (!g) grupos.push((g = { k, itens: [], atras }));
    g.itens.push(it);
  }
  $('#v-missoes').innerHTML = `<div class="secao" style="gap:14px">
    <h2 class="titulo-vista">Missões</h2>
    ${chipsMissoes(f)}
    <div class="chips rolar">
      ${chip({ rotulo: 'Todas', ativo: f.cat === 'todas', dados: 'data-mcat="todas"', peq: true })}
      ${Object.keys(CATEGORIAS).map((c) => chip({ rotulo: CATEGORIAS[c].rotulo, cor: corCat(c), ativo: f.cat === c, dados: `data-mcat="${c}"`, peq: true })).join('')}
    </div>
    <div class="campo"><input type="search" id="m-busca" placeholder="Buscar por título, local ou observação" value="${esc(f.busca)}" aria-label="Buscar missões"></div>
    ${concluidas && lista.length ? (ui.confirmarLimpar
      ? `<div class="confirmar"><span>Remover ${lista.length === 1 ? 'a missão concluída' : `as ${lista.length} missões concluídas`}${f.cat !== 'todas' || f.busca.trim() ? ' deste filtro' : ''} do histórico?</span>
          <button class="btn" type="button" data-acao="limpar-nao">Cancelar</button><button class="btn perigo" type="button" data-acao="limpar-sim" data-chaves="${esc(lista.map((i) => i.chave).join('|'))}">Remover</button></div>`
      : `<div class="linha"><span class="it-m">${lista.length} concluída${lista.length === 1 ? '' : 's'}${f.cat !== 'todas' || f.busca.trim() ? ' neste filtro' : ''}</span><button class="btn perigo dir" type="button" data-acao="limpar-pedir">Limpar histórico</button></div>`) : ''}
    ${grupos.length ? grupos.map((g) => `<div class="secao"><h2 class="lbl"${g.atras ? ' style="color:var(--danger)"' : ''}>${esc(g.k)}</h2>${g.itens.map((i) => cartao(i, agora, { mostrarDia: g.atras, remover: concluidas })).join('')}</div>`).join('')
      : `<div class="vazio">${f.status === 'pendente' ? 'Nenhuma missão pendente com esses filtros.' : 'Nenhuma missão concluída ainda.'}</div>`}
  </div>`;
}

function blocoSinc() {
  const st = nuvem.statusNuvem();
  const quando = st.ultimaSinc ? `${rotuloDia(st.ultimaSinc)} às ${hhmm(st.ultimaSinc)}` : 'nunca';
  let corpo;
  if (st.cofre === 'sem-chave') corpo = `<p>Para guardar uma cópia <b>criptografada</b> e usar a mesma agenda em outro celular, confirme a senha da sua conta. A chave nasce da senha e fica só nos seus aparelhos: nem o administrador consegue ler.</p>
      <div class="campo"><label class="lbl" for="aj-senha">Senha da conta</label><input id="aj-senha" type="password" autocomplete="current-password"></div>
      ${ui.senhaErro ? `<p class="erro">${esc(ui.senhaErro)}</p>` : ''}
      <button class="btn pri" type="button" data-acao="ativar-sinc">Ativar sincronização</button>`;
  else if (st.cofre === 'chave-diferente') corpo = `<p class="erro">A cópia na nuvem foi criada com outra senha (por exemplo, antes de redefinir a senha) e não pode ser aberta.</p>
      <p>Você pode substituí-la pela agenda deste aparelho. A cópia antiga será apagada.</p>
      <button class="btn perigo" type="button" data-acao="substituir-cofre">Usar a agenda deste aparelho</button>`;
  else corpo = `<p>${st.cofre === 'ok' ? '<span class="ok-txt">Ligada.</span> ' : st.cofre === 'offline' ? 'Sem internet agora; sincroniza quando voltar. ' : st.cofre === 'erro' ? `<span class="erro">Falhou (${esc(st.erro)}).</span> ` : ''}Última sincronização: ${esc(quando)}. Entre com a mesma conta em outro aparelho e a agenda aparece lá. A cópia é criptografada com a sua senha.</p>
      <button class="btn" type="button" data-acao="sincronizar">Sincronizar agora</button>`;
  return `<div class="ajuste"><h3>Sincronização entre aparelhos</h3>${corpo}</div>`;
}
function blocoPush() {
  const ativo = nuvem.pushAtivo();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<div class="ajuste"><h3>Avisos com o app fechado</h3>
    <p>Recebe os lembretes mesmo com o app fechado (precisa de internet no momento do aviso). O texto do aviso vai criptografado: só este aparelho abre.</p>
    ${ios && !instalado ? '<p>No iPhone, instale o app na tela de início primeiro (Compartilhar → Adicionar à Tela de Início) e ative por lá.</p>' : ''}
    ${ativo ? '<p class="ok-txt">Ligado neste aparelho.</p><div class="linha"><button class="btn" type="button" data-acao="testar-aviso">Testar aviso</button><button class="btn perigo" type="button" data-acao="desligar-push">Desligar</button></div>'
      : '<button class="btn ouro" type="button" data-acao="ligar-push">Ligar avisos com o app fechado</button>'}</div>`;
}
function blocoGcal() {
  if (!gcalConfigurado()) return '';
  const k = `agenda-cadete:gcal:${ui.conta?.uid || 'local'}`;
  let info = null; try { info = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
  return `<div class="ajuste"><h3>Google Agenda</h3>
    <p>Copia as missões dos próximos 60 dias para o seu Google Agenda (com os mesmos lembretes). Rodar de novo atualiza o que mudou e apaga o que saiu.</p>
    ${info?.em ? `<p>Última vez: ${esc(rotuloDia(info.em))} às ${hhmm(info.em)} · ${info.ids?.length || 0} eventos.</p>` : ''}
    <div class="linha"><button class="btn pri" type="button" data-acao="gcal-sinc">Sincronizar com o Google Agenda</button>${info ? '<button class="btn link" type="button" data-acao="gcal-sair">Desconectar</button>' : ''}</div></div>`;
}

function renderAjustes() {
  const { config, missoes, ciclos } = store.get();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const perm = 'Notification' in window ? Notification.permission : 'indisponivel';
  const contatos = config.contatos || [];
  $('#v-ajustes').innerHTML = `<div class="secao" style="gap:14px">
    <h2 class="titulo-vista">Ajustes</h2>
    <div class="ajuste"><h3>Nome no topo</h3>
      <div class="campo"><input id="aj-nome" value="${esc(config.nome)}" aria-label="Nome exibido no topo"></div>
      <button class="btn pri" type="button" data-acao="salvar-nome">Salvar nome</button></div>
    <div class="ajuste"><h3>Seus nomes nas escalas</h3>
      <p>Usados para achar os seus serviços ao importar uma escala em PDF.</p>
      <div class="campo"><label class="lbl" for="aj-ncompleto">Nome completo (Serviço Interno)</label><input id="aj-ncompleto" value="${esc(config.nomeCompleto || '')}" autocomplete="name"></div>
      <div class="campo"><label class="lbl" for="aj-nguerra">Nome de guerra (Escala da Rotina)</label><input id="aj-nguerra" value="${esc(config.nomeGuerra || '')}"></div>
      <div class="campo"><label class="lbl" for="aj-fard">Fardamento padrão da guarda e do estágio</label><input id="aj-fard" placeholder="Ex.: 4º A" value="${esc(config.fardamentoPadrao || '')}"></div>
      <p>Usado no aviso da véspera ("Amanhã: guarda 07h. Separou o 4º A?") quando o serviço não tem fardamento próprio.</p>
      <div class="linha"><button class="btn pri" type="button" data-acao="salvar-nomes">Salvar</button><button class="btn" type="button" data-acao="importar-pdf">Importar escala em PDF</button></div></div>
    <div class="ajuste"><h3>Contatos do serviço</h3>
      <p>Aparecem no modo "Em serviço" para ligar com um toque (Cmt. da Guarda, Oficial de Dia, Dia-à-EsFO…).</p>
      ${contatos.map((c, i) => `<div class="adm-item"><span><b>${esc(c.nome)}</b> · ${esc(c.tel)}</span><button class="btn link" type="button" data-contato-rm="${i}">Remover</button></div>`).join('')}
      <div class="dupla"><div class="campo"><label class="lbl" for="aj-ct-nome">Nome / função</label><input id="aj-ct-nome"></div>
        <div class="campo"><label class="lbl" for="aj-ct-tel">Telefone</label><input id="aj-ct-tel" type="tel" inputmode="tel"></div></div>
      <button class="btn" type="button" data-acao="add-contato">Adicionar contato</button></div>
    <div class="ajuste"><h3>Aparência</h3>
      <div class="chips">${[['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']].map(([v, r]) => chip({ rotulo: r, ativo: config.tema === v, dados: `data-tema="${v}"` })).join('')}</div></div>
    <div class="ajuste"><h3>Lembretes</h3>
      <p>Com o app aberto (ou recém-aberto), os lembretes aparecem como aviso do sistema. ${temNuvem() ? 'Para avisos com o app fechado, ligue a opção abaixo.' : ''} Também dá para mandar tudo para a agenda do celular, que toca mesmo sem internet.</p>
      ${perm === 'granted' ? '<p class="ok-txt">Avisos ativados neste aparelho.</p>'
        : perm === 'denied' ? '<p>Avisos bloqueados. Libere nas configurações do navegador para este site.</p>'
        : perm === 'indisponivel' ? '<p>Este navegador não oferece avisos. Use a agenda do celular.</p>'
        : '<button class="btn" type="button" data-acao="notificar">Ativar avisos</button>'}
      <button class="btn ouro" type="button" data-acao="ics-tudo">Enviar próximos 60 dias para a agenda do celular (.ics)</button></div>
    ${temNuvem() ? blocoPush() : ''}
    ${blocoGcal()}
    ${temNuvem() ? blocoSinc() : ''}
    <div class="ajuste"><h3>Backup em arquivo</h3>
      <p>${missoes.length} missões e ${ciclos.length} ciclos neste aparelho. O arquivo de backup não é criptografado: guarde em local seguro.</p>
      <div class="linha"><button class="btn pri" type="button" data-acao="backup">Baixar backup</button>
        <label class="btn" for="aj-importar" style="cursor:pointer">Restaurar backup</label>
        <input type="file" id="aj-importar" accept="application/json,.json" hidden></div></div>
    <div class="ajuste"><h3>Instalar no celular</h3>
      ${standalone ? '<p class="ok-txt">Você já está usando o app instalado.</p>'
        : ui.instalar ? '<button class="btn ouro" type="button" data-acao="instalar">Instalar agora</button>'
        : '<p><b>Android (Chrome):</b> menu ⋮ → <i>Instalar app</i> ou <i>Adicionar à tela inicial</i>.<br><b>iPhone (Safari):</b> botão Compartilhar → <i>Adicionar à Tela de Início</i>.</p>'}</div>
    ${ui.conta ? `<div class="ajuste"><h3>Conta</h3>
      <p>Conectado como <b>${esc(ui.conta.email)}</b>${ui.conta.admin ? ' · administrador' : ui.conta.papel === 'escalante' ? ' · escalante' : ''}. Ninguém mais tem acesso à sua agenda.</p>
      <button class="btn" type="button" data-acao="sair-conta">Sair da conta</button></div>` : ''}
    ${ui.conta?.admin ? renderAdmin() : ''}
    <p class="rodape">Agenda do Cadete v${nuvem.VERSAO_APP} · funciona offline</p>
  </div>`;
}

function renderAdmin() {
  const a = ui.adm;
  const item = (email, botoes) => `<div class="adm-item"><span>${esc(email)}${a?.papeis?.[email] === 'escalante' ? ' <small class="st aceita">escalante</small>' : ''}</span>${botoes(email).map(([acao, rot, cls]) => `<button class="btn ${cls || ''}" type="button" data-adm="${acao}" data-email="${esc(email)}">${rot}</button>`).join('')}</div>`;
  const bloco = (titulo, lista, botoes, vazio) => `<div class="adm-sub">${titulo} (${lista.length})</div><div class="adm-lista">${lista.length ? lista.map((e) => item(e, botoes)).join('') : `<p>${vazio}</p>`}</div>`;
  const st = ui.stats;
  return `<div class="ajuste"><h3>Administração de acessos</h3>
    <p>Você libera ou bloqueia quem pode usar o app e escolhe quem é <b>escalante</b> (publica escalas para a turma). Aqui aparecem só os e-mails: as agendas são criptografadas por cada cadete e você não tem acesso a elas.</p>
    <div class="linha"><div class="campo" style="flex:1;min-width:200px"><input id="adm-email" type="email" inputmode="email" placeholder="e-mail para liberar" aria-label="E-mail para liberar"></div>
      <button class="btn pri" type="button" data-adm="liberar-novo">Liberar</button></div>
    ${ui.admErro ? `<p class="erro">${esc(ui.admErro)}</p>` : ''}
    ${!a ? '<p>Carregando lista…</p>' : `
      ${bloco('Pedidos aguardando', a.pendentes, () => [['liberar', 'Liberar', 'pri'], ['bloquear', 'Recusar', 'perigo']], 'Nenhum pedido no momento.')}
      ${bloco('Liberados', a.liberados, (e) => [a.papeis?.[e] === 'escalante' ? ['tirar-escalante', 'Tirar escalante'] : ['escalante', 'Tornar escalante'], ['bloquear', 'Bloquear', 'perigo']], 'Ninguém liberado ainda.')}
      ${a.bloqueados.length ? bloco('Bloqueados', a.bloqueados, () => [['liberar', 'Desbloquear'], ['remover', 'Apagar']], '') : ''}`}
    <button class="btn link" type="button" data-adm="atualizar">Atualizar lista</button></div>
  <div class="ajuste"><h3>Estatísticas de uso</h3>
    <p>Só números de acesso (sem nenhum conteúdo das agendas).</p>
    ${st ? (st.erro ? `<p class="erro">${esc(st.erro)}</p>` : `<div class="cartoes-n">
      <div><b class="num">${st.total}</b><span>contas que já usaram</span></div>
      <div><b class="num">${st.semana}</b><span>ativas em 7 dias</span></div>
      <div><b class="num">${st.mes}</b><span>ativas em 30 dias</span></div>
      <div><b class="num">${st.hoje}</b><span>hoje</span></div>
      <div><b class="num">${st.instalados}</b><span>com app instalado</span></div>
      <div><b class="num">${st.push ?? '–'}</b><span>com avisos ligados</span></div></div>
      <p>${Object.entries(st.porPlat).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</p>`) : ''}
    <button class="btn" type="button" data-adm="stats">${st ? 'Atualizar números' : 'Ver números'}</button></div>`;
}
async function carregarAdmin() {
  try { ui.adm = await listarAcessos(); ui.admErro = ''; }
  catch (e) { ui.admErro = e?.code === 'unavailable' || !navigator.onLine ? 'Sem internet para carregar a lista.' : mensagemErro(e); }
  if (ui.vista === 'ajustes') renderAjustes();
}


/* ---- Turma (mural, trocas, escalas publicadas) ---- */
function avisoNovo() {
  const a = ui.turma.avisos[0];
  return a && a.criadoEm > (store.get().config.avisoVisto || 0) ? a : null;
}
function atualizarBadge() {
  const n = (avisoNovo() ? 1 : 0) + ui.turma.trocas.filter((t) => !t.enviada && t.status === 'pendente').length;
  $('#badge-turma').hidden = !n;
}
async function carregarTurma() {
  if (!temNuvem() || ui.turma.carregando) return;
  ui.turma.carregando = true;
  const T = ui.turma;
  const tentar = async (fn, padrao) => { try { return await fn(); } catch (e) { console.warn(e); T.erro = mensagemErro(e); return padrao; } };
  T.erro = '';
  const [perfil, avisos, escalas] = await Promise.all([tentar(nuvem.lerMeuPerfil, T.perfil), tentar(nuvem.listarAvisos, T.avisos), tentar(nuvem.listarEscalas, T.escalas)]);
  Object.assign(T, { perfil, avisos, escalas });
  T.trocas = await tentar(nuvem.minhasTrocas, T.trocas);
  T.carregado = true; T.carregando = false;
  aplicarTrocas();
  aplicarAltsQts();
  atualizarBadge();
  if (ui.vista === 'turma' || ui.vista === 'painel') renderizar();
}

const ROT_STATUS = { pendente: 'Aguardando', aceita: 'Aceita', recusada: 'Recusada', cancelada: 'Cancelada' };
function descServico(sv) {
  if (!sv) return 'Serviço';
  return `${SUBTIPOS[sv.subtipo]?.rotulo || sv.titulo} · ${dataCurta(sv)}${sv.detalhe ? ' · ' + sv.detalhe : ''}`;
}
function cartaoTroca(t) {
  const sv = t.servico;
  const outro = t.enviada ? t.paraNome : t.deNome;
  let botoes = [];
  if (t.ilegivel) botoes.push(['apagar', 'Apagar']);
  else if (!t.enviada && t.status === 'pendente') botoes = [['aceita', 'Aceitar', 'pri'], ['recusada', 'Recusar', 'perigo']];
  else if (t.enviada && t.status === 'pendente') botoes = [['cancelada', 'Cancelar pedido']];
  else if (t.status === 'aceita') {
    botoes = [['fiscal', 'Avisar o fiscal', 'ouro']];
    if (t.enviada && sv?.inicio > Date.now()) botoes.push(['cancelada', 'Desfazer troca']);
  } else botoes = [['apagar', 'Apagar']];
  const conflito = !t.enviada && t.status === 'pendente' && sv ? conflitos(sv)[0] : null;
  return `<div class="cartao-n">
    <div class="linha"><span class="st ${t.status}">${ROT_STATUS[t.status] || t.status}</span><span class="meta">${t.enviada ? 'Você pediu a' : 'Pedido de'} Cad. ${esc(outro)}</span></div>
    <h3>${t.ilegivel ? 'Dados indisponíveis neste aparelho' : esc(descServico(sv))}</h3>
    ${t.motivo ? `<p>${esc(t.motivo)}</p>` : ''}
    ${t.fiscal ? `<span class="meta">Fiscalizador: ${esc(t.fiscal)}</span>` : ''}
    ${t.status === 'aceita' ? `<span class="meta ok-txt">${t.enviada ? 'Saiu da sua agenda' : 'Está na sua agenda'} · a escala dos dois foi atualizada</span>` : ''}
    ${conflito ? `<span class="meta erro">Você já tem ${esc(SUBTIPOS[conflito.subtipo]?.rotulo || 'serviço')} nesse horário: não pode aceitar.</span>` : ''}
    <span class="meta">${ddmm(t.criadoEm)} às ${hhmm(t.criadoEm)}</span>
    <div class="linha">${botoes.map(([a, r, c]) => `<button class="btn ${c || ''}" type="button" data-troca="${a}" data-id="${esc(t.id)}">${r}</button>`).join('')}</div></div>`;
}

function renderTurma() {
  const T = ui.turma;
  const c = store.get().config;
  if (!temNuvem()) { $('#v-turma').innerHTML = '<div class="secao"><h2 class="titulo-vista">Turma</h2><div class="vazio">Disponível com login.</div></div>'; return; }
  if (!T.carregado) { $('#v-turma').innerHTML = `<div class="secao"><h2 class="titulo-vista">Turma</h2><p class="carregando">Carregando…</p></div>`; carregarTurma(); return; }
  const admin = ui.conta.admin;
  const escalante = admin || ui.conta.papel === 'escalante';
  const p = T.perfil;
  const editar = !p || T.editarPerfil;
  const recebidas = T.trocas.filter((t) => !t.enviada), enviadas = T.trocas.filter((t) => t.enviada);
  $('#v-turma').innerHTML = `<div class="secao" style="gap:16px">
    <h2 class="titulo-vista">Turma</h2>
    ${T.erro ? `<div class="aviso"><p>${esc(T.erro)}</p><button class="btn" type="button" data-acao="turma-atualizar">Tentar de novo</button></div>` : ''}

    <div class="secao"><h2 class="lbl">Mural de avisos</h2>
      ${admin ? `<div class="ajuste"><h3>Novo aviso</h3>
        <div class="campo"><label class="lbl" for="av-titulo">Título</label><input id="av-titulo" maxlength="120"></div>
        <div class="campo"><label class="lbl" for="av-texto">Texto</label><textarea id="av-texto" maxlength="2000"></textarea></div>
        <label class="toggle"><input type="checkbox" id="av-imp"> Importante (destacado)</label>
        <button class="btn pri" type="button" data-acao="publicar-aviso">Publicar para todos</button></div>` : ''}
      ${T.avisos.length ? T.avisos.map((a) => `<div class="cartao-n${a.importante ? ' importante' : ''}"><h3>${esc(a.titulo)}</h3>${a.texto ? `<p>${esc(a.texto)}</p>` : ''}
        <div class="linha"><span class="meta">${esc(rotuloDia(a.criadoEm))} às ${hhmm(a.criadoEm)}</span>${admin ? `<button class="btn link dir" type="button" data-aviso-rm="${esc(a.id)}">Apagar</button>` : ''}</div></div>`).join('')
        : '<div class="vazio">Nenhum aviso no mural.</div>'}
    </div>

    <div class="secao"><h2 class="lbl">Seu perfil na turma</h2>
      ${editar ? `<div class="ajuste">
        <p>Para trocar serviços pelo app, entre na turma. Os colegas da mesma turma veem só seu nome, nome de guerra e turma — nunca a sua agenda.</p>
        <div class="campo"><label class="lbl" for="pf-nome">Nome completo</label><input id="pf-nome" value="${esc(p?.nome || c.nomeCompleto || '')}"></div>
        <div class="dupla"><div class="campo"><label class="lbl" for="pf-guerra">Nome de guerra</label><input id="pf-guerra" value="${esc(p?.nomeGuerra || c.nomeGuerra || '')}"></div>
          <div class="campo"><label class="lbl" for="pf-turma">Turma</label><select id="pf-turma">${(() => { const atual = p?.turma || c.turma || '';
            return `<option value=""${TURMAS.includes(atual) ? '' : ' selected'} disabled>Escolha a turma</option>` + TURMAS.map((t) => `<option${t === atual ? ' selected' : ''}>${t}</option>`).join(''); })()}</select></div></div>
        <p class="dica">Só quem está na mesma turma aparece para troca de serviço.</p>
        <div class="linha"><button class="btn pri" type="button" data-acao="salvar-perfil">${p ? 'Salvar' : 'Entrar na turma'}</button>${p ? '<button class="btn" type="button" data-acao="cancelar-perfil">Cancelar</button>' : ''}</div></div>`
      : `${TURMAS.includes(p.turma) ? '' : `<div class="aviso"><p>A turma "${esc(p.turma)}" não está na lista nova. Escolha a sua para os colegas acharem você nas trocas.</p><button class="btn pri" type="button" data-acao="editar-perfil">Escolher turma</button></div>`}
        <div class="cartao-n"><h3>Cad. ${esc(p.nomeGuerra || p.nome)} · ${esc(p.turma)}</h3><p>${esc(p.nome)}</p>
          <div class="linha"><button class="btn" type="button" data-acao="editar-perfil">Editar</button><button class="btn link dir" type="button" data-acao="sair-turma">Sair da turma</button></div></div>`}
    </div>

    <div class="secao"><h2 class="lbl">Trocas de serviço</h2>
      <p class="dica">Para pedir: abra o serviço na agenda e toque em <b>"Pedir troca a um colega pelo app"</b>. Os dados do serviço vão criptografados: só você e o colega leem. Depois de aceita, avise o fiscal.</p>
      ${recebidas.length ? `<span class="lbl">Recebidas</span>${recebidas.map(cartaoTroca).join('')}` : ''}
      ${enviadas.length ? `<span class="lbl">Enviadas</span>${enviadas.map(cartaoTroca).join('')}` : ''}
      ${!T.trocas.length ? '<div class="vazio">Nenhuma troca por enquanto.</div>' : ''}
    </div>

    <div class="secao"><h2 class="lbl">Escalas da turma</h2>
      ${escalante ? '<button class="btn ouro" type="button" data-acao="publicar-escala">Publicar escala (PDF) para a turma</button>' : ''}
      ${T.escalas.length ? T.escalas.map((e) => `<div class="cartao-n"><h3>${esc(e.titulo)}</h3>
        <span class="meta">${{ interna: 'Serviço Interno', rotina: 'Missões de Rotina', desfile: 'Desfile', representacao: 'Representação', qts: 'QTS', 'qts-alt': 'Alteração do QTS' }[e.tipo] || 'Escala'}${e.tipo === 'qts-alt' ? ` · ${esc(e.linhas?.[0]?.qtsTurma || '')}` : ` · ${e.linhas?.length || 0} linhas`} · publicada ${esc(rotuloDia(e.criadoEm).toLowerCase())}</span>
        <div class="linha">${e.tipo === 'qts-alt' ? `<button class="btn" type="button" data-ir="qts">Ver no QTS</button>` : `<button class="btn pri" type="button" data-escala="${esc(e.id)}">Ver meus serviços</button>`}${admin || e.publicadoPor === ui.conta.email ? `<button class="btn link dir" type="button" data-escala-rm="${esc(e.id)}">Apagar</button>` : ''}</div></div>`).join('')
        : `<div class="vazio">Nenhuma escala publicada.${escalante ? '' : ' Enquanto isso, importe o PDF pelo botão dourado.'}</div>`}
    </div>
    <button class="btn link" type="button" data-acao="turma-atualizar">Atualizar</button>
  </div>`;
  // ao abrir a aba, o aviso mais recente conta como visto
  if (avisoNovo()) { store.setConfig({ avisoVisto: Date.now() }); atualizarBadge(); }
}

function renderizar() {
  if (!ui.iniciado) return; // nada aparece antes do portão de acesso liberar
  const agora = Date.now();
  renderTopo(agora);
  $$('main > section').forEach((s) => (s.hidden = s.dataset.vista !== ui.vista));
  $$('.abas button').forEach((b) => (b.dataset.ir === ui.vista ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (ui.vista === 'painel') renderPainel(agora);
  if (ui.vista === 'escalas') renderEscalas(agora);
  if (ui.vista === 'qts') renderQts(agora);
  if (ui.vista === 'missoes') renderMissoes(agora);
  if (ui.vista === 'turma') renderTurma();
  if (ui.vista === 'ajustes') renderAjustes();
}

/* ============ 4. folhas ============ */
function abrirFolha(id) { const d = $(id); if (!d.open) d.showModal(); }
function fecharFolha(id) { const d = $(id); if (d.open) d.close(); }
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog.folha').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

/* ---- Adição rápida ---- */
let rapidoRes = null;
function diaAlvoAtual() {
  if (ui.vista === 'escalas') return ui.esc.sel;
  if (ui.vista === 'painel') return ui.diaPainel;
  return inicioDoDia(Date.now());
}
function desenharModelos() {
  const dia = ui.diaAlvo || inicioDoDia(Date.now());
  const grupos = [...new Set(MODELOS.map((m) => m.grupo))];
  $('#modelos').innerHTML = grupos.map((g) => `<div class="modelos-grupo"><span>${esc(g)}</span><div class="modelos">${MODELOS.filter((m) => m.grupo === g).map((m) => {
    const d = m.subtipo === 'estagio_cpu' ? proximoFimDeSemana(dia) : dia;
    const h = horarioPadrao(m.subtipo, d);
    const quando = h
      ? (h.diaTodo ? `${rotuloDia(h.inicio)} · dia todo` : `${rotuloDia(h.inicio)} · ${hhmm(h.inicio)}${h.fim ? '–' + hhmm(h.fim) : ''}`)
      : m.diaTodo ? `${rotuloDia(d.getTime())} · prazo` : `${rotuloDia(d.getTime())}${m.hora != null ? ' · ' + p2(m.hora) + ':00' : ''}`;
    return `<button type="button" class="modelo" data-modelo="${m.id}" style="--cor:${corCat(m.categoria)}"><b>${esc(m.rotulo)}</b><span>${esc(quando)}</span></button>`;
  }).join('')}</div></div>`).join('');
}
function abrirRapido() {
  ui.diaAlvo = ui.diaAlvo || diaAlvoAtual();
  desenharModelos();
  $('#rapido-txt').value = ''; $('#rapido-msg').hidden = true; atualizarRapido();
  abrirFolha('#dlg-rapido');
  // sem foco automático no texto: no celular o teclado esconderia as abas de modelos
  $('#modelos button')?.focus({ preventScroll: true });
}
function atualizarRapido() {
  const txt = $('#rapido-txt').value;
  rapidoRes = txt.trim() ? interpretarRapido(txt) : null;
  $('#rapido-salvar').disabled = $('#rapido-outra').disabled = !rapidoRes;
  $('#rapido-dica').hidden = !!rapidoRes;
  if (!rapidoRes) { $('#rapido-chips').innerHTML = ''; return; }
  const r = rapidoRes;
  const temData = r.reconhecido.some((x) => /^(Hoje|Amanhã|Depois|\d{2}\/)/.test(x));
  $('#rapido-chips').innerHTML = [
    chip({ rotulo: SUBTIPOS[r.subtipo].rotulo, cor: corCat(r.categoria), ativo: true, dados: 'tabindex="-1"', peq: true }),
    chip({ rotulo: PRIORIDADES[r.prioridade].rotulo, cor: corPri(r.prioridade), ativo: true, dados: 'tabindex="-1"', peq: true }),
    temData ? '' : chip({ rotulo: rotuloDia(r.inicioMs), ativo: false, dados: 'tabindex="-1"', peq: true }),
    ...r.reconhecido.map((x) => chip({ rotulo: x, ativo: false, dados: 'tabindex="-1"', peq: true })),
  ].join('');
}
function salvarRapido(continuar) {
  const r = rapidoRes; if (!r) return;
  let { inicioMs: inicio, fimMs: fim, diaInteiro: diaTodo } = r;
  const regra = diaTodo ? horarioPadrao(r.subtipo, new Date(r.inicioMs)) : null; // "sentinela amanhã" → horário do serviço
  if (regra) { inicio = regra.inicio; fim = regra.fim; diaTodo = regra.diaTodo; }
  store.salvarMissao({ id: novoId(), titulo: r.titulo, categoria: r.categoria, subtipo: r.subtipo, prioridade: r.prioridade,
    inicio, fim, diaTodo, local: r.local || '', obs: '', lembretes: r.lembretesMin, escala: null });
  vibrar(25);
  if (continuar) { $('#rapido-txt').value = ''; atualizarRapido(); const m = $('#rapido-msg'); m.textContent = `Salvo: ${r.titulo}`; m.style.color = 'var(--ok)'; m.hidden = false; $('#rapido-txt').focus(); }
  else { fecharFolha('#dlg-rapido'); toast(`Salvo: ${r.titulo}`); }
}
$('#rapido-txt').addEventListener('input', () => { $('#rapido-msg').hidden = true; atualizarRapido(); });
$('#form-rapido').addEventListener('submit', (e) => { e.preventDefault(); salvarRapido(false); });
$('#rapido-outra').addEventListener('click', () => salvarRapido(true));
$('#rapido-detalhes').addEventListener('click', () => { const r = rapidoRes; fecharFolha('#dlg-rapido'); abrirMissao(null, r ? { rapido: r } : {}); });
$('#fab').addEventListener('click', () => { vibrar(10); ui.diaAlvo = diaAlvoAtual(); abrirRapido(); });
$('#modelos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-modelo]'); if (!b) return;
  const modelo = MODELOS.find((m) => m.id === b.dataset.modelo);
  const dia = ui.diaAlvo || inicioDoDia(Date.now());
  fecharFolha('#dlg-rapido');
  abrirMissao(null, { modelo, dia: dia.getTime() });
});
$('#dlg-rapido').addEventListener('close', () => { ui.diaAlvo = null; });

/* ---- Missão ---- */
const fm = { editando: null, categoria: 'operacional', subtipo: 'guarda', prioridade: 'critico', lembretes: [], lembManual: false, horarioAuto: false, unidade: '', tituloAuto: '', localAuto: '', detalhe: '', checklist: [], checkManual: false };
function desenharChecklist() {
  const l = fm.checklist;
  $('#m-check-lista').innerHTML = l.length ? l.map((c, i) => `<label class="ck${c.ok ? ' ok' : ''}"><input type="checkbox" data-fck="${i}" ${c.ok ? 'checked' : ''}><span>${esc(c.t)}</span><button class="x" type="button" data-fck-rm="${i}" aria-label="Remover item: ${esc(c.t)}">✕</button></label>`).join('')
    : '<span class="cinza" style="font-size:.88rem">Sem itens. Adicione abaixo ou use o padrão.</span>';
  const pend = l.filter((c) => !c.ok).length;
  $('#m-check-cont').textContent = l.length ? `· ${l.length - pend}/${l.length}` : '';
  $('#m-check-padrao').hidden = !checklistPadrao(fm.subtipo).length;
}
const prioridadeSugerida = (st) => (st === 'sobreaviso' ? 'importante' : SUBTIPOS[st].categoria === 'operacional' || st === 'prova' ? 'critico' : ['trabalho', 'seminario', 'formatura'].includes(st) || SUBTIPOS[st].categoria === 'rotina' ? 'importante' : 'rotineiro');

function desenharFormMissao() {
  $('#m-cat').innerHTML = Object.keys(CATEGORIAS).map((c) => chip({ rotulo: CATEGORIAS[c].rotulo, cor: corCat(c), ativo: fm.categoria === c, dados: `data-mc="${c}"` })).join('');
  $('#m-sub').innerHTML = subtiposDe(fm.categoria).map((s) => chip({ rotulo: SUBTIPOS[s].rotulo, cor: corCat(fm.categoria), ativo: fm.subtipo === s, dados: `data-ms="${s}"` })).join('');
  $('#m-pri').innerHTML = Object.keys(PRIORIDADES).map((p) => chip({ rotulo: PRIORIDADES[p].rotulo, cor: corPri(p), ativo: fm.prioridade === p, dados: `data-mp="${p}"` })).join('');
  $('#m-lemb').innerHTML = OPCOES_LEMBRETE.map((o) => chip({ rotulo: o.rotulo, cor: 'var(--gold)', ativo: fm.lembretes.includes(o.min), dados: `data-ml="${o.min}"`, peq: true })).join('');
  const escala = SUBTIPOS_ESCALA.includes(fm.subtipo);
  $('#m-escala').hidden = !escala;
  $('#m-trocas').hidden = !(escala && fm.editando);
  $('#m-temfim-txt').textContent = escala ? 'Tem horário de término (ex.: 24 h de serviço)' : 'Tem horário de término';
  const dt = $('#m-diatodo').checked;
  $('#m-hora').disabled = dt;
  $('#m-lemb-lbl').textContent = dt ? 'Lembretes (antes das 08:00 do dia)' : 'Lembretes antes do início';
  $('#m-fim-box').hidden = !$('#m-temfim').checked;
  // opções extras (Sobreaviso de… / posição nas salas)
  const op = OPCOES_TIPO[fm.subtipo];
  $('#m-opcoes').hidden = !op;
  if (op) {
    $('#m-opcoes').style.setProperty('--cor', corCat(fm.categoria));
    $('#m-opcoes-lbl').textContent = op.rotulo;
    $('#m-opcoes-chips').innerHTML = op.itens.map((x) => chip({ rotulo: x, cor: corCat(fm.categoria), ativo: fm.detalhe === x, dados: `data-op="${esc(x)}"` })).join('');
  }
  // Estágio CPU: unidade (abas por CRPM) e oficial responsável
  const cpu = fm.subtipo === 'estagio_cpu';
  $('#m-cpu').hidden = !cpu;
  if (cpu) $('#m-unidades').innerHTML = UNIDADES_CPU.map((g) => `<div class="g"><span>${g.crpm}</span><div class="chips">${
    g.unidades.map((u) => chip({ rotulo: u, cor: 'var(--c-operacional)', ativo: fm.unidade === u, dados: `data-un="${u}"` })).join('')}</div></div>`).join('');
  // notas (provas/trabalhos) e checklist
  $('#m-acad').hidden = !SUBTIPOS_AVALIACAO.includes(fm.subtipo);
  $('#m-check').hidden = fm.categoria === 'pessoal' && !fm.checklist.length;
  $('#m-check').style.setProperty('--cor', corCat(fm.categoria));
  desenharChecklist();
  $('#t-app').hidden = !(temNuvem() && fm.editando && SUBTIPOS_ESCALA.includes(fm.subtipo));
  // regra de horário do serviço
  const d = $('#m-data').value ? new Date(deCampos($('#m-data').value, '12:00')) : null;
  const h = d ? horarioPadrao(fm.subtipo, d) : null;
  const regra = $('#m-regra');
  regra.hidden = !h;
  if (h) {
    regra.textContent = (fm.horarioAuto ? 'Horário automático · ' : 'Padrão deste dia · ') + h.regra;
    regra.classList.toggle('alerta', h.regra.startsWith('Atenção'));
  }
}

/** Preenche hora de início e término conforme a regra do serviço e a data escolhida. */
function aplicarHorarioAuto() {
  if (!$('#m-data').value) return;
  const h = horarioPadrao(fm.subtipo, new Date(deCampos($('#m-data').value, '12:00')));
  if (!h) return;
  $('#m-diatodo').checked = false;
  $('#m-diatodo').checked = h.diaTodo;
  $('#m-hora').value = h.diaTodo ? '' : paraHora(h.inicio);
  $('#m-temfim').checked = !!h.fim;
  if (h.fim) { $('#m-fimdata').value = paraData(h.fim); $('#m-fimhora').value = paraHora(h.fim); }
}
/** Ao escolher a unidade do CPU, ajusta título e local se ainda forem os automáticos. */
function aplicarUnidade(u) {
  fm.unidade = u;
  const titulo = `Estágio CPU – ${u}`, local = `${u} · ${crpmDa(u)}`;
  const t = $('#m-titulo').value.trim();
  if (!t || t === 'Estágio CPU' || t === fm.tituloAuto) { $('#m-titulo').value = titulo; fm.tituloAuto = titulo; }
  const l = $('#m-local').value.trim();
  if (!l || l === fm.localAuto) { $('#m-local').value = local; fm.localAuto = local; }
}

function abrirMissao(id, { rapido, dia, modelo } = {}) {
  const m = id ? store.get().missoes.find((x) => x.id === id) : null;
  fm.editando = m ? m.id : null;
  $('#missao-t').textContent = m ? 'Editar missão' : 'Nova missão';
  $('#m-erro').hidden = true; $('#m-confirmar').hidden = true;
  $('#m-excluir').hidden = $('#m-ics').hidden = !m;
  let base;
  if (m) base = m;
  else if (rapido) base = { titulo: rapido.titulo, categoria: rapido.categoria, subtipo: rapido.subtipo, prioridade: rapido.prioridade, inicio: rapido.inicioMs, fim: rapido.fimMs, diaTodo: rapido.diaInteiro, local: rapido.local || '', lembretes: rapido.lembretesMin };
  else if (modelo) {
    let d = inicioDoDia(dia || Date.now());
    if (modelo.subtipo === 'estagio_cpu') d = proximoFimDeSemana(d);
    const h = horarioPadrao(modelo.subtipo, d);
    const ini = h ? h.inicio : modelo.diaTodo ? d.getTime() : new Date(d).setHours(modelo.hora ?? 7, 0, 0, 0);
    base = { titulo: modelo.titulo, categoria: modelo.categoria, subtipo: modelo.subtipo, prioridade: modelo.prioridade,
      inicio: ini, fim: h ? h.fim : null, diaTodo: h ? h.diaTodo : !!modelo.diaTodo, local: modelo.local || '', obs: modelo.obs || '',
      lembretes: modelo.lembretes, escala: modelo.escala || null };
  }
  else {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    const ini = dia ? new Date(dia).setHours(7, 0, 0, 0) : d.getTime();
    base = { titulo: '', categoria: 'operacional', subtipo: 'guarda', prioridade: 'critico', inicio: ini, fim: null, diaTodo: false, local: '', lembretes: lembretesPadrao('guarda', 'critico') };
  }
  Object.assign(fm, { categoria: base.categoria, subtipo: base.subtipo, prioridade: base.prioridade, lembretes: [...(base.lembretes || [])], lembManual: !!m,
    horarioAuto: !m && !!horarioPadrao(base.subtipo, new Date(base.inicio)), unidade: base.escala?.unidade || '', tituloAuto: '', localAuto: '', detalhe: base.detalhe || '',
    checklist: m ? (m.checklist || []).map((c) => ({ ...c })) : checklistPadrao(base.subtipo), checkManual: !!m });
  $('#m-disc').value = m?.disciplina || ''; $('#m-peso').value = m?.peso ?? ''; $('#m-nota').value = m?.nota ?? ''; $('#m-check-novo').value = '';
  $('#lista-disc').innerHTML = [...new Set([...opcoesDisciplina(store.get().config.qts, capitaliza), ...store.get().missoes.map((x) => x.disciplina).filter(Boolean)])].sort().map((d) => `<option value="${esc(d)}">`).join('');
  $('#m-oficial').value = base.escala?.oficial || '';
  $('#m-titulo').value = base.titulo || '';
  $('#m-data').value = paraData(base.inicio); $('#m-hora').value = base.diaTodo ? '' : paraHora(base.inicio);
  $('#m-diatodo').checked = !!base.diaTodo;
  $('#m-temfim').checked = !!base.fim;
  const fimBase = base.fim || base.inicio + 24 * 3600000;
  $('#m-fimdata').value = paraData(fimBase); $('#m-fimhora').value = paraHora(fimBase);
  $('#m-local').value = base.local || ''; $('#m-obs').value = base.obs || '';
  $('#m-posto').value = base.escala?.posto || ''; $('#m-funcao').value = base.escala?.funcao || ''; $('#m-fard').value = base.escala?.fardamento || (base.escala && SERVICOS_ARMADOS.includes(base.subtipo) && !m ? store.get().config.fardamentoPadrao || '' : ''); $('#m-quartos').value = base.escala?.quartos || '';
  $('#t-com').value = ''; $('#t-motivo').value = ''; $('#t-status').value = 'solicitada';
  desenharTrocas(m);
  desenharColegas(m);
  desenharFormMissao();
  abrirFolha('#dlg-missao');
  if (modelo) setTimeout(() => (modelo.subtipo === 'estagio_cpu' ? $('#m-unidades button') : modelo.titulo.endsWith(' ') || !modelo.titulo ? $('#m-titulo') : $('#m-data'))?.focus(), 80);
}
/** "Na escala com você": quem está no Serviço Interno do mesmo dia (da escala completa). */
function htmlColegas(dia, { compacto = false } = {}) {
  const g = colegasNaEscala(listarDocs(ui.conta?.uid), dia, store.get().config);
  if (!g) return '';
  if (compacto) {
    const outros = g.flatMap((x) => x.nomes.filter((n) => !n.eu).map((n) => `${n.nome.split(' ')[0]} ${n.nome.split(' ').slice(-1)[0]} (${x.rotulo.split(' · ')[0]})`));
    return outros.length ? `<small>Na escala hoje: ${esc(outros.slice(0, 6).join(', '))}${outros.length > 6 ? '…' : ''}</small>` : '';
  }
  return `<span class="lbl">Na escala com você · ${ddmm(new Date(dia + 'T12:00').getTime())}</span>
    ${g.map((x) => `<div class="func${x.nomes.some((n) => n.eu) ? ' minha' : ''}"><span class="lbl">${esc(x.rotulo)}</span><div class="nomes">${x.nomes.map((n) => `<span class="${n.eu ? 'eu' : ''}">${esc([n.grad, n.nome].filter(Boolean).join(' '))}</span>`).join('')}</div></div>`).join('')}`;
}
function desenharColegas(m) {
  const box = $('#m-colegas');
  const html = m && SUBTIPOS_ESCALA.includes(m.subtipo) ? htmlColegas(ymdL(m.inicio)) : '';
  box.hidden = !html; box.innerHTML = html;
}
function desenharTrocas(m) {
  $('#m-trocas-lista').innerHTML = (m?.trocas || []).map((t) => `<span>${ddmm(t.em)} ${hhmm(t.em)} · com <b>${esc(t.comQuem)}</b> · ${esc(t.status)}${t.motivo ? ' · ' + esc(t.motivo) : ''}</span>`).join('') || '<span>Nenhuma troca registrada.</span>';
}

$('#form-missao').addEventListener('click', (e) => {
  const c = e.target.closest('[data-mc]'), s = e.target.closest('[data-ms]'), p = e.target.closest('[data-mp]'), l = e.target.closest('[data-ml]');
  if (c) { fm.categoria = c.dataset.mc; fm.subtipo = subtiposDe(fm.categoria)[0]; if (!fm.editando) fm.prioridade = prioridadeSugerida(fm.subtipo); if (!fm.lembManual) fm.lembretes = lembretesPadrao(fm.subtipo, fm.prioridade); }
  else if (s) {
    fm.subtipo = s.dataset.ms; fm.detalhe = ''; if (!fm.editando) fm.prioridade = prioridadeSugerida(fm.subtipo); if (!fm.lembManual) fm.lembretes = lembretesPadrao(fm.subtipo, fm.prioridade);
    if (!fm.checkManual) fm.checklist = checklistPadrao(fm.subtipo);
    if (horarioPadrao(fm.subtipo, new Date())) { fm.horarioAuto = true; aplicarHorarioAuto(); }
  }
  else if (e.target.closest('[data-un]')) aplicarUnidade(e.target.closest('[data-un]').dataset.un);
  else if (e.target.closest('[data-fck-rm]')) { e.preventDefault(); fm.checkManual = true; fm.checklist.splice(+e.target.closest('[data-fck-rm]').dataset.fckRm, 1); }
  else if (e.target.closest('[data-fck]')) { const i = +e.target.closest('[data-fck]').dataset.fck; fm.checkManual = true; fm.checklist[i].ok = e.target.closest('[data-fck]').checked; }
  else if (e.target.id === 'm-check-add') { const t = $('#m-check-novo').value.trim(); if (!t) return; fm.checkManual = true; fm.checklist.push({ t, ok: false }); $('#m-check-novo').value = ''; }
  else if (e.target.id === 'm-check-padrao') { fm.checkManual = true; const atuais = new Set(fm.checklist.map((c) => c.t)); fm.checklist.push(...checklistPadrao(fm.subtipo).filter((c) => !atuais.has(c.t))); }
  else if (e.target.closest('[data-op]')) { const v = e.target.closest('[data-op]').dataset.op; fm.detalhe = fm.detalhe === v ? '' : v; }
  else if (p) { fm.prioridade = p.dataset.mp; if (!fm.lembManual) fm.lembretes = lembretesPadrao(fm.subtipo, fm.prioridade); }
  else if (l) { const min = +l.dataset.ml; fm.lembManual = true; fm.lembretes = fm.lembretes.includes(min) ? fm.lembretes.filter((x) => x !== min) : [...fm.lembretes, min].sort((a, b) => b - a); }
  else return;
  desenharFormMissao();
});
$('#m-diatodo').addEventListener('change', desenharFormMissao);
$('#m-data').addEventListener('input', () => { if (fm.horarioAuto) aplicarHorarioAuto(); desenharFormMissao(); });
['#m-hora', '#m-fimdata', '#m-fimhora'].forEach((sel) => $(sel).addEventListener('input', () => { fm.horarioAuto = false; desenharFormMissao(); }));
$('#m-temfim').addEventListener('change', () => {
  if ($('#m-temfim').checked) {
    const ini = deCampos($('#m-data').value, $('#m-hora').value || '00:00');
    const fim = ini + (SUBTIPOS_ESCALA.includes(fm.subtipo) ? 24 : 2) * 3600000;
    $('#m-fimdata').value = paraData(fim); $('#m-fimhora').value = paraHora(fim);
  }
  desenharFormMissao();
});
$('#form-missao').addEventListener('submit', (e) => {
  e.preventDefault();
  const erro = (t) => { const el = $('#m-erro'); el.textContent = t; el.hidden = false; el.scrollIntoView({ block: 'nearest' }); };
  const titulo = $('#m-titulo').value.trim();
  if (!titulo) return erro('Escreva o que é a missão.');
  if (!$('#m-data').value) return erro('Escolha a data.');
  const diaTodo = $('#m-diatodo').checked;
  if (!diaTodo && !$('#m-hora').value) return erro('Escolha a hora ou marque "Dia todo".');
  const inicio = deCampos($('#m-data').value, diaTodo ? '00:00' : $('#m-hora').value);
  let fim = null;
  if ($('#m-temfim').checked) {
    if (!$('#m-fimdata').value || !$('#m-fimhora').value) return erro('Preencha data e hora do término.');
    fim = deCampos($('#m-fimdata').value, $('#m-fimhora').value);
    if (fim <= inicio) return erro('O término precisa ser depois do início.');
  }
  if (fm.subtipo === 'estagio_cpu' && !fm.unidade) return erro('Escolha a unidade do Estágio CPU.');
  const acad = SUBTIPOS_AVALIACAO.includes(fm.subtipo);
  const nota = $('#m-nota').value.trim(), peso = $('#m-peso').value.trim();
  if (acad && nota !== '' && !(+nota >= 0 && +nota <= 10)) return erro('A nota precisa estar entre 0 e 10.');
  const escala = SUBTIPOS_ESCALA.includes(fm.subtipo) ? { posto: $('#m-posto').value.trim(), funcao: $('#m-funcao').value.trim(), fardamento: $('#m-fard').value.trim(), quartos: $('#m-quartos').value.trim(),
    ...(fm.subtipo === 'estagio_cpu' ? { unidade: fm.unidade, crpm: crpmDa(fm.unidade), oficial: $('#m-oficial').value.trim() } : {}) } : null;
  store.salvarMissao({ id: fm.editando || novoId(), titulo, categoria: fm.categoria, subtipo: fm.subtipo, prioridade: fm.prioridade,
    inicio, fim, diaTodo, local: $('#m-local').value.trim(), obs: $('#m-obs').value.trim(), lembretes: fm.lembretes, escala,
    detalhe: OPCOES_TIPO[fm.subtipo] ? fm.detalhe : '', checklist: fm.checklist,
    disciplina: acad ? $('#m-disc').value.trim() : '', peso: acad && peso !== '' ? +peso : null, nota: acad && nota !== '' ? +nota : null });
  vibrar(25);
  fecharFolha('#dlg-missao');
  toast(fm.editando ? 'Alterações salvas' : `Salvo: ${titulo}`);
});
$('#m-excluir').addEventListener('click', () => { $('#m-confirmar').hidden = false; });
$('#m-nao').addEventListener('click', () => { $('#m-confirmar').hidden = true; });
$('#m-sim').addEventListener('click', () => { store.excluirMissao(fm.editando); fecharFolha('#dlg-missao'); toast('Missão excluída'); });
$('#m-ics').addEventListener('click', () => { const it = acharItem(fm.editando); if (it) baixar('missao.ics', gerarICS([it]), 'text/calendar'); });
$('#m-check-novo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#m-check-add').click(); } });
$('#t-app').addEventListener('click', () => abrirPedidoTroca(fm.editando));
$('#t-salvar').addEventListener('click', () => {
  const com = $('#t-com').value.trim();
  if (!com) { const el = $('#m-erro'); el.textContent = 'Informe com quem foi a troca.'; el.hidden = false; return; }
  store.registrarTroca(fm.editando, { comQuem: com, motivo: $('#t-motivo').value.trim(), status: $('#t-status').value });
  $('#t-com').value = ''; $('#t-motivo').value = ''; $('#m-erro').hidden = true;
  desenharTrocas(store.get().missoes.find((x) => x.id === fm.editando));
  toast('Troca registrada');
});

/* ---- Ciclo ---- */
const PADROES = [[24, 72], [24, 48], [12, 36], [12, 60], [24, 96]];
const fc = { editando: null, subtipo: 'guarda', lembretes: [1440, 120, 30] };

function desenharFormCiclo() {
  $('#c-sub').innerHTML = SUBTIPOS_ESCALA.map((s) => chip({ rotulo: SUBTIPOS[s].rotulo, cor: 'var(--c-operacional)', ativo: fc.subtipo === s, dados: `data-cs="${s}"` })).join('');
  const dur = +$('#c-dur').value, folga = +$('#c-folga').value;
  $('#c-padrao').innerHTML = PADROES.map(([d, f]) => chip({ rotulo: `${d}×${f}`, ativo: d === dur && f === folga, dados: `data-cp="${d},${f}"`, peq: true })).join('');
  $('#c-lemb').innerHTML = OPCOES_LEMBRETE.map((o) => chip({ rotulo: o.rotulo, cor: 'var(--gold)', ativo: fc.lembretes.includes(o.min), dados: `data-cl="${o.min}"`, peq: true })).join('');
  // prévia dos próximos plantões
  const c = cicloDoForm();
  if (!c) { $('#c-previa').innerHTML = '<span>Preencha serviço, folga e o 1º plantão para ver a prévia.</span>'; return; }
  const agora = Date.now();
  const prox = plantoesDoCiclo({ ...c, ativo: true }, Math.max(agora, c.inicio) - 1, Math.max(agora, c.inicio) + 60 * DIA).slice(0, 5);
  $('#c-previa').innerHTML = `<span class="lbl">Próximos plantões</span>` + (prox.length ? prox.map((p) => `<span><b>${esc(rotuloDia(p.inicio, agora))}</b> ${hhmm(p.inicio)} → ${mesmoDia(p.inicio, p.fim) ? '' : ddmm(p.fim) + ' '}${hhmm(p.fim)}</span>`).join('') : '<span>Nenhum no período.</span>');
}
function cicloDoForm() {
  const dur = +$('#c-dur').value, folga = +$('#c-folga').value;
  if (!dur || dur <= 0 || folga < 0 || !$('#c-data').value || !$('#c-hora').value) return null;
  return { subtipo: fc.subtipo, inicio: deCampos($('#c-data').value, $('#c-hora').value), duracaoMin: dur * 60, periodoMin: (dur + folga) * 60,
    ate: $('#c-ate').value ? deCampos($('#c-ate').value, '23:59') : null };
}
function abrirCiclo(id) {
  const c = id ? store.get().ciclos.find((x) => x.id === id) : null;
  fc.editando = c ? c.id : null;
  fc.subtipo = c?.subtipo || 'guarda';
  fc.lembretes = [...(c?.lembretes || [1440, 120, 30])];
  $('#ciclo-t').textContent = c ? 'Editar ciclo' : 'Novo ciclo de escala';
  $('#c-titulo').value = c?.titulo || '';
  $('#c-dur').value = c ? c.duracaoMin / 60 : 24;
  $('#c-folga').value = c ? (c.periodoMin - c.duracaoMin) / 60 : 72;
  const ini = c?.inicio || new Date(new Date().setHours(7, 0, 0, 0) + DIA).getTime();
  $('#c-data').value = paraData(ini); $('#c-hora').value = paraHora(ini);
  $('#c-ate').value = c?.ate ? paraData(c.ate) : '';
  $('#c-local').value = c?.local || '';
  $('#c-ativo').checked = c ? c.ativo !== false : true;
  $('#c-erro').hidden = true; $('#c-confirmar').hidden = true; $('#c-excluir').hidden = !c;
  desenharFormCiclo();
  abrirFolha('#dlg-ciclo');
}
$('#form-ciclo').addEventListener('click', (e) => {
  const s = e.target.closest('[data-cs]'), p = e.target.closest('[data-cp]'), l = e.target.closest('[data-cl]');
  if (s) fc.subtipo = s.dataset.cs;
  else if (p) { const [d, f] = p.dataset.cp.split(','); $('#c-dur').value = d; $('#c-folga').value = f; }
  else if (l) { const min = +l.dataset.cl; fc.lembretes = fc.lembretes.includes(min) ? fc.lembretes.filter((x) => x !== min) : [...fc.lembretes, min].sort((a, b) => b - a); }
  else return;
  desenharFormCiclo();
});
['#c-dur', '#c-folga', '#c-data', '#c-hora', '#c-ate'].forEach((s) => $(s).addEventListener('input', desenharFormCiclo));
$('#form-ciclo').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = cicloDoForm();
  const erro = (t) => { const el = $('#c-erro'); el.textContent = t; el.hidden = false; };
  if (!c) return erro('Preencha horas de serviço, folga, data e hora do 1º plantão.');
  if (c.ate && c.ate < c.inicio) return erro('A data de término é anterior ao 1º plantão.');
  const titulo = $('#c-titulo').value.trim() || SUBTIPOS[fc.subtipo].rotulo;
  const anterior = fc.editando ? store.get().ciclos.find((x) => x.id === fc.editando) : null;
  // se mudar a âncora ou o rodízio, as exceções antigas deixam de bater com os novos horários
  const mudouGrade = anterior && (anterior.inicio !== c.inicio || anterior.periodoMin !== c.periodoMin);
  store.salvarCiclo({ id: fc.editando || novoId(), titulo, prioridade: 'critico', local: $('#c-local').value.trim(), lembretes: fc.lembretes,
    ativo: $('#c-ativo').checked, ...c, ...(mudouGrade ? { excecoes: {} } : {}) });
  fecharFolha('#dlg-ciclo');
  toast('Ciclo salvo · plantões no calendário');
});
$('#c-excluir').addEventListener('click', () => { $('#c-confirmar').hidden = false; });
$('#c-nao').addEventListener('click', () => { $('#c-confirmar').hidden = true; });
$('#c-sim').addEventListener('click', () => { store.excluirCiclo(fc.editando); fecharFolha('#dlg-ciclo'); toast('Ciclo excluído'); });

/* ---- Plantão de ciclo ---- */
function abrirPlantao(chave) {
  const it = acharItem(chave); if (!it) return;
  const agora = Date.now();
  const c = store.get().ciclos.find((x) => x.id === it.cicloId);
  const exc = (c.excecoes || {})[it.inicio];
  $('#plantao-t').textContent = SUBTIPOS[it.subtipo].rotulo;
  $('#plantao-corpo').innerHTML = `
    <div class="previa"><b style="font-size:1.15rem">${esc(it.titulo)}</b>
      <span>${esc(rotuloDia(it.inicio, agora))} · ${esc(horario(it))}</span>
      ${it.local ? `<span>${esc(it.local)}</span>` : ''}
      <span>Ciclo ${c.duracaoMin / 60}×${(c.periodoMin - c.duracaoMin) / 60}</span>
      ${exc?.tipo === 'pulado' ? `<span style="color:var(--danger)">Trocado / dispensado${exc.motivo ? ': ' + esc(exc.motivo) : ''}</span>` : ''}
    </div>
    ${exc?.tipo === 'pulado'
      ? `<button class="btn pri" type="button" data-pl="restaurar">Restaurar este plantão</button>`
      : `<button class="btn pri" type="button" data-pl="concluir">${exc?.tipo === 'concluido' ? 'Marcar como pendente' : 'Marcar como cumprido'}</button>
         <div class="caixa"><span class="lbl">Troca ou dispensa</span>
           <div class="campo"><label class="lbl" for="pl-motivo">Motivo (ex.: troquei com Cad. Silva)</label><input id="pl-motivo"></div>
           <button class="btn" type="button" data-pl="pular">Tirar este plantão do calendário</button></div>`}
    <div class="linha"><button class="btn" type="button" data-pl="ics">Pôr na agenda do celular</button><button class="btn link dir" type="button" data-pl="editar">Editar ciclo</button></div>`;
  $('#plantao-corpo').dataset.chave = chave;
  abrirFolha('#dlg-plantao');
}
$('#plantao-corpo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pl]'); if (!b) return;
  const it = acharItem(e.currentTarget.dataset.chave); if (!it) return;
  const c = store.get().ciclos.find((x) => x.id === it.cicloId);
  const exc = (c.excecoes || {})[it.inicio];
  const acao = b.dataset.pl;
  if (acao === 'concluir') store.excecaoCiclo(c.id, it.inicio, exc?.tipo === 'concluido' ? null : { tipo: 'concluido' });
  if (acao === 'pular') store.excecaoCiclo(c.id, it.inicio, { tipo: 'pulado', motivo: $('#pl-motivo').value.trim() });
  if (acao === 'restaurar') store.excecaoCiclo(c.id, it.inicio, null);
  if (acao === 'ics') return baixar('plantao.ics', gerarICS([it]), 'text/calendar');
  if (acao === 'editar') { fecharFolha('#dlg-plantao'); return abrirCiclo(c.id); }
  fecharFolha('#dlg-plantao');
  toast(acao === 'pular' ? 'Plantão retirado do calendário' : 'Plantão atualizado');
});

/* ---- Importar escala (PDF ou publicada pela turma) ---- */
/**
 * ui.imp = { etapa: 'inicio'|'lendo'|'resultado'|'erro', modo: 'importar'|'publicar',
 *            tipo, linhas (todas), nomeArquivo, origem: 'pdf'|'turma', erro }
 */
function abrirImportar(modo = 'importar') {
  ui.imp = { etapa: 'inicio', modo };
  desenharImportar();
  abrirFolha('#dlg-importar');
}
let EXT = null; // escalasExtras.js, carregado sob demanda
async function abrirEscalaPublicada(id) {
  const e = ui.turma.escalas.find((x) => x.id === id);
  if (!e) return;
  ui.imp = { etapa: 'resultado', modo: 'importar', tipo: e.tipo, linhas: e.linhas || [], nomeArquivo: e.titulo, origem: 'turma' };
  if (e.tipo === 'qts' && e.linhas?.[0]?.dias) { ui.imp.qts = e.linhas[0]; desenharImportar(); abrirFolha('#dlg-importar'); return; }
  if (!['interna', 'rotina'].includes(e.tipo)) {
    EXT ||= await import('./escalasExtras.js');
    ui.imp.doc = { tipo: e.tipo, titulo: e.titulo, linhas: e.linhas || [] };
  }
  desenharImportar();
  abrirFolha('#dlg-importar');
}
function meusServicosDaEscala(imp, cfg) {
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const alvo = norm(imp.tipo === 'interna' ? cfg.nomeCompleto : cfg.nomeGuerra);
  if (!alvo) return null;
  return imp.linhas.filter((l) => norm(l.nome) === alvo);
}
function tituloEscala(imp) {
  const datas = imp.linhas.map((l) => l.data).sort();
  if (!datas.length) return imp.nomeArquivo || 'Escala';
  const f = (d) => d.split('-').reverse().slice(0, 2).join('/');
  return `${imp.tipo === 'interna' ? 'Serviço Interno' : 'Missões de Rotina'} · ${f(datas[0])} a ${f(datas[datas.length - 1])}`;
}
function desenharImportar() {
  const imp = ui.imp, cfg = store.get().config, corpo = $('#importar-corpo');
  $('#importar-t').textContent = imp.modo === 'publicar' ? 'Publicar escala para a turma' : 'Importar escala';
  const nomes = `<div class="dupla">
      <div class="campo"><label class="lbl" for="im-ncompleto">Seu nome completo</label><input id="im-ncompleto" value="${esc(cfg.nomeCompleto || '')}" placeholder="Como está no Serviço Interno"></div>
      <div class="campo"><label class="lbl" for="im-nguerra">Nome de guerra</label><input id="im-nguerra" value="${esc(cfg.nomeGuerra || '')}" placeholder="Como está na Rotina"></div></div>`;
  if (imp.etapa === 'inicio') {
    corpo.innerHTML = `<p class="dica">Escolha o PDF: <b>QTS</b>, <b>Serviço Interno</b>, <b>Rotina</b>, <b>Desfile</b>, <b>Representação</b>, <b>Comando</b>, <b>Suplência</b>${imp.modo === 'publicar' ? '' : ', <b>Planilha de Anotados</b> ou <b>NAMCE</b>'}. O arquivo é lido aqui no aparelho${imp.modo === 'publicar' ? ' e a escala inteira fica disponível para a turma' : ' e nada é enviado'}.</p>
      ${imp.modo === 'importar' ? nomes : ''}
      <label class="btn pri" for="arquivo-pdf" style="text-align:center;cursor:pointer">Escolher PDF</label>`;
    return;
  }
  if (imp.etapa === 'lendo') { corpo.innerHTML = '<p class="carregando">Lendo a escala…</p>'; return; }
  if (imp.etapa === 'erro') {
    corpo.innerHTML = `<p class="erro">${esc(imp.erro)}</p><label class="btn" for="arquivo-pdf" style="text-align:center;cursor:pointer">Escolher outro PDF</label>`;
    return;
  }
  if (imp.qts) return desenharQtsImport(imp, corpo);
  if (imp.doc) return desenharDocumento(imp, cfg, corpo, nomes);
  // resultado
  const titulo = tituloEscala(imp);
  const podePublicar = imp.origem === 'pdf' && ui.conta && (ui.conta.admin || ui.conta.papel === 'escalante');
  if (imp.modo === 'publicar') {
    const dias = new Set(imp.linhas.map((l) => l.data)).size;
    corpo.innerHTML = `<div class="previa"><b>${esc(titulo)}</b><span>${imp.linhas.length} ${imp.tipo === 'interna' ? 'linhas' : 'células'} em ${dias} dias.</span></div>
      <div class="campo"><label class="lbl" for="im-titulo">Título para a turma</label><input id="im-titulo" value="${esc(titulo)}"></div>
      <p class="dica">Os cadetes liberados verão a escala na aba Turma e importam só os próprios serviços.</p>
      <div class="linha"><button class="btn pri" type="button" data-imp="publicar">Publicar</button><label class="btn" for="arquivo-pdf" style="cursor:pointer">Outro PDF</label></div>`;
    return;
  }
  const meus = meusServicosDaEscala(imp, cfg);
  const missoes = meus ? linhasParaMissoes(meus, { fardamento: cfg.fardamentoPadrao || '' }) : [];
  const existentes = new Set(store.get().missoes.map((m) => m.id));
  imp.missoes = missoes;
  const nomeUsado = imp.tipo === 'interna' ? 'nome completo' : 'nome de guerra';
  corpo.innerHTML = `<div class="previa"><b>${esc(titulo)}</b><span>${imp.linhas.length} ${imp.tipo === 'interna' ? 'linhas lidas' : 'nomes lidos'}${imp.origem === 'turma' ? ' · publicada na turma' : ''}.</span></div>
    ${nomes}
    ${meus == null ? `<p class="erro">Preencha o seu ${nomeUsado} para achar os seus serviços.</p>`
      : !missoes.length ? `<p class="erro">Nenhum serviço com esse ${nomeUsado}. Confira se está escrito como na escala.</p>`
      : `<span class="lbl">${missoes.length} serviço${missoes.length > 1 ? 's' : ''} seu${missoes.length > 1 ? 's' : ''}</span>
        <div class="imp-lista">${missoes.map((m, i) => `<label class="imp-item${existentes.has(m.id) ? ' existe' : ''}"><input type="checkbox" data-imp-sel="${i}" checked>
          <span><b>${esc(m.titulo)}</b>${m.detalhe && m.subtipo !== 'sobreaviso' ? ' · ' + esc(m.detalhe) : ''}<small>${esc(rotuloDia(m.inicio))} · ${esc(horario(m))}${existentes.has(m.id) ? ' · já está na agenda (horário será atualizado)' : ''}</small></span></label>`).join('')}</div>
        <button class="btn pri" type="button" data-imp="adicionar">Adicionar à agenda</button>`}
    ${podePublicar ? '<button class="btn" type="button" data-imp="ir-publicar">Publicar esta escala para a turma</button>' : ''}
    <button class="btn link" type="button" data-imp="ver-todos">Ver a escala completa (todos)</button>`;
}
function desenharQtsImport(imp, corpo) {
  const q = imp.qts;
  const aulas = q.dias.reduce((n, d) => n + d.aulas.filter((a) => a.sigla && !ehIndisponivel(a.sigla)).length, 0);
  const discs = new Set(q.dias.flatMap((d) => d.aulas.filter((a) => a.sigla && !ehIndisponivel(a.sigla)).map((a) => siglaBase(a.sigla))));
  const ja = (store.get().config.qts || []).some((s) => s.id === q.id);
  const podePublicar = imp.origem === 'pdf' && ui.conta && (ui.conta.admin || ui.conta.papel === 'escalante');
  if (imp.modo === 'publicar') {
    corpo.innerHTML = `<div class="previa"><b>${esc(q.titulo)}</b><span>${esc(q.turma)}</span></div>
      <div class="campo"><label class="lbl" for="im-titulo">Título para a turma</label><input id="im-titulo" value="${esc(q.titulo)}"></div>
      <div class="linha"><button class="btn pri" type="button" data-imp="publicar">Publicar</button><label class="btn" for="arquivo-pdf" style="cursor:pointer">Outro PDF</label></div>`;
    return;
  }
  corpo.innerHTML = `<div class="previa"><b>${esc(q.titulo)}</b><span>${esc(q.turma)} · ${aulas} aulas de ${discs.size} disciplinas${imp.origem === 'turma' ? ' · publicado na turma' : ''}</span></div>
    <div class="imp-lista">${q.dias.map((d) => { const bl = blocosDoDia(d.aulas).filter((b) => b.sigla && !ehIndisponivel(b.sigla));
      return `<div class="imp-item anot"><span><b>${DIAS_CURTOS[d.dow]} ${d.data.split('-').reverse().slice(0, 2).join('/')}</b> ${bl.length ? bl.map((b) => `${esc(b.sigla)} ${b.ini}`).join(' · ') : '<span class="cinza">sem aula</span>'}</span></div>`; }).join('')}</div>
    <button class="btn pri" type="button" data-imp="salvar-qts">${ja ? 'Atualizar esta semana no QTS' : 'Salvar no QTS'}</button>
    ${podePublicar ? '<button class="btn" type="button" data-imp="ir-publicar">Publicar este QTS para a turma</button>' : ''}`;
}

/** Desfile, Representação, Comando, Suplência, Planilha de Anotados e NAMCE. */
function desenharDocumento(imp, cfg, corpo, nomes) {
  const doc = imp.doc, E = EXT;
  const podePublicar = imp.origem === 'pdf' && E.PUBLICAVEIS.includes(doc.tipo) && ui.conta && (ui.conta.admin || ui.conta.papel === 'escalante');
  const cab = `<div class="previa"><b>${esc(doc.titulo)}</b><span>${esc(E.NOMES_DOC[doc.tipo] || 'Documento')}${doc.semTexto ? '' : ` · ${doc.linhas.length} linha${doc.linhas.length === 1 ? '' : 's'} lida${doc.linhas.length === 1 ? '' : 's'}`}${imp.origem === 'turma' ? ' · publicada na turma' : ''}</span></div>`;
  if (imp.modo === 'publicar') {
    corpo.innerHTML = E.PUBLICAVEIS.includes(doc.tipo) ? `${cab}
      <div class="campo"><label class="lbl" for="im-titulo">Título para a turma</label><input id="im-titulo" value="${esc(doc.titulo)}"></div>
      <p class="dica">Os cadetes liberados verão a escala na aba Turma e importam só o que é deles.</p>
      <div class="linha"><button class="btn pri" type="button" data-imp="publicar">Publicar</button><label class="btn" for="arquivo-pdf" style="cursor:pointer">Outro PDF</label></div>`
      : `${cab}<p class="erro">Este documento não é publicado para a turma${doc.tipo === 'anotados' || doc.tipo === 'namce' ? ' (é disciplinar: cada cadete importa o próprio)' : ' (vem como imagem: cada cadete marca a própria função)'}.</p><label class="btn" for="arquivo-pdf" style="text-align:center;cursor:pointer">Escolher outro PDF</label>`;
    return;
  }
  const disciplinar = doc.tipo === 'anotados' || doc.tipo === 'namce';
  const comando = doc.tipo === 'comando' || doc.tipo === 'suplencia';
  if (doc.tipo === 'namce' && !imp.sexta) imp.sexta = E.sextaDasMce(new Date());
  const minhas = comando ? [] : E.minhasLinhas(doc, cfg);
  const funcao = imp.funcao === 'outra' ? (imp.funcaoOutra || '').trim() : imp.funcao;
  const missoes = E.missoesDoDocumento(doc, minhas, { funcao, sexta: imp.sexta });
  imp.missoes = missoes;
  imp.registros = disciplinar ? E.registrosDisciplina(doc, minhas) : [];
  const existentes = new Set(store.get().missoes.map((m) => m.id));
  const lista = missoes.length ? `<span class="lbl">${missoes.length} compromisso${missoes.length > 1 ? 's' : ''} para a agenda</span>
    <div class="imp-lista">${missoes.map((m, i) => `<label class="imp-item${existentes.has(m.id) ? ' existe' : ''}"><input type="checkbox" data-imp-sel="${i}" checked>
      <span><b>${esc(m.titulo)}</b><small>${esc(rotuloDia(m.inicio))} · ${esc(horario(m))}${m.local ? ' · ' + esc(m.local) : ''}${existentes.has(m.id) ? ' · já está na agenda (será atualizado)' : ''}</small></span></label>`).join('')}</div>` : '';
  let meio = '';
  if (comando) {
    const opc = E.FUNCOES_COMANDO.map((f) => `<option${imp.funcao === f ? ' selected' : ''}>${esc(f)}</option>`).join('');
    meio = `<p class="dica">Nesta escala os nomes estão em imagem no PDF, então o app não consegue lê-los. Confira o organograma e escolha a sua função${doc.tipo === 'suplencia' ? ' de suplente' : ''}.</p>
      <div class="campo"><label class="lbl" for="im-funcao">Sua função na semana</label><select id="im-funcao"><option value="">Não estou nesta escala</option>${opc}<option value="outra"${imp.funcao === 'outra' ? ' selected' : ''}>Outra…</option></select></div>
      ${imp.funcao === 'outra' ? `<div class="campo"><label class="lbl" for="im-funcao-outra">Qual função?</label><input id="im-funcao-outra" value="${esc(imp.funcaoOutra || '')}" placeholder="Ex.: Cmd. 1º PM Echo"></div>` : ''}`;
  } else {
    const nomeUsado = disciplinar ? 'nome de guerra' : 'nome completo';
    const falta = disciplinar ? !cfg.nomeGuerra : !(cfg.nomeCompleto || cfg.nomeGuerra);
    const minhasHtml = disciplinar && minhas.length ? `<span class="lbl">Seu nome aparece ${minhas.length} vez${minhas.length > 1 ? 'es' : ''}</span>
      <div class="imp-lista">${minhas.map((l) => { const k = E.codigosMce(l.mce); return `<div class="imp-item anot ${l.tipoAnot === 'FO+' ? 'pos' : 'neg'}"><span><b>${l.tipoAnot} · ${esc(l.data.split('-').reverse().join('/'))}</b> ${esc(l.texto)}<small>${esc(l.anotador || '')}${doc.tipo === 'namce' && l.tipoAnot === 'AAD' ? ' · MCE: ' + esc(k.situacao || k.codigos.join(' + ') || '—') : ''}</small></span></div>`; }).join('')}</div>` : '';
    meio = `${nomes}
      ${doc.tipo === 'namce' ? `<div class="campo"><label class="lbl" for="im-sexta">Sexta-feira do cumprimento</label><input id="im-sexta" type="date" value="${esc(imp.sexta)}"></div>` : ''}
      ${falta ? `<p class="erro">Preencha o seu ${nomeUsado} para achar o que é seu.</p>`
        : !minhas.length ? `<p class="ok-msg">${disciplinar ? 'Seu nome de guerra não aparece neste documento.' : `Nenhuma linha com esse ${nomeUsado}. Confira se está escrito como no PDF.`}</p>` : minhasHtml}`;
  }
  const botao = missoes.length ? `<button class="btn pri" type="button" data-imp="adicionar">Adicionar à agenda${imp.registros.length ? ' e ao histórico' : ''}</button>`
    : imp.registros.length ? '<button class="btn pri" type="button" data-imp="adicionar">Guardar no histórico disciplinar</button>' : '';
  corpo.innerHTML = `${cab}${meio}${lista}${botao}
    ${disciplinar && minhas.length ? '<p class="dica">As anotações ficam só na sua agenda (criptografada). Veja em Missões › Notas › Disciplina.</p>' : ''}
    ${podePublicar ? '<button class="btn" type="button" data-imp="ir-publicar">Publicar esta escala para a turma</button>' : ''}
    ${TIPOS_CONSULTA[doc.tipo] && doc.linhas.length ? '<button class="btn link" type="button" data-imp="ver-todos">Ver a escala completa (todos)</button>' : ''}`;
}
async function lerPdfEscolhido(arquivo) {
  ui.imp = { ...(ui.imp || { modo: 'importar' }), etapa: 'lendo', nomeArquivo: arquivo.name };
  desenharImportar();
  try {
    const pdf = await import('./escalaPdf.js');
    const itens = await pdf.extrairItens(arquivo);
    if (ehQts(itens)) {
      const qts = lerQts(itens);
      if (!qts.dias.length) throw new Error('Não encontrei as páginas dos dias neste QTS.');
      Object.assign(ui.imp, { etapa: 'resultado', tipo: 'qts', qts, linhas: [qts], origem: 'pdf' });
      desenharImportar();
      return;
    }
    EXT ||= await import('./escalasExtras.js');
    const extra = EXT.detectarTipoExtra(itens);
    if (extra) {
      const doc = EXT.lerDocumento(extra, itens);
      if (!doc.semTexto && !doc.linhas.length) throw new Error(`Não encontrei a tabela da ${EXT.NOMES_DOC[extra]} neste PDF.`);
      Object.assign(ui.imp, { etapa: 'resultado', tipo: extra, doc, linhas: doc.linhas, origem: 'pdf', funcao: '', funcaoOutra: '', sexta: '' });
      if (TIPOS_CONSULTA[extra] && doc.linhas.length) ui.imp.docId = guardarDocSinc({ tipo: extra, titulo: doc.titulo, linhas: doc.linhas, numero: doc.numero, meta: { evento: doc.evento, local: doc.local, fardamento: doc.fardamento } });
      desenharImportar();
      return;
    }
    const tipo = pdf.detectarTipo(itens);
    if (!tipo) throw new Error('Não reconheci este PDF. O app lê: QTS, Serviço Interno, Rotina, Desfile, Representação, Comando, Suplência, Planilha de Anotados e NAMCE.');
    const linhas = tipo === 'interna' ? pdf.lerEscalaInterna(itens) : pdf.lerEscalaRotina(itens, new Date());
    if (!linhas.length) throw new Error('Não encontrei a tabela da escala neste PDF.');
    Object.assign(ui.imp, { etapa: 'resultado', tipo, linhas, origem: 'pdf' });
    ui.imp.docId = guardarDocSinc({ tipo, titulo: tituloEscala(ui.imp), linhas });
  } catch (e) {
    console.error(e);
    Object.assign(ui.imp, { etapa: 'erro', erro: e.message?.startsWith('Não') ? e.message : 'Não foi possível ler este PDF.' });
  }
  desenharImportar();
}
$('#importar-corpo').addEventListener('change', (e) => {
  const imp = ui.imp; if (!imp?.doc) return;
  if (e.target.id === 'im-funcao') imp.funcao = e.target.value;
  else if (e.target.id === 'im-funcao-outra') imp.funcaoOutra = e.target.value;
  else if (e.target.id === 'im-sexta') imp.sexta = e.target.value;
  else return;
  desenharImportar();
});
$('#importar-corpo').addEventListener('input', (e) => {
  if (e.target.id !== 'im-ncompleto' && e.target.id !== 'im-nguerra') return;
  const nomes = { nomeCompleto: $('#im-ncompleto').value.trim(), nomeGuerra: $('#im-nguerra').value.trim() };
  clearTimeout(lerPdfEscolhido.t);
  lerPdfEscolhido.t = setTimeout(() => {
    store.setConfig(nomes);
    if (ui.imp?.etapa === 'resultado') { const id = document.activeElement?.id; const pos = document.activeElement?.selectionStart; desenharImportar(); const el = id && $('#' + id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (err) {} } }
  }, 350);
});
$('#importar-corpo').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-imp]'); if (!b) return;
  const imp = ui.imp;
  if (b.dataset.imp === 'adicionar') {
    const sel = $$('[data-imp-sel]').filter((x) => x.checked).map((x) => imp.missoes[+x.dataset.impSel]);
    const regs = imp.registros || [];
    if (!sel.length && !regs.length) return toast('Nenhum serviço marcado');
    if (regs.length) {
      const atual = store.get().config.disciplina || [];
      const ids = new Set(atual.map((r) => r.id));
      store.setConfig({ disciplina: [...atual, ...regs.filter((r) => !ids.has(r.id))] });
    }
    if (!sel.length) { fecharFolha('#dlg-importar'); return toast('Guardado no histórico disciplinar'); }
    const novas = store.salvarMissoes(sel);
    fecharFolha('#dlg-importar');
    vibrar(25);
    toast(novas === sel.length ? `${novas} serviço${novas > 1 ? 's' : ''} na agenda` : `${novas} novo${novas === 1 ? '' : 's'}, ${sel.length - novas} atualizado${sel.length - novas === 1 ? '' : 's'}`);
  }
  if (b.dataset.imp === 'salvar-qts') {
    const novas = guardarSemana(store.get().config.qts, imp.qts);
    store.setConfig({ qts: novas });
    const mantidas = novas.find((x) => x.id === imp.qts.id)?.mantidas || 0;
    setTimeout(aplicarAltsQts, 300);
    fecharFolha('#dlg-importar'); vibrar(25);
    ui.qts = { dia: ymdL(Math.max(Date.now(), new Date(imp.qts.dias[0].data + 'T00:00').getTime())), modo: 'dia' };
    ui.vista = 'qts'; renderizar(); toast(`QTS da semana ${imp.qts.semana} salvo${mantidas ? ` · ${mantidas} alteração(ões) sua(s) mantida(s)` : ''}`);
  }
  if (b.dataset.imp === 'ver-todos') {
    if (!imp.docId) imp.docId = guardarDocSinc({ tipo: imp.tipo, titulo: imp.doc?.titulo || imp.nomeArquivo || tituloEscala(imp), linhas: imp.linhas, numero: imp.doc?.numero, meta: imp.doc ? { evento: imp.doc.evento, local: imp.doc.local, fardamento: imp.doc.fardamento } : {} });
    fecharFolha('#dlg-importar');
    ui.todos = { doc: imp.docId, busca: '', data: '' };
    ui.vista = 'escalas'; ui.esc.todos = true; renderizar();
  }
  if (b.dataset.imp === 'ir-publicar') { imp.modo = 'publicar'; desenharImportar(); }
  if (b.dataset.imp === 'publicar') {
    b.disabled = true;
    try {
      await nuvem.publicarEscala({ tipo: imp.tipo, titulo: $('#im-titulo').value.trim() || (imp.qts ? imp.qts.titulo : imp.doc ? imp.doc.titulo : tituloEscala(imp)), linhas: JSON.parse(JSON.stringify(imp.linhas).replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '')) });
      fecharFolha('#dlg-importar'); toast('Escala publicada para a turma');
      ui.turma.carregado = false; carregarTurma();
    } catch (err) { b.disabled = false; toast(mensagemErro(err)); }
  }
});
$('#arquivo-pdf').addEventListener('change', (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (!$('#dlg-importar').open) { ui.imp = { modo: 'importar' }; abrirFolha('#dlg-importar'); }
  lerPdfEscolhido(f);
});
$('#rapido-pdf').addEventListener('click', () => { fecharFolha('#dlg-rapido'); abrirImportar('importar'); });

/* ---- Trocas de serviço pelo app ----
 * Regras da EsFO conferidas pelo app (e pelo Firebase, nas regras de segurança):
 *  - só com colega da MESMA turma;
 *  - o serviço ainda não começou e não há outro pedido aberto para ele;
 *  - o fiscalizador precisa ser informado (nome obrigatório e mensagem pronta);
 *  - quem recebe não pode assumir se já tiver serviço no mesmo horário.
 * Aceita a troca, a agenda dos dois se atualiza sozinha.
 */
let trocaAlvo = null;
async function abrirPedidoTroca(chave) {
  const it = acharItem(chave); if (!it) return;
  if (!ui.turma.carregado) await carregarTurma();
  const perfil = ui.turma.perfil;
  if (!perfil) { fecharFolha('#dlg-missao'); ui.vista = 'turma'; renderizar(); return toast('Entre na turma primeiro para pedir trocas.'); }
  trocaAlvo = { it, perfil, colegas: null, escolhido: '', fiscal: store.get().config.ultimoFiscal || '' };
  fecharFolha('#dlg-missao');
  desenharTroca();
  abrirFolha('#dlg-troca');
  try { trocaAlvo.colegas = await nuvem.colegasDaTurma(perfil.turma); }
  catch (e) { trocaAlvo.erro = mensagemErro(e); trocaAlvo.colegas = []; }
  desenharTroca();
}
function regrasDoPedido(t) {
  const aberto = ui.turma.trocas.some((x) => x.enviada && x.servico?.chave === t.it.chave && ['pendente', 'aceita'].includes(x.status));
  return [
    { ok: true, txt: `Colegas da mesma turma (${t.perfil.turma})` },
    { ok: t.it.inicio > Date.now(), txt: t.it.inicio > Date.now() ? 'Serviço ainda não começou' : 'O serviço já começou: não dá mais para trocar' },
    { ok: !aberto, txt: aberto ? 'Já existe um pedido aberto para este serviço' : 'Nenhum outro pedido aberto para este serviço' },
    { ok: !!(t.fiscal || '').trim(), txt: (t.fiscal || '').trim() ? `Fiscalizador: ${t.fiscal.trim()}` : 'Informe o fiscalizador' },
  ];
}
function desenharTroca() {
  const t = trocaAlvo, corpo = $('#troca-corpo');
  const regras = regrasDoPedido(t);
  const pode = t.escolhido && regras.every((r) => r.ok);
  corpo.innerHTML = `<div class="previa"><b>${esc(t.it.titulo)}</b><span>${esc(dataCurta(t.it))}${t.it.fim ? ' → ' + ddmm(t.it.fim) + ' ' + hhmm(t.it.fim) : ''}</span>${t.it.detalhe ? `<span>${esc(t.it.detalhe)}</span>` : ''}</div>
    <span class="lbl">Colega da turma ${esc(t.perfil.turma)}</span>
    ${t.colegas == null ? '<p class="carregando">Buscando colegas…</p>'
      : t.colegas.length ? `<div class="chips">${t.colegas.map((c) => chip({ rotulo: 'Cad. ' + (c.nomeGuerra || c.nome), ativo: t.escolhido === c.email, dados: `data-colega="${esc(c.email)}"` })).join('')}</div>`
      : `<p class="erro">${esc(t.erro || 'Nenhum colega desta turma entrou no app ainda.')}</p>`}
    ${(() => {
      const livres = livresParaTroca(listarDocs(ui.conta?.uid), ymdL(t.it.inicio), store.get().config);
      if (!livres) return '';
      if (!livres.length) return '<p class="dica">Pela escala completa, ninguém da sua turma está livre na véspera, no dia e no dia seguinte.</p>';
      return `<div class="caixa"><span class="lbl">Livres pela escala <small>sem serviço na véspera, no dia e no dia seguinte · menos escalados primeiro</small></span>
        <div class="livres">${livres.slice(0, 12).map((x) => { const c = (t.colegas || []).find((cc) => casaColega(x.nome, cc));
          return c ? `<button type="button" class="chip peq${t.escolhido === c.email ? ' sel' : ''}" data-colega="${esc(c.email)}">${esc(x.nome)} · ${x.servicos} serv. · no app</button>` : `<span class="chip peq off">${esc(x.nome)} · ${x.servicos} serv.</span>`; }).join('')}</div></div>`;
    })()}
    <div class="campo"><label class="lbl" for="tr-fiscal">Fiscalizador a ser informado</label><input id="tr-fiscal" placeholder="Ex.: Ten. Silva" value="${esc(t.fiscal || '')}"></div>
    <div class="campo"><label class="lbl" for="tr-motivo">Motivo</label><input id="tr-motivo" placeholder="Ex.: consulta médica, viagem" value="${esc(t.motivo || '')}"></div>
    <div class="caixa"><span class="lbl">Regras da troca</span><div class="regras-troca">${regras.map((r) => `<span class="${r.ok ? '' : 'nao'}">${esc(r.txt)}</span>`).join('')}</div></div>
    <p class="dica">Quando o colega aceitar, o serviço sai da sua agenda e entra na dele automaticamente. Os dados vão criptografados entre vocês dois.</p>
    <button class="btn pri" type="button" data-tr="enviar" ${pode ? '' : 'disabled'}>Enviar pedido</button>`;
}
$('#troca-corpo').addEventListener('input', (e) => {
  if (e.target.id === 'tr-fiscal' || e.target.id === 'tr-motivo') {
    trocaAlvo.fiscal = $('#tr-fiscal').value; trocaAlvo.motivo = $('#tr-motivo').value;
    const regras = regrasDoPedido(trocaAlvo);
    $('#troca-corpo .regras-troca').innerHTML = regras.map((r) => `<span class="${r.ok ? '' : 'nao'}">${esc(r.txt)}</span>`).join('');
    $('[data-tr="enviar"]').disabled = !(trocaAlvo.escolhido && regras.every((r) => r.ok));
  }
});
$('#troca-corpo').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-colega]');
  if (c) { trocaAlvo.motivo = $('#tr-motivo').value; trocaAlvo.fiscal = $('#tr-fiscal').value; trocaAlvo.escolhido = c.dataset.colega; return desenharTroca(); }
  const b = e.target.closest('[data-tr="enviar"]'); if (!b) return;
  const t = trocaAlvo, it = t.it;
  t.fiscal = $('#tr-fiscal').value.trim(); t.motivo = $('#tr-motivo').value.trim();
  if (!t.escolhido || !regrasDoPedido(t).every((r) => r.ok)) return desenharTroca();
  const colega = t.colegas.find((x) => x.email === t.escolhido);
  b.disabled = true;
  try {
    const servico = { titulo: it.titulo, subtipo: it.subtipo, categoria: it.categoria, inicio: it.inicio, fim: it.fim, diaTodo: it.diaTodo, local: it.local || '', detalhe: it.detalhe || '', chave: it.chave,
      escala: it.escala ? { fardamento: it.escala.fardamento || '', posto: it.escala.posto || '', funcao: it.escala.funcao || '' } : null };
    await nuvem.pedirTroca({ colega, meuPerfil: t.perfil, servico, motivo: t.motivo, fiscal: t.fiscal });
    store.setConfig({ ultimoFiscal: t.fiscal });
    if (it.origem === 'missao') store.registrarTroca(it.id, { comQuem: 'Cad. ' + (colega.nomeGuerra || colega.nome), motivo: t.motivo, status: 'solicitada' });
    fecharFolha('#dlg-troca'); toast('Pedido enviado. Quando o colega aceitar, sua agenda se atualiza.');
    ui.turma.carregado = false; carregarTurma();
  } catch (err) { b.disabled = false; toast(err.code === 'sem-chave' ? 'Ative a sincronização em Ajustes primeiro.' : mensagemErro(err)); }
});

/** Texto pronto para avisar o fiscal da troca. */
function textoFiscal(t) {
  const sv = t.servico || {};
  const quem = (n) => 'Cad. ' + n;
  return `${t.fiscal ? t.fiscal + ', ' : 'Sr. Fiscal, '}informo a troca de serviço:\n${SUBTIPOS[sv.subtipo]?.rotulo || sv.titulo}${sv.detalhe ? ' (' + sv.detalhe + ')' : ''} de ${dataCurta(sv)}${sv.fim ? ' a ' + ddmm(sv.fim) + ' ' + hhmm(sv.fim) : ''}.\nSai: ${quem(t.deNome)}\nEntra: ${quem(t.paraNome)}${t.motivo ? '\nMotivo: ' + t.motivo : ''}\nAmbos de acordo (mesma turma, ${t.turma}).`;
}
async function compartilharTexto(texto, titulo) {
  try { if (navigator.share) { await navigator.share({ title: titulo, text: texto }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(texto); toast('Texto copiado. Cole no WhatsApp ou e-mail.'); }
  catch (e) { prompt('Copie o texto:', texto); }
}
/** Serviços da escala que batem com o horário do serviço oferecido (para quem vai assumir). */
function conflitos(sv) {
  const fim = sv.fim || sv.inicio + 3600000;
  return itensNoIntervalo(sv.inicio - 1, fim + 1).filter((i) => SUBTIPOS_ESCALA.includes(i.subtipo) && i.subtipo !== 'sobreaviso' && i.status === 'pendente'
    && i.chave !== sv.chave && i.inicio < fim && fimEfetivo(i) > sv.inicio);
}
function assumirServico(t) {
  const sv = t.servico;
  store.salvarMissao({ id: `troca-${t.id}`, titulo: sv.titulo, categoria: sv.categoria || SUBTIPOS[sv.subtipo]?.categoria || 'operacional', subtipo: sv.subtipo, prioridade: 'critico',
    inicio: sv.inicio, fim: sv.fim, diaTodo: !!sv.diaTodo, local: sv.local || '', detalhe: sv.detalhe || '', obs: `Troca com Cad. ${t.deNome}${t.motivo ? ' · ' + t.motivo : ''}${t.fiscal ? ' · fiscal: ' + t.fiscal : ''}`,
    lembretes: lembretesPadrao(sv.subtipo, 'critico'), checklist: checklistPadrao(sv.subtipo),
    escala: sv.escala ? { ...sv.escala, fardamento: sv.escala.fardamento || store.get().config.fardamentoPadrao || '' } : null,
    trocas: [{ em: Date.now(), comQuem: 'Cad. ' + t.deNome, status: 'aprovada', motivo: 'Assumido por troca' }] });
}
function liberarServico(t) {
  const sv = t.servico;
  if (sv?.chave?.startsWith('ciclo:')) { const [, cid, ini] = sv.chave.split(':'); store.excecaoCiclo(cid, +ini, { tipo: 'pulado', motivo: `Troca com Cad. ${t.paraNome}` }); }
  else if (sv?.chave && store.get().missoes.some((m) => m.id === sv.chave)) { store.salvarMissao({ id: sv.chave, status: 'pulado' }); store.registrarTroca(sv.chave, { comQuem: 'Cad. ' + t.paraNome, status: 'aprovada', motivo: t.motivo || '' }); }
}
function devolverServico(t) {
  const sv = t.servico;
  if (sv?.chave?.startsWith('ciclo:')) { const [, cid, ini] = sv.chave.split(':'); const c = store.get().ciclos.find((x) => x.id === cid); if (c?.excecoes?.[ini]?.tipo === 'pulado') store.excecaoCiclo(cid, +ini, null); }
  else if (sv?.chave) { const m = store.get().missoes.find((x) => x.id === sv.chave); if (m?.status === 'pulado') store.salvarMissao({ id: m.id, status: 'pendente' }); }
}
/**
 * Mantém a agenda igual ao estado das trocas: aceita → quem pediu sai e quem aceitou entra;
 * desfeita → volta como era. Roda ao abrir o app e a cada atualização da aba Turma.
 */
function aplicarTrocas() {
  const ap = { ...(store.get().config.trocasAplicadas || {}) };
  let mudou = false;
  for (const t of ui.turma.trocas) {
    if (t.ilegivel || !t.servico) continue;
    if (t.status === 'aceita' && !ap[t.id]) { t.enviada ? liberarServico(t) : assumirServico(t); ap[t.id] = Date.now(); mudou = true; }
    else if (t.status !== 'aceita' && ap[t.id]) { t.enviada ? devolverServico(t) : store.excluirMissao(`troca-${t.id}`); delete ap[t.id]; mudou = true; }
  }
  if (mudou) { store.setConfig({ trocasAplicadas: ap }); toast('Agenda atualizada pelas trocas de serviço'); }
}
async function acaoTroca(acao, id) {
  const t = ui.turma.trocas.find((x) => x.id === id); if (!t) return;
  try {
    if (acao === 'aceita') {
      const c = conflitos(t.servico);
      if (c.length) { toast(`Você já tem ${SUBTIPOS[c[0].subtipo]?.rotulo || 'serviço'} nesse horário (${dataCurta(c[0])}). Não dá para aceitar.`); ui.turma.carregado = false; return carregarTurma(); }
      if (t.servico.inicio <= Date.now()) { toast('Esse serviço já começou: não dá mais para aceitar.'); ui.turma.carregado = false; return carregarTurma(); }
    }
    if (['aceita', 'recusada', 'cancelada'].includes(acao)) {
      await nuvem.responderTroca(id, acao);
      t.status = acao;
      aplicarTrocas();
      toast(acao === 'aceita' ? 'Troca aceita: o serviço entrou na sua agenda. Agora avise o fiscal.' : acao === 'recusada' ? 'Troca recusada' : 'Troca desfeita: a agenda voltou como era');
    }
    if (acao === 'apagar') { await nuvem.apagarTroca(id); toast('Apagada'); }
    if (acao === 'fiscal') return compartilharTexto(textoFiscal(t), 'Troca de serviço');
    ui.turma.carregado = false; carregarTurma();
  } catch (e) { toast(mensagemErro(e)); }
}

/* ============ eventos globais ============ */
document.addEventListener('click', async (e) => {
  const t = e.target;
  const ir = t.closest('[data-ir]');
  if (ir) { ui.vista = ir.dataset.ir; renderizar(); scrollTo({ top: 0 }); if (ui.vista === 'ajustes' && ui.conta?.admin) carregarAdmin(); if (ui.vista === 'turma') carregarTurma(); return; }
  const ck = t.closest('[data-ck]');
  if (ck) { const [id, i] = ck.dataset.ck.split(':'); store.marcarChecklist(id, +i); vibrar(10); return; }
  const tr = t.closest('[data-troca]'); if (tr) { tr.disabled = true; return acaoTroca(tr.dataset.troca, tr.dataset.id); }
  const escB = t.closest('[data-escala]'); if (escB) return abrirEscalaPublicada(escB.dataset.escala);
  const fb = t.closest('[data-falta]');
  if (fb) {
    const [dia, a, b, sigla] = fb.dataset.falta.split('|');
    const f = { ...(store.get().config.faltas || {}) };
    const tem = Array.from({ length: +b - +a + 1 }, (_, i) => chaveAula(dia, +a + i)).some((k) => f[k]);
    for (let i = +a; i <= +b; i++) { const k = chaveAula(dia, i); if (tem) delete f[k]; else f[k] = sigla; }
    store.setConfig({ faltas: f }); toast(tem ? 'Falta desmarcada' : `Falta marcada (${+b - +a + 1} aula${+b > +a ? 's' : ''})`); return;
  }
  const tdd = t.closest('[data-todosdata]'); if (tdd) { ui.todos.data = tdd.dataset.todosdata; renderizar(); return; }
  const qn = t.closest('[data-qtsnav]');
  if (qn) { const sems = store.get().config.qts || []; const i = sems.indexOf(semanaDoDia(sems, ui.qts.dia)) + +qn.dataset.qtsnav; if (sems[i]) ui.qts.dia = sems[i].dias[0].data; renderizar(); return; }
  const qe = t.closest('[data-qtsed]'); if (qe) { const [dia, a, b] = qe.dataset.qtsed.split('|'); abrirEdicaoQts(dia, a, b); return; }
  const qm = t.closest('[data-qtsmodo]'); if (qm) { ui.qts.modo = qm.dataset.qtsmodo; renderizar(); return; }
  const qd = t.closest('[data-qtsdia]'); if (qd) { ui.qts.dia = qd.dataset.qtsdia; if (qd.dataset.qtsir) ui.qts.modo = 'dia'; renderizar(); return; }
  if (t.closest('[data-ir-rotina]')) { ui.vista = 'missoes'; ui.mis.status = 'rotina'; renderizar(); return; }
  const rvrm = t.closest('[data-rvrm]');
  if (rvrm) { const r = configRevista(store.get().config); const itens = r.itens.filter((_, i) => i !== +rvrm.dataset.rvrm); store.setConfig({ revista: { ...(store.get().config.revista || {}), itens } }); return; }
  const glrm = t.closest('[data-glrm]');
  if (glrm) { store.setConfig({ geladeira: (store.get().config.geladeira || []).filter((a) => a.id !== glrm.dataset.glrm) }); toast('Tirado da lista'); return; }
  const discB = t.closest('[data-disc-rm]');
  if (discB) {
    const cfg = store.get().config;
    store.setConfig({ disciplina: (cfg.disciplina || []).filter((r) => r.id !== discB.dataset.discRm) });
    renderizar(); return toast('Anotação removida do histórico');
  }
  const escRm = t.closest('[data-escala-rm]');
  if (escRm) { if (!confirm('Apagar esta escala publicada?')) return; try { await nuvem.apagarEscala(escRm.dataset.escalaRm); toast('Escala apagada'); ui.turma.carregado = false; carregarTurma(); } catch (err) { toast(mensagemErro(err)); } return; }
  const avRm = t.closest('[data-aviso-rm]');
  if (avRm) { try { await nuvem.apagarAviso(avRm.dataset.avisoRm); toast('Aviso apagado'); ui.turma.carregado = false; carregarTurma(); } catch (err) { toast(mensagemErro(err)); } return; }
  const ctRm = t.closest('[data-contato-rm]');
  if (ctRm) { const l = [...(store.get().config.contatos || [])]; l.splice(+ctRm.dataset.contatoRm, 1); store.setConfig({ contatos: l }); return; }
  const rn = t.closest('[data-relnav]');
  if (rn) { const k = +rn.dataset.relnav, r = ui.rel.ref; ui.rel.ref = ui.rel.modo === 'mes' ? new Date(r.getFullYear(), r.getMonth() + k, 1) : new Date(r.getFullYear() + k, 0, 1); renderizar(); return; }
  const rmd = t.closest('[data-relmodo]'); if (rmd) { ui.rel.modo = rmd.dataset.relmodo; renderizar(); return; }
  const adm = t.closest('[data-adm]');
  if (adm) {
    const acao = adm.dataset.adm;
    let email = adm.dataset.email;
    if (acao === 'atualizar') { ui.adm = null; renderAjustes(); return carregarAdmin(); }
    if (acao === 'stats') {
      adm.disabled = true;
      try { ui.stats = await nuvem.estatisticas(); } catch (err) { ui.stats = { erro: mensagemErro(err) }; }
      return renderAjustes();
    }
    if (acao === 'liberar-novo') {
      email = ($('#adm-email').value || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { ui.admErro = 'Digite um e-mail válido.'; return renderAjustes(); }
    }
    adm.disabled = true;
    try {
      if (acao === 'liberar' || acao === 'liberar-novo') { await definirAcesso(email, true); toast(`${email} liberado`); }
      if (acao === 'bloquear') { await definirAcesso(email, false); toast(`${email} bloqueado`); }
      if (acao === 'remover') { await removerAcesso(email); toast(`${email} apagado da lista`); }
      if (acao === 'escalante') { await definirPapel(email, 'escalante'); toast(`${email} agora é escalante`); }
      if (acao === 'tirar-escalante') { await definirPapel(email, ''); toast(`${email} deixou de ser escalante`); }
      ui.admErro = '';
    } catch (err) { ui.admErro = mensagemErro(err); }
    return carregarAdmin();
  }

  const chk = t.closest('[data-check]');
  if (chk) {
    const chave = chk.dataset.check;
    if (chave.startsWith('ciclo:')) {
      const it = acharItem(chave);
      store.excecaoCiclo(it.cicloId, it.inicio, it.status === 'concluida' ? null : { tipo: 'concluido' });
    } else store.alternarMissao(chave);
    vibrar(20);
    return;
  }
  const ab = t.closest('[data-abrir]');
  if (ab && ab.dataset.abrir) { const k = ab.dataset.abrir; return k.startsWith('ciclo:') ? abrirPlantao(k) : abrirMissao(k); }
  if (ab) { abrirRapido(); return; } // contagem sem item

  const dp = t.closest('[data-diapainel]'); if (dp) { ui.diaPainel = new Date(+dp.dataset.diapainel); renderizar(); return; }
  const de = t.closest('[data-diaesc]');
  if (de) { const d = new Date(+de.dataset.diaesc); ui.esc.sel = d; if (ui.esc.modo === 'mes' && d.getMonth() !== ui.esc.ref.getMonth()) ui.esc.ref = new Date(d.getFullYear(), d.getMonth(), 1); renderizar(); return; }
  const nv = t.closest('[data-nav]');
  if (nv) { const k = +nv.dataset.nav; const r = ui.esc.ref; ui.esc.ref = ui.esc.modo === 'mes' ? new Date(r.getFullYear(), r.getMonth() + k, 1) : somaDias(r, 7 * k); renderizar(); return; }
  const md = t.closest('[data-modo]');
  if (md) { const v = md.dataset.modo; if (v === 'hoje') { ui.esc.ref = ui.esc.sel = inicioDoDia(Date.now()); } else { ui.esc.modo = v; ui.esc.ref = v === 'semana' ? ui.esc.sel : new Date(ui.esc.sel.getFullYear(), ui.esc.sel.getMonth(), 1); } renderizar(); return; }
  const cc = t.closest('[data-ciclo]'); if (cc) return abrirCiclo(cc.dataset.ciclo);
  const rm = t.closest('[data-remover]'); if (rm) { removerHistorico([rm.dataset.remover]); return; }
  const ms = t.closest('[data-mstatus]'); if (ms) { ui.mis.status = ms.dataset.mstatus; ui.confirmarLimpar = false; renderizar(); return; }
  const mc = t.closest('[data-mcat]'); if (mc) { ui.mis.cat = mc.dataset.mcat; renderizar(); return; }
  const tm = t.closest('[data-tema]');
  if (tm) { store.setConfig({ tema: tm.dataset.tema }); aplicarTema(); return; }

  const ac = t.closest('[data-acao]'); if (!ac) return;
  switch (ac.dataset.acao) {
    case 'missao-no-dia': ui.diaAlvo = ui.esc.sel; abrirRapido(); break;
    case 'novo-ciclo': abrirCiclo(null); break;
    case 'sair-conta': await sairDaConta(); location.reload(); break;
    case 'limpar-pedir': ui.confirmarLimpar = true; renderizar(); break;
    case 'limpar-nao': ui.confirmarLimpar = false; renderizar(); break;
    case 'limpar-sim': ui.confirmarLimpar = false; removerHistorico(ac.dataset.chaves.split('|').filter(Boolean)); break;
    case 'salvar-nome': store.setConfig({ nome: $('#aj-nome').value.trim() || 'Cadete' }); toast('Nome salvo'); break;
    case 'salvar-nomes': store.setConfig({ nomeCompleto: $('#aj-ncompleto').value.trim(), nomeGuerra: $('#aj-nguerra').value.trim(), fardamentoPadrao: $('#aj-fard').value.trim() }); toast('Salvo'); break;
    case 'importar-pdf': abrirImportar('importar'); break;
    case 'esc-todos': ui.esc.todos = true; renderizar(); break;
    case 'qts-desfazer-dia': { const sems = store.get().config.qts || []; const sem = semanaDoDia(sems, ui.qts.dia); store.setConfig({ qts: restaurarAulas(sems, sem.id, ui.qts.dia) }); toast('Dia voltou ao QTS original'); break; }
    case 'esc-minha': ui.esc.todos = false; renderizar(); break;
    case 'td-eu': ui.todos.busca = store.get().config.nomeGuerra || store.get().config.nomeCompleto || ''; renderizar(); break;
    case 'td-apagar': apagarDoc(ui.conta?.uid, ui.todos.doc); if (temNuvem()) nuvem.agendarSincronizacao(); ui.todos.doc = ''; toast('Documento apagado do aparelho'); renderizar(); break;
    case 'revista-pronta': { const r = revistaDoDia(store.get().config, Date.now()); store.setConfig({ revistaHoje: { data: r.dia, ok: r.itens.map((_, i) => i), feita: true } }); vibrar(25); toast('Revista pronta. Bom dia!'); break; }
    case 'lx-editar': ui.editLicenca = ac.dataset.k; renderizar(); break;
    case 'lx-cancelar': ui.editLicenca = null; renderizar(); break;
    case 'lx-padrao': case 'lx-salvar': {
      const lic = { ...(store.get().config.licenca || {}) }; const ex = { ...(lic.excecoes || {}) };
      if (ac.dataset.acao === 'lx-padrao') delete ex[ac.dataset.k];
      else {
        const sa = $('#lx-saida').value, re = $('#lx-ret').value;
        if (!sa || !re || re <= sa) { toast('O retorno precisa ser depois da saída'); break; }
        ex[ac.dataset.k] = { saida: sa, retorno: re };
      }
      // guarda só as exceções recentes
      for (const k of Object.keys(ex)) if (k < ymdL(Date.now() - 60 * DIA)) delete ex[k];
      ui.editLicenca = null; store.setConfig({ licenca: { ...lic, excecoes: ex } });
      toast(ac.dataset.acao === 'lx-padrao' ? 'Licença voltou ao padrão' : 'Licença deste fim de semana alterada'); break;
    }
    case 'lc-salvar': store.setConfig({ licenca: { ...(store.get().config.licenca || {}), ativo: $('#lc-ativo').checked, saidaDia: +$('#lc-sdia').value, saidaHora: $('#lc-shora').value || '18:00', retornoDia: +$('#lc-rdia').value, retornoHora: $('#lc-rhora').value || '19:00' } }); toast('Licença salva'); break;
    case 'rs-salvar': store.setConfig({ resumo: { ativo: $('#rs-ativo').checked, hora: $('#rs-hora').value || '21:00' } }); toast('Resumo da noite salvo'); break;
    case 'rv-add': { const v = $('#rv-novo').value.trim(); if (!v) break; const r = configRevista(store.get().config); store.setConfig({ revista: { ...(store.get().config.revista || {}), itens: [...r.itens, v] } }); break; }
    case 'rv-padrao': { const { itens, ...resto } = store.get().config.revista || {}; store.setConfig({ revista: resto }); toast('Itens padrão restaurados'); break; }
    case 'rv-salvar': {
      const dias = $$('[data-rvdia]').filter((x) => x.checked).map((x) => +x.dataset.rvdia);
      store.setConfig({ revista: { ...(store.get().config.revista || {}), ativo: $('#rv-ativo').checked, hora: $('#rv-hora').value || '06:00', dias } });
      toast('Revista salva'); break;
    }
    case 'gl-add': {
      const item = $('#gl-item').value.trim(), validade = $('#gl-val').value;
      if (!item || !validade) { toast('Preencha o alimento e a validade'); break; }
      store.setConfig({ geladeira: [...(store.get().config.geladeira || []), { id: novoId(), item, validade }] }); toast('Guardado na lista'); break;
    }
    case 'rl-salvar': { const v = Math.max(0, Math.round(+$('#rl-horas').value || 0)); store.setConfig({ prazoRelatorioHoras: v }); if (v) aplicarRelatorios(); toast(v ? `Prazo do relatório: ${v} h` : 'Prazo automático desligado'); break; }
    case 'publicar-escala': abrirImportar('publicar'); break;
    case 'add-contato': {
      const nome = $('#aj-ct-nome').value.trim(), tel = $('#aj-ct-tel').value.trim();
      if (!nome || !tel) { toast('Preencha nome e telefone'); break; }
      store.setConfig({ contatos: [...(store.get().config.contatos || []), { nome, tel }] }); toast('Contato salvo'); break;
    }
    case 'nova-prova': ui.diaAlvo = inicioDoDia(Date.now()); abrirMissao(null, { modelo: MODELOS.find((m) => m.id === 'prova'), dia: Date.now() }); break;
    case 'compartilhar-rel': compartilharTexto(ui.relTexto || '', 'Relatório de serviços'); break;
    case 'ativar-sinc': {
      const senha = $('#aj-senha').value;
      if (!senha) { ui.senhaErro = 'Digite a senha.'; renderAjustes(); break; }
      ac.disabled = true; ac.textContent = 'Aguarde…';
      try { const r = await nuvem.ativarComSenha(senha); ui.senhaErro = ''; toast(r === 'ok' ? 'Sincronização ligada' : r === 'chave-diferente' ? 'A cópia na nuvem usa outra senha' : 'Chave criada; sincroniza quando houver internet'); }
      catch (err) { ui.senhaErro = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? 'Senha incorreta.' : mensagemErro(err); }
      renderAjustes(); break;
    }
    case 'sincronizar': { ac.disabled = true; const r = await nuvem.sincronizar(); toast(r === 'ok' ? 'Sincronizado' : r === 'offline' ? 'Sem internet agora' : r === 'sem-chave' ? 'Confirme a senha para ligar' : 'Não foi possível sincronizar'); renderAjustes(); break; }
    case 'substituir-cofre': if (confirm('Substituir a cópia da nuvem pela agenda deste aparelho?')) { const r = await nuvem.substituirCofre(); toast(r === 'ok' ? 'Cópia substituída' : 'Não foi possível'); renderAjustes(); } break;
    case 'ligar-push': {
      ac.disabled = true; ac.textContent = 'Aguarde…';
      try { await nuvem.ativarPush(); toast('Avisos com o app fechado ligados'); }
      catch (err) { toast(err.code === 'sem-chave' ? 'Ligue a sincronização (abaixo) antes.' : err.message || 'Não foi possível ligar'); }
      renderAjustes(); break;
    }
    case 'desligar-push': await nuvem.desativarPush(); toast('Avisos com o app fechado desligados'); renderAjustes(); break;
    case 'testar-aviso': {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg && Notification.permission === 'granted') reg.showNotification('Agenda do Cadete', { body: 'Os avisos estão funcionando neste aparelho.', icon: 'icon-192.png', tag: 'teste' });
      else toast('Avisos não autorizados neste aparelho');
      break;
    }
    case 'gcal-sinc': {
      ac.disabled = true; ac.textContent = 'Sincronizando…';
      const k = `agenda-cadete:gcal:${ui.conta?.uid || 'local'}`;
      let info = null; try { info = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
      try {
        const agora = Date.now();
        const itens = itensNoIntervalo(agora - DIA, agora + 60 * DIA).filter((i) => i.status === 'pendente');
        const r = await sincronizarAgenda(itens, (i) => SUBTIPOS[i.subtipo]?.rotulo || '', info?.ids || []);
        localStorage.setItem(k, JSON.stringify({ em: Date.now(), ids: r.ids }));
        toast(`Google Agenda: ${r.criados} novos, ${r.atualizados} atualizados, ${r.apagados} removidos`);
      } catch (err) { toast(err.message || 'Falha ao sincronizar com o Google'); }
      renderAjustes(); break;
    }
    case 'gcal-sair': gcalDesconectar(); try { localStorage.removeItem(`agenda-cadete:gcal:${ui.conta?.uid || 'local'}`); } catch (e) {} toast('Google Agenda desconectado (os eventos já criados continuam lá)'); renderAjustes(); break;
    case 'turma-atualizar': ui.turma.carregado = false; renderTurma(); break;
    case 'editar-perfil': ui.turma.editarPerfil = true; renderTurma(); break;
    case 'cancelar-perfil': ui.turma.editarPerfil = false; renderTurma(); break;
    case 'salvar-perfil': {
      const dados = { nome: $('#pf-nome').value, nomeGuerra: $('#pf-guerra').value, turma: $('#pf-turma').value, participar: true };
      if (!dados.nome.trim() || !dados.nomeGuerra.trim() || !TURMAS.includes(dados.turma)) { toast('Preencha nome, nome de guerra e escolha a turma'); break; }
      ac.disabled = true;
      try {
        ui.turma.perfil = await nuvem.salvarPerfil(dados); ui.turma.editarPerfil = false;
        store.setConfig({ nomeCompleto: store.get().config.nomeCompleto || dados.nome.trim(), nomeGuerra: store.get().config.nomeGuerra || dados.nomeGuerra.trim(), turma: dados.turma.trim() });
        toast('Perfil da turma salvo');
      } catch (err) { toast(err.code === 'sem-chave' ? 'Ative a sincronização em Ajustes primeiro (ela cria a sua chave).' : mensagemErro(err)); }
      renderTurma(); break;
    }
    case 'sair-turma': if (confirm('Sair da turma? Colegas não poderão mais pedir trocas a você.')) { try { await nuvem.salvarPerfil({ participar: false }); ui.turma.perfil = null; toast('Você saiu da turma'); } catch (err) { toast(mensagemErro(err)); } renderTurma(); } break;
    case 'publicar-aviso': {
      const titulo = $('#av-titulo').value.trim();
      if (!titulo) { toast('Escreva o título do aviso'); break; }
      ac.disabled = true;
      try { await nuvem.publicarAviso(titulo, $('#av-texto').value, $('#av-imp').checked); toast('Aviso publicado'); ui.turma.carregado = false; carregarTurma(); }
      catch (err) { ac.disabled = false; toast(mensagemErro(err)); }
      break;
    }
    case 'notificar': await pedirAvisos(); break;
    case 'instalar': if (ui.instalar) { ui.instalar.prompt(); await ui.instalar.userChoice.catch(() => {}); ui.instalar = null; renderizar(); } break;
    case 'backup': baixar(`agenda-cadete-backup-${paraData(Date.now())}.json`, store.exportar(), 'application/json'); toast('Backup baixado'); break;
    case 'ics-tudo': {
      const agora = Date.now();
      const itens = itensNoIntervalo(agora, agora + 60 * DIA).filter((i) => i.status === 'pendente');
      if (!itens.length) { toast('Nada pendente nos próximos 60 dias'); break; }
      baixar('agenda-cadete.ics', gerarICS(itens), 'text/calendar');
      toast(`${itens.length} missões exportadas. Abra o arquivo para adicionar à agenda.`);
      break;
    }
  }
});
document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('ck-serv')) ui.ckServAberto = e.target.open; }, true);
document.addEventListener('input', (e) => {
  if (e.target.id === 'qts-pct') {
    const v = parseInt(e.target.value, 10);
    if (v >= 0 && v <= 100) { clearTimeout(ui.tPct); ui.tPct = setTimeout(() => { store.setConfig({ limiteFaltasPct: v }); $('#qts-pct')?.focus(); }, 600); }
    return;
  }
  if (e.target.id === 'nt-min') {
    const v = parseFloat(e.target.value.replace(',', '.'));
    if (v >= 0 && v <= 10) { clearTimeout(ui.tMin); ui.tMin = setTimeout(() => { store.setConfig({ mediaMinima: v }); const el = $('#nt-min'); el?.focus(); }, 500); }
    return;
  }
  if (e.target.id === 'td-busca') {
    ui.todos.busca = e.target.value;
    const pos = e.target.selectionStart;
    renderTodos(Date.now());
    const novo = $('#td-busca'); novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (err) {}
    return;
  }
  if (e.target.id === 'm-busca') {
    ui.mis.busca = e.target.value;
    const pos = e.target.selectionStart;
    renderMissoes(Date.now());
    const novo = $('#m-busca'); novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (err) {}
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'td-doc') { ui.todos = { doc: e.target.value, busca: '', data: '' }; renderizar(); return; }
  const rv = e.target.closest?.('[data-rev]'); if (!rv) return;
  const r = revistaDoDia(store.get().config, Date.now());
  const ok = new Set(r.ok); rv.checked ? ok.add(+rv.dataset.rev) : ok.delete(+rv.dataset.rev);
  store.setConfig({ revistaHoje: { data: r.dia, ok: [...ok], feita: false } });
});
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'aj-importar' || !e.target.files[0]) return;
  try { store.importar(await e.target.files[0].text()); toast('Backup restaurado'); }
  catch (err) { toast(err.message || 'Arquivo inválido'); }
  e.target.value = '';
});

function aplicarTema() {
  const t = store.get().config.tema;
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const escuro = t === 'escuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').content = escuro ? '#121d31' : '#1c2f52';
}

/* ============ 5. relógio, lembretes, instalação ============ */
async function pedirAvisos() {
  if (!('Notification' in window)) return toast('Este navegador não oferece avisos.');
  const r = await Notification.requestPermission();
  toast(r === 'granted' ? 'Avisos ativados' : 'Avisos não autorizados');
  renderizar();
}

async function verificarLembretes() {
  const agora = Date.now();
  const vencidos = lembretesVencidos(agora);
  // modo "em serviço": só o que é crítico toca; o resto chega em silêncio
  const emServico = vencidos.length && emServicoAgora(agora).length > 0;
  for (const { it, min, chave } of vencidos) {
    const { titulo, corpo } = textoLembrete(it, min);
    const silencioso = emServico && it.prioridade !== 'critico';
    let mostrou = false;
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.showNotification(titulo, { body: corpo, tag: chave, icon: 'icon-192.png', badge: 'icon-192.png', data: { chave: it.chave }, requireInteraction: it.prioridade === 'critico' && !silencioso, silent: silencioso });
        else new Notification(titulo, { body: corpo, tag: chave, icon: 'icon-192.png' });
        mostrou = true;
      } catch (e) { /* cai no aviso interno */ }
    }
    if (!mostrou && document.visibilityState === 'visible') toast(`${titulo}: ${it.titulo}`);
    store.marcarAvisado(chave);
  }
  // revista, geladeira (não vêm de missões)
  const { avisados } = store.get();
  for (const x of [...lembretesExtras(store.get().config, agora - 6 * 3600000, agora), ...lembretesResumo(agora - 3 * 3600000, agora), ...lembretesLicenca(agora - 3 * 3600000, agora)]) {
    if (avisados[x.tag]) continue;
    let mostrou = false;
    if ('Notification' in window && Notification.permission === 'granted') {
      try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { await reg.showNotification(x.titulo, { body: x.corpo, tag: x.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { chave: x.chave }, silent: emServicoAgora(agora).length > 0 }); mostrou = true; } } catch (e) { /* aviso interno */ }
    }
    if (!mostrou && document.visibilityState === 'visible') toast(`${x.titulo}`);
    store.marcarAvisado(x.tag);
  }
}

let ultimoMinuto = -1;
function tique() {
  const agora = Date.now();
  if (ui.vista === 'painel' && !$('#contagem').hidden) renderContagem(agora);
  $$('[data-cd-fim]').forEach((el) => { el.textContent = contagem(Math.max(0, +el.dataset.cdFim - agora)); });
  const minuto = Math.floor(agora / 60000);
  if (minuto !== ultimoMinuto) {
    ultimoMinuto = minuto;
    aplicarRelatorios();
    if (!document.querySelector('dialog[open]') && document.activeElement?.id !== 'm-busca' && document.activeElement?.id !== 'td-busca' && document.activeElement?.id !== 'qts-pct' && !ui.editLicenca && !document.activeElement?.closest?.('#v-missoes .ajuste')) renderizar();
    verificarLembretes();
  }
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.instalar = e; renderizar(); });
window.addEventListener('appinstalled', () => { ui.instalar = null; toast('App instalado na tela inicial'); renderizar(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { ultimoMinuto = -1; tique(); } });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', aplicarTema);

// abre a missão quando o aviso é tocado (mensagem vinda do service worker)
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.tipo === 'abrir' && e.data.chave) abrirChave(e.data.chave);
});

// atalho do ícone (ex.: ./#escalas) abre direto na aba
const hashInicial = location.hash.replace('#', '');
if (['painel', 'escalas', 'qts', 'missoes', 'turma', 'ajustes'].includes(hashInicial)) ui.vista = hashInicial;
// aviso tocado com o app fechado: ./#abrir=<chave>
const abrirAoIniciar = hashInicial.startsWith('abrir=') ? decodeURIComponent(hashInicial.slice(6)) : '';

/** Resumo da noite: o que tem no dia seguinte (aulas, compromissos, revista, geladeira, checklist). */
function resumoDoDia(diaYmd) {
  const cfg = store.get().config;
  const d0 = new Date(diaYmd + 'T00:00').getTime();
  const itens = itensNoIntervalo(d0, d0 + DIA).filter((i) => i.status === 'pendente' && i.inicio >= d0 && i.inicio < d0 + DIA).sort((a, b) => a.inicio - b.inicio);
  const sem = semanaDoDia(cfg.qts || [], diaYmd);
  const dia = sem?.dias.find((x) => x.data === diaYmd);
  const aulas = dia ? blocosDoDia(dia.aulas).filter((b) => b.sigla && !ehIndisponivel(b.sigla)).map((b) => ({ ini: b.ini, sigla: siglaBase(b.sigla), local: b.local })) : [];
  const revista = diaDeRevista(cfg, d0 + 12 * 3600000) ? `Revista ${configRevista(cfg).hora}` : '';
  const alimentos = (cfg.geladeira || []).filter((a) => a.validade <= diaYmd).map((a) => a.item);
  const pendencias = itens.filter((i) => i.origem === 'missao').map((i) => { const m = store.get().missoes.find((x) => x.id === i.id); const f = (m?.checklist || []).filter((c) => !c.ok); return f.length ? `Separou para ${i.titulo}? Falta: ${f.slice(0, 3).map((c) => c.t).join(', ')}${f.length > 3 ? '…' : ''}.` : ''; }).filter(Boolean);
  const dt = new Date(d0);
  const fd = fardaDoDia(d0);
  const farda = `Farda: ${fd.farda.replace('Fardamento orgânico', 'orgânico')} · DAG: ${fd.dag.toLowerCase()}${fd.extras.length ? ' · ' + fd.extras.map((x) => x.texto).join(' · ') : ''}`;
  return textoResumo({ rotuloDia: `Amanhã (${DIAS_CURTOS[dt.getDay()].toLowerCase()} ${ddmm(d0)})`, itens: itens.map((i) => ({ titulo: i.titulo, hora: i.diaTodo ? '' : hhmm(i.inicio), local: i.local })), aulas, revista, alimentos, pendencias, farda: aulas.length || itens.length ? farda : '' });
}
function lembretesResumo(de, ate) {
  const r = store.get().config.resumo || {};
  if (r.ativo === false) return [];
  const [h, m] = String(r.hora || '21:00').split(':').map(Number);
  const out = [];
  for (let d = inicioDoDia(de - DIA); d.getTime() <= ate; d = somaDias(d, 1)) {
    const dispara = new Date(d).setHours(h || 0, m || 0, 0, 0);
    if (dispara < de || dispara > ate) continue;
    const txt = resumoDoDia(ymdL(somaDias(d, 1).getTime()));
    if (txt) out.push({ dispara, titulo: txt.titulo, corpo: txt.corpo, chave: 'resumo', tag: `resumo:${ymdL(d.getTime())}`, critico: false });
  }
  return out;
}

/** Abre o que o aviso indica: missão, plantão, revista (painel) ou geladeira (Rotina). */
function abrirChave(k) {
  if (k === 'revista') { ui.vista = 'painel'; ui.diaPainel = inicioDoDia(Date.now()); renderizar(); return; }
  if (k === 'licenca') { ui.vista = 'painel'; ui.diaPainel = inicioDoDia(Date.now()); renderizar(); return; }
  if (k === 'resumo') { ui.vista = 'painel'; ui.diaPainel = somaDias(inicioDoDia(Date.now()), 1); renderizar(); return; }
  if (k === 'geladeira') { ui.vista = 'missoes'; ui.mis.status = 'rotina'; renderizar(); return; }
  ui.vista = 'painel'; renderizar();
  k.startsWith('ciclo:') ? abrirPlantao(k) : abrirMissao(k);
}

/** Próximos lembretes (7 dias) para o disparo com o app fechado. */
function proximosLembretes() {
  const agora = Date.now(), ate = agora + 7 * DIA, out = [];
  for (const it of proximas(agora)) {
    const ancora = it.diaTodo ? it.inicio + 8 * 3600000 : it.inicio;
    for (const min of it.lembretes || []) {
      const dispara = ancora - min * 60000;
      if (dispara <= agora + 60000 || dispara > ate) continue;
      const { titulo, corpo } = textoLembrete(it, min);
      out.push({ dispara, titulo, corpo, chave: it.chave, tag: `${it.chave}@${min}`, critico: it.prioridade === 'critico' });
    }
  }
  for (const x of lembretesExtras(store.get().config, agora + 60000, ate)) out.push(x);
  for (const x of lembretesResumo(agora + 60000, ate)) out.push(x);
  for (const x of lembretesLicenca(agora + 60000, ate)) out.push(x);
  return out.sort((a, b) => a.dispara - b.dispara);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e)));
}

/** PDF enviado pelo "Compartilhar" do celular: o service worker guarda e o app abre a importação. */
async function abrirPdfCompartilhado() {
  const q = new URLSearchParams(location.search);
  if (!q.has('compartilhado')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  try {
    const cache = await caches.open('compartilhado');
    const res = await cache.match('./__compartilhado.pdf');
    if (!res) return toast('Não recebi o PDF compartilhado. Tente de novo.');
    const nome = decodeURIComponent(res.headers.get('X-Nome') || 'escala.pdf');
    const arquivo = new File([await res.blob()], nome, { type: 'application/pdf' });
    await cache.delete('./__compartilhado.pdf');
    ui.imp = { modo: 'importar' }; abrirFolha('#dlg-importar');
    lerPdfEscolhido(arquivo);
  } catch (e) { console.error(e); toast('Não foi possível abrir o PDF compartilhado.'); }
}

/** Abre o app (depois do portão de acesso, quando ele está configurado). */
async function iniciarApp(conta) {
  if (conta) { usarConta(conta.uid); ui.conta = { ...conta, papel: papelDaConta(conta.uid) }; }
  ui.iniciado = true;
  store.assinar(() => renderizar());
  let tRel = null;
  store.assinar(() => { clearTimeout(tRel); tRel = setTimeout(aplicarRelatorios, 400); });
  aplicarTema();
  $('#aba-turma').hidden = !temNuvem();
  renderizar();
  if (ui.conta?.admin && ui.vista === 'ajustes') carregarAdmin();
  setInterval(tique, 1000);
  verificarLembretes();
  pedirArmazenamentoPersistente();
  if (abrirAoIniciar) { history.replaceState(null, '', location.pathname); if (['revista', 'geladeira', 'resumo', 'licenca'].includes(abrirAoIniciar) || acharItem(abrirAoIniciar)) abrirChave(abrirAoIniciar); }
  aplicarRelatorios();
  abrirPdfCompartilhado();
  if (temNuvem()) {
    await aguardarChave(); // a chave do cofre nasce da senha digitada no login
    nuvem.definirFonteLembretes(proximosLembretes);
    nuvem.definirAoReceberDocs(() => { if (ui.vista === 'escalas' && ui.esc.todos) renderizar(); });
    nuvem.aoMudarNuvem(() => { if (ui.vista === 'painel') renderizar(); });
    nuvem.aoMudarNuvem(() => { if (ui.vista === 'ajustes' && !document.activeElement?.closest?.('#v-ajustes input')) renderAjustes(); });
    nuvem.iniciarNuvem(ui.conta);
    let tPush = null;
    store.assinar(() => { clearTimeout(tPush); tPush = setTimeout(() => nuvem.atualizarPush().catch(() => {}), 6000); });
    carregarTurma();
    setInterval(() => { if (document.visibilityState === 'visible') { ui.turma.carregado = ui.vista === 'turma' ? ui.turma.carregado : false; carregarTurma(); } }, 10 * 60000);
  }
}
iniciarPortao(iniciarApp);

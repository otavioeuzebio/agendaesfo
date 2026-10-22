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
import { iniciarPortao, sairDaConta } from './portao.js';
import { listarAcessos, definirAcesso, removerAcesso, mensagemErro } from './acesso.js';
import { itensNoIntervalo, proximoCritico, atrasadas, plantoesDoCiclo, lembretesVencidos, fimEfetivo } from './agenda.js';
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
};

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
  if (it.diaTodo) return 'Dia todo';
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

/* ============ 3. vistas ============ */
function renderTopo(agora) {
  const { config } = store.get();
  $('#nome-cadete').textContent = config.nome || 'Cadete';
  const ext = dataPorExtenso(agora);
  $('#hoje').textContent = ext.charAt(0).toUpperCase() + ext.slice(1);
  $('#contagem').hidden = ui.vista !== 'painel';
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

  $('#v-painel').innerHTML = `<div class="secao" style="gap:18px">
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
    <div class="secao"><h2 class="lbl">Linha do tempo · ${esc(rotuloDia(dia.getTime(), agora))}</h2>${linha}</div>
  </div>`;
}

function renderEscalas(agora) {
  const e = ui.esc;
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

function renderMissoes(agora) {
  const f = ui.mis;
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
    <div class="linha">
      ${chip({ rotulo: 'Pendentes', ativo: f.status === 'pendente', dados: 'data-mstatus="pendente"' })}
      ${chip({ rotulo: 'Concluídas', ativo: f.status === 'concluida', dados: 'data-mstatus="concluida"' })}
    </div>
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

function renderAjustes() {
  const { config, missoes, ciclos } = store.get();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const perm = 'Notification' in window ? Notification.permission : 'indisponivel';
  $('#v-ajustes').innerHTML = `<div class="secao" style="gap:14px">
    <h2 class="titulo-vista">Ajustes</h2>
    <div class="ajuste"><h3>Nome no topo</h3>
      <div class="campo"><input id="aj-nome" value="${esc(config.nome)}" aria-label="Nome exibido no topo"></div>
      <button class="btn pri" type="button" data-acao="salvar-nome">Salvar nome</button></div>
    <div class="ajuste"><h3>Aparência</h3>
      <div class="chips">${[['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']].map(([v, r]) => chip({ rotulo: r, ativo: config.tema === v, dados: `data-tema="${v}"` })).join('')}</div></div>
    <div class="ajuste"><h3>Lembretes</h3>
      <p>Com o app aberto (ou recém-aberto), os lembretes aparecem como aviso do sistema. Para alarmes que tocam <b>mesmo com o app fechado e sem internet</b>, envie as missões para a agenda do celular.</p>
      ${perm === 'granted' ? '<p style="color:var(--ok);font-weight:650">Avisos ativados neste aparelho.</p>'
        : perm === 'denied' ? '<p>Avisos bloqueados. Libere nas configurações do navegador para este site.</p>'
        : perm === 'indisponivel' ? '<p>Este navegador não oferece avisos. Use a agenda do celular.</p>'
        : '<button class="btn" type="button" data-acao="notificar">Ativar avisos</button>'}
      <button class="btn ouro" type="button" data-acao="ics-tudo">Enviar próximos 60 dias para a agenda do celular (.ics)</button></div>
    <div class="ajuste"><h3>Backup</h3>
      <p>Os dados ficam só neste aparelho (${missoes.length} missões, ${ciclos.length} ciclos). Faça backup antes de trocar de celular ou limpar o navegador.</p>
      <div class="linha"><button class="btn pri" type="button" data-acao="backup">Baixar backup</button>
        <label class="btn" for="aj-importar" style="cursor:pointer">Restaurar backup</label>
        <input type="file" id="aj-importar" accept="application/json,.json" hidden></div></div>
    <div class="ajuste"><h3>Instalar no celular</h3>
      ${standalone ? '<p style="color:var(--ok);font-weight:650">Você já está usando o app instalado.</p>'
        : ui.instalar ? '<button class="btn ouro" type="button" data-acao="instalar">Instalar agora</button>'
        : '<p><b>Android (Chrome):</b> menu ⋮ → <i>Instalar app</i> ou <i>Adicionar à tela inicial</i>.<br><b>iPhone (Safari):</b> botão Compartilhar → <i>Adicionar à Tela de Início</i>.</p>'}</div>
    ${ui.conta ? `<div class="ajuste"><h3>Conta</h3>
      <p>Conectado como <b>${esc(ui.conta.email)}</b>${ui.conta.admin ? ' · administrador' : ''}. Sua agenda fica só neste aparelho e ninguém mais tem acesso a ela.</p>
      <button class="btn" type="button" data-acao="sair-conta">Sair da conta</button></div>` : ''}
    ${ui.conta?.admin ? renderAdmin() : ''}
    <p class="rodape">Agenda do Cadete · funciona offline · dados salvos no aparelho</p>
  </div>`;
}

function renderAdmin() {
  const a = ui.adm;
  const item = (email, botoes) => `<div class="adm-item"><span>${esc(email)}</span>${botoes.map(([acao, rot, cls]) => `<button class="btn ${cls || ''}" type="button" data-adm="${acao}" data-email="${esc(email)}">${rot}</button>`).join('')}</div>`;
  const bloco = (titulo, lista, botoes, vazio) => `<div class="adm-sub">${titulo} (${lista.length})</div><div class="adm-lista">${lista.length ? lista.map((e) => item(e, botoes)).join('') : `<p>${vazio}</p>`}</div>`;
  return `<div class="ajuste"><h3>Administração de acessos</h3>
    <p>Você libera ou bloqueia quem pode usar o app. Aqui aparecem só os e-mails: as agendas ficam no aparelho de cada pessoa e você não tem acesso a elas.</p>
    <div class="linha"><div class="campo" style="flex:1;min-width:200px"><input id="adm-email" type="email" inputmode="email" placeholder="e-mail para liberar" aria-label="E-mail para liberar"></div>
      <button class="btn pri" type="button" data-adm="liberar-novo">Liberar</button></div>
    ${ui.admErro ? `<p class="erro">${esc(ui.admErro)}</p>` : ''}
    ${!a ? '<p>Carregando lista…</p>' : `
      ${bloco('Pedidos aguardando', a.pendentes, [['liberar', 'Liberar', 'pri'], ['bloquear', 'Recusar', 'perigo']], 'Nenhum pedido no momento.')}
      ${bloco('Liberados', a.liberados, [['bloquear', 'Bloquear', 'perigo']], 'Ninguém liberado ainda.')}
      ${a.bloqueados.length ? bloco('Bloqueados', a.bloqueados, [['liberar', 'Desbloquear'], ['remover', 'Apagar']], '') : ''}`}
    <button class="btn link" type="button" data-adm="atualizar">Atualizar lista</button></div>`;
}
async function carregarAdmin() {
  try { ui.adm = await listarAcessos(); ui.admErro = ''; }
  catch (e) { ui.admErro = e?.code === 'unavailable' || !navigator.onLine ? 'Sem internet para carregar a lista.' : mensagemErro(e); }
  if (ui.vista === 'ajustes') renderAjustes();
}

function renderizar() {
  if (!ui.iniciado) return; // nada aparece antes do portão de acesso liberar
  const agora = Date.now();
  renderTopo(agora);
  $$('main > section').forEach((s) => (s.hidden = s.dataset.vista !== ui.vista));
  $$('.abas button').forEach((b) => (b.dataset.ir === ui.vista ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (ui.vista === 'painel') renderPainel(agora);
  if (ui.vista === 'escalas') renderEscalas(agora);
  if (ui.vista === 'missoes') renderMissoes(agora);
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
const fm = { editando: null, categoria: 'operacional', subtipo: 'guarda', prioridade: 'critico', lembretes: [], lembManual: false, horarioAuto: false, unidade: '', tituloAuto: '', localAuto: '', detalhe: '' };
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
    horarioAuto: !m && !!horarioPadrao(base.subtipo, new Date(base.inicio)), unidade: base.escala?.unidade || '', tituloAuto: '', localAuto: '', detalhe: base.detalhe || '' });
  $('#m-oficial').value = base.escala?.oficial || '';
  $('#m-titulo').value = base.titulo || '';
  $('#m-data').value = paraData(base.inicio); $('#m-hora').value = base.diaTodo ? '' : paraHora(base.inicio);
  $('#m-diatodo').checked = !!base.diaTodo;
  $('#m-temfim').checked = !!base.fim;
  const fimBase = base.fim || base.inicio + 24 * 3600000;
  $('#m-fimdata').value = paraData(fimBase); $('#m-fimhora').value = paraHora(fimBase);
  $('#m-local').value = base.local || ''; $('#m-obs').value = base.obs || '';
  $('#m-posto').value = base.escala?.posto || ''; $('#m-funcao').value = base.escala?.funcao || ''; $('#m-fard').value = base.escala?.fardamento || '';
  $('#t-com').value = ''; $('#t-motivo').value = ''; $('#t-status').value = 'solicitada';
  desenharTrocas(m);
  desenharFormMissao();
  abrirFolha('#dlg-missao');
  if (modelo) setTimeout(() => (modelo.subtipo === 'estagio_cpu' ? $('#m-unidades button') : modelo.titulo.endsWith(' ') || !modelo.titulo ? $('#m-titulo') : $('#m-data'))?.focus(), 80);
}
function desenharTrocas(m) {
  $('#m-trocas-lista').innerHTML = (m?.trocas || []).map((t) => `<span>${ddmm(t.em)} ${hhmm(t.em)} · com <b>${esc(t.comQuem)}</b> · ${esc(t.status)}${t.motivo ? ' · ' + esc(t.motivo) : ''}</span>`).join('') || '<span>Nenhuma troca registrada.</span>';
}

$('#form-missao').addEventListener('click', (e) => {
  const c = e.target.closest('[data-mc]'), s = e.target.closest('[data-ms]'), p = e.target.closest('[data-mp]'), l = e.target.closest('[data-ml]');
  if (c) { fm.categoria = c.dataset.mc; fm.subtipo = subtiposDe(fm.categoria)[0]; if (!fm.editando) fm.prioridade = prioridadeSugerida(fm.subtipo); if (!fm.lembManual) fm.lembretes = lembretesPadrao(fm.subtipo, fm.prioridade); }
  else if (s) {
    fm.subtipo = s.dataset.ms; fm.detalhe = ''; if (!fm.editando) fm.prioridade = prioridadeSugerida(fm.subtipo); if (!fm.lembManual) fm.lembretes = lembretesPadrao(fm.subtipo, fm.prioridade);
    if (horarioPadrao(fm.subtipo, new Date())) { fm.horarioAuto = true; aplicarHorarioAuto(); }
  }
  else if (e.target.closest('[data-un]')) aplicarUnidade(e.target.closest('[data-un]').dataset.un);
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
  const escala = SUBTIPOS_ESCALA.includes(fm.subtipo) ? { posto: $('#m-posto').value.trim(), funcao: $('#m-funcao').value.trim(), fardamento: $('#m-fard').value.trim(),
    ...(fm.subtipo === 'estagio_cpu' ? { unidade: fm.unidade, crpm: crpmDa(fm.unidade), oficial: $('#m-oficial').value.trim() } : {}) } : null;
  store.salvarMissao({ id: fm.editando || novoId(), titulo, categoria: fm.categoria, subtipo: fm.subtipo, prioridade: fm.prioridade,
    inicio, fim, diaTodo, local: $('#m-local').value.trim(), obs: $('#m-obs').value.trim(), lembretes: fm.lembretes, escala,
    detalhe: OPCOES_TIPO[fm.subtipo] ? fm.detalhe : '' });
  vibrar(25);
  fecharFolha('#dlg-missao');
  toast(fm.editando ? 'Alterações salvas' : `Salvo: ${titulo}`);
});
$('#m-excluir').addEventListener('click', () => { $('#m-confirmar').hidden = false; });
$('#m-nao').addEventListener('click', () => { $('#m-confirmar').hidden = true; });
$('#m-sim').addEventListener('click', () => { store.excluirMissao(fm.editando); fecharFolha('#dlg-missao'); toast('Missão excluída'); });
$('#m-ics').addEventListener('click', () => { const it = acharItem(fm.editando); if (it) baixar('missao.ics', gerarICS([it]), 'text/calendar'); });
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

/* ============ eventos globais ============ */
document.addEventListener('click', async (e) => {
  const t = e.target;
  const ir = t.closest('[data-ir]');
  if (ir) { ui.vista = ir.dataset.ir; renderizar(); scrollTo({ top: 0 }); if (ui.vista === 'ajustes' && ui.conta?.admin) carregarAdmin(); return; }
  const adm = t.closest('[data-adm]');
  if (adm) {
    const acao = adm.dataset.adm;
    let email = adm.dataset.email;
    if (acao === 'atualizar') { ui.adm = null; renderAjustes(); return carregarAdmin(); }
    if (acao === 'liberar-novo') {
      email = ($('#adm-email').value || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { ui.admErro = 'Digite um e-mail válido.'; return renderAjustes(); }
    }
    adm.disabled = true;
    try {
      if (acao === 'liberar' || acao === 'liberar-novo') { await definirAcesso(email, true); toast(`${email} liberado`); }
      if (acao === 'bloquear') { await definirAcesso(email, false); toast(`${email} bloqueado`); }
      if (acao === 'remover') { await removerAcesso(email); toast(`${email} apagado da lista`); }
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
document.addEventListener('input', (e) => {
  if (e.target.id === 'm-busca') {
    ui.mis.busca = e.target.value;
    const pos = e.target.selectionStart;
    renderMissoes(Date.now());
    const novo = $('#m-busca'); novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (err) {}
  }
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
  for (const { it, min, chave } of vencidos) {
    const titulo = `${SUBTIPOS[it.subtipo]?.rotulo || 'Missão'} em ${rotuloAntecedencia(min)}`;
    const corpo = [it.titulo, it.diaTodo ? rotuloDia(it.inicio, agora) : `${rotuloDia(it.inicio, agora)} às ${hhmm(it.inicio)}`, it.local].filter(Boolean).join(' · ');
    let mostrou = false;
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.showNotification(titulo, { body: corpo, tag: chave, icon: 'icon-192.png', badge: 'icon-192.png', data: { chave: it.chave }, requireInteraction: it.prioridade === 'critico' });
        else new Notification(titulo, { body: corpo, tag: chave, icon: 'icon-192.png' });
        mostrou = true;
      } catch (e) { /* cai no aviso interno */ }
    }
    if (!mostrou && document.visibilityState === 'visible') toast(`${titulo}: ${it.titulo}`);
    store.marcarAvisado(chave);
  }
}

let ultimoMinuto = -1;
function tique() {
  const agora = Date.now();
  if (ui.vista === 'painel' && !$('#contagem').hidden) renderContagem(agora);
  const minuto = Math.floor(agora / 60000);
  if (minuto !== ultimoMinuto) {
    ultimoMinuto = minuto;
    if (!document.querySelector('dialog[open]') && document.activeElement?.id !== 'm-busca') renderizar();
    verificarLembretes();
  }
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.instalar = e; renderizar(); });
window.addEventListener('appinstalled', () => { ui.instalar = null; toast('App instalado na tela inicial'); renderizar(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { ultimoMinuto = -1; tique(); } });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', aplicarTema);

// abre a missão quando o aviso é tocado (mensagem vinda do service worker)
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.tipo === 'abrir' && e.data.chave) { ui.vista = 'painel'; renderizar(); const k = e.data.chave; k.startsWith('ciclo:') ? abrirPlantao(k) : abrirMissao(k); }
});

// atalho do ícone (ex.: ./#escalas) abre direto na aba
const hashInicial = location.hash.replace('#', '');
if (['painel', 'escalas', 'missoes', 'ajustes'].includes(hashInicial)) ui.vista = hashInicial;

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e)));
}

/** Abre o app (depois do portão de acesso, quando ele está configurado). */
function iniciarApp(conta) {
  if (conta) { usarConta(conta.uid); ui.conta = conta; }
  ui.iniciado = true;
  store.assinar(() => renderizar());
  aplicarTema();
  renderizar();
  if (ui.conta?.admin && ui.vista === 'ajustes') carregarAdmin();
  setInterval(tique, 1000);
  verificarLembretes();
  pedirArmazenamentoPersistente();
}
iniciarPortao(iniciarApp);

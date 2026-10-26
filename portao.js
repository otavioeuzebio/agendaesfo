/**
 * Portão de acesso: telas de entrar, criar conta, confirmar e-mail e
 * aguardar liberação. Só depois de liberada a conta o app é aberto.
 *
 * Sem configuração do Firebase (firebase-config.js vazio), o app abre direto.
 */
import {
  acessoConfigurado, observarConta, entrar, criarConta, reenviarVerificacao,
  atualizarUsuario, redefinirSenha, sair, situacao, mensagemErro,
} from './acesso.js';
import { guardarChaveDaSenha } from './cripto.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let liberado = false;
let tela = 'entrar';
let emailDigitado = '';
let chavePendente = Promise.resolve();
/** Espera a chave de criptografia (derivada da senha digitada agora) ficar pronta. */
export const aguardarChave = () => chavePendente.catch(() => {});

function mostrar(html) {
  const p = $('#portao');
  p.hidden = false;
  document.body.classList.add('com-portao');
  $('#portao-corpo').innerHTML = html;
  const primeiro = $('#portao-corpo input');
  if (primeiro && matchMedia('(pointer: fine)').matches) primeiro.focus();
}
function esconder() {
  $('#portao').hidden = true;
  document.body.classList.remove('com-portao');
}
function msg(texto, tipo = 'erro') {
  const el = $('#portao-msg');
  if (!el) return;
  el.textContent = texto; el.className = `portao-msg ${tipo}`; el.hidden = !texto;
}
function ocupado(botao, sim) {
  if (!botao) return;
  botao.disabled = sim;
  if (sim) { botao.dataset.rotulo = botao.textContent; botao.textContent = 'Aguarde…'; }
  else if (botao.dataset.rotulo) botao.textContent = botao.dataset.rotulo;
}

const telas = {
  carregando: () => `<p class="portao-txt">Verificando sua conta…</p>`,
  entrar: () => `
    <h2>Entrar</h2>
    <form id="f-entrar" class="portao-form" novalidate>
      <div class="campo"><label class="lbl" for="p-email">E-mail</label><input id="p-email" type="email" autocomplete="username" inputmode="email" value="${esc(emailDigitado)}"></div>
      <div class="campo"><label class="lbl" for="p-senha">Senha</label><input id="p-senha" type="password" autocomplete="current-password"></div>
      <p id="portao-msg" class="portao-msg" hidden></p>
      <button class="btn pri" type="submit">Entrar</button>
    </form>
    <div class="portao-links">
      <button class="btn link" type="button" data-p="criar">Criar conta</button>
      <button class="btn link" type="button" data-p="esqueci">Esqueci a senha</button>
    </div>`,
  criar: () => `
    <h2>Criar conta</h2>
    <p class="portao-txt">Depois de criar, confirme o e-mail. O administrador libera o seu acesso. Sua agenda fica só no seu aparelho: ninguém mais vê.</p>
    <form id="f-criar" class="portao-form" novalidate>
      <div class="campo"><label class="lbl" for="p-email">E-mail</label><input id="p-email" type="email" autocomplete="username" inputmode="email" value="${esc(emailDigitado)}"></div>
      <div class="campo"><label class="lbl" for="p-senha">Senha (mínimo 6 caracteres)</label><input id="p-senha" type="password" autocomplete="new-password"></div>
      <div class="campo"><label class="lbl" for="p-senha2">Repita a senha</label><input id="p-senha2" type="password" autocomplete="new-password"></div>
      <p id="portao-msg" class="portao-msg" hidden></p>
      <button class="btn pri" type="submit">Criar conta</button>
    </form>
    <div class="portao-links"><button class="btn link" type="button" data-p="entrar">Já tenho conta</button></div>`,
  verificar: (u) => `
    <h2>Confirme seu e-mail</h2>
    <p class="portao-txt">Enviamos um link de confirmação para <b>${esc(u.email)}</b>. Abra o e-mail (veja também o spam), toque no link e volte aqui.</p>
    <p id="portao-msg" class="portao-msg" hidden></p>
    <button class="btn pri" type="button" data-p="ja-confirmei">Já confirmei</button>
    <div class="portao-links">
      <button class="btn link" type="button" data-p="reenviar">Reenviar e-mail</button>
      <button class="btn link" type="button" data-p="sair">Sair</button>
    </div>`,
  pendente: (u) => `
    <h2>Aguardando liberação</h2>
    <p class="portao-txt">Seu pedido de acesso para <b>${esc(u.email)}</b> foi enviado ao administrador. Quando ele liberar, toque em "Verificar de novo".</p>
    <p id="portao-msg" class="portao-msg" hidden></p>
    <button class="btn pri" type="button" data-p="verificar-de-novo">Verificar de novo</button>
    <div class="portao-links"><button class="btn link" type="button" data-p="sair">Sair</button></div>`,
  bloqueado: (u) => `
    <h2>Acesso bloqueado</h2>
    <p class="portao-txt">O acesso de <b>${esc(u.email)}</b> foi bloqueado pelo administrador. Fale com ele se achar que é um engano.</p>
    <div class="portao-links"><button class="btn link" type="button" data-p="sair">Sair</button></div>`,
  semRede: () => `
    <h2>Sem internet</h2>
    <p class="portao-txt">Para entrar pela primeira vez neste aparelho é preciso estar conectado. Depois disso, o app funciona offline.</p>
    <button class="btn pri" type="button" data-p="recarregar">Tentar de novo</button>`,
};

function ir(nome, usuario) { tela = nome; mostrar(telas[nome](usuario)); }

/** Decide a tela (ou libera o app) para o usuário atual. */
async function avaliar(user, aoLiberar) {
  if (!user) { if (liberado) return location.reload(); return ir('entrar'); }
  if (!user.emailVerified) return ir('verificar', user);
  ir('carregando');
  // renova o token para as regras já enxergarem o e-mail confirmado (offline, segue com o atual)
  try { await user.getIdToken(true); } catch (e) { /* sem internet */ }
  let s;
  try { s = await situacao(user); }
  catch (e) { return ir('semRede'); }
  if (s === 'admin' || s === 'liberado') {
    if (!liberado) { liberado = true; esconder(); aoLiberar({ email: user.email, uid: user.uid, admin: s === 'admin' }); }
    return;
  }
  ir(s, user);
}

export async function iniciarPortao(aoLiberar) {
  if (!acessoConfigurado()) { aoLiberar(null); return; }
  ir('carregando');
  let usuarioAtual = null;

  $('#portao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#p-email')?.value.trim() || '';
    const senha = $('#p-senha')?.value || '';
    emailDigitado = email;
    const botao = e.target.querySelector('button[type=submit]');
    if (!email) return msg('Digite seu e-mail.');
    if (!senha) return msg('Digite a senha.');
    if (e.target.id === 'f-criar' && senha !== $('#p-senha2').value) return msg('As senhas não conferem.');
    ocupado(botao, true);
    let pronto;
    chavePendente = new Promise((r) => (pronto = r));
    try {
      const cred = e.target.id === 'f-criar' ? await criarConta(email, senha) : await entrar(email, senha);
      // a chave do cofre criptografado nasce da senha, só neste aparelho
      guardarChaveDaSenha(senha, cred.user.uid).then(pronto, pronto);
      // a troca de tela vem do observarConta
    } catch (err) { pronto(); msg(mensagemErro(err)); }
    finally { ocupado(botao, false); }
  });

  $('#portao').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const acao = b.dataset.p;
    if (acao === 'criar' || acao === 'entrar') { emailDigitado = $('#p-email')?.value.trim() || emailDigitado; return ir(acao); }
    if (acao === 'recarregar') return location.reload();
    ocupado(b, true);
    try {
      if (acao === 'esqueci') {
        const email = $('#p-email')?.value.trim();
        if (!email) { msg('Digite seu e-mail acima e toque de novo em "Esqueci a senha".'); return; }
        await redefinirSenha(email);
        msg(`Enviamos um link para redefinir a senha para ${email}.`, 'ok');
      }
      if (acao === 'reenviar') { await reenviarVerificacao(); msg('E-mail reenviado.', 'ok'); }
      if (acao === 'ja-confirmei') {
        const u = await atualizarUsuario();
        if (u && u.emailVerified) { await u.getIdToken(true); return avaliar(u, aoLiberar); }
        msg('Ainda não consta a confirmação. Abra o link do e-mail e tente de novo.');
      }
      if (acao === 'verificar-de-novo') { await avaliar(usuarioAtual, aoLiberar); if (tela === 'pendente') msg('Ainda aguardando liberação.', 'info'); }
      if (acao === 'sair') await sair();
    } catch (err) { msg(mensagemErro(err)); }
    finally { ocupado(b, false); }
  });

  try {
    await observarConta((u) => { usuarioAtual = u; avaliar(u, aoLiberar); });
  } catch (e) {
    ir('semRede');
  }
}

export { sair as sairDaConta };

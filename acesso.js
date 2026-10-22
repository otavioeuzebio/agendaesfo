/**
 * Contas e permissões (Firebase Authentication + Firestore).
 *
 * Coleções no Firestore (nenhum dado de agenda é enviado):
 *   acessos/{email}  → { ativo: true|false, atualizadoEm }   (escrita só do administrador)
 *   pedidos/{email}  → { email, criadoEm }                   (criado pela própria pessoa)
 *
 * As regras de segurança do Firestore (arquivo firestore.rules) garantem que
 * cada pessoa só lê o próprio status e que só o administrador altera acessos.
 */
import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

export const acessoConfigurado = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId);
export const ehAdmin = (email) => ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((email || '').toLowerCase());

let fb = null; // módulos e instâncias carregados sob demanda

async function carregar() {
  if (fb) return fb;
  const [app, auth, fs] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`),
  ]);
  const inst = app.initializeApp(firebaseConfig);
  const a = auth.getAuth(inst);
  a.languageCode = 'pt';
  fb = { auth, fs, a, db: fs.getFirestore(inst) };
  return fb;
}

const norm = (e) => (e || '').trim().toLowerCase();

/** Avisa a cada mudança de login: cb(usuario | null). */
export async function observarConta(cb) {
  const { auth, a } = await carregar();
  auth.onAuthStateChanged(a, cb);
}

export async function entrar(email, senha) {
  const { auth, a } = await carregar();
  return auth.signInWithEmailAndPassword(a, norm(email), senha);
}

export async function criarConta(email, senha) {
  const { auth, a } = await carregar();
  const cred = await auth.createUserWithEmailAndPassword(a, norm(email), senha);
  await auth.sendEmailVerification(cred.user);
  return cred;
}

export async function reenviarVerificacao() {
  const { auth, a } = await carregar();
  if (a.currentUser) await auth.sendEmailVerification(a.currentUser);
}

/** Recarrega o usuário (para saber se já confirmou o e-mail). */
export async function atualizarUsuario() {
  const { a } = await carregar();
  if (a.currentUser) await a.currentUser.reload();
  return a.currentUser;
}

export async function redefinirSenha(email) {
  const { auth, a } = await carregar();
  return auth.sendPasswordResetEmail(a, norm(email));
}

export async function sair() {
  const { auth, a } = await carregar();
  return auth.signOut(a);
}

/**
 * Situação da conta: "admin" | "liberado" | "bloqueado" | "pendente".
 * Sem internet, usa a última situação conhecida neste aparelho.
 */
export async function situacao(user) {
  const email = norm(user.email);
  if (ehAdmin(email)) return 'admin';
  const chave = `agenda-cadete:acesso:${user.uid}`;
  try {
    const { fs, db } = await carregar();
    const snap = await fs.getDoc(fs.doc(db, 'acessos', email));
    let s;
    if (snap.exists()) s = snap.data().ativo === false ? 'bloqueado' : 'liberado';
    else {
      s = 'pendente';
      // registra o pedido para o administrador ver (ignora se já existe)
      await fs.setDoc(fs.doc(db, 'pedidos', email), { email, criadoEm: fs.serverTimestamp() }).catch(() => {});
    }
    try { localStorage.setItem(chave, JSON.stringify({ s, em: Date.now() })); } catch (e) {}
    return s;
  } catch (e) {
    try {
      const salvo = JSON.parse(localStorage.getItem(chave) || 'null');
      if (salvo) return salvo.s; // offline: última situação conhecida
    } catch (e2) {}
    throw e;
  }
}

/* ---------- administração (só funciona para o administrador, pelas regras) ---------- */
export async function listarAcessos() {
  const { fs, db } = await carregar();
  const [pedidos, acessos] = await Promise.all([
    fs.getDocs(fs.collection(db, 'pedidos')),
    fs.getDocs(fs.collection(db, 'acessos')),
  ]);
  const liberados = new Map(acessos.docs.map((d) => [d.id, d.data()]));
  return {
    pendentes: pedidos.docs.map((d) => d.id).filter((e) => !liberados.has(e)).sort(),
    liberados: [...liberados].filter(([, v]) => v.ativo !== false).map(([e]) => e).sort(),
    bloqueados: [...liberados].filter(([, v]) => v.ativo === false).map(([e]) => e).sort(),
  };
}

export async function definirAcesso(email, ativo) {
  const { fs, db } = await carregar();
  email = norm(email);
  await fs.setDoc(fs.doc(db, 'acessos', email), { ativo, atualizadoEm: fs.serverTimestamp() });
  await fs.deleteDoc(fs.doc(db, 'pedidos', email)).catch(() => {});
}

export async function removerAcesso(email) {
  const { fs, db } = await carregar();
  email = norm(email);
  await fs.deleteDoc(fs.doc(db, 'acessos', email));
  await fs.deleteDoc(fs.doc(db, 'pedidos', email)).catch(() => {});
}

/** Traduz os erros mais comuns do Firebase para o usuário. */
export function mensagemErro(e) {
  const c = e?.code || '';
  const m = {
    'auth/invalid-email': 'E-mail inválido.',
    'auth/missing-password': 'Digite a senha.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Use "Entrar".',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem internet. Conecte-se para entrar pela primeira vez.',
    'permission-denied': 'Sem permissão para esta ação.',
  };
  return m[c] || 'Não foi possível concluir. Tente de novo.';
}

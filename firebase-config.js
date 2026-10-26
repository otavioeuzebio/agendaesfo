/**
 * Configuração do controle de acesso (Firebase).
 *
 * Projeto Firebase "agenda-esfo". Esta chave é pública por natureza (identifica o
 * projeto); quem protege os dados são as regras do Firestore (firestore.rules).
 * Para voltar a usar o app SEM login, deixe `apiKey` vazio.
 *
 * O Firebase guarda SÓ as contas (e-mail/senha) e a lista de e-mails
 * liberados. As agendas nunca saem do aparelho de cada pessoa.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyCmFBkytK2xGocP53F0BPlb-39kFtvPB_g',
  authDomain: 'agenda-esfo.firebaseapp.com',
  projectId: 'agenda-esfo',
  appId: '1:32285182241:web:fec6f3a2eda4498e111660',
};

/** E-mails com poder de administrador (liberar e bloquear contas). */
export const ADMIN_EMAILS = [
  'otaviosilva.oe@gmail.com',
];

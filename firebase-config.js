/**
 * Configuração do controle de acesso (Firebase).
 *
 * Projeto Firebase "agenda-esfo". Esta chave é pública por natureza (identifica o
 * projeto); quem protege os dados são as regras do Firestore (firestore.rules).
 * Para voltar a usar o app SEM login, deixe `apiKey` vazio.
 *
 * As agendas ficam no aparelho. Quando a sincronização está ligada, vai para o
 * Firebase só uma cópia CRIPTOGRAFADA com a senha de cada cadete (ninguém mais lê).
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyCmFBkytK2xGocP53F0BPlb-39kFtvPB_g',
  authDomain: 'agenda-esfo.firebaseapp.com',
  projectId: 'agenda-esfo',
  appId: '1:32285182241:web:fec6f3a2eda4498e111660',
  messagingSenderId: '32285182241', // avisos com o app fechado (Firebase Cloud Messaging)
};

/**
 * Google Agenda (opcional): ID do cliente OAuth do tipo "Aplicativo da Web",
 * criado no Google Cloud do projeto agenda-esfo. É público (não é senha).
 * Vazio = botão do Google Agenda fica oculto.
 */
export const GOOGLE_CLIENT_ID = '';

/** E-mails com poder de administrador (liberar e bloquear contas). */
export const ADMIN_EMAILS = [
  'otaviosilva.oe@gmail.com',
];

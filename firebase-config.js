/**
 * Configuração do controle de acesso (Firebase).
 *
 * Enquanto `apiKey` estiver vazio, o app funciona SEM login (como antes).
 * Depois de criar o projeto no Firebase, cole aqui os dados de
 * "Configurações do projeto → Seus apps → Configuração do SDK".
 *
 * O Firebase guarda SÓ as contas (e-mail/senha) e a lista de e-mails
 * liberados. As agendas nunca saem do aparelho de cada pessoa.
 */
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

/** E-mails com poder de administrador (liberar e bloquear contas). */
export const ADMIN_EMAILS = [
  'otaviosilva.oe@gmail.com',
];

# Agenda do Cadete

App (PWA) para a rotina do cadete da EsFO/APMG: Serviço Interno, Missões de Rotina,
Estágio CPU, provas e trabalhos. Funciona offline e é publicado pelo GitHub Pages:
https://otavioeuzebio.github.io/agendaesfo/

## O que tem

- **Agenda e escalas**: modelos prontos com horário automático, ciclos de escala, calendário.
- **Importar escala em PDF** (Serviço Interno ou Rotina): o PDF é lido no aparelho e os serviços do cadete entram sozinhos.
- **Checklist por serviço**, **modo "Em serviço"** (contagem para a rendição, checklist e contatos), **relatório de horas** e **painel de notas** (média ponderada e quanto falta).
- **Sincronização entre aparelhos**: cópia da agenda criptografada com a senha de cada cadete (AES-GCM). Nem o administrador lê.
- **Aba Turma**: mural de avisos (admin), trocas de serviço entre colegas da mesma turma (dados criptografados entre os dois) e escalas publicadas pelo escalante.
- **Avisos com o app fechado** (Firebase Cloud Messaging + rotina do GitHub Actions; o texto vai criptografado).
- **Google Agenda** (opcional) e exportação `.ics`.
- **Estatísticas de uso** para o administrador (só números de acesso).

## Privacidade

O Firebase guarda: e-mails liberados, perfis de quem entra na turma (nome, nome de guerra, turma),
avisos do mural, escalas publicadas e dados **criptografados** (agenda, lembretes, trocas).
A chave nasce da senha de cada cadete e fica no aparelho. Se a pessoa redefinir a senha,
a cópia antiga não abre mais e o app oferece substituí-la pela agenda do aparelho.

## Configuração (uma vez, pelo administrador)

1. **Regras do Firestore**: copie `firestore.rules` para Firebase → Firestore → Regras → Publicar.
2. **Avisos com o app fechado** (opcional):
   - Firebase → Configurações do projeto → Contas de serviço → *Gerar nova chave privada* (baixa um JSON).
   - GitHub → repositório → Settings → Secrets and variables → Actions → *New repository secret*
     nome `FIREBASE_SERVICE_ACCOUNT`, valor = conteúdo do JSON. Depois apague o arquivo baixado.
   - A rotina `.github/workflows/lembretes.yml` roda a cada ~5 min (o GitHub pode atrasar alguns minutos).
3. **Google Agenda** (opcional): no Google Cloud do projeto `agenda-esfo`, ative a *Google Calendar API*,
   configure a tela de consentimento e crie um *ID do cliente OAuth* do tipo **Aplicativo da Web** com a
   origem `https://otavioeuzebio.github.io`. Cole o ID em `GOOGLE_CLIENT_ID` (`firebase-config.js`).
4. **Escalante**: em Ajustes → Administração, toque em *Tornar escalante* no e-mail de quem publica as escalas.

## Desenvolvimento

Sem build: arquivos estáticos. Testes: `node --test tests/*.test.mjs` (rodam também no GitHub Actions).
Ao publicar, aumente `VERSAO` em `sw.js`. `vendor/` contém o pdf.js (licença Apache 2.0).

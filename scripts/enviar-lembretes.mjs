/**
 * Rotina automática (GitHub Actions, a cada ~5 min): envia os lembretes vencidos
 * para os aparelhos com "avisos com o app fechado" ligados.
 *
 * Ela NÃO consegue ler os lembretes: o texto vai criptografado com a chave de
 * cada cadete e só é aberto no próprio aparelho (sw.js). Aqui só se vê o horário.
 */
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('FIREBASE_SERVICE_ACCOUNT não configurado: nada a fazer.');
  process.exit(0);
}
const { default: admin } = await import('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const agora = Date.now();
const JANELA = 2 * 3600000; // atrasos do agendador do GitHub: avisa até 2 h depois
const INVALIDOS = /registration-token-not-registered|invalid-registration-token|invalid-argument/;

let enviados = 0;
const docs = await db.collection('push').get();
for (const d of docs.docs) {
  const { tokens = [], itens = [], enviadoAte = 0 } = d.data();
  if (!tokens.length || !itens.length) continue;
  const desde = Math.max(enviadoAte, agora - JANELA);
  const vencidos = itens.filter((i) => i.t > desde && i.t <= agora + 60000).sort((a, b) => a.t - b.t);
  if (!vencidos.length) continue;
  const ruins = new Set();
  for (const it of vencidos) {
    const r = await admin.messaging().sendEachForMulticast({
      tokens,
      data: { uid: d.id, iv: it.iv, dados: it.dados, t: String(it.t) },
      webpush: { headers: { Urgency: 'high', TTL: '7200' } },
    });
    r.responses.forEach((x, i) => { if (x.success) enviados++; else if (INVALIDOS.test(x.error?.code || '')) ruins.add(tokens[i]); });
  }
  const upd = { enviadoAte: vencidos[vencidos.length - 1].t };
  if (ruins.size) upd.tokens = admin.firestore.FieldValue.arrayRemove(...ruins);
  await d.ref.update(upd);
}
console.log(`Lembretes enviados: ${enviados}`);

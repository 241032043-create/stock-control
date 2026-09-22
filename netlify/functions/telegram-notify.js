import crypto from 'node:crypto';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const getDatabase = () => {
  if (!getApps().length) {
    const credentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!credentials) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
    initializeApp({ credential: cert(JSON.parse(credentials)) });
  }
  return getFirestore();
};

const claimNotification = async key => {
  const id = crypto.createHash('sha256').update(String(key)).digest('hex');
  const database = getDatabase();
  const reference = database.doc(`telegramNotifications/${id}`);
  const now = Date.now();
  let claimed = false;
  await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const existing = snapshot.exists ? snapshot.data() : null;
    if (existing?.status === 'sent' || (existing?.status === 'sending' && now - Number(existing.startedAt || 0) < 120000)) return;
    transaction.set(reference, { status: 'sending', startedAt: now, key: String(key) }, { merge: true });
    claimed = true;
  });
  return { claimed, reference };
};

export default async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { text, idempotencyKey } = await request.json();
    if (!text) return Response.json({ error: 'Notification text is required' }, { status: 400 });

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return Response.json({ error: 'Telegram is not configured' }, { status: 503 });
    const claim = idempotencyKey ? await claimNotification(idempotencyKey) : null;
    if (claim && !claim.claimed) return Response.json({ sent: true, duplicate: true, configured: true });

    const chunks = [];
    for (let offset = 0; offset < String(text).length; offset += 3900) chunks.push(String(text).slice(offset, offset + 3900));
    for (const chunk of chunks) {
      const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
      const result = await telegramResponse.json().catch(() => ({}));
      if (!telegramResponse.ok || result.ok === false) {
        if (claim) await claim.reference.set({ status: 'failed', failedAt: Date.now() }, { merge: true });
        return Response.json({ sent: false, error: result.description || 'Telegram request failed' }, { status: 502 });
      }
    }
    if (claim) await claim.reference.set({ status: 'sent', sentAt: Date.now(), parts: chunks.length }, { merge: true });
    return Response.json({ sent: true, configured: true, parts: chunks.length });
  } catch (error) {
    if (error?.message?.includes('FIREBASE_SERVICE_ACCOUNT_JSON')) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ error: error.message || 'Invalid request' }, { status: 400 });
  }
};

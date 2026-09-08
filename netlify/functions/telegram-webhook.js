import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildReport } from './daily-stock-report.js';

const timezone = 'Asia/Kolkata';

const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const database = () => {
  if (!getApps().length) {
    const credentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!credentials) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
    initializeApp({ credential: cert(JSON.parse(credentials)) });
  }
  return getFirestore();
};

const sendMessage = async (token, chatId, text) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error((await response.json()).description || 'Telegram request failed');
};

export default async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('Forbidden', { status: 403 });
    const update = await request.json();
    const message = update.message;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const allowedChatId = String(process.env.TELEGRAM_CHAT_ID || '');
    if (!token || !allowedChatId) return Response.json({ error: 'Telegram is not configured' }, { status: 503 });
    if (!message?.chat?.id || String(message.chat.id) !== allowedChatId) return new Response('OK');
    const command = String(message.text || '').trim().split(/\s+/)[0].toLowerCase().split('@')[0];
    if (command === '/help' || command === '/start') {
      await sendMessage(token, message.chat.id, 'Stock Control commands:\n/report - latest current stock report\n/today - same daily report\n/help - show commands');
    } else if (command === '/report' || command === '/today') {
      const snapshot = await database().doc('inventory/shared').get();
      await sendMessage(token, message.chat.id, buildReport(snapshot.exists ? snapshot.data() : {}, today()));
    } else {
      await sendMessage(token, message.chat.id, 'Report mangwane ke liye /report bhejiye. Commands dekhne ke liye /help bhejiye.');
    }
    return new Response('OK');
  } catch (error) {
    console.error('[telegram-webhook]', error);
    return new Response('Webhook error', { status: 500 });
  }
};
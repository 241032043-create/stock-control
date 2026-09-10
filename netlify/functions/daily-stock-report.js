import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const timezone = 'Asia/Kolkata';
const money = value => `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
const number = value => (Number(value) || 0).toLocaleString('en-IN');

const getReportDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const movementDate = movement => {
  const value = movement.createdAt || movement.time;
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(value));
};

export const buildReport = (state, reportDate) => {
  const products = Array.isArray(state.products) ? state.products : [];
  const movements = Array.isArray(state.movements) ? state.movements : [];
  const today = movements.filter(movement => movementDate(movement) === reportDate && (movement.type === 'in' || movement.type === 'out')).flatMap(movement => movement.items?.length
    ? movement.items.map(item => ({ ...movement, ...item, transactionPrice: item.rate }))
    : [movement]);
  const stockIn = today.filter(movement => movement.type === 'in');
  const sales = today.filter(movement => movement.type === 'out');
  const quantity = movement => Number(movement.qty ?? movement.quantity) || 0;
  const rate = movement => Number(movement.transactionPrice ?? movement.price) || 0;
  const movementValue = movement => quantity(movement) * rate(movement);
  const stockInPieces = stockIn.reduce((total, movement) => total + quantity(movement), 0);
  const salesPieces = sales.reduce((total, movement) => total + quantity(movement), 0);
  const stockInValue = stockIn.reduce((total, movement) => total + movementValue(movement), 0);
  const salesValue = sales.reduce((total, movement) => total + movementValue(movement), 0);
  const closingPieces = products.reduce((total, product) => total + (Number(product.stock) || 0), 0);
  const closingValue = products.reduce((total, product) => total + (Number(product.stock) || 0) * (Number(product.price) || 0), 0);
  const openingPieces = closingPieces - stockInPieces + salesPieces;
  const openingValue = closingValue - stockInValue + salesValue;
  const formattedDate = new Date(`${reportDate}T00:00:00`).toLocaleDateString('en-IN', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return [
    '📊 DAILY STOCK SUMMARY',
    '',
    `📅 Date: ${formattedDate}`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '💰 STOCK SUMMARY',
    '',
    `Opening Stock: ${money(openingValue)}`,
    `➕ Stock In Today: ${money(stockInValue)}`,
    `➖ Sale Today: ${money(salesValue)}`,
    `= Net Change Today: ${money(stockInValue - salesValue)}`,
    '',
    `📦 Closing Stock: ${money(closingValue)}`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '📦 PIECES SUMMARY',
    '',
    `Opening: ${number(openingPieces)} pcs`,
    `Stock In: ${number(stockInPieces)} pcs`,
    `Sale: ${number(salesPieces)} pcs`,
    `= Net Change Today: ${number(stockInPieces - salesPieces)} pcs`,
    '',
    `Closing: ${number(closingPieces)} pcs`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '✅ END OF DAY STOCK SUMMARY',
  ].join('\n');
};

const getDatabase = () => {
  if (!getApps().length) {
    const credentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!credentials) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
    initializeApp({ credential: cert(JSON.parse(credentials)) });
  }
  return getFirestore();
};

export const config = { schedule: '0 12 * * *' };

export default async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const reportDate = getReportDate();
    const snapshot = await getDatabase().doc('inventory/shared').get();
    const text = buildReport(snapshot.exists ? snapshot.data() : {}, reportDate);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return Response.json({ error: 'Telegram is not configured' }, { status: 503 });
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const result = await telegramResponse.json();
    if (!telegramResponse.ok) return Response.json({ error: result.description || 'Telegram request failed' }, { status: 502 });
    return Response.json({ sent: true, reportDate });
  } catch (error) {
    return Response.json({ error: error.message || 'Daily report failed' }, { status: 500 });
  }
};
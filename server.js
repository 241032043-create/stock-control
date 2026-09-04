import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
try { process.loadEnvFile(join(root, '.env')); } catch { }
const storageDir = join(root, 'storage');
mkdirSync(storageDir, { recursive: true });
const dataFile = join(storageDir, 'data.json');
const sessions = new Map();
const users = { admin: { password: 'admin123', role: 'admin' }, staff: { password: 'staff123', role: 'staff' } };
const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
const emptyData = { products: [], movements: [], whatsapp: { enabled: false, phone: '' } };
const readData = () => existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : emptyData;
const writeData = (data) => writeFileSync(dataFile, JSON.stringify(data, null, 2));
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)); };
const body = async (req) => { let raw = ''; for await (const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {}; };
const auth = (req) => { const token = req.headers.authorization?.replace('Bearer ', ''); return sessions.get(token); };
const sendTelegram = async (text) => { if (!telegramToken || !telegramChatId) return { sent: false, configured: false }; const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: telegramChatId, text }) }); if (!response.ok) throw new Error(`Telegram returned ${response.status}`); return { sent: true, configured: true }; };
const serve = (req, res) => { const requested = req.url === '/' ? 'index.html' : normalize(req.url.slice(1)); if (requested.startsWith('..')) return json(res, 403, { error: 'Forbidden' }); const file = join(root, requested); if (!existsSync(file)) return json(res, 404, { error: 'Not found' }); const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }; res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file)); };
const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' }); return res.end(); }
  if (!req.url.startsWith('/api/')) return serve(req, res);
  try {
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { ok: true, serverTime: new Date().toISOString() });
    if (req.method === 'POST' && req.url === '/api/login') { const input = await body(req), user = users[input.username]; if (!user || user.password !== input.password || user.role !== input.role) return json(res, 401, { error: 'Invalid credentials' }); const token = crypto.randomUUID(); sessions.set(token, { username: input.username, role: user.role }); return json(res, 200, { token, role: user.role }); }
    const session = auth(req); if (!session) return json(res, 401, { error: 'Authentication required' });
    const data = readData();
    if (req.method === 'GET' && req.url === '/api/products') return json(res, 200, data.products);
    if (req.method === 'GET' && req.url === '/api/movements') return json(res, 200, data.movements);
    if (req.method === 'GET' && req.url === '/api/state') return json(res, 200, { products: data.products, movements: data.movements });
    if (req.method === 'GET' && req.url === '/api/telegram/status') return json(res, 200, { configured: Boolean(telegramToken && telegramChatId) });
    if (req.method === 'POST' && req.url === '/api/telegram/test') { if (session.role !== 'admin') return json(res, 403, { error: 'Admin access required' }); const result = await sendTelegram('Godown Stock Control\nTelegram notifications are connected.'); return json(res, 200, result); }
    if (req.method === 'POST' && req.url === '/api/telegram/notify') { const input = await body(req); const result = await sendTelegram(input.text); return json(res, 200, result); }
    if (req.method === 'POST' && req.url === '/api/products') { if (session.role !== 'admin') return json(res, 403, { error: 'Admin access required' }); const input = await body(req); const product = { id: crypto.randomUUID(), ...input, stock: Number(input.stock) || 0, price: Number(input.price) || 0, min: Number(input.min) || 0, createdAt: new Date().toISOString() }; data.products.push(product); writeData(data); return json(res, 201, product); }
    if (req.method === 'POST' && req.url === '/api/movements') { const input = await body(req), product = data.products.find(item => item.id === input.productId); if (!product) return json(res, 404, { error: 'Product not found' }); const quantity = Number(input.quantity); if (!Number.isInteger(quantity) || quantity < 1) return json(res, 400, { error: 'Quantity must be a positive whole number' }); if (input.type === 'out' && quantity > product.stock) return json(res, 400, { error: 'Insufficient stock' }); const beforeStock = product.stock; product.stock += input.type === 'in' ? quantity : -quantity; const movement = { id: crypto.randomUUID(), ...input, quantity, beforeStock, afterStock: product.stock, createdAt: new Date().toISOString(), enteredBy: session.username }; data.movements.unshift(movement); writeData(data); let notification = { sent: false, configured: Boolean(telegramToken && telegramChatId) }; try { notification = await sendTelegram(`Godown Stock Update\n${input.type === 'in' ? 'Stock received' : 'Stock dispatched'}\nProduct: ${product.name}\nCategory: ${product.category || 'Uncategorized'}\nVariant: ${product.variant}\nBefore: ${beforeStock} pcs\n${input.type === 'in' ? 'Added' : 'Dispatched'}: ${quantity} pcs\nAfter: ${product.stock} pcs\nDate: ${new Date().toLocaleString('en-IN')}\nEntered by: ${session.username}`); } catch (error) { notification = { sent: false, configured: true, error: error.message }; } return json(res, 201, { movement, notification }); }
    if (req.method === 'PUT' && req.url === '/api/state') { if (session.role !== 'admin') return json(res, 403, { error: 'Admin access required' }); const input = await body(req); if (!Array.isArray(input.products) || !Array.isArray(input.movements)) return json(res, 400, { error: 'Invalid state' }); data.products = input.products; data.movements = input.movements; writeData(data); return json(res, 200, { saved: true, savedAt: new Date().toISOString() }); }
    return json(res, 404, { error: 'API route not found' });
  } catch (error) { return json(res, 500, { error: error.message }); }
});
server.listen(3000, () => console.log('Godown server running at http://localhost:3000'));
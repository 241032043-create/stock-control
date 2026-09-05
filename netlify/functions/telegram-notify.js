export default async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { text } = await request.json();
    if (!text) return Response.json({ error: 'Notification text is required' }, { status: 400 });

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
    return Response.json({ sent: true, configured: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Invalid request' }, { status: 400 });
  }
};
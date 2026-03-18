// Sends a Telegram message to Steph via Lumen's bot
const LUMEN_KEY = process.env.LUMEN_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const STEPH_CHAT_ID = '8073561870';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-lumen-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = req.headers['x-lumen-key'];
  if (key !== LUMEN_KEY) return res.status(403).json({ error: 'Unauthorized' });

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'No message' });

  const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: STEPH_CHAT_ID, text: message }),
  });

  const tgData = await tgRes.json();
  if (!tgData.ok) return res.status(500).json({ error: 'Telegram failed', detail: tgData });
  return res.status(200).json({ ok: true });
}

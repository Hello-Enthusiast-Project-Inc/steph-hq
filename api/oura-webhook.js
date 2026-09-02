// Oura Webhook → Auto-mark workout done in Home Base
// Oura sends a POST when a new workout/activity is recorded
// We mark today's workout day as done in userdata.json

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'imperialinteractive/steph-hq';
const FILE_PATH = 'userdata.json';
const BRANCH = 'main';
const API_BASE = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

// Oura webhook verification token — set this as OURA_WEBHOOK_TOKEN in Vercel env vars
const OURA_WEBHOOK_TOKEN = process.env.OURA_WEBHOOK_TOKEN || 'oura-steph-2026';

async function getFile() {
  const res = await fetch(API_BASE + `?ref=${BRANCH}&t=${Date.now()}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
  });
  if (res.status === 404) return { content: {}, sha: null };
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { content, sha: data.sha };
}

async function putFile(content, sha) {
  const body = {
    message: 'Oura: auto-mark workout done',
    content: Buffer.from(JSON.stringify(content)).toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(API_BASE, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// Returns the workout week key (Monday ISO date) and day index (0=Mon ... 6=Sun)
// matching exactly how the app calculates it
function getWorkoutKeys() {
  const now = new Date();
  // Convert to Vancouver time (PST/PDT)
  const vancouver = new Date(now.toLocaleString('en-US', { timeZone: 'America/Vancouver' }));
  const day = vancouver.getDay(); // 0=Sun, 1=Mon ...
  const monday = new Date(vancouver);
  monday.setDate(vancouver.getDate() - ((day + 6) % 7));
  const weekKey = monday.toLocaleDateString('en-CA'); // YYYY-MM-DD

  // dayIndex: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
  const dayIndex = (day + 6) % 7;
  const workoutKey = `${weekKey}-${dayIndex}`;
  return { weekKey, dayIndex, workoutKey };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-oura-token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET = health check / verification endpoint (Oura pings this when setting up)
  if (req.method === 'GET') {
    // Oura sends ?verification_token=xxx during webhook registration
    const verificationToken = req.query.verification_token;
    if (verificationToken) {
      // Respond with the token to confirm ownership
      return res.status(200).json({ verification_token: verificationToken });
    }
    return res.status(200).json({ ok: true, message: 'Oura webhook endpoint live' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify token — Oura sends it as a header or query param
  const token = req.headers['x-oura-token'] || req.query.token || '';
  if (token !== OURA_WEBHOOK_TOKEN) {
    console.warn('Oura webhook: unauthorized token attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse the Oura payload
  // Oura webhook events look like: { event_type: "create", data_type: "workout", data: { ... } }
  const body = req.body || {};
  const dataType = body.data_type || '';
  const eventType = body.event_type || '';

  console.log('Oura webhook received:', JSON.stringify({ dataType, eventType }));

  // Only act on workout or daily_activity events (both count as "worked out today")
  const isWorkoutEvent = ['workout', 'daily_activity', 'session'].includes(dataType);
  if (!isWorkoutEvent) {
    return res.status(200).json({ ok: true, skipped: true, reason: `data_type=${dataType} — not a workout event` });
  }

  // Only act on create events (not updates/deletes)
  if (eventType && eventType !== 'create' && eventType !== 'update') {
    return res.status(200).json({ ok: true, skipped: true, reason: `event_type=${eventType}` });
  }

  // Get today's workout key
  const { workoutKey, dayIndex, weekKey } = getWorkoutKeys();

  // Read current userdata
  const { content, sha } = await getFile();

  // Get or init the workout log
  const workoutLog = content['steph-workout-log'] || {};

  // Already marked done? No-op
  if (workoutLog[workoutKey] === true) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'Already marked done', workoutKey });
  }

  // Mark it done
  workoutLog[workoutKey] = true;
  content['steph-workout-log'] = workoutLog;

  // Also set a default calorie estimate so the cal balance bar updates
  // We'll store a flag so the app knows this was auto-set by Oura
  const calsKey = `steph-workout-cals-${weekKey}-${dayIndex}`;
  const noteCalsKey = `steph-workout-note-cals-${weekKey}-${dayIndex}`;
  if (!content[noteCalsKey]) {
    // Default 300 cal — app will refine when Steph views the workout detail
    content[noteCalsKey] = 300;
    const existingPostureCals = content[`steph-posture-cals-${new Date().toLocaleDateString('en-CA')}`] || 0;
    content[calsKey] = 300 + existingPostureCals;
  }

  const saved = await putFile(content, sha);

  if (saved) {
    console.log('Oura webhook: workout marked done for key', workoutKey);
    return res.status(200).json({ ok: true, workoutKey, message: 'Workout marked done ✅' });
  } else {
    console.error('Oura webhook: failed to save to GitHub');
    return res.status(500).json({ error: 'Failed to save workout log' });
  }
}

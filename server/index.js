import express from 'express';
import config from './config.js';
import { isValidToken, register, approve, listAll, notifyAdmin, notifyUserApproved } from './users.js';
import { chat } from './chat.js';

const app = express();

// CORS (for Vercel frontend → tunnel API)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-auth-token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(config.publicDir));
app.use(express.json({ limit: '10mb' }));

// Auth middleware
function requireAuth(req, res, next) {
  if (isValidToken(req.headers['x-auth-token'])) return next();
  res.status(401).json({ error: '未授權' });
}

// ── Routes ──

app.post('/api/auth', (req, res) => {
  res.json({ ok: isValidToken(req.body.token) });
});

app.post('/api/register', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: '請填寫名字和 Email' });

  const result = register(name, email);
  if (!result.ok) return res.status(400).json({ error: result.error });

  if (!result.existing) {
    const base = config.publicUrl || `http://localhost:${config.port}`;
    const url = `${base}/api/admin/approve?email=${encodeURIComponent(email)}&secret=${result.approveToken}`;
    console.log(`[register] New user: ${name} <${email}>`);
    try {
      await notifyAdmin(name, email, url);
      console.log('[register] Admin notified');
    } catch (err) {
      console.error('[register] Notify failed:', err);
    }
  } else {
    console.log(`[register] Existing user: ${email}`);
  }

  res.json({ ok: true });
});

app.get('/api/admin/approve', (req, res) => {
  const user = approve(req.query.email, req.query.secret);
  if (!user) return res.status(400).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>❌ 無效的核准連結</h2></body></html>');

  notifyUserApproved(user.email, user.token);

  res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#08080c;color:#f0eef5">
    <h2>✅ 已核准</h2>
    <p><b>${user.name}</b> (${user.email})</p>
    <p>通行碼：<code style="background:#1a1a28;padding:4px 12px;border-radius:4px">${user.token}</code></p>
  </body></html>`);
});

app.get('/api/admin/users', (req, res) => {
  const users = listAll(req.query.secret);
  if (!users) return res.status(401).json({ error: '未授權' });
  res.json(users);
});

app.post('/api/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: '沒有訊息' });

  try {
    const reply = await chat(message);
    res.json({ reply });
  } catch (err) {
    console.error('[chat]', err.message);
    res.status(500).json({ error: err.name === 'AbortError' ? '回覆超時' : '伺服器錯誤' });
  }
});

app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '0.5.0' }));

export default app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`🎙️ Chat with May — :${config.port} → ${config.gateway.url}`);
  });
}

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// OpenClaw Gateway
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:6100';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || 'be2baca938d49a36b1eccedbfff45bcca35d046799e9a9c7';

// Auth
const ADMIN_TOKEN = process.env.AUTH_TOKEN || 'june2026';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'may-admin-2026';
const ADMIN_EMAIL = 'df41022@gmail.com';

// Email (Gmail App Password)
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

// Data directory
const DATA_DIR = join(__dirname, '..', 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}

function loadUsers() {
  try { return JSON.parse(readFileSync(USERS_FILE, 'utf-8')); } catch { return {}; }
}

function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Notify admin via email
async function notifyAdmin(name, email, approveUrl) {
  // Try email first
  if (SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transporter.sendMail({
        from: `Chat with May <${SMTP_USER}>`,
        to: ADMIN_EMAIL,
        subject: `[Chat with May] 新使用者申請：${name}`,
        html: `
          <h2>新使用者申請</h2>
          <p><b>名字：</b>${name}</p>
          <p><b>Email：</b>${email}</p>
          <p><a href="${approveUrl}" style="display:inline-block;padding:12px 24px;background:#a78bfa;color:white;border-radius:8px;text-decoration:none;">核准</a></p>
        `,
      });
      console.log('[auth] Email sent to admin');
      return;
    } catch (err) {
      console.error('[auth] Email failed:', err.message);
    }
  }

  // Fallback: notify via OpenClaw webhook
  try {
    await fetch(`${GATEWAY_URL}/hooks/wake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        text: `[Chat with May] 新使用者申請：${name} (${email})。核准連結：${approveUrl}`,
        mode: 'now',
      }),
    });
    console.log('[auth] Notified via OpenClaw webhook');
  } catch (err) {
    console.error('[auth] Webhook notification failed:', err.message);
  }

  console.log(`[auth] PENDING APPROVAL: ${name} <${email}>`);
  console.log(`[auth] Approve URL: ${approveUrl}`);
}

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-auth-token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(join(__dirname, '..', 'public')));
app.use(express.json({ limit: '10mb' }));

// ── Auth: verify token ──
app.post('/api/auth', (req, res) => {
  const { token } = req.body;
  // Admin token always works
  if (token === ADMIN_TOKEN) return res.json({ ok: true });
  // Check approved users
  const users = loadUsers();
  const user = Object.values(users).find(u => u.token === token && u.status === 'approved');
  res.json({ ok: !!user });
});

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token === ADMIN_TOKEN) return next();
  const users = loadUsers();
  const user = Object.values(users).find(u => u.token === token && u.status === 'approved');
  if (user) return next();
  return res.status(401).json({ error: '未授權' });
}

// ── Register ──
app.post('/api/register', (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: '請填寫名字和 Email' });

  const users = loadUsers();

  // Check if already registered
  if (users[email]) {
    if (users[email].status === 'pending') {
      return res.json({ ok: true, message: '申請已送出，等待審核中' });
    }
    if (users[email].status === 'approved') {
      return res.status(400).json({ error: '此 Email 已註冊，請用通行碼登入' });
    }
  }

  // Generate approval token
  const approveToken = crypto.randomBytes(16).toString('hex');
  const userToken = crypto.randomBytes(8).toString('hex');

  users[email] = {
    name,
    email,
    status: 'pending',
    token: userToken,
    approveToken,
    createdAt: new Date().toISOString(),
  };

  saveUsers(users);

  // Build approve URL
  const baseUrl = req.headers['x-forwarded-host']
    ? `https://${req.headers['x-forwarded-host']}`
    : `http://localhost:${PORT}`;
  const approveUrl = `${baseUrl}/api/admin/approve?email=${encodeURIComponent(email)}&secret=${approveToken}`;

  notifyAdmin(name, email, approveUrl);

  res.json({ ok: true });
});

// ── Admin: approve user ──
app.get('/api/admin/approve', (req, res) => {
  const { email, secret } = req.query;
  const users = loadUsers();

  if (!users[email] || users[email].approveToken !== secret) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>❌ 無效的核准連結</h2>
      </body></html>
    `);
  }

  users[email].status = 'approved';
  users[email].approvedAt = new Date().toISOString();
  saveUsers(users);

  const userToken = users[email].token;

  // Send approval email to user
  if (SMTP_USER && SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    transporter.sendMail({
      from: `Chat with May <${SMTP_USER}>`,
      to: email,
      subject: '你的 Chat with May 帳號已核准！',
      html: `
        <h2>歡迎使用 Chat with May！</h2>
        <p>你的通行碼是：<b>${userToken}</b></p>
        <p>請到 <a href="https://chat-with-may.vercel.app">chat-with-may.vercel.app</a> 登入。</p>
      `,
    }).catch(err => console.error('[auth] Approval email failed:', err.message));
  }

  res.send(`
    <html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#08080c;color:#f0eef5">
      <h2>✅ 已核准</h2>
      <p><b>${users[email].name}</b> (${email})</p>
      <p>通行碼：<code style="background:#1a1a28;padding:4px 12px;border-radius:4px">${userToken}</code></p>
      <p style="color:#888;font-size:13px;margin-top:20px">使用者會收到 Email 通知（如已設定 SMTP）</p>
    </body></html>
  `);
});

// ── Admin: list users ──
app.get('/api/admin/users', (req, res) => {
  const { secret } = req.query;
  if (secret !== ADMIN_SECRET) return res.status(401).json({ error: '未授權' });
  res.json(loadUsers());
});

// ── Chat ──
const chatHistory = [];
const SYSTEM_PROMPT = `你是一個友善的語音助手。用戶透過語音或文字跟你對話，你的回覆會被轉成語音播放。

重要規則：
- 你必須永遠回覆用戶的訊息，不可以回覆 NO_REPLY 或空白
- 回覆要簡潔自然，像真人講話一樣
- 不要用 markdown 格式（粗體、列表、標題等），因為會被唸出來
- 不要用 emoji
- 適當使用口語化的表達
- 回覆控制在 2-3 句話以內，除非用戶要求詳細說明
- 使用繁體中文
- 可以使用工具搜尋資訊，但要盡快回覆，不要做太多步驟
- 搜尋完就直接回答，不要再做額外查證`;

app.post('/api/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: '沒有訊息' });

  console.log('[chat] Received:', message);

  chatHistory.push({ role: 'user', content: message });
  while (chatHistory.length > 40) chatHistory.shift();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...chatHistory,
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'x-openclaw-agent-id': 'main',
      },
      body: JSON.stringify({ model: 'openclaw:main', messages, max_tokens: 300 }),
    });

    clearTimeout(timeout);
    console.log('[chat] Gateway status:', response.status);

    if (!response.ok) {
      const err = await response.text();
      console.error('[chat] Gateway error:', response.status, err);
      return res.status(response.status).json({ error: 'Gateway 錯誤: ' + response.status });
    }

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) {
      return res.status(500).json({ error: 'Gateway 回傳格式錯誤' });
    }

    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return res.json({ reply: '（沒有回覆內容）' });

    chatHistory.push({ role: 'assistant', content: reply });
    console.log('[chat] Reply:', reply.substring(0, 100));
    res.json({ reply });
  } catch (err) {
    console.error('[chat] Error:', err.message);
    res.status(500).json({ error: '伺服器錯誤: ' + err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.4.0', backend: 'openclaw-gateway' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎙️ Chat with May running on http://localhost:${PORT}`);
  console.log(`📡 Backend: OpenClaw Gateway @ ${GATEWAY_URL}`);
  console.log(`🔑 Admin secret: ${ADMIN_SECRET}`);
});

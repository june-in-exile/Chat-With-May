import express from 'express';
import multer from 'multer';
import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import config from './config.js';
import { isValidToken, register, approve, listAll, notifyAdmin, notifyUserApproved } from './users.js';
import { chat } from './chat.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

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

app.get('/api/admin/approve', async (req, res) => {
  const user = approve(req.query.email, req.query.secret);
  if (!user) return res.status(400).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>❌ 無效的核准連結</h2></body></html>');

  await notifyUserApproved(user.email, user.token);

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

app.post('/api/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '沒有音訊檔案' });

  try {
    const text = config.auth.groqKey
      ? await transcribeGroq(req.file)
      : await transcribeLocal(req.file);
    res.json({ text });
  } catch (err) {
    console.error('[transcribe]', err.message);
    res.status(500).json({ error: '語音辨識失敗' });
  }
});

// Groq Cloud API（現有方案）
async function transcribeGroq(file) {
  const formData = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype });
  formData.append('file', blob, 'audio.webm');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'zh');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.auth.groqKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API ${response.status}: ${err.slice(0, 100)}`);
  }

  const data = await response.json();
  return data.text;
}

// Local Whisper（新方案）
async function transcribeLocal(file) {
  const tmpPath = join('/tmp', `whisper-${randomUUID()}.webm`);
  try {
    await writeFile(tmpPath, file.buffer);
    const scriptPath = join(import.meta.dirname, 'transcribe.py');
    const result = await new Promise((resolve, reject) => {
      execFile('python3', [scriptPath, tmpPath, 'zh', config.auth.whisperModel], {
        timeout: 120000, // 增加到 120 秒超時，本地模型可能較慢
      }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error('Failed to parse Whisper output')); }
      });
    });
    if (result.error) throw new Error(result.error);
    return result.text;
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '0.5.0' }));

export default app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`🎙️ Chat with May — :${config.port} → ${config.gateway.url}`);
  });
}

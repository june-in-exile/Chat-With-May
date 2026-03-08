import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// OpenClaw Gateway config
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:6100';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || 'be2baca938d49a36b1eccedbfff45bcca35d046799e9a9c7';

// CORS for Vercel frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Auth token — change this to your own passphrase
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'june2026';

app.use(express.static(join(__dirname, '..', 'public')));
app.use(express.json({ limit: '10mb' }));

// Auth verify endpoint
app.post('/api/auth', (req, res) => {
  const { token } = req.body;
  res.json({ ok: token === AUTH_TOKEN });
});

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: '未授權' });
  }
  next();
}

// ── Chat history (in-memory) ──
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

// ── M3: Chat via OpenClaw Gateway ──
app.post('/api/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: '沒有訊息' });

  chatHistory.push({ role: 'user', content: message });
  while (chatHistory.length > 40) chatHistory.shift();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...chatHistory,
  ];

  console.log('[chat] Received:', message);
  console.log('[chat] Sending to gateway:', GATEWAY_URL);

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
      body: JSON.stringify({
        model: 'openclaw:main',
        messages,
        max_tokens: 300,
      }),
    });

    clearTimeout(timeout);
    console.log('[chat] Gateway status:', response.status);

    if (!response.ok) {
      const err = await response.text();
      console.error('[chat] Gateway error:', response.status, err);
      return res.status(response.status).json({ error: 'Gateway 錯誤: ' + response.status });
    }

    const raw = await response.text();
    console.log('[chat] Gateway raw response:', raw.substring(0, 200));

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('[chat] JSON parse error:', e.message);
      return res.status(500).json({ error: 'Gateway 回傳格式錯誤' });
    }

    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      console.error('[chat] No reply in data:', JSON.stringify(data).substring(0, 300));
      return res.json({ reply: '（沒有回覆內容）' });
    }

    chatHistory.push({ role: 'assistant', content: reply });

    res.json({ reply });
  } catch (err) {
    console.error('[chat] Error:', err.message);
    res.status(500).json({ error: '伺服器錯誤: ' + err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.3.0', backend: 'openclaw-gateway' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎙️ Voice Chat App running on http://localhost:${PORT}`);
  console.log(`📡 Backend: OpenClaw Gateway @ ${GATEWAY_URL}`);
});

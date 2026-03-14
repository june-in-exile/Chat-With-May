# Chat with May

語音對語音 AI 聊天應用 — 透過語音或文字與 May 即時對話，回覆會自動轉成語音播放。

## 運作方式

使用者透過瀏覽器說話或打字，訊息送到 Express 後端，後端透過 OpenClaw Gateway 呼叫 Claude API 取得回覆，再傳回瀏覽器用語音合成（TTS）唸出來。

```
瀏覽器 (PWA)
  ├─ MediaRecorder → 錄製音訊
  ├─ fetch POST /api/transcribe → Whisper 轉文字
  ├─ 文字輸入框 → 直接送出
  └─ fetch POST /api/chat
        ↓
  Express Server
        ↓ OpenAI-compatible API
  OpenClaw Gateway
        ↓
  Claude API → 回覆文字
        ↓
  瀏覽器 SpeechSynthesis → 語音播放
```

## 使用的模型

- **語音辨識** — Groq Whisper-large-v3-turbo（透過 OpenAI-compatible API）
- **對話理解** — Claude API（經由 OpenClaw Gateway）
- **語音回覆** — 瀏覽器 Web Speech API TTS，可調語速（0.5x ~ 2x）

## 功能

- **語音輸入** — MediaRecorder 錄製音訊 → Whisper 轉文字，支援中英文混合辨識
- **語音回覆** — 瀏覽器 TTS，可調語速（0.5x ~ 2x）
- **語音中斷** — 回覆播放中說話可立即打斷，發送新訊息
- **靜默自動送出** — 停頓 2 秒自動送出，不需手動按鍵
- **文字輸入** — 也可直接打字對話
- **PWA** — 可安裝到手機桌面

## 使用者認證

採用通行碼（token）機制：

1. 新使用者填寫名字和 Email 申請
2. 系統通知管理員（優先寄 Email，備援用 OpenClaw webhook）
3. 管理員點核准連結
4. 使用者收到通行碼 Email，用通行碼登入
5. 管理員也可直接用 `AUTH_TOKEN` 登入

## 專案結構

```
public/           # 前端靜態檔案
  app.js          # 主應用（認證、語音辨識、TTS、對話）
  config.js       # API base URL 設定（Vercel 用 same-origin）
  index.html      # 單頁應用 HTML
  style.css       # 樣式
  manifest.json   # PWA manifest

server/           # Express 後端
  index.js        # 路由（auth、register、approve、chat、health）
  chat.js         # 對話邏輯（維護 history，呼叫 Gateway）
  users.js        # 使用者管理（註冊、核准、通知）
  config.js       # 環境變數設定

api/              # Vercel serverless 進入點
  index.js        # 匯出 Express app 供 Vercel 使用

vercel.json       # Vercel 部署設定（rewrites、headers）
```

## 部署

**本機開發：**

```bash
npm install
cp .env.example .env  # 編輯 .env 填入設定
npm run dev
```

**Vercel：**

設定環境變數後直接部署。`vercel.json` 會將 `/api/*` 路由到 serverless function，靜態檔案直接從 `public/` 提供。

## 環境變數

| 變數 | 說明 | 必填 |
|------|------|------|
| `GATEWAY_URL` | OpenClaw Gateway URL | 是 |
| `GATEWAY_TOKEN` | Gateway 認證 token | 是 |
| `AUTH_TOKEN` | 管理員通行碼 | 是 |
| `ADMIN_SECRET` | 管理 API 金鑰（查詢用戶列表） | 否 |
| `ADMIN_EMAIL` | 接收新註冊通知的 Email | 否 |
| `PUBLIC_URL` | 部署網址（產生核准連結用） | 部署時必填 |
| `SMTP_USER` | Gmail 寄件地址 | 否（未設定改用 webhook） |
| `SMTP_PASS` | Gmail 應用程式密碼 | 否（未設定改用 webhook） |

## Live

https://chat-with-may.vercel.app

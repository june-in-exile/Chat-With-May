# Chat with May 🎙️

語音對語音 AI 聊天應用 — 透過 OpenClaw Gateway 與 May 即時語音對話。

## Features

- 🎤 語音輸入（Web Speech API）
- 🤖 AI 對話（透過 OpenClaw Gateway → Claude）
- 🔊 語音回覆（瀏覽器 TTS + 語速調整）
- 📱 PWA 支援（可安裝到手機桌面）
- 🔒 通行碼保護

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your settings
npm run dev
```

## Architecture

```
Browser (PWA)
  ├─ Web Speech API (語音辨識)
  ├─ SpeechSynthesis (TTS)
  └─ fetch /api/chat
        │
    Express Server (:3000)
        │
    OpenClaw Gateway (:6100)
        │
    Claude API (via OpenClaw agent)
```

## Live

https://chat-with-may.vercel.app

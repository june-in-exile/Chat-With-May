# Voice Chat App 🎙️

語音對語音 AI 聊天應用 — 透過 OpenClaw Gateway 與 AI 助手即時語音對話。

## Features

- 🎤 語音輸入（Web Speech API）
- 🤖 AI 對話（透過 OpenClaw Gateway → Claude）
- 🔊 語音回覆（瀏覽器 TTS）
- 📱 PWA 支援（可安裝到手機桌面）

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

## Requirements

- Node.js 18+
- OpenClaw Gateway running locally
- Chrome browser (for Web Speech API)

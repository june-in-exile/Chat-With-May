# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start local server (port 3000)
npm start        # Same as dev (used in production)
```

No build step — static files in `public/` are served directly. No test suite exists.

## Architecture

This is a voice-to-voice AI chat app (PWA). The user speaks → browser sends text to server → server calls an LLM gateway → reply is read aloud via browser TTS.

**Deployment modes:**
- **Local**: `node server/index.js` listens on port 3000, serves `public/` as static files
- **Vercel**: `api/index.js` re-exports the Express app as a serverless function; `vercel.json` routes `/api/*` to it and serves `public/` directly

**Request flow:**
```
Browser (Web Speech API → speech-to-text)
  → POST /api/chat (x-auth-token header)
  → server/chat.js → OpenClaw Gateway (OpenAI-compatible API)
  → Claude API → reply text
  → Browser SpeechSynthesis (TTS)
```

**Authentication flow:**
1. User registers (name + email) → `POST /api/register`
2. Server sends admin an approval email (Gmail SMTP) or falls back to OpenClaw webhook
3. Admin clicks approval link → `GET /api/admin/approve?email=&secret=`
4. Server emails user their token → user logs in with token
5. Admin can also log in directly with `AUTH_TOKEN`

**Key files:**
- `server/config.js` — all env var defaults and config object
- `server/chat.js` — in-memory conversation history (last 40 messages), system prompt, Gateway call
- `server/users.js` — user persistence (`data/users.json`), registration, approval, email/webhook notifications
- `server/index.js` — Express routes and auth middleware
- `public/app.js` — all frontend logic: auth, voice recognition, TTS, chat, mode state machine

**Frontend state machine** (`state.mode` in `public/app.js`):
- `idle` → `listening` → `processing` → `speaking` → `idle`
- TTS echo prevention: recognition stops during `speaking` mode, resumes after TTS ends

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GATEWAY_URL` | OpenClaw Gateway base URL |
| `GATEWAY_TOKEN` | Gateway bearer token |
| `AUTH_TOKEN` | Admin passtoken (direct login) |
| `ADMIN_EMAIL` | Email to receive registration notifications |
| `ADMIN_SECRET` | Key for `GET /api/admin/users` |
| `PUBLIC_URL` | Deployed URL (for generating approval links) |
| `SMTP_USER` | Gmail address for sending emails |
| `SMTP_PASS` | Gmail App Password (not main password) |

Gmail requires an App Password (not the account password) for SMTP auth.

## Data Persistence

User data is stored in `data/users.json` (gitignored). On Vercel, this file is ephemeral — the data directory is recreated each cold start. The `data/` directory is auto-created on startup.

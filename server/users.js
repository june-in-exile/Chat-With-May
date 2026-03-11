import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import config from './config.js';

const USERS_FILE = join(config.dataDir, 'users.json');
try { mkdirSync(config.dataDir, { recursive: true }); } catch {}

// ── Data ──

function load() {
  try { return JSON.parse(readFileSync(USERS_FILE, 'utf-8')); } catch { return {}; }
}

function save(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── Auth ──

export function isValidToken(token) {
  if (token === config.auth.adminToken) return true;
  const user = Object.values(load()).find(u => u.token === token && u.status === 'approved');
  return !!user;
}

// ── Registration ──

export function register(name, email) {
  const users = load();

  if (users[email]?.status === 'pending') return { ok: true, existing: true };
  if (users[email]?.status === 'approved') return { ok: false, error: '此 Email 已註冊，請用通行碼登入' };

  const approveToken = crypto.randomBytes(16).toString('hex');
  const userToken = crypto.randomBytes(8).toString('hex');

  users[email] = { name, email, status: 'pending', token: userToken, approveToken, createdAt: new Date().toISOString() };
  save(users);

  return { ok: true, approveToken };
}

export function approve(email, secret) {
  const users = load();
  if (!users[email] || users[email].approveToken !== secret) return null;

  users[email].status = 'approved';
  users[email].approvedAt = new Date().toISOString();
  save(users);

  return users[email];
}

export function listAll(secret) {
  if (secret !== config.auth.adminSecret) return null;
  return load();
}

// ── Notifications ──

export async function notifyAdmin(name, email, approveUrl) {
  const { user, pass } = config.smtp;
  
  if (user && pass) {
    console.log(`[auth] Attempting to send email to ${config.auth.adminEmail} via ${user}...`);
    try {
      const transport = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass }
      });
      
      await transport.sendMail({
        from: `Chat with May <${user}>`,
        to: config.auth.adminEmail,
        subject: `[Chat with May] 新使用者申請：${name}`,
        html: `<h2>新使用者申請</h2><p><b>名字：</b>${name}</p><p><b>Email：</b>${email}</p><p><a href="${approveUrl}" style="display:inline-block;padding:12px 24px;background:#a78bfa;color:white;border-radius:8px;text-decoration:none;">核准</a></p>`,
      });
      console.log('[auth] Admin notification email sent successfully.');
      return;
    } catch (err) {
      console.error('[auth] Email failed! Full error:', err);
      // If it's a login issue, remind the user about App Passwords
      if (err.message.includes('Invalid login')) {
        console.error('[auth] TIP: If using Gmail, make sure you use an "App Password", not your main Google password.');
      }
    }
  } else {
    console.warn('[auth] SMTP_USER or SMTP_PASS missing. Skipping email notification.');
  }

  // Fallback: OpenClaw webhook
  if (config.gateway.url && config.gateway.token) {
    console.log('[auth] Attempting fallback webhook notification...');
    try {
      await fetch(`${config.gateway.url}/hooks/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.gateway.token}` },
        body: JSON.stringify({ text: `[Chat with May] 新使用者申請：${name} (${email})。核准連結：${approveUrl}`, mode: 'now' }),
      });
      console.log('[auth] Webhook notification sent.');
    } catch (err) {
      console.error('[auth] Webhook failed:', err.message);
    }
  } else {
    console.warn('[auth] No webhook configured for fallback.');
  }

  console.log(`[auth] MANUAL APPROVAL URL: ${approveUrl}`);
}

export async function notifyUserApproved(email, token) {
  if (!config.smtp.user || !config.smtp.pass) return;
  try {
    const transport = nodemailer.createTransport({ service: 'gmail', auth: { user: config.smtp.user, pass: config.smtp.pass } });
    await transport.sendMail({
      from: `Chat with May <${config.smtp.user}>`,
      to: email,
      subject: '你的 Chat with May 帳號已核准！',
      html: `<h2>歡迎使用 Chat with May！</h2><p>你的通行碼是：<b>${token}</b></p><p>請到 <a href="https://chat-with-may.vercel.app">chat-with-may.vercel.app</a> 登入。</p>`,
    });
  } catch (err) {
    console.error('[auth] Approval email failed:', err.message);
  }
}

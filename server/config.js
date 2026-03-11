import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const smtpUser = process.env.SMTP_USER || 'df41022@gmail.com';

export default {
  port: process.env.PORT || 3000,
  publicUrl: process.env.PUBLIC_URL || 'https://chat-with-may.vercel.app',
  publicDir: join(__dirname, '..', 'public'),
  dataDir: join(__dirname, '..', 'data'),

  gateway: {
    url: process.env.GATEWAY_URL || 'http://127.0.0.1:6100',
    token: process.env.GATEWAY_TOKEN || '',
  },

  auth: {
    adminToken: process.env.AUTH_TOKEN || '',
    adminSecret: process.env.ADMIN_SECRET || '',
    adminEmail: process.env.ADMIN_EMAIL || smtpUser, // Fallback to SMTP_USER if not set
  },

  smtp: {
    user: smtpUser,
    pass: process.env.SMTP_PASS || '',
  },
};

// Startup verification
if (process.env.NODE_ENV !== 'test') {
  console.log(`[config] Admin Email: ${process.env.ADMIN_EMAIL || smtpUser}`);
  console.log(`[config] SMTP configured: ${process.env.SMTP_PASS ? 'YES' : 'NO'}`);
}

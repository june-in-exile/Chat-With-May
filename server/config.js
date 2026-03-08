import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  port: process.env.PORT || 3000,
  publicUrl: process.env.PUBLIC_URL || '',
  publicDir: join(__dirname, '..', 'public'),
  dataDir: join(__dirname, '..', 'data'),

  gateway: {
    url: process.env.GATEWAY_URL || 'http://127.0.0.1:6100',
    token: process.env.GATEWAY_TOKEN || 'be2baca938d49a36b1eccedbfff45bcca35d046799e9a9c7',
  },

  auth: {
    adminToken: process.env.AUTH_TOKEN || '5f6f1aa6ec72fc146f23878f',
    adminSecret: process.env.ADMIN_SECRET || 'may-admin-2026',
    adminEmail: 'df41022@gmail.com',
  },

  smtp: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};

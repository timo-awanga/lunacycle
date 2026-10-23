import { env } from '../config/env.js';
export async function sendMail(to, subject, text) {
  if (env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
    }).catch((e) => console.error('mail failed', e.message));
  } else if (env.NODE_ENV !== 'production') console.log(`[dev mail to ${to}] ${subject}\n${text}`);
}

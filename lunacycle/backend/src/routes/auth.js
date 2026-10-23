import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, getToken, COOKIE, cookieOptions, SESSION_DAYS } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { newToken, hashToken } from '../utils/tokens.js';
import { env } from '../config/env.js';
import { sendMail } from '../utils/mail.js';

const router = Router();
const COST = 12;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST); // equalises login timing

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

const email = z.string().trim().toLowerCase().email().max(254);
// bcrypt only uses the first 72 bytes, so cap length there.
const password = z.string().min(10, 'Use at least 10 characters').max(72);

const signupSchema = z.object({ email, password, displayName: z.string().trim().max(60).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please accept the Terms and Privacy Policy' }) }) });
const loginSchema = z.object({ email, password: z.string().min(1).max(72) });
const forgotSchema = z.object({ email });
const resetSchema = z.object({ token: z.string().min(20).max(100), password });
const profileSchema = z.object({ displayName: z.string().trim().max(60).nullable() });

async function startSession(res, userId) {
  const token = newToken();
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, hashToken(token), SESSION_DAYS]
  );
  res.cookie(COOKIE, token, cookieOptions);
  return token;
}

router.post('/signup', limiter, validate(signupSchema), async (req, res) => {
  const { email, password, displayName } = req.body;
  const hash = await bcrypt.hash(password, COST);
  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3)
       RETURNING id, email, display_name`,
      [email, hash, displayName ?? null]
    );
    user = rows[0];
    await client.query('INSERT INTO user_settings (user_id) VALUES ($1)', [user.id]);
    await client.query("INSERT INTO consent_records (user_id, kind, granted) VALUES ($1,'terms',true)", [user.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') throw new AppError(409, 'An account with this email already exists');
    throw e;
  } finally { client.release(); }
  const token = await startSession(res, user.id);
  await sendVerification(user).catch((e) => console.error('verification mail failed', e.message));
  res.status(201).json({ user, ...(req.get('x-client') === 'mobile' && { token }) });
});

router.post('/login', limiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query(
    'SELECT id, email, display_name, password_hash, status FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'Incorrect email or password');
  if (user.status === 'suspended') throw new AppError(403, 'This account is suspended. Please contact support.');
  const token = await startSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, display_name: user.display_name }, ...(req.get('x-client') === 'mobile' && { token }) });
});

router.post('/logout', async (req, res) => {
  const token = getToken(req);
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.patch('/me', requireAuth, validate(profileSchema), async (req, res) => {
  const { rows } = await query(
    'UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, email, display_name',
    [req.body.displayName, req.user.id]);
  res.json({ user: rows[0] });
});

// Always responds identically so attackers can't discover which emails are registered.
router.post('/forgot-password', limiter, validate(forgotSchema), async (req, res) => {
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [req.body.email]);
  if (rows[0]) {
    const token = newToken();
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1,$2, now() + interval '30 minutes')`, [rows[0].id, hashToken(token)]);
    const link = `${env.CLIENT_ORIGIN}/reset-password?token=${token}`;
    if (env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: req.body.email, subject: 'Reset your LunaCycle password',
          text: `Use this link within 30 minutes to choose a new password:\n${link}\n\nIf you didn't ask for this, you can ignore this email.` }),
      }).catch((e) => console.error('mail failed', e.message));
    } else if (env.NODE_ENV !== 'production') console.log(`[dev] password reset link: ${link}`);
  }
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

router.post('/reset-password', limiter, validate(resetSchema), async (req, res) => {
  const { token, password } = req.body;
  const { rows } = await query(
    `SELECT id, user_id FROM password_reset_tokens
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [hashToken(token)]);
  if (!rows[0]) throw new AppError(400, 'This reset link is invalid or has expired');
  const hash = await bcrypt.hash(password, COST);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, rows[0].user_id]);
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [rows[0].id]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].user_id]); // sign out everywhere
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ message: 'Password updated. Please log in.' });
});

async function sendVerification(user) {
  const token = newToken();
  await query(`INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '24 hours')`, [user.id, hashToken(token)]);
  await sendMail(user.email, 'Verify your LunaCycle email', `Confirm your email address:\n${env.CLIENT_ORIGIN}/verify-email?token=${token}\n\nThis link expires in 24 hours.`);
}
router.post('/verify-email', limiter, validate(z.object({ token: z.string().min(20).max(100) })), async (req, res) => {
  const { rows } = await query('DELETE FROM email_verification_tokens WHERE token_hash=$1 AND expires_at > now() RETURNING user_id', [hashToken(req.body.token)]);
  if (!rows[0]) throw new AppError(400, 'This verification link is invalid or has expired');
  await query('UPDATE users SET email_verified_at = now() WHERE id=$1', [rows[0].user_id]);
  res.json({ ok: true });
});
router.post('/resend-verification', requireAuth, limiter, async (req, res) => {
  if (req.user.verified) return res.json({ ok: true });
  await sendVerification(req.user);
  res.json({ message: 'Verification email sent.' });
});

export default router;

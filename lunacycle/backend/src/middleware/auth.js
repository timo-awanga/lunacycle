import { query } from '../db/pool.js';
import { hashToken } from '../utils/tokens.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

export const COOKIE = 'lc_sid';
export const SESSION_DAYS = 14;

export const cookieOptions = {
  httpOnly: true,                        // JS (and therefore XSS) can't read it
  sameSite: 'lax',                       // baseline CSRF defence
  secure: env.NODE_ENV === 'production', // HTTPS-only in production
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
};

export const getToken = (req) => req.cookies?.[COOKIE] || (req.get('authorization') || '').replace(/^Bearer /i, '') || null;

export async function requireAuth(req, _res, next) {
  try {
    const token = getToken(req);
    if (!token) throw new AppError(401, 'Not authenticated');
    const { rows } = await query(
      `SELECT u.id, u.email, u.display_name, u.role, u.status, u.last_seen_at, (u.email_verified_at IS NOT NULL) AS verified
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)]
    );
    if (!rows[0]) throw new AppError(401, 'Session expired');
    if (rows[0].status !== 'active') throw new AppError(403, 'This account is suspended');
    if (!rows[0].last_seen_at || Date.now() - new Date(rows[0].last_seen_at) > 3600e3)
      await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [rows[0].id]); // "active user" = any authenticated request in the period
    delete rows[0].last_seen_at;
    req.user = rows[0];
    next();
  } catch (e) { next(e); }
}

// Extra CSRF layer: state-changing requests must come from our own frontend origin.
export function sameOriginOnly(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== env.CLIENT_ORIGIN) return next(new AppError(403, 'Forbidden origin'));
  next();
}

// Role is read from the database on every request (never from the client).
export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new AppError(403, 'Administrator access required'));
  next();
}

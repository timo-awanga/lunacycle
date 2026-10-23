import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

const r = Router();
r.use(requireAuth, requireAdmin); // server-verified on EVERY admin request
// PRIVACY: these routes touch only users/sessions/audit_logs. No health table is ever queried here.

r.get('/stats', async (_req, res) => {
  const one = async (sql) => (await query(sql)).rows[0];
  const [t, days] = await Promise.all([
    one(`SELECT count(*)::int total,
                count(*) FILTER (WHERE last_seen_at > now() - interval '30 days')::int active30,
                count(*) FILTER (WHERE created_at > now() - interval '30 days')::int new30,
                count(*) FILTER (WHERE status='suspended')::int suspended,
                count(*) FILTER (WHERE role='admin')::int admins FROM users`),
    query(`SELECT to_char(d,'YYYY-MM-DD') AS day, count(u.id)::int AS n
             FROM generate_series(current_date - 29, current_date, interval '1 day') d
             LEFT JOIN users u ON u.created_at::date = d::date GROUP BY d ORDER BY d`),
  ]);
  const subs = (await query(`SELECT count(*) FILTER (WHERE plan='premium' AND status IN ('active','trialing'))::int premium FROM subscriptions`)).rows[0];
  const ai = (await query(`SELECT count(*)::int calls, count(*) FILTER (WHERE NOT ok)::int errors,
    coalesce(sum(input_tokens+output_tokens),0)::int tokens FROM ai_usage WHERE created_at > now() - interval '30 days'`)).rows[0];
  res.json({
    ...t, signups: days.rows, ai, subs,
    activeDefinition: 'Active = account made at least one authenticated request in the last 30 days.',
    system: { db: 'ok', uptimeSeconds: Math.round(process.uptime()), node: process.version, env: env.NODE_ENV },
    config: { database: env.DATABASE_URL ? 'external PostgreSQL' : 'embedded (local file)', email: !!env.RESEND_API_KEY, ai: !!env.ANTHROPIC_API_KEY, billing: !!env.STRIPE_SECRET_KEY },
  });
});

r.get('/users', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100), like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const page = Math.max(0, parseInt(req.query.page) || 0);
  const { rows } = await query(
    `SELECT id, email, display_name, role, status, created_at, last_seen_at FROM users
      WHERE $1 = '' OR email::text ILIKE $2 OR display_name ILIKE $2
      ORDER BY created_at DESC LIMIT 50 OFFSET $3`, [q, like, page * 50]);
  res.json({ users: rows });
});

r.post('/users/status', validate(z.object({ userId: z.string().uuid(), status: z.enum(['active', 'suspended']) })), async (req, res) => {
  const { userId, status } = req.body;
  if (userId === req.user.id) throw new AppError(400, 'You cannot change your own status');
  const { rows } = await query('SELECT role FROM users WHERE id=$1', [userId]);
  if (!rows[0]) throw new AppError(404, 'User not found');
  if (rows[0].role === 'admin') throw new AppError(403, 'Administrators cannot be suspended from the dashboard');
  await query('UPDATE users SET status=$1 WHERE id=$2', [status, userId]);
  if (status === 'suspended') await query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  await query('INSERT INTO audit_logs (actor_id, action, target_id) VALUES ($1,$2,$3)',
    [req.user.id, status === 'suspended' ? 'user.suspend' : 'user.restore', userId]);
  res.json({ ok: true });
});

r.get('/audit', async (_req, res) => {
  const { rows } = await query(
    `SELECT a.action, a.created_at, a.meta, u.email actor, t.email target FROM audit_logs a
       LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users t ON t.id=a.target_id
      ORDER BY a.created_at DESC LIMIT 100`);
  res.json({ logs: rows });
});

export default r;

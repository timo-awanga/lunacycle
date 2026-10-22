import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { requireAuth, COOKIE, cookieOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../utils/errors.js';

const r = Router();
r.use(requireAuth); // every route below is server-side authorized; user id comes from the session, never the client
const PRESET = ['Cramps','Headache','Bloating','Breast tenderness','Fatigue','Mood changes','Back pain','Acne'];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

r.get('/data', async (req, res) => {
  const u = req.user.id, q = (t) => query(t, [u]).then((x) => x.rows);
  const [[s = {}], dl, pe, sl, sy, mo, jn, nt] = await Promise.all([
    q('SELECT * FROM user_settings WHERE user_id=$1'),
    q('SELECT log_date::text d, energy, notes FROM daily_logs WHERE user_id=$1'),
    q('SELECT entry_date::text d, flow FROM period_entries WHERE user_id=$1'),
    q('SELECT sleep_date::text d, hours::float h FROM sleep_records WHERE user_id=$1'),
    q('SELECT l.log_date::text d, s.name FROM symptoms s JOIN daily_logs l ON l.id=s.daily_log_id WHERE s.user_id=$1'),
    q('SELECT l.log_date::text d, m.mood FROM moods m JOIN daily_logs l ON l.id=m.daily_log_id WHERE m.user_id=$1'),
    q('SELECT entry_date::text d, body FROM journal_entries WHERE user_id=$1'),
    q('SELECT kind, title, enabled FROM notifications WHERE user_id=$1'),
  ]);
  const logs = {}, L = (d) => (logs[d] ??= {});
  dl.forEach((x) => { const l = L(x.d); if (x.energy) l.energy = x.energy; if (x.notes) l.note = x.notes; });
  pe.forEach((x) => (L(x.d).flow = x.flow));
  sl.forEach((x) => (L(x.d).sleep = x.h));
  sy.forEach((x) => (L(x.d).symptoms ??= []).push(x.name));
  mo.forEach((x) => (L(x.d).mood = x.mood));
  const journal = Object.fromEntries(jn.map((x) => [x.d, x.body]));
  const n = (k) => nt.find((x) => x.kind === k);
  res.json({
    user: req.user, logs, journal,
    set: {
      name: req.user.display_name || '', cycle: s.avg_cycle_length || 28, period: s.typical_period_days || 5,
      theme: s.theme || 'system', ai: !!s.ai_enabled,
      remPeriod: n('period') ? n('period').enabled : true, remDaily: !!n('daily_tracking')?.enabled,
      remCustom: n('custom')?.title || '',
    },
  });
});

const logSchema = z.object({ logs: z.array(z.object({
  date, flow: z.number().int().min(0).max(4).optional(), energy: z.number().int().min(1).max(5).optional(),
  sleep: z.number().min(0).max(24).optional(), mood: z.string().trim().max(40).optional(),
  symptoms: z.array(z.string().trim().min(1).max(60)).max(30).optional(), note: z.string().max(2000).optional(),
})).min(1).max(400) });

r.post('/logs', validate(logSchema), async (req, res) => {
  const u = req.user.id, c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const l of req.body.logs) {
      const { rows: [d] } = await c.query(
        `INSERT INTO daily_logs (user_id, log_date, energy, notes) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, log_date) DO UPDATE SET energy=$3, notes=$4 RETURNING id`,
        [u, l.date, l.energy ?? null, l.note ?? null]);
      await c.query('DELETE FROM symptoms WHERE daily_log_id=$1', [d.id]);
      await c.query('DELETE FROM moods WHERE daily_log_id=$1', [d.id]);
      for (const s of l.symptoms ?? [])
        await c.query('INSERT INTO symptoms (daily_log_id,user_id,name,is_custom) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [d.id, u, s, !PRESET.includes(s)]);
      if (l.mood) await c.query('INSERT INTO moods (daily_log_id,user_id,mood) VALUES ($1,$2,$3)', [d.id, u, l.mood]);
      if (l.flow > 0) await c.query(`INSERT INTO period_entries (user_id,entry_date,flow) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,entry_date) DO UPDATE SET flow=$3`, [u, l.date, l.flow]);
      else await c.query('DELETE FROM period_entries WHERE user_id=$1 AND entry_date=$2', [u, l.date]);
      if (l.sleep != null) await c.query(`INSERT INTO sleep_records (user_id,sleep_date,hours) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,sleep_date) DO UPDATE SET hours=$3`, [u, l.date, l.sleep]);
      else await c.query('DELETE FROM sleep_records WHERE user_id=$1 AND sleep_date=$2', [u, l.date]);
    }
    await c.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
});

// Dates travel in request bodies, not URLs, so health data never lands in access logs.
r.post('/logs/delete', validate(z.object({ date })), async (req, res) => {
  const u = req.user.id, d = req.body.date;
  await query('DELETE FROM daily_logs WHERE user_id=$1 AND log_date=$2', [u, d]);
  await query('DELETE FROM period_entries WHERE user_id=$1 AND entry_date=$2', [u, d]);
  await query('DELETE FROM sleep_records WHERE user_id=$1 AND sleep_date=$2', [u, d]);
  res.json({ ok: true });
});

r.post('/journal', validate(z.object({ date, body: z.string().max(10000) })), async (req, res) => {
  const { date: d, body } = req.body;
  if (!body.trim()) await query('DELETE FROM journal_entries WHERE user_id=$1 AND entry_date=$2', [req.user.id, d]);
  else await query(`INSERT INTO journal_entries (user_id,entry_date,body) VALUES ($1,$2,$3)
    ON CONFLICT (user_id,entry_date) DO UPDATE SET body=$3`, [req.user.id, d, body]);
  res.json({ ok: true });
});

const setSchema = z.object({
  name: z.string().trim().max(60).optional(), cycle: z.coerce.number().int().min(15).max(90),
  period: z.coerce.number().int().min(1).max(15), theme: z.enum(['light', 'dark', 'system']),
  ai: z.boolean().optional(), remPeriod: z.boolean(), remDaily: z.boolean(), remCustom: z.string().max(100),
});
r.post('/settings', validate(setSchema), async (req, res) => {
  const u = req.user.id, s = req.body;
  await query('UPDATE users SET display_name=$1 WHERE id=$2', [s.name || null, u]);
  await query(`INSERT INTO user_settings (user_id,avg_cycle_length,typical_period_days,theme,ai_enabled,notifications_enabled)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET avg_cycle_length=$2, typical_period_days=$3,
    theme=$4, ai_enabled=COALESCE($7, user_settings.ai_enabled), notifications_enabled=$6`,
    [u, s.cycle, s.period, s.theme, !!s.ai, s.remPeriod || s.remDaily || !!s.remCustom, s.ai ?? null]);
  await query('DELETE FROM notifications WHERE user_id=$1', [u]);
  const ins = (k, t, e) => query('INSERT INTO notifications (user_id,kind,title,enabled) VALUES ($1,$2,$3,$4)', [u, k, t, e]);
  await ins('period', 'Expected period', s.remPeriod);
  await ins('daily_tracking', 'Daily check-in', s.remDaily);
  if (s.remCustom) await ins('custom', s.remCustom, true);
  res.json({ ok: true });
});

r.post('/account/delete', validate(z.object({ password: z.string().max(72) })), async (req, res) => {
  const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(req.body.password, rows[0].password_hash))) throw new AppError(403, 'Incorrect password');
  await query('DELETE FROM users WHERE id=$1', [req.user.id]); // cascades to ALL user data
  res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

export default r;

import crypto from 'node:crypto';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

const r = Router();
const on = () => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID && env.STRIPE_WEBHOOK_SECRET);
async function stripe(path, params) {
  const resp = await fetch('https://api.stripe.com/v1' + path, { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) { console.error('Stripe error', resp.status); throw new AppError(502, 'The payment provider is unavailable. Please try again.'); }
  return j;
}
const sub = async (id) => (await query('SELECT * FROM subscriptions WHERE user_id=$1', [id])).rows[0];

// Public: lets the pricing page show honest state. Price text comes from config, never invented.
r.get('/plans', (_q, res) => res.json({ configured: on(),
  priceLabel: env.PRICE_LABEL || 'The exact price and billing period are shown at checkout before you pay. Cancel any time.' }));

r.get('/status', requireAuth, async (req, res) => {
  const s = await sub(req.user.id);
  res.json({ configured: on(), plan: s?.plan || 'free', status: s?.status || 'none', currentPeriodEnd: s?.current_period_end || null, cancelAtPeriodEnd: !!s?.cancel_at_period_end });
});

r.post('/checkout', requireAuth, async (req, res) => {
  if (!on()) throw new AppError(503, 'Paid plans are not available yet.');
  const s = await sub(req.user.id);
  if (s?.plan === 'premium') throw new AppError(409, 'You already have Premium.');
  const o = env.CLIENT_ORIGIN;
  const j = await stripe('/checkout/sessions', { mode: 'subscription', 'line_items[0][price]': env.STRIPE_PRICE_ID, 'line_items[0][quantity]': '1',
    success_url: `${o}/#pricing`, cancel_url: `${o}/#pricing`, client_reference_id: req.user.id,
    ...(s?.stripe_customer_id ? { customer: s.stripe_customer_id } : { customer_email: req.user.email }) });
  res.json({ url: j.url });
});

r.post('/portal', requireAuth, async (req, res) => {
  const s = await sub(req.user.id);
  if (!on() || !s?.stripe_customer_id) throw new AppError(400, 'No subscription to manage.');
  res.json({ url: (await stripe('/billing_portal/sessions', { customer: s.stripe_customer_id, return_url: `${env.CLIENT_ORIGIN}/#pricing` })).url });
});

function verify(raw, header) {
  const parts = (header || '').split(',').map((x) => x.split('=')), t = parts.find((x) => x[0] === 't')?.[1];
  const sigs = parts.filter((x) => x[0] === 'v1').map((x) => x[1]);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - +t) > 300) return false; // also blocks replays
  const exp = crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${t}.`).update(raw).digest('hex');
  return sigs.some((s) => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
}
// Mounted in app.js with express.raw() BEFORE the JSON parser (signature needs the exact bytes).
export async function webhook(req, res) {
  if (!on() || !Buffer.isBuffer(req.body) || !verify(req.body, req.get('stripe-signature'))) throw new AppError(400, 'Invalid webhook');
  const ev = JSON.parse(req.body.toString('utf8')), o = ev.data?.object || {};
  if ((await query('SELECT 1 FROM stripe_events WHERE id=$1', [ev.id])).rows[0]) return res.json({ received: true, duplicate: true });
  if (ev.type === 'checkout.session.completed' && /^[0-9a-f-]{36}$/.test(o.client_reference_id || '')) {
    await query(`INSERT INTO subscriptions (user_id, plan, status, stripe_customer_id, stripe_subscription_id) VALUES ($1,'premium','active',$2,$3)
      ON CONFLICT (user_id) DO UPDATE SET plan='premium', status='active', stripe_customer_id=$2, stripe_subscription_id=$3, updated_at=now()`,
      [o.client_reference_id, o.customer, o.subscription]);
  } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
    const gone = ev.type === 'customer.subscription.deleted', act = !gone && ['active', 'trialing'].includes(o.status);
    await query(`UPDATE subscriptions SET plan=$1, status=$2, current_period_end=to_timestamp($3), cancel_at_period_end=$4, updated_at=now() WHERE stripe_subscription_id=$5`,
      [act ? 'premium' : 'free', gone ? 'canceled' : o.status, o.current_period_end ?? null, !!o.cancel_at_period_end, o.id]);
  }
  await query('INSERT INTO stripe_events (id) VALUES ($1) ON CONFLICT DO NOTHING', [ev.id]);
  res.json({ received: true });
}
export default r;

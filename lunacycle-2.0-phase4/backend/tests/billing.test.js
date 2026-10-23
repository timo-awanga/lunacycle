import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.NODE_ENV = 'test'; process.env.DATA_DIR = 'memory://';
Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_ID: 'price_x' });
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://localhost:${server.address().port}`, real = globalThis.fetch; let stripeBody = '';
globalThis.fetch = (u, o) => String(u).startsWith('https://api.stripe.com')
  ? (stripeBody = String(o.body), Promise.resolve({ ok: true, json: async () => ({ url: 'https://checkout.stripe.test/s' }) })) : real(u, o);
const call = async (cookie, p, b) => { const r = await real(base + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: b && JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
const sign = (body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex')}`;
const hook = (ev, sig) => { const body = JSON.stringify(ev); return real(base + '/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig ?? sign(body) }, body }); };
after(async () => { server.close(); await pool.end(); });

test('billing: checkout, signed webhooks, idempotency, cancellation', async () => {
  assert.equal((await call(null, '/api/billing/plans')).j.configured, true);
  assert.equal((await call(null, '/api/billing/checkout', {})).r.status, 401);
  const s = await call(null, '/api/auth/signup', { email: 'p@example.com', password: 'correct-horse-battery', acceptTerms: true });
  const c = s.r.headers.get('set-cookie').split(';')[0], uid = s.j.user.id;
  assert.equal((await call(c, '/api/billing/status')).j.plan, 'free');
  const co = await call(c, '/api/billing/checkout', {});
  assert.equal(co.j.url, 'https://checkout.stripe.test/s');
  assert.ok(stripeBody.includes(uid) && stripeBody.includes('price_x'));
  assert.equal((await hook({ id: 'evt_bad', type: 'x' }, 't=1,v1=00')).status, 400);                       // bad signature
  const oldBody = JSON.stringify({ id: 'evt_old', type: 'x' });
  assert.equal((await hook(JSON.parse(oldBody), sign(oldBody, 1000))).status, 400);                         // stale timestamp
  const done = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: uid, customer: 'cus_1', subscription: 'sub_1' } } };
  assert.equal((await hook(done)).status, 200);
  assert.equal((await call(c, '/api/billing/status')).j.plan, 'premium');
  assert.equal((await call(c, '/api/billing/checkout', {})).r.status, 409);
  assert.equal((await (await hook(done)).json()).duplicate, true);                                          // replay ignored
  await hook({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', current_period_end: 1900000000, cancel_at_period_end: true } } });
  const st = (await call(c, '/api/billing/status')).j; assert.equal(st.cancelAtPeriodEnd, true); assert.ok(st.currentPeriodEnd);
  await hook({ id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } });
  assert.equal((await call(c, '/api/billing/status')).j.plan, 'free');
});

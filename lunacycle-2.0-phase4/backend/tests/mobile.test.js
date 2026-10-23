import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test'; process.env.DATA_DIR = 'memory://';
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://localhost:${server.address().port}`;
const call = async (p, { body, headers = {} } = {}) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }); return { r, j: await r.json().catch(() => ({})) }; };
after(async () => { server.close(); await pool.end(); });

test('mobile Bearer auth (no cookies) and billing off by default', async () => {
  const u = { email: 'm@example.com', password: 'correct-horse-battery', acceptTerms: true };
  assert.equal((await call('/api/auth/signup', { body: { ...u, email: 'web@example.com' } })).j.token, undefined); // web clients never get the raw token in JSON
  const s = await call('/api/auth/signup', { body: u, headers: { 'x-client': 'mobile' } });
  assert.ok(s.j.token);
  const auth = { Authorization: `Bearer ${s.j.token}` };
  assert.equal((await call('/api/data', { headers: auth })).r.status, 200);
  assert.equal((await call('/api/data', { headers: { Authorization: 'Bearer nonsense' } })).r.status, 401);
  assert.equal((await call('/api/auth/logout', { body: {}, headers: auth })).r.status, 200);
  assert.equal((await call('/api/data', { headers: auth })).r.status, 401);
  const l = await call('/api/auth/login', { body: u, headers: { 'x-client': 'mobile' } }); assert.ok(l.j.token);
  assert.equal((await call('/api/billing/plans')).j.configured, false);
});

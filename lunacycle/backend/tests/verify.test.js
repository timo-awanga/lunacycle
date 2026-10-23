import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test'; process.env.DATA_DIR = 'memory://';
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://localhost:${server.address().port}`;
const call = async (cookie, p, b) => { const r = await fetch(base + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: b && JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
after(async () => { server.close(); await pool.end(); });

test('terms required, email verification, AI unconfigured state', async () => {
  assert.equal((await call(null, '/api/auth/signup', { email: 'v@example.com', password: 'correct-horse-battery' })).r.status, 400);
  const logs = [], orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  const s = await call(null, '/api/auth/signup', { email: 'v@example.com', password: 'correct-horse-battery', acceptTerms: true });
  console.log = orig;
  assert.equal(s.r.status, 201);
  const cookie = s.r.headers.get('set-cookie').split(';')[0], token = logs.join('\n').match(/token=([\w-]+)/)[1];
  assert.equal((await call(cookie, '/api/data')).j.user.verified, false);
  assert.equal((await call(null, '/api/auth/verify-email', { token: 'x'.repeat(30) })).r.status, 400);
  assert.equal((await call(null, '/api/auth/verify-email', { token })).r.status, 200);
  assert.equal((await call(null, '/api/auth/verify-email', { token })).r.status, 400); // single use
  assert.equal((await call(cookie, '/api/data')).j.user.verified, true);
  assert.equal((await call(null, '/api/ai/status')).r.status, 401);
  assert.equal((await call(cookie, '/api/ai/status')).j.configured, false);
  assert.equal((await call(cookie, '/api/ai/chat', { message: 'hi' })).r.status, 503);
});

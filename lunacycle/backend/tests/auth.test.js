// Needs a migrated DB: npm test
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test'; process.env.DATA_DIR = 'memory://';
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

let server, base, cookie;
const email = `test+${Date.now()}@example.com`;
const pw = 'correct-horse-battery';
const call = (path, method = 'GET', body, withCookie = true) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(withCookie && cookie ? { Cookie: cookie } : {}) },
    body: body && JSON.stringify(body),
  });

before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
after(async () => { await pool.query('DELETE FROM users WHERE email = $1', [email]); server.close(); await pool.end(); });

test('rejects weak password', async () => {
  assert.equal((await call('/api/auth/signup', 'POST', { email, password: 'short' })).status, 400);
});
test('signup sets httpOnly cookie', async () => {
  const r = await call('/api/auth/signup', 'POST', { email, password: pw, acceptTerms: true });
  assert.equal(r.status, 201);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/i);
  cookie = sc.split(';')[0];
});
test('duplicate signup -> 409', async () => {
  assert.equal((await call('/api/auth/signup', 'POST', { email, password: pw, acceptTerms: true })).status, 409);
});
test('protected route needs session', async () => {
  assert.equal((await call('/api/auth/me', 'GET', null, false)).status, 401);
  assert.equal((await call('/api/auth/me')).status, 200);
});
test('wrong password -> 401, right password -> 200', async () => {
  assert.equal((await call('/api/auth/login', 'POST', { email, password: 'wrong-password-1' })).status, 401);
  assert.equal((await call('/api/auth/login', 'POST', { email, password: pw, acceptTerms: true })).status, 200);
});
test('forgot-password is uniform for unknown emails', async () => {
  assert.equal((await call('/api/auth/forgot-password', 'POST', { email: 'nobody@example.com' })).status, 200);
});
test('logout invalidates session', async () => {
  await call('/api/auth/logout', 'POST');
  assert.equal((await call('/api/auth/me')).status, 401);
});

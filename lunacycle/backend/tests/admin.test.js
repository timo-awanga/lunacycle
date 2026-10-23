import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test'; process.env.DATA_DIR = 'memory://';
const { app } = await import('../src/app.js');
const { pool, query } = await import('../src/db/pool.js');
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://localhost:${server.address().port}`;
const call = async (cookie, method, p, b) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: b && JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
const signup = async (email) => { const x = await call(null, 'POST', '/api/auth/signup', { email, password: 'correct-horse-battery', acceptTerms: true }); return { id: x.j.user.id, cookie: x.r.headers.get('set-cookie').split(';')[0] }; };
after(async () => { server.close(); await pool.end(); });

test('admin authorization, suspension, audit, isolation', async () => {
  const A = await signup('a@example.com'), B = await signup('b@example.com');
  await query("UPDATE users SET role='admin' WHERE id=$1", [B.id]); // only possible with DB access, as with `npm run make-admin`
  assert.equal((await call(null, 'GET', '/api/admin/stats')).r.status, 401);
  assert.equal((await call(A.cookie, 'GET', '/api/admin/stats')).r.status, 403);
  await call(A.cookie, 'PATCH', '/api/auth/me', { displayName: 'x', role: 'admin' }); // self-promotion attempt
  assert.equal((await call(A.cookie, 'GET', '/api/admin/users')).r.status, 403);
  const st = await call(B.cookie, 'GET', '/api/admin/stats');
  assert.equal(st.r.status, 200); assert.ok(st.j.total >= 2); assert.equal(st.j.signups.length, 30);
  assert.equal((await call(B.cookie, 'GET', '/api/admin/users?q=a@exa')).j.users.length, 1);
  assert.equal((await call(B.cookie, 'POST', '/api/admin/users/status', { userId: B.id, status: 'suspended' })).r.status, 400);
  assert.equal((await call(B.cookie, 'POST', '/api/admin/users/status', { userId: A.id, status: 'suspended' })).r.status, 200);
  assert.equal((await call(A.cookie, 'GET', '/api/data')).r.status, 401);
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: 'a@example.com', password: 'correct-horse-battery', acceptTerms: true })).r.status, 403);
  await call(B.cookie, 'POST', '/api/admin/users/status', { userId: A.id, status: 'active' });
  const login = await call(null, 'POST', '/api/auth/login', { email: 'a@example.com', password: 'correct-horse-battery', acceptTerms: true });
  assert.equal(login.r.status, 200);
  const cookieA = login.r.headers.get('set-cookie').split(';')[0];
  assert.ok((await call(B.cookie, 'GET', '/api/admin/audit')).j.logs.length >= 2);
  await call(cookieA, 'POST', '/api/logs', { logs: [{ date: '2026-01-05', flow: 2, note: 'private' }] });
  assert.equal((await call(B.cookie, 'GET', '/api/data')).j.logs['2026-01-05'], undefined); // data isolation
  assert.equal((await call(cookieA, 'GET', '/api/data')).j.logs['2026-01-05'].note, 'private');
});

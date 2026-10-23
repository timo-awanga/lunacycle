import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test'; process.env.DATA_DIR = 'memory://'; process.env.ANTHROPIC_API_KEY = 'test-key';
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://localhost:${server.address().port}`;
const real = globalThis.fetch; let sent = [], mode = 'ok';
globalThis.fetch = (u, o) => {
  if (!String(u).startsWith('https://api.anthropic.com')) return real(u, o);
  sent.push(o);
  return Promise.resolve(mode === 'ok'
    ? { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Mock answer' }], usage: { input_tokens: 10, output_tokens: 5 } }) }
    : { ok: false, status: 500 });
};
const call = async (cookie, p, b) => { const r = await real(base + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: b && JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
after(async () => { server.close(); await pool.end(); });

test('Luna AI: consent, insufficient data, minimisation, provider failure, usage', async () => {
  const s = await call(null, '/api/auth/signup', { email: 'ai@example.com', password: 'correct-horse-battery', acceptTerms: true });
  const c = s.r.headers.get('set-cookie').split(';')[0];
  assert.equal((await call(c, '/api/ai/status')).j.configured, true);
  assert.equal((await call(c, '/api/ai/chat', { message: 'hi' })).r.status, 403);         // no consent yet
  await call(c, '/api/ai/consent', { granted: true });
  let r = await call(c, '/api/ai/chat', { message: 'hi' });
  assert.equal(r.j.source, 'local'); assert.equal(sent.length, 0);                        // too little data: provider NOT called
  const logs = ['2026-01-01', '2026-01-02', '2026-01-29', '2026-01-30', '2026-02-26'].map((date) => ({ date, flow: 2, symptoms: ['Cramps', 'MY-CUSTOM-SECRET'], note: 'SECRET-NOTE-TEXT' }));
  await call(c, '/api/logs', { logs });
  await call(c, '/api/journal', { date: '2026-01-01', body: 'SECRET-JOURNAL' });
  r = await call(c, '/api/ai/chat', { message: 'Summarize my cycles' });
  assert.equal(r.j.reply, 'Mock answer');
  const body = sent[0].body;
  for (const secret of ['SECRET-NOTE-TEXT', 'SECRET-JOURNAL', 'MY-CUSTOM-SECRET', 'ai@example.com']) assert.ok(!body.includes(secret), secret);
  assert.ok(body.includes('Cramps'));
  mode = 'fail';
  assert.equal((await call(c, '/api/ai/chat', { message: 'again' })).r.status, 502);
  await call(c, '/api/ai/consent', { granted: false });
  assert.equal((await call(c, '/api/ai/chat', { message: 'x' })).r.status, 403);          // withdrawn
  const { rows } = await pool.query('SELECT count(*)::int n, count(*) FILTER (WHERE NOT ok)::int bad FROM ai_usage');
  assert.deepEqual([rows[0].n, rows[0].bad], [2, 1]);
});

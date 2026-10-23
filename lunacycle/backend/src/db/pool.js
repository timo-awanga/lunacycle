import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const schema = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
export let pool, query;

if (env.DATABASE_URL) {
  // Your own PostgreSQL server (recommended for production).
  const pg = (await import('pg')).default;
  pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: process.env.VERCEL ? 3 : 10 });
  query = (t, p) => pool.query(t, p);
  if (!process.env.VERCEL) await pool.query(schema); // on Vercel run `npm run migrate` once instead
} else {
  // Zero-setup mode: real PostgreSQL (PGlite) running inside Node, saved in ./data
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  if (!env.DATA_DIR.includes('://')) mkdirSync(env.DATA_DIR, { recursive: true });
  const db = new PGlite(env.DATA_DIR, { extensions: { citext } });
  await db.waitReady;
  await db.exec(schema);
  // PGlite has one connection, so serialize access so transactions never interleave.
  let tail = Promise.resolve();
  const lock = () => { let rel; const p = new Promise((r) => (rel = r)); const prev = tail; tail = prev.then(() => p); return prev.then(() => rel); };
  query = async (t, p) => { const rel = await lock(); try { return await db.query(t, p); } finally { rel(); } };
  pool = { query, end: () => db.close(),
    connect: async () => { const rel = await lock(); return { query: (t, p) => db.query(t, p), release: rel }; } };
}

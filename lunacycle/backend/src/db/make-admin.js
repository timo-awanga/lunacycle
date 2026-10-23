// Owner-only: run on the server/with DB access. There is NO web endpoint that grants admin.
// Usage: npm run make-admin -- you@example.com [--revoke]   (also your account-recovery path)
import { query, pool } from './pool.js';
const [email, flag] = process.argv.slice(2);
if (!email) { console.error('Usage: npm run make-admin -- you@example.com [--revoke]'); process.exit(1); }
const role = flag === '--revoke' ? 'user' : 'admin';
const { rows } = await query('UPDATE users SET role=$1 WHERE email=$2 RETURNING id', [role, email.toLowerCase()]);
if (!rows[0]) { console.error('No account with that email. Sign up in the app first.'); await pool.end(); process.exit(1); }
await query('INSERT INTO audit_logs (actor_id, action, target_id, meta) VALUES (NULL,$1,$2,$3)',
  [role === 'admin' ? 'role.grant' : 'role.revoke', rows[0].id, JSON.stringify({ via: 'cli' })]);
console.log(`✔ ${email} is now: ${role}`);
await pool.end();
process.exit(0);

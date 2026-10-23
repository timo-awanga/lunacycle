# LunaCycle — quick start (no database install needed)

```bash
cd backend
npm install
npm start
```
Open **http://localhost:4000**, click *Create account*, then *Load sample data* on the dashboard.

Data is saved in `backend/data/` (a real PostgreSQL engine running inside Node). Back this folder up to keep your data.
Password-reset links print in the terminal until an email provider is added.

## Optional: use your own PostgreSQL
Set `DATABASE_URL` in `backend/.env` (copy `.env.example`). Tables are created automatically.

## Tests
`cd backend && npm test`  (8 API tests: auth, logs, settings, journal, export, account deletion)

## Production
NODE_ENV=production, CLIENT_ORIGIN=https://your-domain, DATABASE_URL set, and serve behind HTTPS (Caddy/nginx).

## Deploy to Vercel with Neon
1. Create a project at neon.tech and copy its connection string (ends with `?sslmode=require`).
2. Create the tables once, from your computer:
   - Windows PowerShell: `$env:DATABASE_URL="<neon string>"; npm run migrate`
   - Mac/Linux: `DATABASE_URL="<neon string>" npm run migrate`
3. Push this folder to a GitHub repo and import it in Vercel (leave the build settings alone).
4. In Vercel > Settings > Environment Variables add:
   `DATABASE_URL` = the Neon string, `NODE_ENV` = `production`, `CLIENT_ORIGIN` = `https://<your-project>.vercel.app`
5. Redeploy. Password-reset emails are NOT sent yet (no email provider configured).

## Languages, install & email
- UI languages: English, Español, Français, Deutsch, Português, 日本語 (Settings > Language, or the login screen). Translations are machine-quality: have native speakers review them before launch.
- Installable on phones/desktops (PWA). Health data is never cached offline.
- Password-reset emails: create a Resend account, verify your domain, then set `RESEND_API_KEY` and `MAIL_FROM` (e.g. `LunaCycle <no-reply@yourdomain.com>`) as environment variables.

## Admin console (Phase 1)
Admin rights can NOT be obtained from the website. After you sign up normally, grant yourself admin on the machine that has database access:
```bash
cd backend && npm run make-admin -- you@example.com        # grant (also your account-recovery path)
npm run make-admin -- you@example.com --revoke              # revoke
```
Then log in and open **Admin** in the menu. It shows account metadata and aggregate counts only (never health entries). Suspensions and role changes are written to the audit log.

## Phase 2: verification, consent, Luna AI
- New accounts must accept the Terms/Privacy (recorded in `consent_records`) and receive a verification email (link prints in the terminal if no email provider is set).
- Luna AI (cloud): set `ANTHROPIC_API_KEY` on the server. Users must opt in first; only aggregates are sent (never name, email, notes, journal or custom symptoms). Without the key the app shows a setup state and the on-device assistant still works.
- `backend/src/lib/cycle.js`: tested, timezone-safe cycle maths (used by Luna AI; the browser UI still has its own copy).
- Tests: `cd backend && npm test` (15 tests).

## Phase 3: visual refresh
Plum/lavender/pink design system with glass navigation, SVG icons, a cycle-progress ring, gradient accents, toast notifications (replacing browser alerts), loading skeletons and reduced-motion support. "Load sample data" is shown only when NODE_ENV is not `production`.

## Phase 4: billing, mobile, motion, translations
- **Billing:** Stripe Checkout + Customer Portal. Set the 4 STRIPE_* / PRICE_LABEL variables; add a webhook in Stripe for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Test with Stripe test mode first. Verified here only with mocked Stripe calls and signed test webhooks; confirm the webhook works on your host (on Vercel check that the raw body reaches the function).
- **Mobile (Expo):** `cd mobile && npm install && npx expo install --fix && EXPO_PUBLIC_API_URL=https://your-api npx expo start`. Uses Bearer tokens (`X-Client: mobile`) stored in SecureStore. This starter was NOT run here.
- **Style:** inspired by the general idea of a friendly cycle dial, not a copy of any app: segmented phase dial with today marker, count-up number, staggered card entrance, floating colour blobs, tap bounce (all disabled for reduced-motion users).

# LunaCycle
The backend serves the account-backed app from `frontend/index.html` and its API from the same origin. Open http://localhost:4000/ after starting the server; do not open the HTML files directly. You can browse as a guest, but saving tracking data, journal entries, settings, or sample data requires an account. After login, the app loads and saves that account's data in PostgreSQL.

```bash
createdb lunacycle                 # PostgreSQL 13+
cd backend
cp .env.example .env               # set DATABASE_URL
npm install
npm run migrate
npm run dev                        # open http://localhost:4000
npm test                           # auth API tests
```
Sign up or log in to save data across sessions. Use "Load sample data" on the dashboard to preview charts and patterns; sample data is saved to the signed-in account.
Password-reset links print in the server console until an email provider is added.

## Production
Set NODE_ENV=production, CLIENT_ORIGIN=https://your-domain, a managed Postgres DATABASE_URL, and serve over HTTPS (reverse proxy such as Caddy/nginx).

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { sameOriginOnly } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';
const FRONT = fileURLToPath(new URL('../../frontend/', import.meta.url));

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind an HTTPS reverse proxy in production
app.use(helmet({ contentSecurityPolicy: { directives: {
  scriptSrc: ["'self'", "'unsafe-inline'"], scriptSrcAttr: ["'unsafe-inline'"],
  upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null } } }));
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(sameOriginOnly);

// Health data never appears in URLs: dates/IDs travel in bodies or opaque UUIDs.
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', dataRoutes);
app.use(express.static(FRONT));
app.use((req, res, next) =>
  req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(FRONT + 'index.html') : next());

app.use(notFound);
app.use(errorHandler);

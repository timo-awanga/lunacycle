import pg from 'pg';
import { env } from '../config/env.js';

// All queries use parameterized placeholders ($1, $2…) -> SQL-injection safe.
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
export const query = (text, params) => pool.query(text, params);

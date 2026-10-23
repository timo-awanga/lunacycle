import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default('./data'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('LunaCycle <onboarding@resend.dev>'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  PRICE_LABEL: z.string().optional(),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:4000'),
});

export const env = schema.parse(process.env);

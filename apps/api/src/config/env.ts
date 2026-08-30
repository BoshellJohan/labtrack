import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Defaulted rather than required on purpose. `main` deploys automatically, so
  // a required variable would stop the API booting on the next deploy over a
  // header string. The cost, stated: with nobody configuring it, the PDF goes
  // out with the placeholder.
  LAB_NAME: z.string().min(1).default('Laboratorio'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration -> ${details}`);
  }
  return result.data;
}

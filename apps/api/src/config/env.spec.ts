import { parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/labtrack',
  JWT_SECRET: 'a-secret-long-enough-for-signing',
  JWT_EXPIRES_IN: '8h',
  CORS_ORIGIN: 'http://localhost:4200',
  PORT: '3000',
};

describe('parseEnv', () => {
  it('returns a typed configuration when every variable is present', () => {
    expect(parseEnv(valid)).toEqual({ ...valid, PORT: 3000 });
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET, ...withoutSecret } = valid;
    expect(() => parseEnv(withoutSecret)).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT_SECRET is too short to be safe', () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });
});

import { assertTestDatabase } from '../../../test/utils/assert-test-database';

describe('assertTestDatabase', () => {
  it('accepts a localhost database', () => {
    expect(() =>
      assertTestDatabase('postgresql://labtrack:pass@localhost:5432/labtrack'),
    ).not.toThrow();
  });

  it('accepts 127.0.0.1', () => {
    expect(() =>
      assertTestDatabase('postgresql://labtrack:pass@127.0.0.1:5432/labtrack'),
    ).not.toThrow();
  });

  it('refuses a remote host', () => {
    expect(() =>
      assertTestDatabase(
        'postgresql://user:pass@ep-plain-heart.us-east-2.aws.neon.tech/neondb',
      ),
    ).toThrow(/refusing to run/i);
  });

  it('names the offending host without echoing credentials', () => {
    let message = '';
    try {
      assertTestDatabase('postgresql://user:sup3rsecret@db.example.com/app');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('db.example.com');
    expect(message).not.toContain('sup3rsecret');
  });

  it('refuses when the URL is missing', () => {
    expect(() => assertTestDatabase(undefined)).toThrow(/DATABASE_URL/);
  });
});

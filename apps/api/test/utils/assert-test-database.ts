const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Every e2e suite truncates shared tables. Pointed at a real database that
 * destroys data with no warning and no undo, so the harness refuses to start
 * unless the host is local.
 */
export function assertTestDatabase(url: string | undefined): void {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The e2e suites need a local database; ' +
        'copy apps/api/.env.example to apps/api/.env.',
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }

  if (!LOCAL_HOSTS.has(host)) {
    // The host is named because it is what the reader needs to act on; the
    // credentials in the URL are never included.
    throw new Error(
      `Refusing to run the e2e suites against '${host}'. ` +
        'They TRUNCATE tables on every test, which would destroy the data in ' +
        'that database. Point DATABASE_URL at a local database first.',
    );
  }
}

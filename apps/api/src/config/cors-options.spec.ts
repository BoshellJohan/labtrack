import { corsOptions } from './cors-options';

describe('corsOptions', () => {
  it('exposes Content-Disposition so a cross-origin download can read the filename the server sent', () => {
    // Regression guard for a real bug: without this, a browser reading the
    // export response can see the file's bytes but not the filename in
    // Content-Disposition (browsers only expose a small default header
    // allowlist to cross-origin JavaScript). This has no e2e coverage
    // because main.ts's bootstrap() — the only caller of enableCors — never
    // runs under the e2e harness (test/utils/test-app.ts calls
    // configureApp() but not this), so a plain inline options object had no
    // automated check at all.
    const options = corsOptions('http://localhost:4200');

    expect(options.exposedHeaders).toContain('Content-Disposition');
  });

  it('still restricts requests to the configured origin', () => {
    expect(corsOptions('https://labtrack.example').origin).toBe(
      'https://labtrack.example',
    );
  });
});

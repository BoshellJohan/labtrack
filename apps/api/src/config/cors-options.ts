import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

// Extracted so it can be unit tested: main.ts's bootstrap() (where
// app.enableCors was previously called inline) never runs under the e2e
// harness (see test/utils/test-app.ts, which calls configureApp() but not
// this), so a plain inline options object had no automated check at all.
//
// exposedHeaders is the field that matters here. By the CORS spec, a
// cross-origin page's JavaScript may read only a small default allowlist of
// response headers; Content-Disposition (the export filename) is not on it
// unless the server explicitly exposes it. Without this, a browser download
// still gets the file's bytes but can never read the filename the server
// computed (see export-filename.ts) — it falls back to a generic name, with
// no error to signal the gap. Netlify/Railway put the web app and the API on
// different origins by definition, so this is not a local-only concern.
export function corsOptions(origin: string): CorsOptions {
  return {
    origin,
    credentials: false,
    exposedHeaders: ['Content-Disposition'],
  };
}

// Prisma 7 moved the datasource URL, the migrations path and the seed command
// out of schema.prisma and package.json into this file.
//
// The CLI no longer loads .env on its own, hence the dotenv import.
//
// Deliberately NOT fail-fast on a missing DATABASE_URL: this file is loaded for
// every Prisma command, including `prisma generate`, which needs no database and
// runs from postinstall on every install. Throwing here breaks `npm ci` on any
// machine without a .env — a fresh clone, CI, or the Netlify build, which
// installs every workspace. Commands that do need a connection fail on their own
// with a clear message. The application keeps its fail-fast rule where it
// belongs, at startup, in src/config/env.ts.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // tsx rather than ts-node: the generated Prisma client imports its own
    // modules with .js specifiers, which ts-node does not map back to .ts under
    // CommonJS. Loaded through `node --require` because Prisma spawns this
    // command itself, without the node_modules/.bin PATH that npm scripts add.
    seed: 'node --require tsx/cjs prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});

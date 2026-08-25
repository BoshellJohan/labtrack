// Jest global setup: runs once, in its own process/module scope, before any
// e2e suite file is even collected. This is the outermost line of defence
// against running the e2e suites against a non-local database.
//
// The three call sites in test-app.ts and seed.e2e-spec.ts stay in place on
// purpose (defence in depth): they document the requirement right where the
// TRUNCATE happens, and they still protect a suite run outside this Jest
// config (e.g. a single file run through a different runner). But relying on
// each new e2e file to remember to call the guard is exactly the kind of
// protection that eventually gets forgotten — Phase 2 adds four more e2e
// suites, and any of them skipping the call would silently reopen this gap.
// This global setup makes the check unconditional for every e2e run.
//
// This module has its own scope, separate from every suite file, so it needs
// its own dotenv load rather than assuming a suite's import already did it.
import 'dotenv/config';
import { assertTestDatabase } from './assert-test-database';

export default function globalSetup(): void {
  assertTestDatabase(process.env.DATABASE_URL);
}

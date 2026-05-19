#!/usr/bin/env node
/**
 * Thin Prisma CLI wrapper that bridges Orbit's two database modes:
 *
 * - Supabase mode (dev today): DATABASE_URL is the pooled pgbouncer URL,
 *   DIRECT_URL is the direct-port URL Prisma uses for migrations.
 * - Bundled-Postgres mode (Docker compose): only DATABASE_URL is set;
 *   migrations and runtime use the same connection.
 *
 * Prisma's schema reads `directUrl = env("DIRECT_URL")` unconditionally —
 * when DIRECT_URL is unset (bundled mode), Prisma errors out. This shim
 * fills DIRECT_URL from DATABASE_URL so migrations work in both modes
 * without forcing the user to set the same URL twice in their .env.
 *
 * Invocation: same as `prisma`, e.g. `node prisma-shim.cjs migrate dev`.
 */
const { spawn } = require("node:child_process");

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const args = process.argv.slice(2);
// `shell: true` is needed on Windows so we can find `npx.cmd` via PATH —
// Node's direct .cmd spawn fails with EINVAL. The DEP0190 warning that
// fires here is about untrusted-input injection; we only ever pass our
// own argv through, so the security concern doesn't apply.
const child = spawn("npx", ["prisma", ...args], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("Failed to launch prisma:", err);
  process.exit(1);
});

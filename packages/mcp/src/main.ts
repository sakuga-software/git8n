#!/usr/bin/env node
import { configOf, NotConfiguredError } from './api.ts';
import { serveOverStdio } from './server.ts';

/**
 * The server an agent spawns (DB-211). `git8n mcp` starts the same server (DB-671).
 *
 * It speaks over stdio, so **nothing may be written to stdout** but the
 * protocol: a stray `console.log` corrupts the stream and the agent reads a
 * parse error rather than an answer. What has to be said goes to stderr.
 */
try {
  await serveOverStdio(configOf(process.env));
} catch (error) {
  console.error(error instanceof NotConfiguredError ? error.message : error);
  process.exit(1);
}

#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configOf, NotConfiguredError } from './api.ts';
import { buildServer } from './server.ts';

/**
 * The server an agent spawns (DB-211).
 *
 * It speaks over stdio, so **nothing may be written to stdout** but the
 * protocol: a stray `console.log` corrupts the stream and the agent reads a
 * parse error rather than an answer. What has to be said goes to stderr.
 */
try {
  await buildServer(configOf(process.env)).connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof NotConfiguredError ? error.message : error);
  process.exit(1);
}

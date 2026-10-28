import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiConfig } from '../api.ts';
import { run, type Io } from './run.ts';

/** What one run of the command line wrote and answered. */
export interface Ran {
  exit: number;
  stdout: string;
  stderr: string;
  /** The parsed stdout of a run with `--json`. */
  json: <T = any>() => T;
}

export interface FakeIo {
  io: Io;
  /** The folder that holds the credentials of this test. */
  configHome: string;
  served: ApiConfig[];
  opened: string[];
  /** Runs the command line with these arguments. */
  run: (...argv: string[]) => Promise<Ran>;
}

/**
 * A computer for the tests of the command line: a temporary folder for the
 * credentials, a clock that a sleep moves, and the `fetch` that the test gives.
 */
export const fakeIo = async (
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  overrides: Partial<Io> = {},
): Promise<FakeIo> => {
  const configHome = await mkdtemp(join(tmpdir(), 'i18n-editor-cli-'));
  const served: ApiConfig[] = [];
  const opened: string[] = [];
  let clock = Date.parse('2026-10-28T12:00:00Z');
  let stdout = '';
  let stderr = '';

  const io: Io = {
    env: { XDG_CONFIG_HOME: configHome },
    home: '/nonexistent',
    cwd: '/nonexistent',
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    readStdin: async () => '',
    readFile: async () => '',
    readDir: async () => null,
    fetch: ((input: string | URL | Request, init?: RequestInit) => fetcher(String(input), init)) as typeof fetch,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    openUrl: async (url) => {
      opened.push(url);

      return true;
    },
    gitRemotes: async () => [],
    serveMcp: async (config) => {
      served.push(config);
    },
    version: '0.0.0-test',
    ...overrides,
  };

  return {
    io,
    configHome,
    served,
    opened,
    run: async (...argv) => {
      stdout = '';
      stderr = '';

      const exit = await run(argv, io);
      const out = stdout;

      return { exit, stdout: out, stderr, json: () => JSON.parse(out) };
    },
  };
};

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

import { execFile, spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { serveOverStdio } from '../server.ts';
import { run } from './run.ts';

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks).toString('utf8');
};

const openUrl = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    const [command, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : ['xdg-open', [url]];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });

    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });

const gitRemotes = async (cwd: string): Promise<string[]> => {
  try {
    const { stdout } = await promisify(execFile)('git', ['remote', '-v'], { cwd });

    return stdout.split('\n').flatMap((line) => line.split(/\s+/)[1] ?? []);
  } catch {
    return [];
  }
};

/** Runs the CLI on the arguments of the process, and sets its exit status. */
export const main = async (version: string): Promise<void> => {
  process.exitCode = await run(process.argv.slice(2), {
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin,
    readFile: (path) => readFile(path, 'utf8'),
    readDir: async (path) => {
      try {
        return (await readdir(path, { withFileTypes: true })).map((entry) => ({
          name: entry.name,
          directory: entry.isDirectory(),
        }));
      } catch {
        return null;
      }
    },
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    openUrl,
    gitRemotes,
    serveMcp: serveOverStdio,
    version,
  });
};

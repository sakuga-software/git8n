import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import manifest from '../package.json' with { type: 'json' };

/**
 * The file that npm installs (DB-687). `pnpm test` builds it first.
 */

const BIN = fileURLToPath(new URL('../dist/git8n.js', import.meta.url));
const env = { ...process.env, GIT8N_API_URL: '', GIT8N_API_TOKEN: '' };
const cli = (args: string[], cwd?: string) => promisify(execFile)(process.execPath, [BIN, ...args], { env, cwd });

describe('the published binary', () => {
  it('answers the version of its package', async () => {
    const { stdout } = await cli(['--version', '--json']);

    expect(JSON.parse(stdout)).toEqual({ data: { version: manifest.version } });
  });

  it('exits with the status of the error', async () => {
    await expect(cli(['nope'])).rejects.toMatchObject({ code: 2 });
  });

  it('checks the locale files of a folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git8n-'));

    await mkdir(join(root, 'locales/en'), { recursive: true });
    await mkdir(join(root, 'locales/fr'), { recursive: true });
    await writeFile(join(root, 'locales/en/common.json'), '{"hello":"Hello {{name}}"}');
    await writeFile(join(root, 'locales/fr/common.json'), '{"hello":"Bonjour"}');

    const failure = await cli(['check', '--source', 'en', '--json'], root).catch((error) => error);

    expect(failure.code).toBe(1);
    expect(JSON.parse(failure.stdout).data.problems).toEqual([expect.objectContaining({ rule: 'placeholders' })]);
  });

  it('serves the MCP protocol with `mcp`', async () => {
    const client = new Client({ name: 'test', version: '0' });

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN, 'mcp'],
        env: { ...env, GIT8N_API_URL: 'https://api.test', GIT8N_API_TOKEN: 'unused' },
        stderr: 'pipe',
      }),
    );

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toContain('i18n_propose');

    await client.close();
  });
});

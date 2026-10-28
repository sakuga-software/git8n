import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

/**
 * The binary that a person runs (DB-671).
 *
 * The rest of the suite runs `run` in memory. Only a real process proves that
 * Node, with type stripping, starts the command.
 */

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const cli = (...args: string[]) =>
  promisify(execFile)(process.execPath, ['--experimental-strip-types', MAIN, ...args], {
    env: { ...process.env, GIT8N_API_URL: '', GIT8N_API_TOKEN: '' },
  });

describe('the command a person runs', () => {
  it('starts, and answers its version', async () => {
    const { stdout } = await cli('--version', '--json');

    expect(JSON.parse(stdout)).toEqual({ data: { version: expect.stringMatching(/^\d+\.\d+\.\d+/) } });
  });

  it('exits with the status of the error', async () => {
    await expect(cli('nope')).rejects.toMatchObject({ code: 2 });
  });

  it('serves the MCP protocol with `mcp`', async () => {
    const client = new Client({ name: 'test', version: '0' });

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--experimental-strip-types', MAIN, 'mcp'],
        env: { ...process.env, GIT8N_API_URL: 'https://api.test', GIT8N_API_TOKEN: 'unused' },
        stderr: 'pipe',
      }),
    );

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toContain('i18n_propose');

    await client.close();
  });
});

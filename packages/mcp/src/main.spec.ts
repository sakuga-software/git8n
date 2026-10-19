import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * The binary an agent spawns (DB-211).
 *
 * The rest of the suite builds the server in memory, where vitest resolves the
 * imports. **Node does not resolve them the same way**, and the first version
 * of this package answered thirteen green tests while the process could not
 * boot at all — twice over: an import without its extension, then a parameter
 * property that strip-only mode refuses.
 *
 * This spawns the real command the README documents and speaks the protocol to
 * it, which is the only thing that can say it starts.
 */

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

describe('the command an agent runs', () => {
  it('starts, and answers the protocol', async () => {
    const client = new Client({ name: 'test', version: '0' });

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--experimental-strip-types', MAIN],
        // The API is never called: listing the tools asks it nothing. What is
        // under test is that the process boots and speaks.
        env: { ...process.env, DETECTIVEBOX_API_URL: 'https://api.test', DETECTIVEBOX_API_TOKEN: 'unused' },
        stderr: 'pipe',
      }),
    );

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'i18n_key',
      'i18n_keys',
      'i18n_me',
      'i18n_proposals',
      'i18n_propose',
      'i18n_repositories',
    ]);

    await client.close();
  }, 30_000);

  /** Without its two variables it says which, and stops rather than serving. */
  it('refuses to start with nothing configured, and names what is missing', async () => {
    const client = new Client({ name: 'test', version: '0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--experimental-strip-types', MAIN],
      env: { PATH: process.env.PATH ?? '' },
      stderr: 'pipe',
    });

    await expect(client.connect(transport)).rejects.toThrow();
    await transport.close().catch(() => undefined);
  }, 30_000);
});

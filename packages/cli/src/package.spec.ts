import { execFile } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * The tarball that `release-npm.yml` sends to npm (DB-688).
 *
 * npm refuses a provenance that names no repository, or another one. A `catalog:` or a
 * `workspace:` range that survives the pack makes the package impossible to install.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);

const pack = async () => {
  const out = await mkdtemp(join(tmpdir(), 'git8n-pack-'));

  await run('pnpm', ['pack', '--pack-destination', out], { cwd: ROOT });

  const [tarball] = await readdir(out);
  const read = async (file: string) =>
    (await run('tar', ['-xzOf', join(out, tarball!), `package/${file}`], { maxBuffer: 8 * 1024 * 1024 })).stdout;
  const files = (await run('tar', ['-tzf', join(out, tarball!)])).stdout.split('\n').filter(Boolean);

  return { files, manifest: JSON.parse(await read('package.json')), read };
};

let packed: ReturnType<typeof pack> | undefined;
const tarball = () => (packed ??= pack());

describe('the tarball of @git8n/cli', () => {
  it('holds the bundle, the README and the licence, and nothing else', async () => {
    const { files } = await tarball();

    expect(files.sort()).toEqual([
      'package/LICENSE',
      'package/README.md',
      'package/dist/git8n.js',
      'package/package.json',
    ]);
  }, 60_000);

  it('names its repository and its directory, for the provenance', async () => {
    const { manifest } = await tarball();

    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/sakuga-software/git8n.git',
      directory: 'packages/cli',
    });
  }, 60_000);

  it('gives real ranges to its dependencies', async () => {
    const { manifest } = await tarball();

    for (const range of Object.values<string>(manifest.dependencies ?? {})) {
      expect(range).not.toMatch(/^(catalog|workspace):/);
    }
  }, 60_000);

  it('starts with a shebang, so that npm can link the command', async () => {
    const { manifest, read } = await tarball();

    expect(manifest.bin).toEqual({ git8n: './dist/git8n.js' });
    expect((await read('dist/git8n.js')).startsWith('#!/usr/bin/env node\n')).toBe(true);
  }, 60_000);
});

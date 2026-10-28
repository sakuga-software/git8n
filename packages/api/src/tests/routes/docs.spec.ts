import '../setup-env';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const webRoot = mkdtempSync(join(tmpdir(), 'web-root-'));

const write = (path: string, content: string) => {
  mkdirSync(join(webRoot, path, '..'), { recursive: true });
  writeFileSync(join(webRoot, path), content);
};

write('index.html', '<p>the editor</p>');
write('docs/index.html', '<p>the docs</p>');
write('docs/guide/concepts.html', '<p>concepts</p>');
write('docs/raw/guide/concepts.md', '# Concepts\n');
write('docs/llms.txt', '# i18n-editor\n');
write('docs/demo/index.html', '<p>the demo</p>');

let app: (typeof import('../../app'))['default'];

beforeAll(async () => {
  process.env.WEB_ROOT = webRoot;
  ({ default: app } = await import('../../app'));
});

describe('the site of the documentation', () => {
  it('sends /docs to /docs/', async () => {
    const res = await app.request('/docs');

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/docs/');
  });

  it('serves the home page and a page of the site', async () => {
    expect(await (await app.request('/docs/')).text()).toBe('<p>the docs</p>');
    expect(await (await app.request('/docs/guide/concepts.html')).text()).toBe('<p>concepts</p>');
  });

  it('serves a raw page as Markdown, and llms.txt as text', async () => {
    const raw = await app.request('/docs/raw/guide/concepts.md');

    expect(raw.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await raw.text()).toBe('# Concepts\n');
    expect((await app.request('/docs/llms.txt')).headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('answers 404 for a missing page, and not the page of the editor', async () => {
    const res = await app.request('/docs/nothing.html');

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('the editor');
  });

  it('opens the demo on any of its paths, as the editor does', async () => {
    expect(await (await app.request('/docs/demo/')).text()).toBe('<p>the demo</p>');
    expect(await (await app.request('/docs/demo/repositories/demo-acme-shop')).text()).toBe('<p>the demo</p>');
  });

  it('still opens the editor on its own paths', async () => {
    expect(await (await app.request('/repositories/42')).text()).toBe('<p>the editor</p>');
  });
});

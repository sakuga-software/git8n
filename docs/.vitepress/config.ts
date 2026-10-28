import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vitepress';

const repository = 'https://github.com/sakuga-software/i18n-editor';

const titleOf = (markdown: string, page: string): string =>
  markdown.match(/^title:\s*(.+)$/m)?.[1] ?? markdown.match(/^#\s+(.+)$/m)?.[1] ?? page;

/**
 * Writes each page again as Markdown under `raw/`, and lists them in `llms.txt`.
 * An agent reads these files. They do not need the HTML or its scripts.
 */
const writeRawPages = async (srcDir: string, outDir: string, pages: string[]) => {
  const lines = [
    '# i18n-editor',
    '',
    '> An editor for the JSON locale files of a GitHub repository, with an MCP server for agents.',
    '',
    '## Pages',
    '',
  ];

  for (const page of [...pages].sort()) {
    const markdown = await readFile(join(srcDir, page), 'utf8');
    const target = join(outDir, 'raw', page);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, markdown);
    lines.push(`- [${titleOf(markdown, page)}](/docs/raw/${page})`);
  }

  await writeFile(join(outDir, 'llms.txt'), `${lines.join('\n')}\n`);
};

export default defineConfig({
  title: 'i18n-editor',
  description: 'Translate the JSON locale files of a GitHub repository, by hand or with an agent.',
  base: '/docs/',
  lastUpdated: false,
  head: [['link', { rel: 'alternate', type: 'text/plain', href: '/docs/llms.txt', title: 'llms.txt' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Agents', link: '/agents/mcp' },
      { text: 'Reference', link: '/reference/mcp-tools' },
      // A link with a target leaves the router, and VitePress then adds no base.
      { text: 'llms.txt', link: '/docs/llms.txt', target: '_self' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Concepts', link: '/guide/concepts' },
          { text: 'Accounts and rights', link: '/guide/accounts' },
          { text: 'A repository and its files', link: '/guide/repositories' },
        ],
      },
      {
        text: 'Operate',
        items: [
          { text: 'Deploy', link: '/operate/deploy' },
          { text: 'The GitHub App', link: '/operate/github-app' },
        ],
      },
      {
        text: 'Agents',
        items: [
          { text: 'MCP server', link: '/agents/mcp' },
          { text: 'Access tokens', link: '/agents/tokens' },
          { text: 'CLI', link: '/agents/cli' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'MCP tools', link: '/reference/mcp-tools' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    search: { provider: 'local' },
    outline: [2, 3],
  },
  markdown: {
    // A message format writes `{{` and `}}`. Vue reads them as an expression, except in a `v-pre` element.
    config: (md) => {
      const render = md.renderer.rules.code_inline!;

      md.renderer.rules.code_inline = (...args) => render(...args).replace('<code', '<code v-pre');
    },
  },
  buildEnd: (site) => writeRawPages(site.srcDir, site.outDir, site.pages),
});

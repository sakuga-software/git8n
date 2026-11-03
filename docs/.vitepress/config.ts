import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const repository = 'https://github.com/sakuga-software/git8n';

/**
 * Whether git can give each page the date of its last commit.
 *
 * The image of `packages/api/Dockerfile` has no git, and its context has no `.git`. A shallow
 * clone gives every page the date of its one commit. In both cases, no date is shown, because a
 * false date is worse than none.
 */
const hasFullHistory = (): boolean => {
  const result = spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    encoding: 'utf8',
  });

  return !result.error && result.status === 0 && result.stdout.trim() === 'false';
};

const titleOf = (markdown: string, page: string): string =>
  markdown.match(/^title:\s*(.+)$/m)?.[1] ?? markdown.match(/^#\s+(.+)$/m)?.[1] ?? page;

/**
 * Writes each page again as Markdown under `raw/`, and lists them in `llms.txt`.
 * An agent reads these files. They do not need the HTML or its scripts.
 */
const writeRawPages = async (srcDir: string, outDir: string, pages: string[]) => {
  const lines = [
    '# git8n',
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
  title: 'git8n',
  description: 'Translate the JSON locale files of a GitHub repository, by hand or with an agent.',
  base: '/docs/',
  lastUpdated: hasFullHistory(),
  head: [['link', { rel: 'alternate', type: 'text/plain', href: '/docs/llms.txt', title: 'llms.txt' }]],
  themeConfig: {
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
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
          { text: 'Troubleshooting', link: '/guide/troubleshooting' },
        ],
      },
      {
        text: 'Formats',
        items: [
          { text: 'Overview', link: '/formats/' },
          { text: 'i18next JSON', link: '/formats/i18next' },
          { text: 'ICU MessageFormat', link: '/formats/icu' },
          { text: 'Libraries', link: '/formats/libraries' },
        ],
      },
      {
        text: 'Operate',
        items: [
          { text: 'Run it locally', link: '/operate/self-host' },
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
  // A page of a dynamic route gets its text from code, not from its `.md` file. Its edit link and
  // the date of that file would both be wrong.
  transformPageData: (page) =>
    page.params ? { lastUpdated: undefined, frontmatter: { ...page.frontmatter, editLink: false } } : undefined,
  buildEnd: (site) => writeRawPages(site.srcDir, site.outDir, site.pages),
});

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

/** The `description` of the frontmatter, on one line, without the quotes of YAML. */
const descriptionOf = (markdown: string): string | undefined => {
  const value = markdown.match(/^---\n[\s\S]*?^description:\s*(.+)$[\s\S]*?^---$/m)?.[1]?.trim();

  if (value?.startsWith('"')) return JSON.parse(value) as string;
  // oxfmt writes a value with `: ` in single quotes. YAML writes a quote in it as `''`.
  if (value?.startsWith("'")) return value.slice(1, -1).replaceAll("''", "'");

  return value;
};

/**
 * The page again, for a reader of `/docs/raw/`.
 *
 * A link that starts with `/` names a page of the site, and the site lives under `/docs/`. A link
 * to a folder names its `index.md`, the only file that `/docs/raw/` holds for it. The lines of a
 * code block stay as they are.
 */
const rawOf = (markdown: string): string => {
  let fence = false;

  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence) return line;

      return line
        .replace(/\]\(\/(?!docs\/)([^)]*)\)/g, '](/docs/$1)')
        .replace(/\]\((\.{1,2}\/[^)#]*\/)(#[^)]*)?\)/g, ']($1index.md$2)');
    })
    .join('\n');
};

/** The limits of git8n, for an agent that reads `llms.txt` before anything else. */
const KEY_FACTS = [
  '## Key facts',
  '',
  '- The files of a GitHub repository are the storage. The database holds the repositories, the accounts and their rights, and no text.',
  '- JSON locale files only, in one folder for each language. No YAML, `.po`, XLIFF or ARB.',
  '- GitHub only, through a GitHub App. No GitLab or Bitbucket.',
  '- No translation memory, no glossary, and no machine translation on the server.',
  '- The MCP server and the CLI propose. They never publish: a person with the right reviews and publishes.',
  '- A proposal is a commit on the branch `i18n/<language>`. A publication is a commit on the base branch, or a pull request.',
  '- `git8n check` checks the locale files of a clone with no server and no token.',
];

/**
 * Writes each page again as Markdown under `raw/`, all of them in `llms-full.txt`, and lists
 * them in `llms.txt`. An agent reads these files. They do not need the HTML or its scripts.
 *
 * WARNING: the build fails if a page has no `description` in its frontmatter. `llms.txt` gives it
 * beside each link.
 */
const writeRawPages = async (
  srcDir: string,
  outDir: string,
  pages: string[],
  dynamicRoutes: Array<{ path: string; route: string; content?: string }>,
) => {
  // A page of a dynamic route has no file of its own: its template holds the content of its loader.
  const dynamic = new Map(dynamicRoutes.map((route) => [route.path, route]));
  const lines = [
    '# git8n',
    '',
    '> An editor for the JSON locale files of a GitHub repository, with an MCP server for agents.',
    '',
    'To connect an agent to git8n, read [the setup prompt](/docs/agent-prompt.md). Every page below is also in [llms-full.txt](/docs/llms-full.txt).',
    '',
    ...KEY_FACTS,
    '',
    '## Pages',
    '',
  ];
  const full: string[] = [];
  const undescribed: string[] = [];

  for (const page of [...pages].sort()) {
    const route = dynamic.get(page);
    const markdown = route
      ? (await readFile(join(srcDir, route.route), 'utf8')).replace('<!-- @content -->', route.content ?? '')
      : await readFile(join(srcDir, page), 'utf8');
    const raw = rawOf(markdown);
    const target = join(outDir, 'raw', page);
    const description = descriptionOf(markdown);

    if (!description) undescribed.push(page);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, raw);
    lines.push(`- [${titleOf(markdown, page)}](/docs/raw/${page}): ${description}`);
    full.push(`<!-- /docs/raw/${page} -->\n\n${raw.trim()}`);
  }

  if (undescribed.length > 0) {
    throw new Error(`These pages have no \`description\` in their frontmatter: ${undescribed.join(', ')}`);
  }

  await writeFile(join(outDir, 'llms.txt'), `${lines.join('\n')}\n`);
  await writeFile(join(outDir, 'llms-full.txt'), `${full.join('\n\n')}\n`);
};

export default defineConfig({
  title: 'git8n',
  description: 'Translate the JSON locale files of a GitHub repository, by hand or with an agent.',
  base: '/docs/',
  // `public/agent-prompt.md` is a file that an agent reads as it is, and not a page.
  srcExclude: ['public/**'],
  lastUpdated: hasFullHistory(),
  head: [
    ['link', { rel: 'alternate', type: 'text/plain', href: '/docs/llms.txt', title: 'llms.txt' }],
    ['link', { rel: 'alternate', type: 'text/plain', href: '/docs/llms-full.txt', title: 'llms-full.txt' }],
  ],
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
          { text: 'Compare git8n', link: '/guide/compare' },
          { text: 'Migrate from Crowdin', link: '/guide/migrate-from-crowdin' },
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
          { text: 'Security', link: '/operate/security' },
        ],
      },
      {
        text: 'Agents',
        items: [
          { text: 'MCP server', link: '/agents/mcp' },
          { text: 'Translate with Claude Code', link: '/agents/translate-with-claude-code' },
          { text: 'Review a batch', link: '/agents/review-a-batch' },
          { text: 'Access tokens', link: '/agents/tokens' },
          { text: 'CLI', link: '/agents/cli' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'MCP tools', link: '/reference/mcp-tools' },
          { text: 'Rules of check', link: '/reference/rules/' },
          { text: 'Error codes', link: '/reference/errors/' },
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
  buildEnd: (site) => writeRawPages(site.srcDir, site.outDir, site.pages, site.dynamicRoutes),
});

import { parseArgs } from 'node:util';
import {
  catalogue,
  overview,
  progress,
  propose,
  repositories,
  rightsOf,
  waiting,
  type ApiConfig,
  type Catalogue,
  type CatalogueEntry,
  type Repository,
} from '../api.ts';
import { credentialsPath, readCredentials, writeCredentials, type Credentials } from './credentials.ts';
import { asCliError, CliError, EXIT } from './errors.ts';
import {
  disabledFilesOf,
  idOf,
  matchesText,
  neighboursOf,
  pageOf,
  parseId,
  planOf,
  textsOf,
  valuesOf,
} from './keys.ts';
import { askDeviceCode, personOf, signOut, waitForApproval } from './login.ts';
import { promptKeysOf, translatePrompt } from './prompt.ts';
import { githubSlugsOf, nameOf, pickLanguage, pickRepository } from './repository.ts';

/** What the command line needs from the computer. A test gives its own. */
export interface Io {
  env: Record<string, string | undefined>;
  home: string;
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  readFile: (path: string) => Promise<string>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Opens an address in the browser. False when it could not. */
  openUrl: (url: string) => Promise<boolean>;
  /** The addresses of the git remotes of a folder. Empty outside a git repository. */
  gitRemotes: (cwd: string) => Promise<string[]>;
  /** Answers the MCP protocol on stdin and stdout until the client leaves. */
  serveMcp: (config: ApiConfig) => Promise<void>;
  version: string;
}

/** An access token of the « Jetons » page starts with this. A session token of `login` does not. */
const ACCESS_TOKEN_PREFIX = 'i18e_';

const GLOBAL = ['api', 'json', 'help', 'version'] as const;

/** The options of each command, past the global ones. */
const COMMANDS: Record<string, readonly string[]> = {
  login: ['no-open'],
  logout: [],
  whoami: [],
  status: ['repo'],
  keys: ['repo', 'lang', 'state', 'missing', 'file', 'values', 'limit', 'cursor'],
  get: ['repo', 'lang'],
  search: ['repo', 'lang', 'file', 'limit', 'cursor'],
  apply: ['repo', 'lang', 'file', 'dry-run', 'read-at'],
  proposals: ['repo', 'lang'],
  prompt: ['repo', 'lang', 'to', 'state', 'file', 'limit', 'cursor'],
  mcp: [],
};

const OPTIONS = {
  api: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  'no-open': { type: 'boolean' },
  repo: { type: 'string' },
  lang: { type: 'string' },
  to: { type: 'string' },
  state: { type: 'string' },
  missing: { type: 'boolean' },
  file: { type: 'string' },
  values: { type: 'boolean' },
  limit: { type: 'string' },
  cursor: { type: 'string' },
  'dry-run': { type: 'boolean' },
  'read-at': { type: 'string' },
} as const;

type Options = Partial<{
  api: string;
  json: boolean;
  help: boolean;
  version: boolean;
  'no-open': boolean;
  repo: string;
  lang: string;
  to: string;
  state: string;
  missing: boolean;
  file: string;
  values: boolean;
  limit: string;
  cursor: string;
  'dry-run': boolean;
  'read-at': string;
}>;

export const HELP = `i18n-editor — the translations of a repository, from a terminal

Usage: i18n-editor <command> [options]

Account
  login              Sign in with a code that you approve in the editor
  logout             Sign out, and forget the token of this computer
  whoami             The account, and what it may do in each repository

Read
  status             The progress of each language
  keys               The keys of a language (--missing, --state, --file, --values)
  get <file:key>     One key, with its neighbours
  search <text>      The keys whose id, source or translation holds a text
  proposals          The batches that wait on a language

Write
  apply <file|->     Propose a JSON object of translations as one commit (--dry-run)

Agents
  prompt translate   A prompt that asks an LLM for the missing translations
  mcp                The MCP server, on stdin and stdout

Options
  --api <url>        The address of the editor. Default: the last login
  --repo <owner/name>  The repository. Default: the GitHub remote of this folder
  --lang <language>  The target language. Default: the only one the account can open
  --json             Answer one JSON document on stdout
  -h, --help         This help
  -v, --version      The version

Environment
  I18N_EDITOR_API_URL     The address of the editor
  I18N_EDITOR_API_TOKEN   An access token of the page « Jetons », in place of login
  I18N_EDITOR_REPO        The repository, in place of --repo

Exit status: 0 done, 1 refused or failed, 2 wrong command or input, 3 not signed in.
Documentation: <api>/docs/reference/cli
`;

const integerOf = (name: string, value: string | undefined, fallback: number, least: number, most: number): number => {
  if (value === undefined) return fallback;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < least || parsed > most) {
    throw new CliError('I18NE1001', `--${name} takes a whole number from ${least} to ${most}.`);
  }

  return parsed;
};

const STATES = ['missing', 'review', 'translated', 'all'] as const;

const stateOf = (options: Options, fallback: (typeof STATES)[number]): (typeof STATES)[number] => {
  if (options.missing) return 'missing';

  const state = options.state ?? fallback;

  if (!(STATES as readonly string[]).includes(state)) {
    throw new CliError('I18NE1001', `--state takes one of ${STATES.join(', ')}.`);
  }

  return state as (typeof STATES)[number];
};

/** One run of the command line. The answer is the exit status. */
export async function run(argv: string[], io: Io): Promise<number> {
  let json = argv.includes('--json');

  try {
    let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;

    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch (error) {
      throw new CliError('I18NE1001', `${(error as Error).message}. Run i18n-editor --help.`);
    }

    const options = parsed.values as Options;
    const [command, ...rest] = parsed.positionals;

    json = options.json === true;

    if (options.version) {
      io.stdout(json ? `${JSON.stringify({ data: { version: io.version } })}\n` : `${io.version}\n`);

      return EXIT.ok;
    }

    if (options.help || !command) {
      io.stdout(HELP);

      return command || options.help ? EXIT.ok : EXIT.usage;
    }

    const allowed = COMMANDS[command];

    if (!allowed) throw new CliError('I18NE1001', `${command} is not a command. Run i18n-editor --help.`);

    const extra = Object.keys(options).filter(
      (name) => !(GLOBAL as readonly string[]).includes(name) && !allowed.includes(name),
    );

    if (extra.length > 0) {
      throw new CliError('I18NE1001', `${command} takes no ${extra.map((name) => `--${name}`).join(', ')}.`);
    }

    return await new Session(io, options, json).run(command, rest);
  } catch (error) {
    const failure = asCliError(error);

    if (json) {
      io.stdout(
        `${JSON.stringify({ error: { code: failure.code, message: failure.message, details: failure.details } }, null, 2)}\n`,
      );
    } else {
      io.stderr(`error ${failure.code}: ${failure.message}\n`);

      for (const line of failure.details) io.stderr(`  ${line}\n`);
    }

    return failure.exit;
  }
}

class Session {
  private readonly io: Io;
  private readonly options: Options;
  private readonly json: boolean;
  private readonly path: string;
  private credentialsRead?: Promise<Credentials>;

  // No parameter properties: Node runs this file with type stripping, which refuses them.
  constructor(io: Io, options: Options, json: boolean) {
    this.io = io;
    this.options = options;
    this.json = json;
    this.path = credentialsPath(io.env, io.home);
  }

  async run(command: string, positionals: string[]): Promise<number> {
    const expectArgs = (count: number, usage: string) => {
      if (positionals.length !== count) throw new CliError('I18NE1001', `Usage: i18n-editor ${usage}`);
    };

    switch (command) {
      case 'login':
        expectArgs(0, 'login [--api <url>]');
        return this.login();
      case 'logout':
        expectArgs(0, 'logout [--api <url>]');
        return this.logout();
      case 'whoami':
        expectArgs(0, 'whoami');
        return this.whoami();
      case 'status':
        expectArgs(0, 'status [--repo <owner/name>]');
        return this.status();
      case 'keys':
        expectArgs(0, 'keys [--lang <language>] [--missing]');
        return this.keys();
      case 'get':
        expectArgs(1, 'get <file:key> [--lang <language>]');
        return this.get(positionals[0]!);
      case 'search':
        expectArgs(1, 'search <text> [--lang <language>]');
        return this.search(positionals[0]!);
      case 'apply':
        expectArgs(1, 'apply <file.json|-> [--lang <language>] [--dry-run]');
        return this.apply(positionals[0]!);
      case 'proposals':
        expectArgs(0, 'proposals [--lang <language>]');
        return this.proposals();
      case 'prompt':
        if (positionals[0] !== 'translate' || positionals.length !== 1) {
          throw new CliError('I18NE1001', 'Usage: i18n-editor prompt translate --to <language>');
        }
        return this.promptTranslate();
      case 'mcp':
        expectArgs(0, 'mcp');
        return this.mcp();
      default:
        throw new CliError('I18NE1001', `${command} is not a command.`);
    }
  }

  private answer(data: unknown, human: () => string): number {
    this.io.stdout(this.json ? `${JSON.stringify({ data }, null, 2)}\n` : human());

    return EXIT.ok;
  }

  private credentials(): Promise<Credentials> {
    this.credentialsRead ??= readCredentials(this.path);

    return this.credentialsRead;
  }

  private async api(): Promise<string> {
    const named = this.options.api ?? this.io.env.I18N_EDITOR_API_URL ?? (await this.credentials()).default;

    if (!named) throw new CliError('I18NE1002', 'Pass --api <url>, for example --api https://i18n.example.com.');

    return named.replace(/\/+$/, '');
  }

  private async config(): Promise<ApiConfig> {
    const url = await this.api();
    const token = this.io.env.I18N_EDITOR_API_TOKEN || (await this.credentials()).servers[url]?.token;

    if (!token) throw new CliError('I18NE2001', `No account is signed in to ${url}. Run i18n-editor login.`);

    return { url, token, fetch: this.io.fetch };
  }

  private async repository(config: ApiConfig): Promise<Repository> {
    const wanted = this.options.repo ?? this.io.env.I18N_EDITOR_REPO;

    return pickRepository(await repositories(config), wanted, githubSlugsOf(await this.io.gitRemotes(this.io.cwd)));
  }

  /** The repository, the language and its catalogue, for the commands that read keys. */
  private async read(language?: string) {
    const config = await this.config();
    const [repository, me] = await Promise.all([this.repository(config), rightsOf(config)]);
    const chosen = pickLanguage(me, repository, language ?? this.options.lang);
    const read = await catalogue(config, repository.id, chosen);

    return { config, repository, read };
  }

  private rowOf(entry: CatalogueEntry, withValues: boolean) {
    return {
      id: idOf(entry),
      file: entry.file,
      key: entry.key,
      state: entry.state,
      ...(entry.empty ? { empty: true } : {}),
      ...(withValues
        ? { source: entry.source, value: entry.value, ...(entry.was === undefined ? {} : { was: entry.was }) }
        : {}),
    };
  }

  private humanRows(entries: CatalogueEntry[], withValues: boolean): string {
    const width = Math.max(0, ...entries.map((entry) => idOf(entry).length));

    return entries
      .map((entry) => {
        const head = `${idOf(entry).padEnd(width)}  ${entry.state}${entry.empty ? ' (empty on purpose)' : ''}`;

        if (!withValues) return `${head}\n`;

        return [
          head,
          `    source: ${entry.source}`,
          ...(entry.was === undefined ? [] : [`    was:    ${entry.was}`]),
          `    value:  ${entry.value ?? '—'}`,
          '',
        ].join('\n');
      })
      .join('');
  }

  private pagedFooter(page: { total: number; cursor: number; nextCursor: number | null; rows: unknown[] }) {
    if (this.json) return;

    const first = page.rows.length === 0 ? 0 : page.cursor + 1;

    this.io.stderr(
      `${first}–${page.cursor + page.rows.length} of ${page.total}${page.nextCursor === null ? '' : `. Next: --cursor ${page.nextCursor}`}\n`,
    );
  }

  private async login(): Promise<number> {
    const api = await this.api();
    const code = await askDeviceCode(this.io, api);
    const address = code.verification_uri_complete ?? `${code.verification_uri}?user_code=${code.user_code}`;

    this.io.stderr(`Open ${code.verification_uri} and enter the code ${code.user_code}\n`);

    if (!this.options['no-open'] && (await this.io.openUrl(address))) {
      this.io.stderr('The browser is open. Approve the code there.\n');
    }

    this.io.stderr('Waiting for the approval…\n');

    const token = await waitForApproval(this.io, api, code);
    const person = await personOf(this.io, api, token);
    const credentials = await this.credentials();

    await writeCredentials(this.path, {
      default: api,
      servers: { ...credentials.servers, [api]: { token, ...(person ?? {}) } },
    });

    if (this.io.env.I18N_EDITOR_API_TOKEN) {
      this.io.stderr('I18N_EDITOR_API_TOKEN is set: the commands use it, not this sign-in.\n');
    }

    return this.answer(
      { api, account: person, credentials: this.path },
      () => `Signed in to ${api}${person ? ` as ${person.name} <${person.email}>` : ''}.\n`,
    );
  }

  private async logout(): Promise<number> {
    const api = await this.api();
    const credentials = await this.credentials();
    const held = credentials.servers[api];

    if (!held) {
      return this.answer({ api, signedOut: false, revoked: false }, () => `No account is signed in to ${api}.\n`);
    }

    const revoked = held.token.startsWith(ACCESS_TOKEN_PREFIX) ? false : await signOut(this.io, api, held.token);
    const { [api]: _gone, ...servers } = credentials.servers;

    await writeCredentials(this.path, {
      ...(credentials.default === api ? {} : { default: credentials.default }),
      servers,
    });

    return this.answer(
      { api, signedOut: true, revoked },
      () =>
        `Signed out of ${api}.${revoked ? '' : ' The API did not end the session: it ends after 14 days without use.'}\n`,
    );
  }

  private async whoami(): Promise<number> {
    const config = await this.config();
    const me = await rightsOf(config);
    // The API refuses the list of the repositories to an account that is no member and no admin.
    const [all, person] = await Promise.all([
      me.admin || me.memberships.length > 0 ? repositories(config) : Promise.resolve([]),
      config.token!.startsWith(ACCESS_TOKEN_PREFIX)
        ? Promise.resolve(null)
        : personOf(this.io, config.url, config.token!),
    ]);
    const byId = new Map(all.map((repository) => [repository.id, repository]));
    const memberships = me.memberships.map((membership) => ({
      repository: byId.has(membership.repositoryId)
        ? nameOf(byId.get(membership.repositoryId)!)
        : membership.repositoryId,
      repositoryId: membership.repositoryId,
      role: membership.role,
      languages: membership.languages,
      writesSource: membership.writesSource,
    }));
    const via = this.io.env.I18N_EDITOR_API_TOKEN ? 'I18N_EDITOR_API_TOKEN' : 'login';

    return this.answer({ api: config.url, account: person, via, admin: me.admin, memberships }, () =>
      [
        `${config.url}${person ? ` — ${person.name} <${person.email}>` : ''} (token from ${via})`,
        ...(me.admin ? ['Admin: sets the repositories up.'] : []),
        ...(memberships.length === 0 ? ['Member of no repository.'] : []),
        ...memberships.map(
          (held) =>
            `${held.repository}  ${held.role}  ${held.languages.join(', ') || '—'}${held.writesSource ? '  writes the source' : ''}`,
        ),
        '',
      ].join('\n'),
    );
  }

  private async status(): Promise<number> {
    const config = await this.config();
    const wanted = this.options.repo ?? this.io.env.I18N_EDITOR_REPO;
    const all = await repositories(config);
    const slugs = githubSlugsOf(await this.io.gitRemotes(this.io.cwd));
    const named = wanted !== undefined || all.some((repository) => slugs.includes(nameOf(repository).toLowerCase()));

    if (named) {
      const repository = pickRepository(all, wanted, slugs);
      const languages = await progress(config, repository.id);

      return this.answer(
        {
          repository: {
            id: repository.id,
            name: nameOf(repository),
            branch: repository.branch,
            source: repository.source,
            targets: repository.targets,
          },
          languages,
        },
        () =>
          [
            `${nameOf(repository)} (${repository.branch}) — source ${repository.source}`,
            ...languages.map(
              (row) =>
                `  ${row.language.padEnd(6)} ${String(row.published).padStart(5)}/${row.total} published  ${row.proposed} proposed  ${row.missing} missing  ${row.review} to review`,
            ),
            '',
          ].join('\n'),
      );
    }

    const rows = [];

    for (let page = 1; ; page += 1) {
      const answered = await overview(config, { page, perPage: 50, sort: 'name' });

      rows.push(...answered.rows);

      if (!answered.hasMore) break;
    }

    const summary = rows.map((row) => ({
      id: row.id,
      name: `${row.owner}/${row.name}`,
      source: row.source,
      targets: row.targets,
      languages: row.progress,
      ...(row.progressError ? { error: row.progressError } : {}),
    }));

    return this.answer({ repositories: summary }, () =>
      summary.length === 0
        ? 'This account opens no repository.\n'
        : summary
            .map((row) =>
              [
                `${row.name} — source ${row.source}`,
                ...(row.languages ?? []).map(
                  (language) =>
                    `  ${language.language.padEnd(6)} ${String(language.published).padStart(5)}/${language.total} published  ${language.proposed} proposed  ${language.missing} missing`,
                ),
                ...(row.error ? [`  ${row.error}`] : []),
                '',
              ].join('\n'),
            )
            .join(''),
    );
  }

  private async keys(): Promise<number> {
    const state = stateOf(this.options, 'all');
    const limit = integerOf('limit', this.options.limit, 100, 1, 2000);
    const cursor = integerOf('cursor', this.options.cursor, 0, 0, Number.MAX_SAFE_INTEGER);
    const { repository, read } = await this.read();
    const found = read.entries.filter(
      (entry) =>
        (state === 'all' || entry.state === state) &&
        (this.options.file === undefined || entry.file === this.options.file),
    );
    const page = pageOf(found, cursor, limit);
    const withValues = this.options.values === true;

    this.pagedFooter(page);

    return this.answer(
      {
        repository: nameOf(repository),
        language: read.language,
        source: read.source,
        commit: read.commit,
        filesWithNoVersion: disabledFilesOf(read),
        total: page.total,
        cursor: page.cursor,
        nextCursor: page.nextCursor,
        entries: page.rows.map((entry) => this.rowOf(entry, withValues)),
      },
      () => this.humanRows(page.rows, withValues),
    );
  }

  private async get(id: string): Promise<number> {
    const wanted = parseId(id);
    const { repository, read } = await this.read();

    if (disabledFilesOf(read).includes(wanted.file)) {
      throw new CliError('I18NE3004', `${wanted.file} has no ${read.language} version.`);
    }

    const entry = read.entries.find((held) => held.file === wanted.file && held.key === wanted.key);

    if (!entry) throw new CliError('I18NE3004', `${id} is not a key of the source (${read.source}).`);

    const neighbours = neighboursOf(read, entry);

    return this.answer(
      {
        repository: nameOf(repository),
        language: read.language,
        source: read.source,
        commit: read.commit,
        entry: this.rowOf(entry, true),
        neighbours: neighbours.map((other) => this.rowOf(other, true)),
      },
      () =>
        [
          this.humanRows([entry], true),
          ...(neighbours.length === 0 ? [] : ['Neighbours:\n', this.humanRows(neighbours, true)]),
        ].join(''),
    );
  }

  private async search(text: string): Promise<number> {
    const limit = integerOf('limit', this.options.limit, 100, 1, 2000);
    const cursor = integerOf('cursor', this.options.cursor, 0, 0, Number.MAX_SAFE_INTEGER);
    const { repository, read } = await this.read();
    const found = read.entries.filter(
      (entry) => matchesText(entry, text) && (this.options.file === undefined || entry.file === this.options.file),
    );
    const page = pageOf(found, cursor, limit);

    this.pagedFooter(page);

    return this.answer(
      {
        repository: nameOf(repository),
        language: read.language,
        commit: read.commit,
        total: page.total,
        cursor: page.cursor,
        nextCursor: page.nextCursor,
        entries: page.rows.map((entry) => this.rowOf(entry, true)),
      },
      () => this.humanRows(page.rows, true),
    );
  }

  private async apply(input: string): Promise<number> {
    const readAt = this.options['read-at'];

    if (readAt !== undefined && !/^[0-9a-f]{40}$/.test(readAt)) {
      throw new CliError('I18NE1001', '--read-at takes the full sha of a commit, as keys --json answers it.');
    }

    const texts = textsOf(input === '-' ? await this.io.readStdin() : await this.io.readFile(input), this.options.file);

    if (texts.size === 0) throw new CliError('I18NE1003', 'The input holds no key.');

    const { config, repository, read } = await this.read();
    const plan = planOf(read, texts, readAt ?? read.commit);
    const base = { repository: nameOf(repository), language: read.language, ...plan };

    if (this.options['dry-run'] || plan.changes.length === 0) {
      return this.answer({ ...base, proposed: null }, () =>
        [
          ...plan.changes.map((change) => `${change.id}\n    ${change.from ?? '—'}\n  → ${change.to}`),
          `${plan.changes.length} to propose, ${plan.unchanged.length} unchanged, read at ${plan.readAt.slice(0, 7)}.`,
          ...this.stillToReview(plan.stillToReview),
          plan.changes.length === 0 ? 'Nothing to propose.' : 'Dry run: nothing was sent.',
          '',
        ].join('\n'),
      );
    }

    const proposed = await propose(config, {
      repository: repository.id,
      language: read.language,
      readAt: plan.readAt,
      values: valuesOf(plan),
    });

    return this.answer({ ...base, proposed }, () =>
      [
        `Proposed ${proposed.keys} key(s) in ${read.language} as ${proposed.commit.slice(0, 7)} on ${proposed.branch}. A reviewer publishes them.`,
        ...this.stillToReview(plan.stillToReview),
        '',
      ].join('\n'),
    );
  }

  private stillToReview(ids: string[]): string[] {
    if (ids.length === 0) return [];

    return [
      `${ids.length} key(s) to review keep the same text: a proposal does not change their state. A reviewer keeps them in the editor.`,
      ...ids.slice(0, 10).map((id) => `  ${id}`),
    ];
  }

  private async proposals(): Promise<number> {
    const config = await this.config();
    const [repository, me] = await Promise.all([this.repository(config), rightsOf(config)]);
    const language = pickLanguage(me, repository, this.options.lang);
    const batches = await waiting(config, repository.id, language);

    return this.answer({ repository: nameOf(repository), language, batches }, () =>
      batches.length === 0
        ? `Nothing waits on ${language}.\n`
        : batches
            .map(
              (batch) =>
                `${batch.commit.slice(0, 7)}  ${batch.at.slice(0, 10)}  ${batch.author}  ${batch.message.split('\n')[0]}\n`,
            )
            .join(''),
    );
  }

  private async promptTranslate(): Promise<number> {
    const state = stateOf(this.options, 'missing');

    if (state === 'translated' || state === 'all') {
      throw new CliError('I18NE1001', 'prompt translate takes --state missing or --state review.');
    }

    if (this.options.to && this.options.lang && this.options.to !== this.options.lang) {
      throw new CliError('I18NE1001', '--to and --lang name two languages. Pass one.');
    }

    const limit = integerOf('limit', this.options.limit, 50, 1, 500);
    const cursor = integerOf('cursor', this.options.cursor, 0, 0, Number.MAX_SAFE_INTEGER);
    const { repository, read } = await this.read(this.options.to);
    const found = read.entries.filter(
      (entry) => entry.state === state && (this.options.file === undefined || entry.file === this.options.file),
    );
    const page = pageOf(found, cursor, limit);
    const keys = promptKeysOf(read, page.rows);
    const prompt = translatePrompt({
      repository: nameOf(repository),
      read: read as Catalogue,
      keys,
      total: page.total,
      nextCursor: page.nextCursor,
    });

    if (!this.json && page.total === 0) this.io.stderr(`No key is ${state} in ${read.language}.\n`);

    return this.answer(
      {
        repository: nameOf(repository),
        language: read.language,
        source: read.source,
        commit: read.commit,
        total: page.total,
        cursor: page.cursor,
        nextCursor: page.nextCursor,
        keys,
        prompt,
      },
      () => prompt,
    );
  }

  private async mcp(): Promise<number> {
    if (this.json) throw new CliError('I18NE1001', 'mcp speaks the MCP protocol, and takes no --json.');

    await this.io.serveMcp(await this.config());

    return EXIT.ok;
  }
}

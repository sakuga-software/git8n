import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalogue, Me, Repository } from '../api.ts';
import { writeCredentials } from './credentials.ts';
import { fakeIo, jsonResponse } from './testing.ts';

const API = 'https://i18n.test';
const COMMIT = 'a'.repeat(40);

const REPOSITORY: Repository = {
  id: 'repo-1',
  owner: 'acme',
  name: 'app',
  branch: 'main',
  localesPath: 'src/locales',
  source: 'fr',
  targets: ['en', 'de'],
};

const OTHER: Repository = { ...REPOSITORY, id: 'repo-2', name: 'site' };

const ME: Me = {
  admin: false,
  memberships: [{ repositoryId: 'repo-1', languages: ['en'], role: 'translator', writesSource: false }],
};

const CATALOGUE: Catalogue = {
  repository: 'repo-1',
  language: 'en',
  source: 'fr',
  commit: COMMIT,
  entries: [
    { file: 'common', key: 'hello.title', source: 'Bonjour', value: 'Hello', state: 'translated' },
    { file: 'common', key: 'hello.subtitle', source: 'Bienvenue', value: null, state: 'missing' },
    { file: 'common', key: 'bye', source: 'Au revoir', value: null, state: 'missing' },
    { file: 'menu', key: 'open', source: 'Ouvrir', value: 'Open', state: 'review', was: 'Ouvre' },
  ],
  files: { common: 'available', menu: 'available', legacy: 'disabled' },
};

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: unknown;
}

/** An API that answers the routes the command line reads, and records each call. */
const fakeApi = (answers: Partial<Record<string, (call: Call) => Response>> = {}) => {
  const calls: Call[] = [];

  const fetcher = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      auth: headers.get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    const path = new URL(url).pathname;

    calls.push(call);

    const custom = answers[`${call.method} ${path}`];

    if (custom) return custom(call);

    switch (`${call.method} ${path}`) {
      case 'GET /i18n/repositories':
        return jsonResponse({ data: [REPOSITORY, OTHER] });
      case 'GET /i18n/me':
        return jsonResponse({ data: ME });
      case 'GET /i18n/catalogue':
        return jsonResponse({ data: CATALOGUE });
      case 'POST /i18n/proposals':
        return jsonResponse({
          data: { commit: 'b'.repeat(40), branch: 'i18n/en', readAt: COMMIT, keys: 1, files: ['common'] },
        });
      case 'GET /i18n/proposals':
        return jsonResponse({ data: [] });
      default:
        return jsonResponse({ message: `no route ${path}` }, 404);
    }
  };

  return { calls, fetcher };
};

const signedIn = async (answers?: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(answers);
  const cli = await fakeIo(api.fetcher);

  cli.io.env.I18N_EDITOR_API_URL = API;
  cli.io.env.I18N_EDITOR_API_TOKEN = 'i18e_test';
  cli.io.env.I18N_EDITOR_REPO = 'acme/app';

  return { ...api, cli };
};

describe('the arguments', () => {
  it('refuses an unknown option and an option of another command, with exit 2', async () => {
    const { cli } = await signedIn();

    const unknown = await cli.run('keys', '--nope', '--json');
    const foreign = await cli.run('keys', '--dry-run', '--json');

    expect(unknown.exit).toBe(2);
    expect(unknown.json().error.code).toBe('I18NE1001');
    expect(foreign.exit).toBe(2);
    expect(foreign.json().error.message).toContain('--dry-run');
  });

  it('answers the help with no command, and exit 2 because nothing ran', async () => {
    const { cli } = await signedIn();

    expect((await cli.run()).exit).toBe(2);
    expect((await cli.run('--help')).exit).toBe(0);
  });

  it('says that no account is signed in with exit 3', async () => {
    const cli = await fakeIo(fakeApi().fetcher);

    const ran = await cli.run('keys', '--api', API, '--json');

    expect(ran.exit).toBe(3);
    expect(ran.json().error.code).toBe('I18NE2001');
  });

  it('says how to get a token that works when the API refuses one', async () => {
    const refused = { 'GET /i18n/me': () => jsonResponse({ message: 'Unauthorized' }, 401) };
    const fromEnv = await signedIn(refused);
    const fromLogin = await signedIn(refused);

    delete fromLogin.cli.io.env.I18N_EDITOR_API_TOKEN;
    await writeCredentials(join(fromLogin.cli.configHome, 'i18n-editor', 'credentials.json'), {
      default: API,
      servers: { [API]: { token: 'session-token' } },
    });

    expect((await fromEnv.cli.run('keys', '--json')).json().error.message).toContain('Jetons');
    expect((await fromLogin.cli.run('keys', '--json')).json().error.message).toContain('Run i18n-editor login');
  });

  it('turns a 401 of the API into exit 3, and a 403 into exit 1', async () => {
    const refused = await signedIn({ 'GET /i18n/me': () => jsonResponse({ message: 'Unauthorized' }, 401) });
    const forbidden = await signedIn({ 'GET /i18n/me': () => jsonResponse({ message: 'Not a member' }, 403) });

    const unauthorized = await refused.cli.run('keys', '--json');
    const denied = await forbidden.cli.run('keys', '--json');

    expect(unauthorized.exit).toBe(3);
    expect(denied.exit).toBe(1);
    expect(denied.json().error).toMatchObject({ code: 'I18NE4001', message: '403 — Not a member' });
  });
});

describe('the repository and the language', () => {
  it('takes the repository of the GitHub remote of the folder', async () => {
    const { cli, calls } = await signedIn({ 'GET /i18n/me': () => jsonResponse({ data: { ...ME, admin: true } }) });

    delete cli.io.env.I18N_EDITOR_REPO;
    cli.io.gitRemotes = async () => ['git@github.com:Acme/site.git'];

    expect((await cli.run('keys', '--lang', 'en', '--json')).exit).toBe(0);
    expect(calls.find((call) => call.url.includes('/i18n/catalogue'))!.url).toContain('repository=repo-2');
  });

  it('refuses the only repository of the account in a folder of another repository', async () => {
    const { cli } = await signedIn({ 'GET /i18n/repositories': () => jsonResponse({ data: [REPOSITORY] }) });

    delete cli.io.env.I18N_EDITOR_REPO;
    cli.io.gitRemotes = async () => ['https://github.com/acme/other.git'];

    const ran = await cli.run('keys', '--json');

    expect(ran.exit).toBe(2);
    expect(ran.json().error).toMatchObject({ code: 'I18NE3001', details: expect.arrayContaining(['  acme/app']) });

    cli.io.gitRemotes = async () => [];

    expect((await cli.run('keys', '--json')).exit).toBe(0);
  });

  it('lists the repositories when none is clear', async () => {
    const { cli } = await signedIn();

    delete cli.io.env.I18N_EDITOR_REPO;

    const ran = await cli.run('keys');

    expect(ran.exit).toBe(2);
    expect(ran.stderr).toContain('I18NE3002');
    expect(ran.stderr).toContain('acme/app');
    expect(ran.stderr).toContain('acme/site');
  });

  it('takes the only language the account can open, and refuses one the repository does not translate', async () => {
    const { cli, calls } = await signedIn();

    expect((await cli.run('keys', '--json')).exit).toBe(0);
    expect(calls.find((call) => call.url.includes('/i18n/catalogue'))!.url).toContain('language=en');

    const ran = await cli.run('keys', '--lang', 'it', '--json');

    expect(ran.exit).toBe(2);
    expect(ran.json().error.code).toBe('I18NE3003');
  });

  it('refuses a target language that the account cannot open, before it asks the API', async () => {
    const { cli, calls } = await signedIn();

    const ran = await cli.run('keys', '--lang', 'de', '--json');

    expect(ran.exit).toBe(2);
    expect(ran.json().error).toMatchObject({ code: 'I18NE3003', details: [expect.stringContaining(': en.')] });
    expect(calls.some((call) => call.url.includes('/i18n/catalogue'))).toBe(false);
  });

  it('refuses a limit of 0, which would answer the same page again', async () => {
    const { cli } = await signedIn();

    for (const command of [['keys'], ['search', 'x'], ['prompt', 'translate']]) {
      const ran = await cli.run(...command, '--limit', '0', '--json');

      expect(ran.exit).toBe(2);
      expect(ran.json().error.code).toBe('I18NE1001');
    }
  });
});

describe('keys, get and search', () => {
  it('answers the missing keys, a page at a time, with the commit to propose against', async () => {
    const { cli } = await signedIn();

    const first = await cli.run('keys', '--missing', '--limit', '1', '--json');
    const second = await cli.run('keys', '--missing', '--limit', '1', '--cursor', '1', '--json');

    expect(first.json().data).toMatchObject({
      repository: 'acme/app',
      language: 'en',
      commit: COMMIT,
      total: 2,
      nextCursor: 1,
      filesWithNoVersion: ['legacy'],
      entries: [{ id: 'common:hello.subtitle', state: 'missing' }],
    });
    expect(second.json().data).toMatchObject({ nextCursor: null, entries: [{ id: 'common:bye' }] });
    expect(first.json().data.entries[0]).not.toHaveProperty('source');
  });

  it('answers one key with its neighbours', async () => {
    const { cli } = await signedIn();

    const ran = await cli.run('get', 'common:hello.subtitle', '--json');

    expect(ran.json().data).toMatchObject({
      entry: { id: 'common:hello.subtitle', source: 'Bienvenue', value: null },
      neighbours: [{ id: 'common:hello.title', value: 'Hello' }],
    });
  });

  it('refuses a key that is not in the source', async () => {
    const { cli } = await signedIn();

    const ran = await cli.run('get', 'common:nope', '--json');

    expect(ran.exit).toBe(1);
    expect(ran.json().error.code).toBe('I18NE3004');
  });

  it('finds a key by its source or its translation', async () => {
    const { cli } = await signedIn();

    const ran = await cli.run('search', 'revoir', '--json');

    expect(ran.json().data.entries.map((entry: { id: string }) => entry.id)).toEqual(['common:bye']);
  });
});

describe('apply', () => {
  it('shows the plan of a dry run and sends nothing', async () => {
    const { cli, calls } = await signedIn();

    cli.io.readStdin = async () =>
      JSON.stringify({ 'common:hello.subtitle': 'Welcome', 'common:hello.title': 'Hello' });

    const ran = await cli.run('apply', '-', '--dry-run', '--json');

    expect(ran.exit).toBe(0);
    expect(ran.json().data).toMatchObject({
      readAt: COMMIT,
      changes: [{ id: 'common:hello.subtitle', from: null, to: 'Welcome' }],
      unchanged: ['common:hello.title'],
      proposed: null,
    });
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('proposes the new texts as one batch, with the revision that was read', async () => {
    const { cli, calls } = await signedIn();

    cli.io.readFile = async () => JSON.stringify({ common: { hello: { subtitle: 'Welcome' }, bye: 'Goodbye' } });

    const ran = await cli.run('apply', 'en.json', '--json');
    const sent = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/i18n/proposals'));

    expect(ran.exit).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({
      repository: 'repo-1',
      language: 'en',
      readAt: COMMIT,
      values: [
        { file: 'common', key: 'hello.subtitle', value: 'Welcome' },
        { file: 'common', key: 'bye', value: 'Goodbye' },
      ],
    });
    expect(sent[0]!.auth).toBe('Bearer i18e_test');
  });

  it('sends the revision of --read-at, the one the texts answer', async () => {
    const { cli, calls } = await signedIn();
    const older = 'c'.repeat(40);

    cli.io.readStdin = async () => JSON.stringify({ 'hello.subtitle': 'Welcome' });

    expect((await cli.run('apply', '-', '--file', 'common', '--read-at', older)).exit).toBe(0);
    expect(calls.find((call) => call.method === 'POST')!.body).toMatchObject({ readAt: older });
  });

  it('refuses a key that is not in the source, a file with no version, and an empty text', async () => {
    const unknown = await signedIn();
    const closed = await signedIn();
    const blank = await signedIn();

    unknown.cli.io.readStdin = async () => JSON.stringify({ 'common:nope': 'x' });
    closed.cli.io.readStdin = async () => JSON.stringify({ 'legacy:old': 'x' });
    blank.cli.io.readStdin = async () => JSON.stringify({ 'common:bye': ' ' });

    const ranUnknown = await unknown.cli.run('apply', '-', '--json');
    const ranClosed = await closed.cli.run('apply', '-', '--json');
    const ranBlank = await blank.cli.run('apply', '-', '--json');

    expect(ranUnknown.json().error).toMatchObject({ code: 'I18NE3004', details: ['common:nope'] });
    expect(ranClosed.json().error).toMatchObject({ code: 'I18NE3004', details: ['legacy:old'] });
    expect(ranBlank.exit).toBe(2);
    expect(ranBlank.json().error.code).toBe('I18NE1003');

    for (const { calls } of [unknown, closed, blank]) expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('says that a key to review with the same text stays to review, and proposes nothing for it', async () => {
    const { cli, calls } = await signedIn();

    cli.io.readStdin = async () => JSON.stringify({ 'menu:open': 'Open', 'common:hello.title': 'Hello' });

    const ran = await cli.run('apply', '-', '--json');

    expect(ran.json().data).toMatchObject({
      changes: [],
      unchanged: ['common:hello.title'],
      stillToReview: ['menu:open'],
      proposed: null,
    });
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect((await cli.run('apply', '-')).stdout).toContain('A reviewer keeps them in the editor.');
  });

  it('refuses a revision that is not a full sha', async () => {
    const { cli } = await signedIn();

    expect((await cli.run('apply', '-', '--read-at', 'abc1234')).exit).toBe(2);
  });
});

describe('prompt translate', () => {
  it('asks for the missing keys, with their neighbours and the command that sends the answer', async () => {
    const { cli } = await signedIn();

    const ran = await cli.run('prompt', 'translate', '--to', 'en', '--json');
    const data = ran.json().data;

    expect(data.keys.map((key: { id: string }) => key.id)).toEqual(['common:hello.subtitle', 'common:bye']);
    expect(data.keys[0].neighbours).toEqual([{ id: 'common:hello.title', source: 'Bonjour', value: 'Hello' }]);
    expect(data.prompt).toContain('Source: « Bienvenue »');
    expect(data.prompt).toContain(`i18n-editor apply - --repo acme/app --lang en --read-at ${COMMIT}`);
  });

  it('asks for the keys to review with the old source', async () => {
    const { cli } = await signedIn();

    const ran = await cli.run('prompt', 'translate', '--state', 'review');

    expect(ran.stdout).toContain('The source was: « Ouvre »');
  });
});

describe('login and logout', () => {
  const deviceRoutes = (answers: Array<{ status: number; body: unknown }>) => {
    const polls = [...answers];

    return {
      'POST /api/auth/device/code': () =>
        jsonResponse({
          device_code: 'device-1',
          user_code: 'ABCD1234',
          verification_uri: `${API}/device`,
          verification_uri_complete: `${API}/device?user_code=ABCD1234`,
          expires_in: 600,
          interval: 5,
        }),
      'POST /api/auth/device/token': () => {
        const next = polls.shift()!;

        return jsonResponse(next.body, next.status);
      },
      'GET /api/auth/get-session': () => jsonResponse({ user: { name: 'Ada', email: 'ada@example.com' } }),
      'POST /api/auth/sign-out': () => jsonResponse({ success: true }),
    };
  };

  it('waits for the approval, keeps the token in a file only its owner reads, and signs out', async () => {
    const api = fakeApi(
      deviceRoutes([
        { status: 400, body: { error: 'authorization_pending' } },
        { status: 400, body: { error: 'slow_down' } },
        { status: 200, body: { access_token: 'session-token', token_type: 'Bearer' } },
      ]),
    );
    const cli = await fakeIo(api.fetcher);

    const ran = await cli.run('login', '--api', `${API}/`, '--json');
    const file = join(cli.configHome, 'i18n-editor', 'credentials.json');

    expect(ran.exit).toBe(0);
    expect(ran.stderr).toContain('ABCD1234');
    expect(cli.opened).toEqual([`${API}/device?user_code=ABCD1234`]);
    expect(ran.json().data).toMatchObject({ api: API, account: { name: 'Ada', email: 'ada@example.com' } });
    expect(ran.stdout).not.toContain('session-token');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      default: API,
      servers: { [API]: { token: 'session-token', name: 'Ada', email: 'ada@example.com' } },
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    const polls = api.calls.filter((call) => call.url.endsWith('/device/token'));

    expect(polls).toHaveLength(3);
    expect(polls[0]!.body).toMatchObject({ device_code: 'device-1', client_id: 'i18n-editor-cli' });

    expect((await cli.run('keys', '--repo', 'acme/app', '--json')).exit).toBe(0);
    expect(api.calls.at(-1)!.auth).toBe('Bearer session-token');

    const out = await cli.run('logout', '--json');

    expect(out.json().data).toEqual({ api: API, signedOut: true, revoked: true });
    expect(api.calls.find((call) => call.url.endsWith('/sign-out'))!.auth).toBe('Bearer session-token');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ servers: {} });
    expect((await cli.run('keys', '--api', API, '--json')).exit).toBe(3);
  });

  it('stops, and keeps the file, when the file of the credentials cannot be read', async () => {
    const api = fakeApi(deviceRoutes([{ status: 200, body: { access_token: 'session-token' } }]));
    const cli = await fakeIo(api.fetcher);

    await mkdir(join(cli.configHome, 'i18n-editor', 'credentials.json'), { recursive: true });

    const ran = await cli.run('login', '--api', API, '--no-open', '--json');

    expect(ran.exit).toBe(2);
    expect(ran.json().error.code).toBe('I18NE1004');
    expect(api.calls).toEqual([]);
  });

  it('stops when the code expires, and when the person refuses it', async () => {
    const expired = await fakeIo(fakeApi(deviceRoutes([{ status: 400, body: { error: 'expired_token' } }])).fetcher);
    const denied = await fakeIo(fakeApi(deviceRoutes([{ status: 400, body: { error: 'access_denied' } }])).fetcher);

    const ranExpired = await expired.run('login', '--api', API, '--no-open', '--json');
    const ranDenied = await denied.run('login', '--api', API, '--no-open', '--json');

    expect(ranExpired.exit).toBe(1);
    expect(ranExpired.json().error.code).toBe('I18NE2002');
    expect(ranDenied.json().error.code).toBe('I18NE2003');
    expect(expired.opened).toEqual([]);
  });

  it('stops polling at the end of the life of the code', async () => {
    const pending = Array.from({ length: 200 }, () => ({ status: 400, body: { error: 'authorization_pending' } }));
    const api = fakeApi(deviceRoutes(pending));
    const cli = await fakeIo(api.fetcher);

    const ran = await cli.run('login', '--api', API, '--no-open', '--json');

    expect(ran.json().error.code).toBe('I18NE2002');
    expect(api.calls.filter((call) => call.url.endsWith('/device/token')).length).toBe(120);
  });
});

describe('mcp', () => {
  it('serves the MCP protocol with the token of the login, and writes nothing on stdout', async () => {
    const { cli } = await signedIn();

    const ran = await cli.run('mcp');

    expect(ran.exit).toBe(0);
    expect(ran.stdout).toBe('');
    expect(cli.served).toEqual([expect.objectContaining({ url: API, token: 'i18e_test' })]);
  });

  it('writes a refusal on stderr, never on stdout', async () => {
    const cli = await fakeIo(fakeApi().fetcher);

    const ran = await cli.run('mcp', '--api', API);

    expect(ran.exit).toBe(3);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toContain('I18NE2001');
  });
});

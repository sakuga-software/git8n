import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { configOf } from './api.ts';
import { buildServer } from './server.ts';
import { createCatalogues } from './tools.ts';

/**
 * The translations, as an agent reads and writes them (DB-211).
 *
 * Driven through a real client over the protocol rather than by calling the
 * functions: what a tool answers, and what it does when the API refuses, is
 * what an agent sees, and neither is visible from the inside.
 */

const CONFIG = { url: 'https://api.test', token: 'token-of-an-account' };

const ENTRIES = [
  { file: 'common', key: 'hello', source: 'Bonjour', value: 'Hello', state: 'translated' },
  { file: 'common', key: 'bye', source: 'Au revoir', value: null, state: 'missing' },
  { file: 'admin', key: 'title', source: 'Titre', value: null, state: 'missing' },
];

const COMMIT = 'a'.repeat(40);

/** Every request the server made, so the calls themselves can be checked. */
let asked: Array<{ url: string; method: string; auth?: string; body?: unknown }>;

const api = (over: Record<string, unknown> = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);

    asked.push({
      url: String(url),
      method: init?.method ?? 'GET',
      auth: headers.get('authorization') ?? undefined,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const refusal = over.refuse as { status: number; text: string } | undefined;

    if (refusal) {
      return { ok: false, status: refusal.status, text: async () => refusal.text } as unknown as Response;
    }

    const path = String(url);
    const data = path.includes('/i18n/catalogue')
      ? { repository: 'repo-1', language: 'en', source: 'fr', commit: COMMIT, entries: ENTRIES, files: over.files }
      : path.includes('/i18n/repositories')
        ? [{ id: 'repo-1', owner: 'o', name: 'n', branch: 'main', localesPath: 'l', source: 'fr', targets: ['en'] }]
        : path.includes('/i18n/me')
          ? { admin: false, rights: { languages: ['en'], role: 'translator' } }
          : path.includes('/i18n/proposals') && (init?.method ?? 'GET') === 'POST'
            ? { commit: 'c'.repeat(40), branch: 'i18n/en', readAt: COMMIT, keys: 2, files: ['l/en/common.json'] }
            : [];

    return { ok: true, json: async () => ({ data }) } as unknown as Response;
  });

/** A client and a server joined by the protocol, as an agent joins one. */
const connected = async (config = CONFIG) => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });

  await Promise.all([buildServer(config).connect(serverSide), client.connect(clientSide)]);

  return client;
};

const said = (result: unknown) =>
  JSON.parse(((result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}') as string) as Record<
    string,
    unknown
  >;

beforeEach(() => {
  asked = [];
  vi.stubGlobal('fetch', api());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the server offers', () => {
  it('names the six operations and no publication', async () => {
    const { tools } = await (await connected()).listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(['i18n_key', 'i18n_keys', 'i18n_me', 'i18n_proposals', 'i18n_propose', 'i18n_repositories']);
    // Publishing is a judgement, and the screen that asks for it is DB-213.
    expect(names).not.toContain('i18n_publish');
  });
});

describe('reading the keys', () => {
  it('answers the missing ones by default, with the revision they were read at', async () => {
    const answer = said(
      await (await connected()).callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en' } }),
    );

    expect(answer.commit).toBe(COMMIT);
    expect(answer.total).toBe(2);
    expect((answer.entries as Array<{ key: string }>).map((entry) => entry.key)).toEqual(['bye', 'title']);
  });

  it('narrows to one file when it is named', async () => {
    const answer = said(
      await (
        await connected()
      ).callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en', file: 'admin' } }),
    );

    expect((answer.entries as Array<{ file: string }>).every((entry) => entry.file === 'admin')).toBe(true);
    expect(answer.total).toBe(1);
  });

  it('answers every key when the state is all', async () => {
    const answer = said(
      await (
        await connected()
      ).callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en', state: 'all' } }),
    );

    expect(answer.total).toBe(3);
    expect(answer.more).toBe(false);
  });

  /** A key that is not there is not an empty translation. */
  it('says a key is not one rather than answering nothing', async () => {
    const answer = said(
      await (
        await connected()
      ).callTool({
        name: 'i18n_key',
        arguments: { repository: 'repo-1', language: 'en', file: 'common', key: 'nope' },
      }),
    );

    expect(answer.found).toBe(false);
    expect(String(answer.reason)).toContain('is not a key of the source');
  });

  /**
   * A disabled file has no key in the catalogue (DB-225). An agent that reads
   * no key of it must not conclude that it is translated.
   */
  it('names the files that have no version in the language', async () => {
    vi.stubGlobal('fetch', api({ files: { admin: 'available', common: 'partial', guide: 'disabled' } }));

    const answer = said(
      await (await connected()).callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en' } }),
    );

    expect(answer.filesWithNoVersion).toEqual(['guide']);
  });

  it('names no such file for an API that sends no state', async () => {
    const answer = said(
      await (await connected()).callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en' } }),
    );

    expect(answer.filesWithNoVersion).toEqual([]);
  });

  it('says a file has no version rather than that its key is unknown', async () => {
    vi.stubGlobal('fetch', api({ files: { guide: 'disabled' } }));

    const answer = said(
      await (
        await connected()
      ).callTool({
        name: 'i18n_key',
        arguments: { repository: 'repo-1', language: 'en', file: 'guide', key: 'title' },
      }),
    );

    expect(answer.found).toBe(false);
    expect(String(answer.reason)).toContain('guide has no en version');
  });

  it('reads one key with what the source says and what the target does', async () => {
    const answer = said(
      await (
        await connected()
      ).callTool({
        name: 'i18n_key',
        arguments: { repository: 'repo-1', language: 'en', file: 'common', key: 'bye' },
      }),
    );

    expect(answer.found).toBe(true);
    expect(answer.commit).toBe(COMMIT);
    expect(answer.entry).toMatchObject({ source: 'Au revoir', value: null, state: 'missing' });
  });
});

describe('paging a catalogue', () => {
  /**
   * **Each page fetching again is how two revisions end up in one proposal.**
   * A batch carries a single `readAt`, so keys read at A stamped with B are
   * compared by DB-212 against a source that moved — and pass.
   */
  it('answers every page at the revision the first one was read at', async () => {
    let commit = 'a'.repeat(40);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        asked.push({ url: String(url), method: init?.method ?? 'GET' });

        // The source moves under the listing between the two pages.
        const answered = { repository: 'repo-1', language: 'en', source: 'fr', commit, entries: ENTRIES };

        commit = 'b'.repeat(40);

        return { ok: true, json: async () => ({ data: answered }) } as unknown as Response;
      }),
    );

    const client = await connected();
    const first = said(
      await client.callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en', state: 'all' } }),
    );
    const second = said(
      await client.callTool({
        name: 'i18n_keys',
        arguments: { repository: 'repo-1', language: 'en', state: 'all', offset: 1 },
      }),
    );

    expect(second.commit).toBe(first.commit);
    // And it asked once, where every page used to fetch the whole catalogue.
    expect(asked.filter((call) => call.url.includes('/i18n/catalogue'))).toHaveLength(1);
  });

  /**
   * **A reading belongs to the server that made it.** Held in the module, two
   * servers built in one process would share it: the second would be answered
   * a catalogue the first read under **its** token and for **its** host,
   * without asking for it — and would see what a 403 should have refused.
   */
  it('never answers one server with what another read', async () => {
    const first = await connected({ url: 'https://api.test', token: 'token-of-one-account' });
    const second = await connected({ url: 'https://api.test', token: 'token-of-another' });

    await first.callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en' } });
    await second.callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en' } });

    const reads = asked.filter((call) => call.url.includes('/i18n/catalogue'));

    expect(reads).toHaveLength(2);
    // And each asked under its own credential, which is the whole point.
    expect(reads.map((call) => call.auth)).toEqual(['Bearer token-of-one-account', 'Bearer token-of-another']);
  });

  /** A second language is a second catalogue, not the first one answered twice. */
  it('holds one reading per language', async () => {
    const client = await connected();

    await client.callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en' } });
    await client.callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'de' } });

    expect(asked.filter((call) => call.url.includes('/i18n/catalogue'))).toHaveLength(2);
  });

  /**
   * Two pages asked at once are one reading.
   *
   * A client can send the second page before the first answers. With a cache
   * that stores the value only after the read, both miss and both fetch, and
   * the two answers can carry two revisions — which a batch cannot, because it
   * carries one `readAt`.
   *
   * **This one calls the unit rather than the protocol on purpose.** Both calls
   * must be in flight before either answers. Through a client, releasing a
   * held response one turn too early lets the second call find a warm cache,
   * and the test then passes against the defect it was written for.
   */
  it('answers two readings started together with one', async () => {
    const held = createCatalogues();
    const together = await Promise.all([
      held.read(CONFIG, 'repo-1', 'en', 0),
      // Started before the first answers: `Promise.all` enters both calls
      // before either await resolves.
      held.read(CONFIG, 'repo-1', 'en', 0),
    ]);

    expect(asked.filter((call) => call.url.includes('/i18n/catalogue'))).toHaveLength(1);
    // The same reading, so the same revision, not two that happen to match.
    expect(together[0]).toBe(together[1]);
  });
});

describe('proposing', () => {
  /** One call is one commit: three hundred keys are not three hundred commits. */
  it('sends the whole batch in one request', async () => {
    await (
      await connected()
    ).callTool({
      name: 'i18n_propose',
      arguments: {
        repository: 'repo-1',
        language: 'en',
        readAt: COMMIT,
        values: [
          { file: 'common', key: 'bye', value: 'Goodbye' },
          { file: 'admin', key: 'title', value: 'Title' },
        ],
      },
    });

    const writes = asked.filter((call) => call.method === 'POST');

    expect(writes).toHaveLength(1);
    expect((writes[0].body as { values: unknown[] }).values).toHaveLength(2);
  });

  /**
   * The revision is what lets a publication refuse a key whose source moved
   * since (DB-212). It is carried from the listing, never made here.
   */
  it('carries the revision the caller was given, and invents none', async () => {
    await (
      await connected()
    ).callTool({
      name: 'i18n_propose',
      arguments: {
        repository: 'repo-1',
        language: 'en',
        readAt: COMMIT,
        values: [{ file: 'common', key: 'bye', value: 'Goodbye' }],
      },
    });

    const post = asked.find((call) => call.method === 'POST');

    expect((post?.body as { readAt?: string } | undefined)?.readAt).toBe(COMMIT);
  });

  it('refuses a revision that is not a full sha, before any request leaves', async () => {
    const result = await (
      await connected()
    ).callTool({
      name: 'i18n_propose',
      arguments: {
        repository: 'repo-1',
        language: 'en',
        readAt: 'main',
        values: [{ file: 'common', key: 'bye', value: 'Goodbye' }],
      },
    });

    expect(result.isError).toBe(true);
    expect(asked.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
});

describe('the credential and the path', () => {
  /**
   * **The rights of DB-210 live in the middleware of `/i18n`.** A server that
   * reached the services directly would carry those rules in its own
   * discipline instead, and there would be a write path that does not pass
   * them. Every call going through those routes is what makes that impossible
   * rather than merely unlikely.
   */
  it('talks to /i18n alone, and carries the token on every call', async () => {
    const client = await connected();

    await client.callTool({ name: 'i18n_repositories', arguments: {} });
    await client.callTool({ name: 'i18n_me', arguments: {} });
    await client.callTool({ name: 'i18n_keys', arguments: { repository: 'repo-1', language: 'en' } });
    await client.callTool({
      name: 'i18n_propose',
      arguments: {
        repository: 'repo-1',
        language: 'en',
        readAt: COMMIT,
        values: [{ file: 'common', key: 'bye', value: 'Goodbye' }],
      },
    });

    expect(asked.length).toBeGreaterThan(3);
    expect(asked.every((call) => call.url.startsWith('https://api.test/i18n/'))).toBe(true);
    expect(asked.every((call) => call.auth === 'Bearer token-of-an-account')).toBe(true);
  });

  /** A refusal is the answer an agent acts on, not a transport failure. */
  it('hands back what the API refused, with its reason', async () => {
    vi.stubGlobal('fetch', api({ refuse: { status: 403, text: 'This account may not propose in de.' } }));

    const result = await (
      await connected()
    ).callTool({
      name: 'i18n_propose',
      arguments: {
        repository: 'repo-1',
        language: 'de',
        readAt: COMMIT,
        values: [{ file: 'common', key: 'bye', value: 'Tschüss' }],
      },
    });

    expect(result.isError).toBe(true);
    expect(String((result.content as Array<{ text: string }>)[0].text)).toContain('may not propose in de');
  });
});

/**
 * Every tool that names a language states it the same way.
 *
 * `i18n_proposals` once stated its two inputs by hand, and took
 * `../../../../user`: the API answered the path error, and the agent read a
 * server failure where it had given bad input.
 */
describe('a language is a tag, on every tool that takes one', () => {
  const walkingOut = '../../../../user';

  const calls = [
    { name: 'i18n_keys', arguments: { repository: 'repo-1', language: walkingOut } },
    { name: 'i18n_key', arguments: { repository: 'repo-1', language: walkingOut, file: 'common', key: 'bye' } },
    { name: 'i18n_proposals', arguments: { repository: 'repo-1', language: walkingOut } },
    {
      name: 'i18n_propose',
      arguments: {
        repository: 'repo-1',
        language: walkingOut,
        readAt: COMMIT,
        values: [{ file: 'common', key: 'bye', value: 'Goodbye' }],
      },
    },
  ];

  it.each(calls)('$name refuses it before any request leaves', async (call) => {
    const result = await (await connected()).callTool(call);

    expect(result.isError).toBe(true);
    expect(asked).toHaveLength(0);
  });
});

describe('what it needs to start', () => {
  it('names both variables rather than failing on an empty header', () => {
    expect(() => configOf({})).toThrow(/I18N_EDITOR_API_URL and I18N_EDITOR_API_TOKEN/);
    expect(() => configOf({ I18N_EDITOR_API_URL: 'https://api.test' })).toThrow(/I18N_EDITOR_API_TOKEN/);
  });

  it('takes the trailing slash off the url, which would double in a path', () => {
    expect(configOf({ I18N_EDITOR_API_URL: 'https://api.test/', I18N_EDITOR_API_TOKEN: 't' }).url).toBe(
      'https://api.test',
    );
  });
});

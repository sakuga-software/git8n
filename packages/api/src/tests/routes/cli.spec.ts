import '../setup-env';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authDeviceCodes, i18nRepositories, newId } from '@i18n-editor/db';
import { fakeIo } from '@i18n-editor/mcp/cli/testing';
import app from '../../app';
import { env } from '@/config/env';
import { clearI18nCatalogueCache } from '@/services/i18n-catalogue.service';
import { clearI18nProgressCache } from '@/services/i18n-progress.service';
import { cookieHeaders, grant, insertAccount, insertOrganization } from '../db/fixtures';
import { useTestDb } from '../db/test-db';
import { fakeRepo, type FakeRepo } from '../services/fake-github-repo';

vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();

  return { ...real, installationToken: async () => 'installation-token', installations: async () => [] };
});

const { db } = useTestDb();

/**
 * The command line against the real API, in this process (DB-671).
 *
 * The `fetch` of the command line goes to `app.request`. The global `fetch` is
 * the fake repository of GitHub that the API reads and writes.
 */

const EDITOR = 'http://editor.test';
const LOCALES = 'src/locales';

let repo: FakeRepo;

beforeEach(() => {
  clearI18nCatalogueCache();
  clearI18nProgressCache();
  Object.assign(env, { I18N_APP: { appId: '123456', privateKey: 'PEM' } });
  repo = fakeRepo({
    owner: 'acme',
    name: 'acme-app',
    baseBranch: 'main',
    files: {
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', bye: 'Au revoir' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    },
  });
  vi.stubGlobal('fetch', repo.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, { I18N_APP: undefined });
});

const sendToApp = (url: string, init?: RequestInit) => app.request(url, init) as Promise<Response>;

describe('i18n-editor against the API', () => {
  it('signs in with a device code, reads the missing keys, proposes them, and signs out', async () => {
    const repositoryId = newId();

    await db()
      .insert(i18nRepositories)
      .values({
        id: repositoryId,
        organizationId: await insertOrganization(),
        installationId: 42,
        owner: 'acme',
        name: 'acme-app',
        branch: 'main',
        localesPath: LOCALES,
        languages: ['fr', 'en'],
      } as never);

    const userId = await insertAccount();

    await grant(userId, repositoryId, { languages: ['en'], role: 'translator' });

    const browser = await cookieHeaders(userId);
    let approvedCode: string | undefined;
    let sleeps = 0;

    const cli = await fakeIo(sendToApp, {
      // The person approves the code in the browser between the first poll and the second.
      openUrl: async (url) => {
        approvedCode = new URL(url).searchParams.get('user_code') ?? undefined;

        return true;
      },
      sleep: async () => {
        sleeps += 1;

        if (sleeps !== 2) return;

        const headers = { ...browser, 'content-type': 'application/json', origin: EDITOR };

        // What the page `/device` does: it reads the code, then approves it.
        expect((await app.request(`${EDITOR}/api/auth/device?user_code=${approvedCode}`, { headers })).status).toBe(
          200,
        );

        const approved = await app.request(`${EDITOR}/api/auth/device/approve`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ userCode: approvedCode }),
        });

        expect(approved.status).toBe(200);

        // The plugin refuses a poll that comes before the interval. No real time passes here.
        await db()
          .update(authDeviceCodes)
          .set({ lastPolledAt: new Date(Date.now() - 60_000) });
      },
    });

    const login = await cli.run('login', '--api', EDITOR, '--json');

    expect(login.exit, login.stdout + login.stderr).toBe(0);
    expect(sleeps).toBe(2);

    const credentials = JSON.parse(await readFile(join(cli.configHome, 'i18n-editor', 'credentials.json'), 'utf8')) as {
      servers: Record<string, { token: string }>;
    };
    const sessionToken = credentials.servers[EDITOR]!.token;

    const whoami = await cli.run('whoami', '--json');

    expect(whoami.json().data).toMatchObject({
      api: EDITOR,
      via: 'login',
      memberships: [{ repository: 'acme/acme-app', role: 'translator', languages: ['en'] }],
    });

    const keys = await cli.run('keys', '--repo', 'acme/acme-app', '--missing', '--json');
    const read = keys.json().data;

    expect(read).toMatchObject({ language: 'en', total: 1, entries: [{ id: 'common:bye', state: 'missing' }] });
    expect(read.commit).toBe(repo.refs.get('main'));

    cli.io.readStdin = async () => JSON.stringify({ 'common:bye': 'Goodbye', 'common:hello': 'Hello' });

    const applied = await cli.run('apply', '-', '--repo', 'acme/acme-app', '--json');

    expect(applied.exit, applied.stdout).toBe(0);
    expect(applied.json().data).toMatchObject({
      readAt: read.commit,
      unchanged: ['common:hello'],
      proposed: { branch: 'i18n/en', keys: 1 },
    });
    expect(JSON.parse(repo.filesAt(repo.refs.get('i18n/en')!).get(`${LOCALES}/en/common.json`)!)).toEqual({
      hello: 'Hello',
      bye: 'Goodbye',
    });

    const proposals = await cli.run('proposals', '--repo', 'acme/acme-app', '--json');

    expect(proposals.json().data.batches).toHaveLength(1);

    const logout = await cli.run('logout', '--json');

    expect(logout.json().data).toEqual({ api: EDITOR, signedOut: true, revoked: true });
    expect(
      (await app.request(`${EDITOR}/i18n/me`, { headers: { authorization: `Bearer ${sessionToken}` } })).status,
    ).toBe(401);

    cli.io.env.I18N_EDITOR_API_URL = EDITOR;

    expect((await cli.run('whoami', '--json')).exit).toBe(3);
  });

  it('acts with an access token of the « Jetons » page', async () => {
    const userId = await insertAccount();
    const made = await app.request(`${EDITOR}/i18n/tokens`, {
      method: 'POST',
      headers: { ...(await cookieHeaders(userId)), 'content-type': 'application/json', origin: EDITOR },
      body: JSON.stringify({ name: 'CI', expiresInDays: 30 }),
    });
    const { token } = ((await made.json()) as { data: { token: string } }).data;
    const cli = await fakeIo(sendToApp);

    Object.assign(cli.io.env, { I18N_EDITOR_API_URL: EDITOR, I18N_EDITOR_API_TOKEN: token });

    const whoami = await cli.run('whoami', '--json');

    expect(whoami.exit, whoami.stdout).toBe(0);
    expect(whoami.json().data).toMatchObject({ via: 'I18N_EDITOR_API_TOKEN', account: null, memberships: [] });
  });
});

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { accessTokens, authDeviceCodes, i18nRepositories, newId } from '@git8n/db';
import app from '@/app';
import { CLI_CLIENT_ID } from '@/auth';
import { authHeaders, cookieHeaders, grant, insertAccount, insertOrganization } from '../db/fixtures';
import { useTestDb } from '../db/test-db';

const { db } = useTestDb();

const EDITOR = 'http://editor.test';

const send = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  app.request(`${EDITOR}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', origin: EDITOR, ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const dataOf = async <T>(res: Response): Promise<T> => ((await res.json()) as { data: T }).data;

/** An account that translates English in a new repository. */
const translator = async () => {
  const userId = await insertAccount();
  const repositoryId = newId();

  await db()
    .insert(i18nRepositories)
    .values({
      id: repositoryId,
      organizationId: await insertOrganization(),
      installationId: 42,
      owner: 'acme',
      name: repositoryId,
      localesPath: 'src/locales',
      languages: ['fr', 'en'],
    });
  await grant(userId, repositoryId, { languages: ['en'] });

  return { userId, repositoryId };
};

const makeToken = async (headers: Record<string, string>, body: unknown = { name: 'CI', expiresInDays: 30 }) =>
  send('/i18n/tokens', { method: 'POST', headers, body });

describe('the access tokens', () => {
  it('shows a token once, keeps only its hash, and lists it with no secret', async () => {
    const { userId } = await translator();
    const headers = await cookieHeaders(userId);

    const made = await makeToken(headers);
    const created = await dataOf<{ id: string; token: string; start: string }>(made);

    expect(made.status).toBe(201);
    expect(created.token).toMatch(/^g8n_[\w-]{43}$/);
    expect(created.token.startsWith(created.start)).toBe(true);

    const [row] = await db().select().from(accessTokens).where(eq(accessTokens.id, created.id));

    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(created.token);

    const listed = await dataOf<Record<string, unknown>[]>(await send('/i18n/tokens', { headers }));

    expect(listed).toEqual([
      expect.objectContaining({ id: created.id, name: 'CI', start: created.start, lastUsedAt: null }),
    ]);
    expect(listed[0]).not.toHaveProperty('token');
  });

  it('opens what its account may do, and nothing more', async () => {
    const { userId, repositoryId } = await translator();
    const { token } = await dataOf<{ token: string }>(await makeToken(await cookieHeaders(userId)));

    const me = await send('/i18n/me', { headers: { authorization: `Bearer ${token}` } });

    expect(me.status).toBe(200);
    expect(await dataOf(me)).toEqual({
      admin: false,
      memberships: [{ repositoryId, languages: ['en'], role: 'translator', writesSource: false }],
      installUrl: null,
    });
    expect((await db().select().from(accessTokens))[0]!.lastUsedAt).not.toBeNull();
  });

  it('refuses a token that expired, a token that was revoked, and a token that does not exist', async () => {
    const { userId } = await translator();
    const headers = await cookieHeaders(userId);
    const expiring = await dataOf<{ id: string; token: string }>(await makeToken(headers));
    const revoked = await dataOf<{ id: string; token: string }>(await makeToken(headers));

    await db()
      .update(accessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accessTokens.id, expiring.id));
    expect((await send(`/i18n/tokens/${revoked.id}`, { method: 'DELETE', headers })).status).toBe(200);

    for (const token of [expiring.token, revoked.token, 'g8n_unknown']) {
      expect((await send('/i18n/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    }
  });

  it('makes a token that does not expire', async () => {
    const { userId } = await translator();

    const made = await dataOf<{ expiresAt: string | null }>(
      await makeToken(await cookieHeaders(userId), { name: 'Agent', expiresInDays: null }),
    );

    expect(made.expiresAt).toBeNull();
  });

  it('refuses a name that is empty and a life longer than a year', async () => {
    const headers = await cookieHeaders((await translator()).userId);

    expect((await makeToken(headers, { name: ' ', expiresInDays: 30 })).status).toBe(400);
    expect((await makeToken(headers, { name: 'CI', expiresInDays: 366 })).status).toBe(400);
  });

  it('lets an account revoke only its own tokens', async () => {
    const owner = await translator();
    const other = await translator();
    const { id } = await dataOf<{ id: string }>(await makeToken(await cookieHeaders(owner.userId)));

    const res = await send(`/i18n/tokens/${id}`, { method: 'DELETE', headers: await cookieHeaders(other.userId) });

    expect(res.status).toBe(404);
    expect(await db().select().from(accessTokens)).toHaveLength(1);
  });

  it('lets only the session of the browser manage the tokens', async () => {
    const { userId } = await translator();
    const { token } = await dataOf<{ token: string }>(await makeToken(await cookieHeaders(userId)));

    for (const headers of [{ authorization: `Bearer ${token}` }, await authHeaders(userId)]) {
      expect((await send('/i18n/tokens', { headers })).status).toBe(403);
      expect((await makeToken(headers)).status).toBe(403);
    }

    expect((await send('/i18n/tokens')).status).toBe(401);
  });
});

describe('the sign-in of the command line with a device code', () => {
  const askCode = (clientId = CLI_CLIENT_ID) =>
    send('/api/auth/device/code', { method: 'POST', body: { client_id: clientId } });

  const poll = (deviceCode: string) =>
    send('/api/auth/device/token', {
      method: 'POST',
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: CLI_CLIENT_ID,
      },
    });

  it('gives the command line a token that acts as the person who approved the code', async () => {
    const { userId, repositoryId } = await translator();
    const browser = await cookieHeaders(userId);

    const asked = await askCode();
    const code = (await asked.json()) as { device_code: string; user_code: string; verification_uri: string };

    expect(asked.status).toBe(200);
    expect(code.verification_uri).toBe(`${EDITOR}/device`);

    const pending = await poll(code.device_code);

    expect(pending.status).toBe(400);
    expect(await pending.json()).toMatchObject({ error: 'authorization_pending' });

    expect((await send(`/api/auth/device?user_code=${code.user_code}`, { headers: browser })).status).toBe(200);
    expect(
      (await send('/api/auth/device/approve', { method: 'POST', headers: browser, body: { userCode: code.user_code } }))
        .status,
    ).toBe(200);

    // The command line waits the interval between two polls. The test moves the last poll back.
    await db()
      .update(authDeviceCodes)
      .set({ lastPolledAt: new Date(Date.now() - 60_000) });

    const granted = await poll(code.device_code);
    const answered = (await granted.json()) as { access_token: string };

    expect(granted.status, JSON.stringify(answered)).toBe(200);

    const accessToken = answered.access_token;

    const me = await send('/i18n/me', { headers: { authorization: `Bearer ${accessToken}` } });

    expect(await dataOf(me)).toMatchObject({ memberships: [{ repositoryId, languages: ['en'] }] });
  });

  it('refuses a client that is not the command line', async () => {
    expect((await askCode('another-client')).status).toBe(400);
  });

  it('refuses an approval that a bearer token sends, also with a trailing slash', async () => {
    const { userId } = await translator();
    const code = (await (await askCode()).json()) as { user_code: string };
    const bearer = await authHeaders(userId);

    for (const path of ['/api/auth/device/approve', '/api/auth/device/approve/', '/api/auth/Device/Approve']) {
      expect((await send(path, { method: 'POST', headers: bearer, body: { userCode: code.user_code } })).status).toBe(
        403,
      );
    }

    expect((await send(`/api/auth/device?user_code=${code.user_code}`, { headers: bearer })).status).toBe(403);
  });
});

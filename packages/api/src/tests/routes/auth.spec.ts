import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authSessions, i18nTranslators, users } from '@i18n-editor/db';
import app from '@/app';
import type { GithubProfile } from 'better-auth/social-providers';
import { createAuth, isAdmin, useAuth } from '@/auth';
import { env } from '@/config/env';
import { ADMIN_EMAIL, authHeaders, insertAccount } from '../db/fixtures';
import { useTestDb } from '../db/test-db';

const { db } = useTestDb();

const INSTALL_URL = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;

const EDITOR = 'http://editor.test';

const me = async (headers: Record<string, string> = {}) => {
  const res = await app.request(`${EDITOR}/i18n/me`, { headers });

  return { status: res.status, body: res.status === 200 ? ((await res.json()) as { data: unknown }).data : null };
};

const grant = (userId: string, row: Partial<typeof i18nTranslators.$inferInsert>) =>
  db()
    .insert(i18nTranslators)
    .values({ userId, ...row });

describe('isAdmin', () => {
  const admins = new Set(['admin@example.test']);

  it('takes an address of the list that GitHub verified, whatever its case', () => {
    expect(isAdmin({ email: ' Admin@Example.TEST ', emailVerified: true }, admins)).toBe(true);
  });

  it('refuses an address of the list that GitHub did not verify', () => {
    expect(isAdmin({ email: 'admin@example.test', emailVerified: false }, admins)).toBe(false);
  });

  it('refuses an address out of the list', () => {
    expect(isAdmin({ email: 'someone@example.test', emailVerified: true }, admins)).toBe(false);
  });
});

describe('who a session is', () => {
  it('refuses a visitor', async () => {
    expect((await me()).status).toBe(401);
  });

  it('refuses a token that no session holds', async () => {
    expect((await me({ authorization: 'Bearer not-a-session' })).status).toBe(401);
  });

  it('refuses a session that expired', async () => {
    const userId = await insertAccount();
    const headers = await authHeaders(userId);

    await db()
      .update(authSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authSessions.userId, userId));

    expect((await me(headers)).status).toBe(401);
  });

  it('opens nothing to an account with no row and no admin address', async () => {
    const userId = await insertAccount();

    expect(await me(await authHeaders(userId))).toEqual({
      status: 200,
      body: { admin: false, rights: null, installUrl: null },
    });
  });

  it('gives a translator the languages of its row', async () => {
    const userId = await insertAccount();

    await grant(userId, { languages: ['en'] });

    expect((await me(await authHeaders(userId))).body).toEqual({
      admin: false,
      rights: { languages: ['en'], role: 'translator', writesSource: false },
      installUrl: null,
    });
  });

  it('gives a reviewer its role', async () => {
    const userId = await insertAccount();

    await grant(userId, { languages: ['en'], role: 'reviewer' });

    expect((await me(await authHeaders(userId))).body).toMatchObject({ rights: { role: 'reviewer' } });
  });

  it('gives the source to the account whose row says so', async () => {
    const userId = await insertAccount();

    await grant(userId, { writesSource: true });

    expect((await me(await authHeaders(userId))).body).toMatchObject({ rights: { writesSource: true } });
  });

  it('makes an admin of a verified address of ADMIN_EMAILS, whatever its case', async () => {
    const userId = await insertAccount({ email: 'BOSS@example.test' });

    expect(env.ADMIN_EMAILS.has('boss@example.test')).toBe(true);
    expect((await me(await authHeaders(userId))).body).toEqual({ admin: true, rights: null, installUrl: INSTALL_URL });
  });

  it('makes no admin of an address of ADMIN_EMAILS that GitHub did not verify', async () => {
    const userId = await insertAccount({ email: ADMIN_EMAIL, emailVerified: false });

    expect((await me(await authHeaders(userId))).body).toEqual({ admin: false, rights: null, installUrl: null });
  });
});

/**
 * A sign-in with GitHub, as a browser does it, with no network.
 *
 * `getUserInfo` replaces the calls to `/user` and `/user/emails`. The stub of
 * `fetch` answers the exchange of the code for a token.
 */
describe('the sign-in with GitHub', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const signIn = async (profile: { id: string; email: string; emailVerified: boolean; name: string }) => {
    useAuth(
      createAuth({
        db: db(),
        secret: env.BETTER_AUTH_SECRET,
        baseURL: EDITOR,
        github: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          getUserInfo: async () => ({
            user: { name: profile.name, email: profile.email, emailVerified: profile.emailVerified },
            // better-auth names the GitHub account by the `id` of the profile.
            data: { id: profile.id, login: profile.name } as Partial<GithubProfile> as GithubProfile,
          }),
        },
      }),
    );

    const realFetch = globalThis.fetch;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url.startsWith('https://github.com/login/oauth/access_token')) {
        return Response.json({ access_token: 'gho_token', token_type: 'bearer', scope: 'read:user,user:email' });
      }

      return realFetch(input, init);
    });

    const start = await app.request(`${EDITOR}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: EDITOR },
      body: JSON.stringify({ provider: 'github', callbackURL: `${EDITOR}/` }),
    });
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get('state');
    const cookie = start.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');

    const callback = await app.request(`${EDITOR}/api/auth/callback/github?state=${state}&code=the-code`, {
      headers: { cookie },
    });

    return {
      authorizeUrl: url,
      status: callback.status,
      location: callback.headers.get('location'),
      cookie: callback.headers
        .getSetCookie()
        .map((line) => line.split(';')[0])
        .join('; '),
    };
  };

  it('sends the browser to GitHub, then back to the editor with a session', async () => {
    const answer = await signIn({ id: '42', email: ADMIN_EMAIL, emailVerified: true, name: 'Mathieu' });

    expect(new URL(answer.authorizeUrl).origin).toBe('https://github.com');
    expect(new URL(answer.authorizeUrl).searchParams.get('redirect_uri')).toBe(`${EDITOR}/api/auth/callback/github`);
    expect(answer.status).toBe(302);
    expect(answer.location).toBe(`${EDITOR}/`);
    expect(await me({ cookie: answer.cookie })).toEqual({
      status: 200,
      body: { admin: true, rights: null, installUrl: INSTALL_URL },
    });
  });

  it('reads the address of GitHub again at each sign-in', async () => {
    await signIn({ id: '42', email: 'someone@example.test', emailVerified: true, name: 'Mathieu' });

    const second = await signIn({ id: '42', email: ADMIN_EMAIL, emailVerified: false, name: 'Mathieu' });

    expect(await db().select({ email: users.email, verified: users.emailVerified }).from(users)).toEqual([
      { email: ADMIN_EMAIL, verified: false },
    ]);
    expect((await me({ cookie: second.cookie })).body).toEqual({ admin: false, rights: null, installUrl: null });
  });
});

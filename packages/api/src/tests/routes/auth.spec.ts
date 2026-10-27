import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authSessions, i18nRepositories, members, newId, pendingMembers, users } from '@i18n-editor/db';
import app from '@/app';
import type { GithubProfile } from 'better-auth/social-providers';
import { createAuth, isAdmin, sendMagicLinkTo, useAuth } from '@/auth';
import { sentInDevelopment } from '@/services/mail.service';
import { env } from '@/config/env';
import { ADMIN_EMAIL, authHeaders, grant, insertAccount, insertOrganization, invite } from '../db/fixtures';
import { useTestDb } from '../db/test-db';

const { db } = useTestDb();

const INSTALL_URL = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;

const EDITOR = 'http://editor.test';

const me = async (headers: Record<string, string> = {}) => {
  const res = await app.request(`${EDITOR}/i18n/me`, { headers });

  return { status: res.status, body: res.status === 200 ? ((await res.json()) as { data: unknown }).data : null };
};

/** Makes `userId` a member of a new repository. */
const grantIn = async (userId: string, options: Parameters<typeof grant>[2]) => {
  const id = newId();

  await db()
    .insert(i18nRepositories)
    .values({
      id,
      organizationId: await insertOrganization(),
      installationId: 42,
      owner: 'acme',
      name: id,
      localesPath: 'src/locales',
      languages: ['fr', 'en'],
    });
  await grant(userId, id, options);

  return id;
};

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
      body: { admin: false, memberships: [], installUrl: null },
    });
  });

  it('gives a translator the languages of its row', async () => {
    const userId = await insertAccount();

    const repositoryId = await grantIn(userId, { languages: ['en'] });

    expect((await me(await authHeaders(userId))).body).toEqual({
      admin: false,
      memberships: [{ repositoryId, languages: ['en'], role: 'translator', writesSource: false }],
      installUrl: null,
    });
  });

  it('gives a reviewer its role', async () => {
    const userId = await insertAccount();

    await grantIn(userId, { languages: ['en'], role: 'reviewer' });

    expect((await me(await authHeaders(userId))).body).toMatchObject({ memberships: [{ role: 'reviewer' }] });
  });

  it('gives the source to the account whose row says so', async () => {
    const userId = await insertAccount();

    await grantIn(userId, { writesSource: true });

    expect((await me(await authHeaders(userId))).body).toMatchObject({ memberships: [{ writesSource: true }] });
  });

  it('makes an admin of a verified address of ADMIN_EMAILS, whatever its case', async () => {
    const userId = await insertAccount({ email: 'BOSS@example.test' });

    expect(env.ADMIN_EMAILS.has('boss@example.test')).toBe(true);
    expect((await me(await authHeaders(userId))).body).toEqual({
      admin: true,
      memberships: [],
      installUrl: INSTALL_URL,
    });
  });

  it('makes no admin of an address of ADMIN_EMAILS that GitHub did not verify', async () => {
    const userId = await insertAccount({ email: ADMIN_EMAIL, emailVerified: false });

    expect((await me(await authHeaders(userId))).body).toEqual({ admin: false, memberships: [], installUrl: null });
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

  /** A person added by GitHub login is a member at the first sign-in (DB-645). */
  it('makes a member of the GitHub account that an invitation names, and deletes the invitation', async () => {
    const repositoryId = await grantIn(await insertAccount(), {});

    await invite(repositoryId, { githubId: '4242', role: 'reviewer', languages: ['en'] });

    const answer = await signIn({ id: '4242', email: 'ann@example.test', emailVerified: false, name: 'Ann' });

    expect((await me({ cookie: answer.cookie })).body).toMatchObject({
      memberships: [{ repositoryId, role: 'reviewer', languages: ['en'] }],
    });
    expect(await db().select().from(pendingMembers)).toEqual([]);
  });

  /** Without this rule, an address added to GitHub and never verified takes the invitation. */
  it('gives an invitation by address to a GitHub account only when GitHub verified the address', async () => {
    const repositoryId = await grantIn(await insertAccount(), {});

    await invite(repositoryId, { email: 'ann@example.test', languages: ['en'] });

    const unverified = await signIn({ id: '1', email: 'ann@example.test', emailVerified: false, name: 'Ann' });

    expect((await me({ cookie: unverified.cookie })).body).toMatchObject({ memberships: [] });

    await db().delete(users);

    const verified = await signIn({ id: '1', email: 'ann@example.test', emailVerified: true, name: 'Ann' });

    expect((await me({ cookie: verified.cookie })).body).toMatchObject({ memberships: [{ repositoryId }] });
  });

  /** A person invited by address signs in with a magic link, then with GitHub: one account (DB-645). */
  it('joins a GitHub sign-in to the account of the same verified address', async () => {
    const userId = await insertAccount({ email: 'ann@example.test', emailVerified: true });
    const answer = await signIn({ id: '7', email: 'ann@example.test', emailVerified: true, name: 'Ann' });

    expect(answer.location).toBe(`${EDITOR}/`);
    expect(await db().select({ id: users.id }).from(users)).toEqual([{ id: userId }]);
  });

  it('does not join a GitHub sign-in whose address GitHub did not verify', async () => {
    await insertAccount({ email: 'ann@example.test', emailVerified: true });

    const answer = await signIn({ id: '7', email: 'ann@example.test', emailVerified: false, name: 'Ann' });

    expect(answer.location).toContain('error=');
    expect(await db().select().from(authSessions)).toEqual([]);
  });

  it('sends the browser to GitHub, then back to the editor with a session', async () => {
    const answer = await signIn({ id: '42', email: ADMIN_EMAIL, emailVerified: true, name: 'Mathieu' });

    expect(new URL(answer.authorizeUrl).origin).toBe('https://github.com');
    expect(new URL(answer.authorizeUrl).searchParams.get('redirect_uri')).toBe(`${EDITOR}/api/auth/callback/github`);
    expect(answer.status).toBe(302);
    expect(answer.location).toBe(`${EDITOR}/`);
    expect(await me({ cookie: answer.cookie })).toEqual({
      status: 200,
      body: { admin: true, memberships: [], installUrl: INSTALL_URL },
    });
  });

  it('reads the address of GitHub again at each sign-in', async () => {
    await signIn({ id: '42', email: 'someone@example.test', emailVerified: true, name: 'Mathieu' });

    const second = await signIn({ id: '42', email: ADMIN_EMAIL, emailVerified: false, name: 'Mathieu' });

    expect(await db().select({ email: users.email, verified: users.emailVerified }).from(users)).toEqual([
      { email: ADMIN_EMAIL, verified: false },
    ]);
    expect((await me({ cookie: second.cookie })).body).toEqual({ admin: false, memberships: [], installUrl: null });
  });
});

/** The sign-in by magic link, for a person invited by address (DB-645). */
describe('the sign-in with a magic link', () => {
  afterEach(() => {
    sentInDevelopment.length = 0;
  });

  const ask = (email: string) =>
    app.request(`${EDITOR}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: EDITOR },
      body: JSON.stringify({ email, callbackURL: `${EDITOR}/` }),
    });

  const linkIn = (text: string) => text.match(/https?:\/\/\S+/)?.[0] ?? '';

  it('sends an invited address a link that opens a session, and makes the account a member', async () => {
    const repositoryId = await grantIn(await insertAccount(), {});

    await invite(repositoryId, { email: 'Ann@Example.test', role: 'translator', languages: ['en'] });

    expect((await ask('ann@example.test')).status).toBe(200);
    await vi.waitFor(() => expect(sentInDevelopment).toHaveLength(1));

    const [mail] = sentInDevelopment;

    expect(mail.to).toBe('ann@example.test');
    expect(mail.text).toContain(`acme/${repositoryId}`);

    const opened = await app.request(linkIn(mail.text));
    const cookie = opened.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');

    expect(opened.status).toBe(302);
    expect((await me({ cookie })).body).toMatchObject({
      admin: false,
      memberships: [{ repositoryId, role: 'translator', languages: ['en'] }],
    });
    expect(
      await db()
        .select({ name: users.name, verified: users.emailVerified })
        .from(users)
        .where(eq(users.email, 'ann@example.test')),
    ).toEqual([{ name: 'ann', verified: true }]);
    expect(await db().select().from(pendingMembers)).toEqual([]);
  });

  it('answers the same to an address it does not know, and sends it nothing', async () => {
    const res = await ask('stranger@example.test');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });

    await sendMagicLinkTo('stranger@example.test', `${EDITOR}/link`);

    expect(sentInDevelopment).toEqual([]);
    expect(await db().select().from(users)).toEqual([]);
  });

  it('sends a link to an admin, and to the verified address of a member, and to no other account', async () => {
    const memberId = await insertAccount({ email: 'member@example.test', emailVerified: true });
    const unverifiedId = await insertAccount({ email: 'unverified@example.test', emailVerified: false });
    const repositoryId = await grantIn(memberId, {});

    await grant(unverifiedId, repositoryId);
    await insertAccount({ email: 'nobody@example.test' });

    for (const address of [ADMIN_EMAIL, 'member@example.test', 'unverified@example.test', 'nobody@example.test']) {
      await sendMagicLinkTo(address, `${EDITOR}/link`);
    }

    expect(sentInDevelopment.map((mail) => mail.to)).toEqual([ADMIN_EMAIL, 'member@example.test']);
  });

  it('keeps the rights of a member that an invitation names again', async () => {
    const userId = await insertAccount({ email: 'ann@example.test', emailVerified: true });
    const repositoryId = await grantIn(userId, { role: 'reviewer', languages: ['en'] });

    await invite(repositoryId, { email: 'ann@example.test', role: 'translator' });
    await authHeaders(userId);

    expect(await db().select({ role: members.role }).from(members)).toEqual([{ role: 'reviewer' }]);
    expect(await db().select().from(pendingMembers)).toEqual([]);
  });
});

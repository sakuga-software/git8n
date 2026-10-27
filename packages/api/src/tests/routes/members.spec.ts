import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { authAccounts, i18nRepositories, members, newId, pendingMembers } from '@i18n-editor/db';
import app from '../../app';
import { sentInDevelopment } from '@/services/mail.service';
import { authHeaders, grant, insertAccount, insertOrganization, signedInAdmin } from '../db/fixtures';
import { useTestDb } from '../db/test-db';

vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();

  return { ...real, installationToken: async () => 'installation-token' };
});

const { db } = useTestDb();

const EDITOR = 'http://editor.test';

/** GitHub knows one login, `octo-cat`, with the ID 583231. */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url) === 'https://api.github.com/users/octo-cat') {
        return Response.json({ id: 583231, login: 'Octo-Cat' });
      }

      return Response.json({ message: 'Not Found' }, { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  sentInDevelopment.length = 0;
});

async function repository(name = 'app') {
  const id = newId();

  await db()
    .insert(i18nRepositories)
    .values({
      id,
      organizationId: await insertOrganization(),
      installationId: 42,
      owner: 'acme',
      name,
      localesPath: 'src/locales',
      languages: ['fr', 'en', 'de'],
    });

  return id;
}

/** A new account with `role` in the repository, and the headers of its requests. */
async function memberWith(repositoryId: string, role: 'owner' | 'reviewer' | 'translator', email?: string) {
  const userId = await insertAccount(email ? { email } : {});

  await grant(userId, repositoryId, { role, languages: ['en'] });

  return { userId, headers: await authHeaders(userId) };
}

const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.request(`${EDITOR}${path}`, {
    method,
    headers: { ...headers, origin: EDITOR, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const list = async (repositoryId: string, headers: Record<string, string>) =>
  (
    (await (await call('GET', `/i18n/repositories/${repositoryId}/members`, headers)).json()) as {
      data: {
        members: Array<{ id: string; userId: string; role: string; languages: string[]; writesSource: boolean }>;
        invitations: Array<{
          id: string;
          email: string | null;
          githubLogin: string | null;
          role: string;
          languages: string[];
        }>;
      };
    }
  ).data;

describe('who manages the members of a repository (DB-637)', () => {
  it('lets an owner and an admin read the members, and refuses a reviewer and a member of another repository', async () => {
    const repo = await repository();
    const other = await repository('other');
    const owner = await memberWith(repo, 'owner');
    const reviewer = await memberWith(repo, 'reviewer');
    const stranger = await memberWith(other, 'owner');
    const admin = await signedInAdmin();
    const path = `/i18n/repositories/${repo}/members`;

    expect((await call('GET', path, owner.headers)).status).toBe(200);
    expect((await call('GET', path, admin.headers)).status).toBe(200);
    expect((await call('GET', path, reviewer.headers)).status).toBe(403);
    expect((await call('GET', path, stranger.headers)).status).toBe(403);
  });

  it('refuses every change to a member who does not manage the repository', async () => {
    const repo = await repository();
    const owner = await memberWith(repo, 'owner');
    const translator = await memberWith(repo, 'translator');
    const [ownerRow] = await db().select().from(members).where(eq(members.userId, owner.userId));
    const base = `/i18n/repositories/${repo}`;

    for (const [method, path, body] of [
      ['POST', `${base}/members`, { email: 'x@example.test', role: 'owner', languages: [], writesSource: false }],
      ['PATCH', `${base}/members/${ownerRow.id}`, { role: 'translator' }],
      ['DELETE', `${base}/members/${ownerRow.id}`, undefined],
    ] as const) {
      expect((await call(method, path, translator.headers, body)).status).toBe(403);
    }

    expect(await db().select({ role: members.role }).from(members).where(eq(members.id, ownerRow.id))).toEqual([
      { role: 'owner' },
    ]);
  });
});

describe('adding a person', () => {
  it('invites an unknown address, mails it the magic link, and makes it a member at its sign-in', async () => {
    const repo = await repository();
    const owner = await memberWith(repo, 'owner');
    const res = await call('POST', `/i18n/repositories/${repo}/members`, owner.headers, {
      email: 'Ann@Example.test',
      role: 'reviewer',
      languages: ['de', 'en'],
      writesSource: true,
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ data: { outcome: 'invited', by: 'email' } });
    expect((await list(repo, owner.headers)).invitations).toEqual([
      expect.objectContaining({ email: 'ann@example.test', role: 'reviewer', languages: ['de', 'en'] }),
    ]);

    await vi.waitFor(() => expect(sentInDevelopment).toHaveLength(1), { timeout: 5000 });
    expect(sentInDevelopment[0]).toMatchObject({ to: 'ann@example.test', subject: 'Invitation à traduire' });

    const link = sentInDevelopment[0].text.match(/https?:\/\/\S+/)?.[0] ?? '';
    const opened = await app.request(link);

    expect(opened.status).toBe(302);

    const after = await list(repo, owner.headers);

    expect(after.invitations).toEqual([]);
    expect(after.members).toContainEqual(
      expect.objectContaining({ role: 'reviewer', languages: ['de', 'en'], writesSource: true }),
    );
  });

  it('makes a member at once of an account whose address is verified', async () => {
    const repo = await repository();
    const owner = await memberWith(repo, 'owner');
    const known = await insertAccount({ email: 'bob@example.test', emailVerified: true });
    const res = await call('POST', `/i18n/repositories/${repo}/members`, owner.headers, {
      email: 'bob@example.test',
      role: 'translator',
      languages: ['en'],
      writesSource: false,
    });

    expect(await res.json()).toMatchObject({ data: { outcome: 'member' } });
    expect((await list(repo, owner.headers)).members).toContainEqual(
      expect.objectContaining({ userId: known, role: 'translator', languages: ['en'] }),
    );
    expect(sentInDevelopment).toEqual([]);
  });

  it('invites a GitHub login by its numeric ID, or makes a member of the account that signed in with it', async () => {
    const repo = await repository();
    const owner = await memberWith(repo, 'owner');
    const add = (githubLogin: string) =>
      call('POST', `/i18n/repositories/${repo}/members`, owner.headers, {
        githubLogin,
        role: 'translator',
        languages: [],
        writesSource: false,
      });

    expect(await (await add('octo-cat')).json()).toMatchObject({ data: { outcome: 'invited', by: 'github' } });
    expect(
      await db().select({ id: pendingMembers.githubId, login: pendingMembers.githubLogin }).from(pendingMembers),
    ).toEqual([{ id: '583231', login: 'Octo-Cat' }]);
    expect((await add('nobody-here')).status).toBe(400);

    await db().delete(pendingMembers);

    const userId = await insertAccount();

    await db().insert(authAccounts).values({ id: newId(), userId, providerId: 'github', accountId: '583231' });

    expect(await (await add('octo-cat')).json()).toMatchObject({ data: { outcome: 'member' } });
  });

  it('refuses a person already there, a language the repository does not translate, and a body that names nobody', async () => {
    const repo = await repository();
    const owner = await memberWith(repo, 'owner', 'owner@example.test');
    const add = (body: unknown) => call('POST', `/i18n/repositories/${repo}/members`, owner.headers, body);
    const rights = { role: 'translator', languages: [], writesSource: false };

    expect((await add({ email: 'owner@example.test', ...rights })).status).toBe(409);
    expect((await add({ email: 'new@example.test', ...rights })).status).toBe(201);
    expect((await add({ email: 'new@example.test', ...rights })).status).toBe(409);
    expect((await add({ email: 'x@example.test', ...rights, languages: ['fr'] })).status).toBe(400);
    expect((await add({ email: 'y@example.test', ...rights, languages: ['pt'] })).status).toBe(400);
    expect((await add(rights)).status).toBe(400);
    expect((await add({ email: 'z@example.test', githubLogin: 'octo-cat', ...rights })).status).toBe(400);
  });
});

describe('changing and removing', () => {
  it('changes the role, the languages and the source of a member', async () => {
    const repo = await repository();
    const owner = await memberWith(repo, 'owner');
    const translator = await memberWith(repo, 'translator');
    const [row] = await db().select().from(members).where(eq(members.userId, translator.userId));
    const res = await call('PATCH', `/i18n/repositories/${repo}/members/${row.id}`, owner.headers, {
      role: 'reviewer',
      languages: ['de'],
      writesSource: true,
    });

    expect(res.status).toBe(200);
    expect((await list(repo, owner.headers)).members).toContainEqual(
      expect.objectContaining({ id: row.id, role: 'reviewer', languages: ['de'], writesSource: true }),
    );
  });

  it('keeps the last owner, and lets it go when another member is owner', async () => {
    const repo = await repository();
    const owner = await memberWith(repo, 'owner');
    const admin = await signedInAdmin();
    const [row] = await db().select().from(members).where(eq(members.userId, owner.userId));
    const base = `/i18n/repositories/${repo}/members/${row.id}`;

    expect((await call('PATCH', base, admin.headers, { role: 'translator' })).status).toBe(409);
    expect((await call('DELETE', base, admin.headers)).status).toBe(409);

    await memberWith(repo, 'owner');

    expect((await call('DELETE', base, admin.headers)).status).toBe(200);
    expect(await db().select().from(members).where(eq(members.id, row.id))).toEqual([]);
  });

  it('answers 404 for a member of another repository', async () => {
    const repo = await repository();
    const other = await repository('other');
    const owner = await memberWith(repo, 'owner');
    const elsewhere = await memberWith(other, 'translator');
    const [row] = await db().select().from(members).where(eq(members.userId, elsewhere.userId));

    expect((await call('DELETE', `/i18n/repositories/${repo}/members/${row.id}`, owner.headers)).status).toBe(404);
    expect(await db().select().from(members).where(eq(members.id, row.id))).toHaveLength(1);
  });

  it('changes and cancels an invitation', async () => {
    const repo = await repository();
    const owner = await memberWith(repo, 'owner');

    await call('POST', `/i18n/repositories/${repo}/members`, owner.headers, {
      githubLogin: 'octo-cat',
      role: 'translator',
      languages: [],
      writesSource: false,
    });

    const [invitation] = (await list(repo, owner.headers)).invitations;
    const base = `/i18n/repositories/${repo}/invitations/${invitation.id}`;

    expect((await call('PATCH', base, owner.headers, { role: 'owner', languages: ['en'] })).status).toBe(200);
    expect((await list(repo, owner.headers)).invitations).toEqual([
      expect.objectContaining({ role: 'owner', languages: ['en'] }),
    ]);
    expect((await call('DELETE', base, owner.headers)).status).toBe(200);
    expect((await list(repo, owner.headers)).invitations).toEqual([]);
  });
});

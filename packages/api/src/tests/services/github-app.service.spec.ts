import '../setup-env';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import {
  clearInstallationToken,
  GithubAppNotConfiguredError,
  installations,
  installationToken,
  repositoriesOf,
} from '@/services/github-app.service';

/**
 * The GitHub App of the translations (DB-210).
 *
 * The App is installed on a repository, so adding a translator needs no access
 * to GitHub. What this pins:
 *
 * - a token asks for as little as its caller needs;
 * - it is held until it is about to end;
 * - the installations are discovered, not configured;
 * - an App with no secrets says so.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

const APP = { appId: '123456', privateKey };

/** An answer of GitHub, with the `Link` header its listings carry. */
const page = (body: unknown, next?: string) => ({
  ok: true,
  headers: new Headers(next ? { link: `<${next}>; rel="next", <${next}>; rel="last"` } : {}),
  json: async () => body,
});

/** GitHub, answering the installations of the App and the tokens it mints. */
const github = (options: { expiresAt?: string } = {}) => {
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url);

    if (path.includes('/app/installations?')) {
      return page([
        { id: 42, account: { login: 'acme' } },
        { id: 43, account: { login: 'acme-labs' } },
      ]);
    }

    if (path.includes('/access_tokens')) {
      return page({ token: 'ghs_minted', expires_at: expiresAt });
    }

    if (path.includes('/installation/repositories')) {
      return page({ repositories: [{ name: 'acme-app', owner: { login: 'acme' } }] });
    }

    throw new Error(`the test answers no ${path}`);
  });
};

beforeEach(() => {
  clearInstallationToken();
  Object.assign(env, { I18N_APP: APP });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, { I18N_APP: undefined });
  clearInstallationToken();
});

describe('the installation token', () => {
  /** GitHub refuses a JWT older than ten minutes, and one signed by another key. */
  it('asks as the App, with a JWT its own key signed', async () => {
    const calls = github();

    vi.stubGlobal('fetch', calls);

    expect(await installationToken(42)).toBe('ghs_minted');

    const [path, options] = calls.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];

    expect(path).toContain('/app/installations/42/access_tokens');

    const payload = jwt.verify(options.headers.Authorization.replace('Bearer ', ''), publicKey, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    expect(payload.iss).toBe('123456');
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(10 * 60);
  });

  /**
   * With neither field, GitHub mints a token for everything the installation
   * holds: every repository, and every permission the App was approved for. An
   * App installed on the organisation would give this service a key to all of
   * it.
   */
  it('asks for the repository and the rights the caller named', async () => {
    const calls = github();

    vi.stubGlobal('fetch', calls);

    await installationToken(42, { repository: 'acme-app', permissions: { contents: 'read' } });

    const [, options] = calls.mock.calls[0] as unknown as [string, { body: string }];

    // The name, not `owner/name`: the owner is the one of the installation.
    expect(JSON.parse(options.body)).toEqual({
      repositories: ['acme-app'],
      permissions: { contents: 'read' },
    });
  });

  it('holds the token rather than minting one per read', async () => {
    const calls = github();

    vi.stubGlobal('fetch', calls);

    await installationToken(42, { repository: 'a' });
    await installationToken(42, { repository: 'a' });

    expect(calls.mock.calls).toHaveLength(1);
  });

  /** A token for reading must not be handed to a caller that asked to write. */
  it('does not hand a token of one scope to another', async () => {
    const calls = github();

    vi.stubGlobal('fetch', calls);

    await installationToken(42, { permissions: { contents: 'read' } });
    await installationToken(42, { permissions: { contents: 'write' } });
    await installationToken(43, { permissions: { contents: 'read' } });

    expect(calls.mock.calls).toHaveLength(3);
  });

  /**
   * A request that starts a second before the end finishes after it. The margin
   * is what keeps a read from failing on a token that was valid when it was
   * picked.
   */
  it('throws the token away before it ends, not after', async () => {
    const at = new Date('2026-09-24T12:00:00Z');
    const calls = github({ expiresAt: new Date(at.getTime() + 60 * 60 * 1000).toISOString() });

    vi.stubGlobal('fetch', calls);

    await installationToken(42, {}, { now: at });
    await installationToken(42, {}, { now: new Date(at.getTime() + 50 * 60 * 1000) });

    expect(calls.mock.calls).toHaveLength(1);

    await installationToken(42, {}, { now: new Date(at.getTime() + 58 * 60 * 1000) });

    expect(calls.mock.calls).toHaveLength(2);
  });
});

describe('what the App can reach', () => {
  /** This is how a repository is found rather than typed into a variable. */
  it('names its installations and who holds them', async () => {
    vi.stubGlobal('fetch', github());

    expect(await installations()).toEqual([
      { id: 42, account: 'acme' },
      { id: 43, account: 'acme-labs' },
    ]);
  });

  it('names the repositories of one installation', async () => {
    vi.stubGlobal('fetch', github());

    expect(await repositoriesOf(42)).toEqual([{ owner: 'acme', name: 'acme-app', private: false }]);
  });

  /**
   * One page is a ceiling. Past a hundred, GitHub answers the first hundred
   * and names the next page in its `Link` header. An installation past the
   * hundredth then looks absent, and the App looks uninstalled.
   */
  it('follows the pages of its installations rather than reading the first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url);

        if (path.includes('page=2')) return page([{ id: 44, account: { login: 'third' } }]);
        if (path.includes('/app/installations?')) {
          return page(
            [{ id: 42, account: { login: 'acme' } }],
            'https://api.github.com/app/installations?per_page=100&page=2',
          );
        }

        throw new Error(`the test answers no ${path}`);
      }),
    );

    expect(await installations()).toEqual([
      { id: 42, account: 'acme' },
      { id: 44, account: 'third' },
    ]);
  });

  /** The same ceiling, on the listing that says which repository can be added. */
  it('follows the pages of one installation rather than reading the first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url);

        if (path.includes('/access_tokens')) {
          return page({ token: 'ghs_minted', expires_at: new Date(Date.now() + 3600_000).toISOString() });
        }

        if (path.includes('page=2')) {
          return page({ repositories: [{ name: 'later', owner: { login: 'acme' }, private: true }] });
        }

        if (path.includes('/installation/repositories')) {
          return page(
            { repositories: [{ name: 'acme-app', owner: { login: 'acme' } }] },
            'https://api.github.com/installation/repositories?per_page=100&page=2',
          );
        }

        throw new Error(`the test answers no ${path}`);
      }),
    );

    expect(await repositoriesOf(42)).toEqual([
      { owner: 'acme', name: 'acme-app', private: false },
      // The picker of the page shows a badge for a private repository.
      { owner: 'acme', name: 'later', private: true },
    ]);
  });
});

describe('when the App cannot answer', () => {
  /**
   * A `next` on another host gets our prefix and becomes a path. Every call
   * here talks to one API.
   */
  it('refuses a next page that is not on the API it talks to', async () => {
    let answered = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        answered += 1;

        return answered === 1
          ? page([{ id: 42, account: { login: 'acme' } }], 'https://evil.example.com/app/installations?page=2')
          : page([]);
      }),
    );

    await expect(installations()).rejects.toThrow(/next page outside/);
  });

  /**
   * A `Link` that always names a next page has no end. It fills the heap and
   * stops the process. That is what the reversal of the rule above did,
   * instead of failing a test.
   */
  it('stops on a listing that never ends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        page([{ id: 42, account: { login: 'acme' } }], 'https://api.github.com/app/installations?page=2'),
      ),
    );

    await expect(installations()).rejects.toThrow(/is a loop, not a listing/);
  });

  it('says what is missing rather than failing on an empty header', async () => {
    Object.assign(env, { I18N_APP: undefined });

    await expect(installationToken(42)).rejects.toBeInstanceOf(GithubAppNotConfiguredError);
  });

  it('says which variable holds a private key it cannot use', async () => {
    Object.assign(env, { I18N_APP: { ...APP, privateKey: 'not a key' } });
    vi.stubGlobal('fetch', github());

    await expect(installationToken(42)).rejects.toThrow(/I18N_GITHUB_PRIVATE_KEY/);
  });
});

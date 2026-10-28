import '../setup-env';
import { beforeAll, describe, expect, it } from 'vitest';

let app: (typeof import('../../app'))['default'];

beforeAll(async () => {
  process.env.REDIRECT_HOSTS = 'old.example.test, Older.example.test';
  ({ default: app } = await import('../../app'));
});

describe('an old host of the editor', () => {
  it('answers 301 to the same path and query on BETTER_AUTH_URL', async () => {
    const res = await app.request('/repositories/abc?tab=keys', { headers: { host: 'old.example.test' } });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(new URL('/repositories/abc?tab=keys', process.env.BETTER_AUTH_URL).href);
    expect((await app.request('/api/auth/ok', { headers: { host: 'OLDER.example.test' } })).status).toBe(301);
  });

  it('stays on the host of BETTER_AUTH_URL for a path that starts with //', async () => {
    const res = await app.request('http://old.example.test//evil.example/page', {
      headers: { host: 'old.example.test' },
    });

    expect(res.status).toBe(301);
    expect(new URL(res.headers.get('location')!).host).toBe(new URL(process.env.BETTER_AUTH_URL!).host);
  });

  it('keeps the state and the code of an OAuth callback in the address', async () => {
    const res = await app.request('/api/auth/callback/github?code=abc&state=xyz', {
      headers: { host: 'old.example.test' },
    });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      new URL('/api/auth/callback/github?code=abc&state=xyz', process.env.BETTER_AUTH_URL).href,
    );
  });

  it('serves a POST, such as a webhook delivery, as the host of BETTER_AUTH_URL does', async () => {
    const post = (host: string) =>
      app.request('/api/github/webhook', {
        method: 'POST',
        headers: { host, 'content-type': 'application/json', 'x-github-event': 'ping' },
        body: '{}',
      });
    const onOldHost = await post('old.example.test');
    const onNewHost = await post(new URL(process.env.BETTER_AUTH_URL!).host);

    expect(onOldHost.status).not.toBe(301);
    expect(onOldHost.headers.get('location')).toBeNull();
    expect(onOldHost.status).toBe(onNewHost.status);
  });

  it('serves every other host as before', async () => {
    const res = await app.request('/health', { headers: { host: 'other.example.test' } });

    expect(res.status).toBe(200);
  });
});

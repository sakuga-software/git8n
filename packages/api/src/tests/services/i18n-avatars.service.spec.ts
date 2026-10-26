import { afterEach, describe, expect, it, vi } from 'vitest';
import { installations } from '@/services/github-app.service';
import { avatarsByInstallation, clearAvatarCache } from '@/services/i18n-avatars.service';

vi.mock('@/services/github-app.service', () => ({ installations: vi.fn() }));

const listed = vi.mocked(installations);

afterEach(() => {
  clearAvatarCache();
  listed.mockReset();
});

describe('avatarsByInstallation', () => {
  it('keeps the installations that have a picture', async () => {
    listed.mockResolvedValue([
      { id: 42, account: 'acme', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' },
      { id: 43, account: 'acme-labs', avatarUrl: null },
    ]);

    expect(await avatarsByInstallation()).toEqual(new Map([[42, 'https://avatars.githubusercontent.com/u/42?v=4']]));
  });

  it('asks GitHub once an hour', async () => {
    listed.mockResolvedValue([{ id: 42, account: 'acme', avatarUrl: 'https://example.test/a.png' }]);

    await avatarsByInstallation(0);
    await avatarsByInstallation(59 * 60 * 1000);
    expect(listed).toHaveBeenCalledTimes(1);

    await avatarsByInstallation(61 * 60 * 1000);
    expect(listed).toHaveBeenCalledTimes(2);
  });

  /** A picture is decoration: the list of repositories must not fail for it. */
  it('gives no picture when GitHub fails, and asks again on the next call', async () => {
    listed.mockRejectedValueOnce(new Error('GitHub answered 502'));

    expect(await avatarsByInstallation(0)).toEqual(new Map());

    listed.mockResolvedValue([{ id: 42, account: 'acme', avatarUrl: 'https://example.test/a.png' }]);

    expect(await avatarsByInstallation(1)).toEqual(new Map([[42, 'https://example.test/a.png']]));
  });
});

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

  it('gives the old pictures at once when they expire, and takes the new ones from the next call', async () => {
    listed.mockResolvedValueOnce([{ id: 42, account: 'acme', avatarUrl: 'https://example.test/old.png' }]);
    await avatarsByInstallation(0);

    let answer!: (rows: Awaited<ReturnType<typeof installations>>) => void;

    listed.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

    // GitHub has not answered: an expired cache must not make the call wait.
    expect(await avatarsByInstallation(61 * 60 * 1000, 60 * 1000)).toEqual(
      new Map([[42, 'https://example.test/old.png']]),
    );

    answer([{ id: 42, account: 'acme', avatarUrl: 'https://example.test/new.png' }]);
    await vi.waitFor(async () =>
      expect(await avatarsByInstallation(62 * 60 * 1000)).toEqual(new Map([[42, 'https://example.test/new.png']])),
    );
  });

  /** A picture is decoration: the list of repositories must not wait for it on each call. */
  it('gives no picture for a minute when GitHub fails, then asks again', async () => {
    listed.mockRejectedValueOnce(new Error('GitHub answered 502'));

    expect(await avatarsByInstallation(0)).toEqual(new Map());

    listed.mockResolvedValue([{ id: 42, account: 'acme', avatarUrl: 'https://example.test/a.png' }]);

    expect(await avatarsByInstallation(59 * 1000)).toEqual(new Map());
    expect(listed).toHaveBeenCalledTimes(1);

    // The held failure is old: this call answers it and asks GitHub again in the background.
    expect(await avatarsByInstallation(61 * 1000)).toEqual(new Map());
    expect(listed).toHaveBeenCalledTimes(2);
    await vi.waitFor(async () =>
      expect(await avatarsByInstallation(62 * 1000)).toEqual(new Map([[42, 'https://example.test/a.png']])),
    );
  });

  it('does not wait for a slow GitHub, and keeps its late answer for the next call', async () => {
    let answer!: (rows: Awaited<ReturnType<typeof installations>>) => void;

    listed.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    expect(await avatarsByInstallation(0, 10)).toEqual(new Map());

    answer([{ id: 42, account: 'acme', avatarUrl: 'https://example.test/a.png' }]);
    await vi.waitFor(async () =>
      expect(await avatarsByInstallation(1, 10)).toEqual(new Map([[42, 'https://example.test/a.png']])),
    );
    expect(listed).toHaveBeenCalledTimes(1);
  });
});

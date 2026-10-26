import { installations } from '@/services/github-app.service';
import { createCache } from '@/utils/cache';

/**
 * The picture of the account that holds each installation of the App (DB-617).
 *
 * The header of the editor shows it beside the name of the repository. An
 * installation belongs to one account, and that account owns each repository
 * of the installation, so the picture is the one of the owner.
 */

/** A new picture on GitHub shows after this. */
const CACHE_MS = 60 * 60 * 1000;
/** After a failure, GitHub is asked again after this. */
const FAILURE_MS = 60 * 1000;
/** The list of repositories waits this long for the pictures, and no longer. */
export const WAIT_MS = 2000;

/** One answer for all the installations: GitHub lists them in one call. */
const ALL = 'installations';

const pictures = createCache<{ avatars: Map<number, string>; failed: boolean }>((answer) =>
  answer.failed ? FAILURE_MS : CACHE_MS,
);

/** Empties the cache. The tests call it. */
export const clearAvatarCache = (): void => pictures.clear();

const ask = async (now: number): Promise<Map<number, string>> =>
  (
    await pictures.get(
      ALL,
      () =>
        installations().then(
          (found) => ({
            avatars: new Map(
              found.flatMap((installation) =>
                installation.avatarUrl ? [[installation.id, installation.avatarUrl] as const] : [],
              ),
            ),
            failed: false,
          }),
          () => ({ avatars: new Map<number, string>(), failed: true }),
        ),
      now,
    )
  ).avatars;

/**
 * The picture of each installation, by its id.
 *
 * A picture is decoration, and the list of repositories must not wait for it:
 * - If the held pictures are old, this gives them now and asks GitHub for new
 *   ones in the background.
 * - If GitHub does not answer, or the App is not configured, this gives an empty
 *   map for a minute. The page then shows initials.
 * - If nothing is held yet and GitHub is slower than `waitMs`, this gives an
 *   empty map now. The answer still fills the cache for the next call.
 */
export const avatarsByInstallation = async (now = Date.now(), waitMs = WAIT_MS): Promise<Map<number, string>> => {
  const held = pictures.peek(ALL, now);

  if (held) {
    if (!held.fresh) void ask(now);

    return held.value.avatars;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Map<number, string>>((resolve) => {
    timer = setTimeout(() => resolve(new Map()), waitMs);
  });

  try {
    return await Promise.race([ask(now), late]);
  } finally {
    clearTimeout(timer);
  }
};

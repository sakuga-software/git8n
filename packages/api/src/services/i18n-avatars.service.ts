import { installations } from '@/services/github-app.service';

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

let held: { until: number; avatars: Map<number, string> } | null = null;
let asking: Promise<Map<number, string>> | null = null;

/** Empties the cache. The tests call it. */
export const clearAvatarCache = (): void => {
  held = null;
  asking = null;
};

const ask = (now: number): Promise<Map<number, string>> => {
  asking ??= installations()
    .then((found) => {
      const avatars = new Map(
        found.flatMap((installation) =>
          installation.avatarUrl ? [[installation.id, installation.avatarUrl] as const] : [],
        ),
      );

      held = { until: now + CACHE_MS, avatars };

      return avatars;
    })
    .catch(() => {
      held = { until: now + FAILURE_MS, avatars: new Map() };

      return held.avatars;
    })
    .finally(() => {
      asking = null;
    });

  return asking;
};

/**
 * The picture of each installation, by its id.
 *
 * A picture is decoration, and the list of repositories must not wait for it:
 * - If GitHub does not answer, or the App is not configured, this gives an empty
 *   map for a minute. The page then shows initials.
 * - If GitHub is slower than `waitMs`, this gives an empty map now. The answer
 *   still fills the cache for the next call.
 */
export const avatarsByInstallation = async (now = Date.now(), waitMs = WAIT_MS): Promise<Map<number, string>> => {
  if (held && now < held.until) return held.avatars;

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

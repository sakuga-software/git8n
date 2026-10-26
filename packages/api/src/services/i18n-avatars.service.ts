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

let held: { at: number; avatars: Map<number, string> } | null = null;

/** Empties the cache. The tests call it. */
export const clearAvatarCache = (): void => {
  held = null;
};

/**
 * The picture of each installation, by its id.
 *
 * A picture is decoration. If GitHub does not answer, or the App is not
 * configured, this gives an empty map and the page shows initials. A failure
 * is not held: the next call asks again.
 */
export const avatarsByInstallation = async (now = Date.now()): Promise<Map<number, string>> => {
  if (held && now - held.at < CACHE_MS) return held.avatars;

  try {
    const found = await installations();
    const avatars = new Map(
      found.flatMap((installation) =>
        installation.avatarUrl ? [[installation.id, installation.avatarUrl] as const] : [],
      ),
    );

    held = { at: now, avatars };

    return avatars;
  } catch {
    return new Map();
  }
};

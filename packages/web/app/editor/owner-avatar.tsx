import { useState } from 'react';

/** The first letter of an account, for a picture that GitHub did not give or that does not load. */
export const initialOf = (owner: string): string => owner.trim().charAt(0).toUpperCase() || '?';

/**
 * The picture of the account that owns a repository (DB-617), beside its name.
 *
 * The name is always written beside it, so the picture is decoration: it has
 * no text for a reader of the screen.
 */
export function OwnerAvatar({ owner, src }: { owner: string; src?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = src && failed !== src ? src : null;

  return shown ? (
    <img
      src={shown}
      alt=""
      width={20}
      height={20}
      onError={() => setFailed(shown)}
      className="border-line size-5 shrink-0 rounded-md border object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      className="bg-quiet text-sub border-line inline-flex size-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold"
    >
      {initialOf(owner)}
    </span>
  );
}

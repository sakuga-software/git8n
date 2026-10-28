import type { AccessToken } from '@i18n-editor/mcp/api';

/** The lives that the form offers, in days. `none` makes a token that does not expire. */
export const LIFE_ITEMS = [
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
  { value: '365', label: '1 an' },
  { value: 'none', label: 'Sans expiration' },
] as const;

export const daysOf = (life: string): number | null => (life === 'none' ? null : Number(life));

const dateOf = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** « Créé le 28 oct. 2026 · expire le 27 nov. 2026 · jamais utilisé ». */
export const detailOf = (token: AccessToken, now = new Date()): string => {
  const life =
    token.expiresAt === null
      ? 'sans expiration'
      : new Date(token.expiresAt) <= now
        ? `expiré le ${dateOf(token.expiresAt)}`
        : `expire le ${dateOf(token.expiresAt)}`;
  const use = token.lastUsedAt === null ? 'jamais utilisé' : `utilisé le ${dateOf(token.lastUsedAt)}`;

  return `Créé le ${dateOf(token.createdAt)} · ${life} · ${use}`;
};

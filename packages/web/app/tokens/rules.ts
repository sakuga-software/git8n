import type { AccessToken, TokenScope } from '@git8n/mcp/api';

/** The lives that the form offers, in days. `none` makes a token that does not expire. */
export const LIFE_ITEMS = [
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
  { value: '365', label: '1 an' },
  { value: 'none', label: 'Sans expiration' },
] as const;

/** The scopes that the form offers (G8N-114). The API refuses a call outside the scope of the token. */
export const SCOPE_ITEMS = [
  { value: 'read', label: 'Lecture seule' },
  { value: 'propose', label: 'Proposer' },
  { value: 'full', label: 'Tous les droits du compte' },
] as const satisfies readonly { value: TokenScope; label: string }[];

/** What each scope lets a token do, as the form says it under the choice. */
export const SCOPE_HINTS: Record<TokenScope, string> = {
  read: 'Lit les dépôts, les clés et les propositions. Ne propose rien et ne publie rien.',
  propose: 'Lit, et propose des traductions. Ne publie pas, et ne change ni les membres ni les réglages.',
  full: 'Fait tout ce que votre compte peut faire, publier et gérer les membres compris. Donnez-le seulement à un outil qui en a besoin.',
};

export const scopeLabelOf = (scope: TokenScope): string =>
  SCOPE_ITEMS.find((item) => item.value === scope)?.label ?? scope;

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

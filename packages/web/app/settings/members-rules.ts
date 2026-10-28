import type { MemberRights } from '@git8n/mcp/api';
import type { ChoiceItem } from '~/editor/ui';

/** The roles of a repository, in the words of the page (DB-637). */
export const ROLE_ITEMS: readonly ChoiceItem[] = [
  { value: 'translator', label: 'Traducteur' },
  { value: 'reviewer', label: 'Relecteur' },
  { value: 'owner', label: 'Propriétaire' },
];

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A GitHub login: letters, digits and single hyphens, 39 characters at most. A leading `@` is allowed. */
const LOGIN = /^@?([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})$/;

/** The person that a typed text names: an address, a GitHub login, or nobody. */
export const personOf = (text: string): { email: string } | { githubLogin: string } | null => {
  const typed = text.trim();

  if (ADDRESS.test(typed)) return { email: typed.toLowerCase() };

  const login = typed.match(LOGIN);

  return login ? { githubLogin: login[1] } : null;
};

/** Whether two sets of rights are the same, whatever the order of the languages. */
export const sameRights = (a: MemberRights, b: MemberRights): boolean =>
  a.role === b.role &&
  a.writesSource === b.writesSource &&
  [...a.languages].sort().join(',') === [...b.languages].sort().join(',');

/**
 * The fields of `draft` that differ from `saved`. A save sends these alone, so
 * it does not write back a field that another manager changed in between.
 */
export const rightsChange = (saved: MemberRights, draft: MemberRights): Partial<MemberRights> => ({
  ...(draft.role !== saved.role ? { role: draft.role } : {}),
  ...(draft.writesSource !== saved.writesSource ? { writesSource: draft.writesSource } : {}),
  ...(sameRights({ ...saved, languages: draft.languages }, saved) ? {} : { languages: draft.languages }),
});

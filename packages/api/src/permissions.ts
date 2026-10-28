import { createAccessControl } from 'better-auth/plugins/access';
import type { MemberRole } from '@git8n/db';

/**
 * What each role of a repository may do (DB-637). The better-auth organization
 * plugin holds the roles. The languages stay a check of the editor, which
 * reads `member_languages`.
 */
export const ac = createAccessControl({
  member: ['create', 'update', 'delete'],
  translation: ['propose', 'publish'],
} as const);

export const roles = {
  owner: ac.newRole({ member: ['create', 'update', 'delete'], translation: ['propose', 'publish'] }),
  reviewer: ac.newRole({ translation: ['propose', 'publish'] }),
  translator: ac.newRole({ translation: ['propose'] }),
} satisfies Record<MemberRole, unknown>;

type Statements = Parameters<(typeof roles)['owner']['authorize']>[0];

/** Whether `role` may do what `request` names. A role out of `roles` may do nothing. */
export const roleMay = (role: string, request: Statements): boolean =>
  role in roles && roles[role as MemberRole].authorize(request).success;

import { createAuthClient } from 'better-auth/react';
import { apiUrl } from './env';

/**
 * The client of better-auth, as `apps/app` holds it.
 *
 * The API sits on another origin, so every call carries the cookie. The API
 * accepts this origin only if `KNOWN_HOSTS` names it.
 */
export const authClient = createAuthClient({
  baseURL: `${apiUrl}/api/auth`,
  fetchOptions: { credentials: 'include' },
});

export const { useSession, signIn, signOut } = authClient;

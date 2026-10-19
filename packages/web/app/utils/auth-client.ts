import { createAuthClient } from 'better-auth/react';

/** The API serves `/api/auth` on the origin of the page, so the client needs no address. */
export const authClient = createAuthClient();

export const { useSession, signIn, signOut } = authClient;

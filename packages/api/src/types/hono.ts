import type { AuthUser } from '../auth';

type Variables = {
  user?: AuthUser;
};

type HonoEnv = {
  Variables: Variables;
};

export type { HonoEnv, Variables };

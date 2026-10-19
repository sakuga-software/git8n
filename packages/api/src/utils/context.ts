import { HonoEnv } from '@/types/hono';
import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

const getUser = (c: Context<HonoEnv>) => {
  const user = c.get('user');

  if (!user) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }

  return user;
};

export { getUser };

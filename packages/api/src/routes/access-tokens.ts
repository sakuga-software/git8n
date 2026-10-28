import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { withAuth } from '@/auth';
import { newAccessTokenSchema } from '@/schemas/i18n';
import { createAccessToken, listAccessTokens, revokeAccessToken } from '@/services/access-tokens.service';
import type { HonoEnv } from '@/types/hono';
import { getUser } from '@/utils/context';

const router = new Hono<HonoEnv>();

/**
 * The access tokens of the signed-in account (DB-669).
 *
 * Only the session of the browser manages them. A token or a session token
 * of the command line that makes a new token would stay valid after the
 * person revokes the first one.
 */
router.use('*', withAuth(), async (c, next) => {
  if (getUser(c).via !== 'cookie') {
    throw new HTTPException(403, { message: 'Manage the access tokens on the page of the editor.' });
  }

  await next();
});

router.get('/', async (c) => c.json({ success: true, data: await listAccessTokens(getUser(c).id) }));

router.post('/', async (c) => {
  const { data, error, success } = newAccessTokenSchema.safeParse(await c.req.json().catch(() => undefined));

  if (!success) throw new HTTPException(400, { message: JSON.stringify(error.issues) });

  return c.json({ success: true, data: await createAccessToken(getUser(c).id, data) }, 201);
});

router.delete('/:id', async (c) => {
  if (!(await revokeAccessToken(getUser(c).id, c.req.param('id')))) {
    throw new HTTPException(404, { message: 'This account holds no such token.' });
  }

  return c.json({ success: true, data: null });
});

export default router;

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { logger } from '@/utils/logger';

export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof ZodError) {
    return c.json(
      {
        message: 'Validation error',
        errors: err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
      },
      400,
    );
  }

  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status);
  }

  logger.error('Unhandled error', err);

  return c.json({ message: 'Internal Server Error' }, 500);
};

import { createLogger, format, transports } from 'winston';
import { env } from '../config/env';

export const logger = createLogger({
  level: env.DEV ? 'debug' : 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    env.DEV ? format.combine(format.colorize(), format.simple()) : format.json(),
  ),
  transports: [new transports.Console()],
});

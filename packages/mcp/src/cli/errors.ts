import { ApiError } from '../api.ts';

/** What the exit status of the command line says. */
export const EXIT = {
  ok: 0,
  /** The API refused, or a sign-in did not end. */
  failed: 1,
  /** A command, an option, a configuration or an input is wrong. */
  usage: 2,
  /** No account is signed in, or the API refused the token. */
  signedOut: 3,
} as const;

/**
 * Every error of the command line, with a stable code (DB-671).
 *
 * A script reads the code, never the message: the message can change.
 */
export const ERRORS = {
  I18NE1001: { exit: EXIT.usage, title: 'The command or an option is wrong.' },
  I18NE1002: { exit: EXIT.usage, title: 'No address of the API: pass --api or set I18N_EDITOR_API_URL.' },
  I18NE1003: { exit: EXIT.usage, title: 'The input of apply is not valid.' },
  I18NE1004: { exit: EXIT.usage, title: 'The file of the credentials is not valid.' },
  I18NE2001: { exit: EXIT.signedOut, title: 'No account is signed in, or the API refused the token.' },
  I18NE2002: { exit: EXIT.failed, title: 'The device code expired before somebody approved it.' },
  I18NE2003: { exit: EXIT.failed, title: 'The person refused the device code.' },
  I18NE3001: { exit: EXIT.usage, title: 'No repository matches.' },
  I18NE3002: { exit: EXIT.usage, title: 'The repository is not clear: pass --repo.' },
  I18NE3003: { exit: EXIT.usage, title: 'The language is not clear, or the account cannot open it: pass --lang.' },
  I18NE3004: {
    exit: EXIT.failed,
    title: 'A key is not a key of the source, or its file has no version in the language.',
  },
  I18NE4001: { exit: EXIT.failed, title: 'The API refused the request.' },
  I18NE4002: { exit: EXIT.failed, title: 'The API failed, or did not answer.' },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly exit: number;
  /** More lines for a person: the repositories to choose from, the keys that are not there. */
  readonly details: string[];

  constructor(code: ErrorCode, message: string, details: string[] = []) {
    super(message);

    this.name = 'CliError';
    this.code = code;
    this.exit = ERRORS[code].exit;
    this.details = details;
  }
}

/** The message of the API, without the JSON envelope it comes in. */
const messageOf = (said: string): string => {
  try {
    const parsed = JSON.parse(said) as { message?: unknown };

    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // The API answered text, not JSON.
  }

  return said;
};

/** Any failure of a command, as a `CliError`. */
export const asCliError = (error: unknown): CliError => {
  if (error instanceof CliError) return error;

  if (error instanceof ApiError) {
    const message = `${error.status} — ${messageOf(error.message)}`;

    if (error.status === 401) return new CliError('I18NE2001', `${message}. Run i18n-editor login.`);

    return new CliError(error.status < 500 ? 'I18NE4001' : 'I18NE4002', message);
  }

  if (error instanceof Error) {
    // `fetch` says only « fetch failed ». The cause names the network error, for example ECONNREFUSED.
    const cause =
      error.cause instanceof Error ? `: ${(error.cause as Error & { code?: string }).code ?? error.cause.message}` : '';

    return new CliError('I18NE4002', `${error.message}${cause}`);
  }

  return new CliError('I18NE4002', String(error));
};

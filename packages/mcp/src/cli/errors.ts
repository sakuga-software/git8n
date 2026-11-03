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
  G8N1001: {
    exit: EXIT.usage,
    title: 'The command or an option is wrong.',
    fix: 'Read the message: it names the option. Run `git8n --help` for the commands and their options.',
  },
  G8N1002: {
    exit: EXIT.usage,
    title: 'No address of the API: pass --api or set GIT8N_API_URL.',
    fix: 'Run `git8n login --api <url>` one time: the address becomes the default. In CI, set `GIT8N_API_URL`.',
  },
  G8N1003: {
    exit: EXIT.usage,
    title: 'The input of apply is not valid.',
    fix: 'Give `apply` a JSON object of texts by key: `{ "common:hello.title": "Hello" }`, or nested by file. With `--file <name>`, the keys of that file only.',
  },
  G8N1004: {
    exit: EXIT.usage,
    title: 'The file of the credentials is not valid.',
    fix: 'Delete `~/.config/git8n/credentials.json`, then run `git8n login` again.',
  },
  G8N1005: {
    exit: EXIT.usage,
    title: 'check cannot find the locales, the manifest or the source language.',
    fix: 'Pass `--locales <folder>`, and `--source <language>` if the manifest names no `source`. The message names what is missing.',
  },
  G8N2001: {
    exit: EXIT.signedOut,
    title: 'No account is signed in, or the API refused the token.',
    fix: 'Run `git8n login`. In CI, set `GIT8N_API_TOKEN` to an access token that is not revoked or expired.',
  },
  G8N2002: {
    exit: EXIT.failed,
    title: 'The device code expired before somebody approved it.',
    fix: 'Run `git8n login` again, and approve the code in the browser before it expires.',
  },
  G8N2003: {
    exit: EXIT.failed,
    title: 'The person refused the device code.',
    fix: 'Run `git8n login` again, and choose « Approuver » if the code is the one of the terminal.',
  },
  G8N3001: {
    exit: EXIT.usage,
    title: 'No repository matches.',
    fix: 'Run `git8n whoami` to see the repositories that the account opens, then pass one with `--repo <owner/name>`.',
  },
  G8N3002: {
    exit: EXIT.usage,
    title: 'The repository is not clear: pass --repo.',
    fix: 'Pass `--repo <owner/name>`, or set `GIT8N_REPO`. The message lists the choices.',
  },
  G8N3003: {
    exit: EXIT.usage,
    title: 'The language is not clear, or the account cannot open it: pass --lang.',
    fix: 'Pass `--lang <language>`. If the account cannot open the language, ask an owner of the repository for it.',
  },
  G8N3004: {
    exit: EXIT.failed,
    title: 'A key is not a key of the source, or its file has no version in the language.',
    fix: 'Check the key with `git8n search` or `git8n keys`: a key is `<file>:<key>`, as in the source.',
  },
  G8N4001: {
    exit: EXIT.failed,
    title: 'The API refused the request.',
    fix: 'Read the message of the API: it tells what it refused, for example a right that the account does not have.',
  },
  G8N4002: {
    exit: EXIT.failed,
    title: 'The API failed, or did not answer.',
    fix: 'Check the address of the API and the network, then try again. If it continues, tell the operator of the editor.',
  },
} as const satisfies Record<string, { exit: number; title: string; fix: string }>;

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

    if (error.status === 401) return new CliError('G8N2001', `${message}. Run git8n login.`);

    return new CliError(error.status < 500 ? 'G8N4001' : 'G8N4002', message);
  }

  if (error instanceof Error) {
    // `fetch` says only « fetch failed ». The cause names the network error, for example ECONNREFUSED.
    const cause =
      error.cause instanceof Error ? `: ${(error.cause as Error & { code?: string }).code ?? error.cause.message}` : '';

    return new CliError('G8N4002', `${error.message}${cause}`);
  }

  return new CliError('G8N4002', String(error));
};

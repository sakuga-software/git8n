import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8001),
  DATABASE_URL: z.string().optional(),
  DATABASE_TLS: z.stringbool().default(false),
  /** The address of the editor, where the browser reaches `/api/auth`. GitHub sends the browser back to it. */
  BETTER_AUTH_URL: z.url().default('http://localhost:5173'),
  /** The key that signs the session cookies and encrypts the GitHub tokens. */
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  /** The client of the GitHub App, for the sign-in. `I18N_GITHUB_APP_ID` is the same App, for the repositories. */
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  /** The addresses of the admins, separated by commas. Case does not count. */
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform(
      (value) =>
        new Set(
          value
            .split(',')
            .map((address) => address.trim().toLowerCase())
            .filter(Boolean),
        ),
    ),
  /**
   * The domain of the address that a commit gives to its author. The default
   * is reserved by RFC 2606, so no mailbox and no GitHub account has it.
   */
  COMMIT_EMAIL_DOMAIN: z.string().min(1).default('users.noreply.invalid'),
  /** The folder of the built web application. The API serves it when it is set. */
  WEB_ROOT: z.string().optional(),
  /** The name of the GitHub App in its address, `github.com/apps/<slug>`. The page links to its installation. */
  GITHUB_APP_SLUG: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'A slug is the name of the App in its address, such as i18n-editor')
    .default('i18n-editor'),
  /**
   * The SMTP server that sends the magic links (DB-645), as a URL:
   * `smtps://user:password@smtp.example.com:465`. Without it, the API sends no
   * mail. Outside production, it writes the link in its log.
   */
  SMTP_URL: z.string().optional(),
  /** The sender of the mails. The default uses the host of `BETTER_AUTH_URL`. */
  MAIL_FROM: z.string().optional(),
  /**
   * The secret of the webhook of the GitHub App (DB-651). Without it, the API
   * takes no event, and a change made on GitHub shows after the cache time.
   */
  GITHUB_WEBHOOK_SECRET: z.string().min(16).optional(),
  I18N_GITHUB_APP_ID: z.string().optional(),
  I18N_GITHUB_PRIVATE_KEY: z.string().optional(),
});

/**
 * The GitHub App of the translations, or nothing when its secrets are absent.
 *
 * **Two values, and both are secrets.** Everything else a repository needs —
 * the branch, the path of the locales, the languages — belongs to that
 * repository and lives in `i18n_repositories`. A private key belongs in
 * neither a table nor a repository, so these two stay here.
 */
export function i18nAppConfig(data: { I18N_GITHUB_APP_ID?: string; I18N_GITHUB_PRIVATE_KEY?: string }) {
  if (!data.I18N_GITHUB_APP_ID || !data.I18N_GITHUB_PRIVATE_KEY) return undefined;

  return {
    appId: data.I18N_GITHUB_APP_ID,
    // A PEM carries newlines, which an environment variable rarely does. Both
    // spellings are accepted rather than making the deployment choose right.
    privateKey: data.I18N_GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

/** The client of the sign-in, or nothing when one of its two values is absent. */
export function githubSignIn(data: { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string }) {
  if (!data.GITHUB_CLIENT_ID || !data.GITHUB_CLIENT_SECRET) return undefined;

  return { clientId: data.GITHUB_CLIENT_ID, clientSecret: data.GITHUB_CLIENT_SECRET };
}

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === 'production' && !parsed.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is missing');
}

export const env = {
  ...parsed,
  // Outside production, a fixed key keeps the sessions across a restart of `pnpm dev`.
  BETTER_AUTH_SECRET: parsed.BETTER_AUTH_SECRET ?? 'a-key-for-development-only-never-for-production',
  GITHUB: githubSignIn(parsed),
  DEV: parsed.NODE_ENV !== 'production',
  I18N_APP: i18nAppConfig(parsed),
  MAIL_FROM: parsed.MAIL_FROM ?? `Traductions <no-reply@${new URL(parsed.BETTER_AUTH_URL).hostname}>`,
};

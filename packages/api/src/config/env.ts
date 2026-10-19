import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8001),
  DATABASE_URL: z.string().optional(),
  DATABASE_TLS: z.stringbool().default(false),
  /** The origins that the browser may call the API from, separated by commas. */
  KNOWN_HOSTS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
    ),
  /**
   * The domain of the address that a commit gives to its author. The default
   * is reserved by RFC 2606, so no mailbox and no GitHub account has it.
   */
  COMMIT_EMAIL_DOMAIN: z.string().min(1).default('users.noreply.invalid'),
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

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  DEV: parsed.NODE_ENV !== 'production',
  I18N_APP: i18nAppConfig(parsed),
};

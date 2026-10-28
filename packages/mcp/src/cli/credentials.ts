import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CliError } from './errors.ts';

/**
 * The tokens of `i18n-editor login`, one for each address of the API.
 *
 * It is a file of this computer, readable by its owner only, and never a row of the database.
 */
export interface Credentials {
  /** The address that a command uses when nothing else names one. */
  default?: string;
  servers: Record<string, { token: string; name?: string; email?: string }>;
}

export const credentialsPath = (env: Record<string, string | undefined>, home: string): string =>
  join(env.XDG_CONFIG_HOME || join(home, '.config'), 'i18n-editor', 'credentials.json');

export const readCredentials = async (path: string): Promise<Credentials> => {
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { servers: {} };

    // A file that exists and cannot be read must stop the command. Else `login` writes it again,
    // and the tokens of the other addresses are lost.
    throw new CliError('I18NE1004', `${path} cannot be read: ${(error as Error).message}`);
  }

  try {
    const parsed = JSON.parse(text) as Credentials;

    if (typeof parsed !== 'object' || parsed === null || typeof parsed.servers !== 'object') throw new Error();

    return parsed;
  } catch {
    throw new CliError('I18NE1004', `${path} is not valid. Delete it, then run i18n-editor login again.`);
  }
};

export const writeCredentials = async (path: string, credentials: Credentials): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  // The token must never be readable by another account, also for a short time.
  const next = `${path}.${process.pid}.tmp`;

  await writeFile(next, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(next, 0o600);
  await rename(next, path);
};

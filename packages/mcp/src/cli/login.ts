import { CliError } from './errors.ts';

/** The `client_id` that the API accepts for a device code (`CLI_CLIENT_ID` of the API). */
export const CLIENT_ID = 'i18n-editor-cli';

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface LoginIo {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const post = (io: LoginIo, url: string, body: unknown) =>
  io.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30 * 1000),
  });

export const askDeviceCode = async (io: LoginIo, api: string): Promise<DeviceCode> => {
  const response = await post(io, `${api}/api/auth/device/code`, { client_id: CLIENT_ID });

  if (!response.ok) {
    throw new CliError(
      response.status < 500 ? 'I18NE4001' : 'I18NE4002',
      `${response.status} — the API gave no device code: ${await response.text().catch(() => '')}`,
    );
  }

  return (await response.json()) as DeviceCode;
};

/**
 * Polls the API until the person approves the code (RFC 8628, section 3.4).
 *
 * The answer is a session token of the person who approved the code.
 */
export const waitForApproval = async (io: LoginIo, api: string, code: DeviceCode): Promise<string> => {
  const deadline = io.now() + code.expires_in * 1000;
  let interval = Math.max(code.interval, 1) * 1000;

  for (;;) {
    if (io.now() >= deadline) throw new CliError('I18NE2002', 'The code expired. Run i18n-editor login again.');

    await io.sleep(interval);

    const response = await post(io, `${api}/api/auth/device/token`, {
      grant_type: GRANT,
      device_code: code.device_code,
      client_id: CLIENT_ID,
    });
    const answered = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };

    if (response.ok && answered.access_token) return answered.access_token;

    switch (answered.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += 5000;
        continue;
      case 'expired_token':
        throw new CliError('I18NE2002', 'The code expired. Run i18n-editor login again.');
      case 'access_denied':
        throw new CliError('I18NE2003', 'The code was refused in the editor.');
      default:
        throw new CliError(
          response.status < 500 ? 'I18NE4001' : 'I18NE4002',
          `${response.status} — the API refused the device code: ${answered.error ?? 'no reason'}`,
        );
    }
  }
};

/** The person of a session token, or null for an access token or a token that the API refuses. */
export const personOf = async (
  io: Pick<LoginIo, 'fetch'>,
  api: string,
  token: string,
): Promise<{ name: string; email: string } | null> => {
  const response = await io
    .fetch(`${api}/api/auth/get-session`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30 * 1000),
    })
    .catch(() => null);

  if (!response?.ok) return null;

  const session = (await response.json().catch(() => null)) as { user?: { name: string; email: string } } | null;

  return session?.user ? { name: session.user.name, email: session.user.email } : null;
};

/** Ends the session of a token on the API. False when the API did not end it. */
export const signOut = async (io: Pick<LoginIo, 'fetch'>, api: string, token: string): Promise<boolean> => {
  const response = await io
    .fetch(`${api}/api/auth/sign-out`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(30 * 1000),
    })
    .catch(() => null);

  return response?.ok ?? false;
};

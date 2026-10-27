import { Button } from '@heroui/react/button';
import { useState } from 'react';
import { signIn } from '~/utils/auth-client';
import { Alert, Github } from './icons';

/** better-auth sends the browser back here with `?error=` when GitHub refuses or fails. */
const SIGN_IN_ERROR = 'error';

/**
 * The sign-in of the editor, with GitHub only (DB-570).
 *
 * A sign-in grants no language. An account opens the table only if it
 * administers, or if it is a member of a repository (DB-637).
 */
export function SignIn() {
  const [error, setError] = useState<string | null>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(SIGN_IN_ERROR)
      ? "GitHub n'a pas ouvert de session. Réessayez dans un instant."
      : null,
  );
  const [busy, setBusy] = useState(false);

  const withGithub = async () => {
    setError(null);
    setBusy(true);

    const back = new URL(window.location.href);

    back.searchParams.delete(SIGN_IN_ERROR);

    const answer = await signIn.social({
      provider: 'github',
      callbackURL: back.href,
      errorCallbackURL: `${back.origin}${back.pathname}?${SIGN_IN_ERROR}=github`,
    });

    if (answer.error) {
      setBusy(false);
      setError('La connexion avec GitHub a échoué. Réessayez dans un instant.');
    }
  };

  return (
    <div className="bg-panel flex min-h-screen items-start justify-center px-4 py-24">
      <main className="border-line flex w-full max-w-[400px] flex-col gap-6 rounded-xl border bg-white px-8 pt-9 pb-8">
        <div className="flex flex-col gap-1.5">
          <span className="text-muted font-mono text-xs">i18n-editor</span>
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Traductions</h1>
          <p className="text-sub text-sm leading-normal">
            Les textes de l'application, du français vers les autres langues.
          </p>
        </div>

        <Button onPress={withGithub} isDisabled={busy} fullWidth className="h-11 text-[15px]">
          <Github size={18} />
          {busy ? 'Ouverture de GitHub…' : 'Se connecter avec GitHub'}
        </Button>

        {error && (
          <div
            role="alert"
            className="border-alarm-line bg-alarm text-alarm-ink flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] leading-normal"
          >
            <Alert size={16} className="mt-px" />
            <span>{error}</span>
          </div>
        )}
      </main>
    </div>
  );
}

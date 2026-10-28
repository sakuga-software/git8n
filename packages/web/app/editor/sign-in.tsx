import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import { useState } from 'react';
import { signIn } from '~/utils/auth-client';
import { Alert, Github } from './icons';

/** better-auth sends the browser back here with `?error=` when GitHub refuses or fails, or a link is spent. */
const SIGN_IN_ERROR = 'error';

/** The value of `?error=` that the page sets for a magic link, to tell it from a failure of GitHub. */
const LINK_ERROR = 'link';

const errorOf = (search: URLSearchParams): string | null => {
  if (!search.has(SIGN_IN_ERROR)) return null;

  return search.get(SIGN_IN_ERROR) === LINK_ERROR
    ? 'Ce lien de connexion a expiré ou a déjà servi. Demandez-en un autre.'
    : "GitHub n'a pas ouvert de session. Réessayez dans un instant.";
};

/**
 * The sign-in of the editor: with GitHub, or with a magic link sent to an
 * invited address (DB-570, DB-645).
 *
 * A sign-in grants no language. An account opens the table only if it
 * administers, or if it is a member of a repository (DB-637).
 */
export function SignIn() {
  const [error, setError] = useState<string | null>(() =>
    typeof window !== 'undefined' ? errorOf(new URLSearchParams(window.location.search)) : null,
  );
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const withLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSending(true);

    const back = new URL(window.location.href);

    back.searchParams.delete(SIGN_IN_ERROR);

    const answer = await signIn.magicLink({
      email: email.trim(),
      callbackURL: back.href,
      errorCallbackURL: `${back.origin}${back.pathname}?${SIGN_IN_ERROR}=${LINK_ERROR}`,
    });

    setSending(false);

    if (answer.error) {
      setError(
        answer.error.status === 429
          ? 'Trop de demandes de lien. Réessayez dans une minute.'
          : "Le lien n'a pas pu être demandé. Vérifiez l'adresse, puis réessayez.",
      );
    } else {
      setSentTo(email.trim());
    }
  };

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
          <span className="text-muted font-mono text-xs">git8n</span>
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Traductions</h1>
          <p className="text-sub text-sm leading-normal">
            Les textes de l'application, du français vers les autres langues.
          </p>
        </div>

        <Button onPress={withGithub} isDisabled={busy} fullWidth className="h-11 text-[15px]">
          <Github size={18} />
          {busy ? 'Ouverture de GitHub…' : 'Se connecter avec GitHub'}
        </Button>

        <div className="text-muted flex items-center gap-3 text-xs" aria-hidden="true">
          <span className="bg-line h-px flex-1" />
          ou
          <span className="bg-line h-px flex-1" />
        </div>

        {sentTo ? (
          <div role="status" className="flex flex-col gap-2 text-sm leading-normal">
            <p>
              Si <span className="font-medium">{sentTo}</span> est invitée sur un dépôt, un lien de connexion vient de
              partir. Il sert une seule fois et expire dans 5 minutes.
            </p>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="text-signal cursor-pointer self-start text-[13px] hover:underline"
            >
              Utiliser une autre adresse
            </button>
          </div>
        ) : (
          <form onSubmit={withLink} className="flex flex-col gap-2">
            <label htmlFor="sign-in-email" className="text-muted text-xs font-medium">
              Invité sans compte GitHub ? Recevez un lien par email
            </label>
            <Input
              id="sign-in-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vous@exemple.fr"
              className="h-10 text-sm"
            />
            <Button type="submit" variant="secondary" isDisabled={sending || email.trim() === ''} fullWidth>
              {sending ? 'Envoi du lien…' : 'Recevoir un lien de connexion'}
            </Button>
          </form>
        )}

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

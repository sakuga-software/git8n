import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import { useState } from 'react';
import { signIn } from '~/utils/auth-client';
import { Alert, Github } from './icons';
import { refusalOf } from './refusal';

/**
 * The sign-in of the editor (DB-218).
 *
 * A sign-in grants no language. An account opens the table only if it
 * administers, or if a row of `i18n_translators` names it.
 */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const withGithub = async () => {
    setError(null);

    const answer = await signIn.social({ provider: 'github', callbackURL: window.location.href });

    if (answer.error) setError("La connexion avec GitHub a échoué. Réessayez, ou passez par l'adresse e-mail.");
  };

  const withPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const answer = await signIn.email({ email, password });

    setBusy(false);

    if (answer.error) setError(refusalOf(answer.error, 'La connexion a échoué. Réessayez dans un instant.'));
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

        <Button onPress={withGithub} fullWidth className="h-11 text-[15px]">
          <Github size={18} />
          Se connecter avec GitHub
        </Button>

        <div className="text-muted flex items-center gap-3 text-xs">
          <span className="bg-line h-px flex-1" />
          ou avec une adresse e-mail
          <span className="bg-line h-px flex-1" />
        </div>

        <form onSubmit={withPassword} className="flex flex-col gap-3.5">
          <label className="text-sub flex flex-col gap-1.5 text-[13px] font-medium">
            Adresse e-mail
            <Input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10"
            />
          </label>
          <label className="text-sub flex flex-col gap-1.5 text-[13px] font-medium">
            Mot de passe
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10"
            />
          </label>

          {error && (
            <div
              role="alert"
              className="border-alarm-line bg-alarm text-alarm-ink flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] leading-normal"
            >
              <Alert size={16} className="mt-px" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" variant="outline" isDisabled={busy} fullWidth className="mt-1 h-10">
            {busy ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>
      </main>
    </div>
  );
}

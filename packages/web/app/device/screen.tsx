import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authClient } from '~/utils/auth-client';
import { Signed } from '~/editor/shell';
import { Busy } from '~/editor/ui';
import { normalCode, shownCode, stateOf, type DeviceAnswer, type DeviceState } from './rules';

/**
 * The approval of the code that `i18n-editor login` shows (DB-669).
 *
 * The terminal opens this page with `?user_code=`. The person signs in if
 * needed, compares the code with the one of the terminal, then approves it.
 */
export default function DeviceScreen() {
  return <Signed>{({ account }) => <Device account={account} />}</Signed>;
}

type Phase = { kind: 'reading' } | DeviceState | { kind: 'done'; approved: boolean } | { kind: 'failed' };

function Device({ account }: { account: string }) {
  const [search, setSearch] = useSearchParams();
  const code = normalCode(search.get('user_code') ?? '');
  const [phase, setPhase] = useState<Phase>({ kind: code ? 'reading' : 'ask' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setPhase({ kind: 'ask' });
      return;
    }

    let current = true;

    setPhase({ kind: 'reading' });
    void authClient.$fetch<DeviceAnswer>('/device', { method: 'GET', query: { user_code: code } }).then(({ data }) => {
      if (current) setPhase(stateOf(data ?? null));
    });

    return () => {
      current = false;
    };
  }, [code]);

  const answer = async (approve: boolean) => {
    setBusy(true);

    const { error } = await authClient.$fetch(approve ? '/device/approve' : '/device/deny', {
      method: 'POST',
      body: { userCode: code },
    });

    setBusy(false);
    setPhase(error ? { kind: 'failed' } : { kind: 'done', approved: approve });
  };

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6 pt-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Connecter un terminal</h1>
        <p className="text-sub text-sm leading-normal">
          La commande <code className="font-mono text-[13px]">i18n-editor login</code> affiche un code. Ce code relie le
          terminal à votre compte.
        </p>
      </div>

      {phase.kind === 'ask' && <AskCode onCode={(typed) => setSearch({ user_code: normalCode(typed) })} />}

      {phase.kind === 'reading' && (
        <p className="text-sub flex items-center gap-2 text-sm">
          <Busy />
          Lecture du code…
        </p>
      )}

      {phase.kind === 'review' && (
        <div className="border-line flex flex-col gap-4 rounded-lg border bg-white p-5">
          <p className="text-center font-mono text-[28px] font-semibold tracking-[0.12em]" aria-label="Code">
            {shownCode(code)}
          </p>
          <p className="text-sm leading-normal">
            Un terminal demande à agir en votre nom, <strong className="font-semibold">{account}</strong>. Il aura les
            mêmes droits que votre compte : dépôts, langues et rôle.
          </p>
          <p className="text-sub text-[13px] leading-normal">
            Approuvez seulement si vous venez de lancer la commande, et si ce code est celui de votre terminal.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button isDisabled={busy} onPress={() => void answer(true)}>
              {busy ? <Busy /> : null}
              Approuver
            </Button>
            <Button variant="ghost" isDisabled={busy} onPress={() => void answer(false)}>
              Refuser
            </Button>
          </div>
        </div>
      )}

      {phase.kind === 'done' && (
        <Outcome>
          {phase.approved
            ? 'Terminal connecté. Revenez au terminal : la connexion se termine toute seule.'
            : "Demande refusée. Le terminal n'a reçu aucun accès."}
        </Outcome>
      )}
      {phase.kind === 'approved' && <Outcome>Ce code est déjà approuvé.</Outcome>}
      {phase.kind === 'denied' && (
        <Outcome>Ce code a été refusé. Relancez la commande pour en obtenir un autre.</Outcome>
      )}
      {phase.kind === 'elsewhere' && (
        <Outcome>Un autre compte a déjà ouvert ce code. Relancez la commande pour en obtenir un autre.</Outcome>
      )}
      {(phase.kind === 'unknown' || phase.kind === 'failed') && (
        <Outcome>
          Ce code n'existe pas ou a expiré. Relancez <code className="font-mono">i18n-editor login</code> pour en
          obtenir un autre.
        </Outcome>
      )}

      <Link to="/" viewTransition className="text-sub text-[13px] underline">
        Revenir aux traductions
      </Link>
    </div>
  );
}

function Outcome({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="bg-panel rounded-lg p-4 text-sm leading-normal">
      {children}
    </p>
  );
}

function AskCode({ onCode }: { onCode: (code: string) => void }) {
  const [typed, setTyped] = useState('');

  return (
    <form
      aria-label="Saisir le code"
      className="bg-panel flex flex-wrap items-end gap-3 rounded-lg p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (normalCode(typed)) onCode(typed);
      }}
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <label htmlFor="device-code" className="text-muted text-xs font-medium">
          Code affiché dans le terminal
        </label>
        <Input
          id="device-code"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="ABCD-1234"
          autoCapitalize="characters"
          spellCheck={false}
          className="h-9 bg-white font-mono text-[13px]"
        />
      </div>
      <Button type="submit" isDisabled={normalCode(typed) === ''}>
        Continuer
      </Button>
    </form>
  );
}

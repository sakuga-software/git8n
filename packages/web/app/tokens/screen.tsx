import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import {
  accessTokens as readAccessTokens,
  createAccessToken,
  revokeAccessToken,
  type AccessToken,
} from '@i18n-editor/mcp/api';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '~/utils/api';
import { Copy } from '~/editor/icons';
import { Signed } from '~/editor/shell';
import { MembersSkeleton } from '~/editor/skeleton';
import { Failure } from '~/editor/states';
import { Busy, Choice } from '~/editor/ui';
import { readErrorOf, useRead, type ReadError } from '~/editor/use-read';
import { daysOf, detailOf, LIFE_ITEMS } from './rules';

/** The access tokens of the signed-in account, for an agent or a CI job (DB-669). */
export default function TokensScreen() {
  return <Signed>{() => <Tokens />}</Signed>;
}

function Tokens() {
  const [list, reload] = useRead('tokens', () => readAccessTokens(api));

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Jetons d'accès</h1>
          <p className="text-sub max-w-2xl text-sm leading-normal">
            Un jeton permet à un agent (serveur MCP) ou à un job de CI d'agir en votre nom : il ouvre les mêmes dépôts,
            les mêmes langues et le même rôle que votre compte. Il ne peut pas créer d'autre jeton.
          </p>
        </div>
        <Link to="/" viewTransition className="text-sub text-[13px] underline">
          Revenir aux traductions
        </Link>
      </div>

      <NewToken onCreated={reload} />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Vos jetons{list.state === 'done' ? ` · ${list.value.length}` : ''}</h2>
        {list.state === 'loading' ? (
          <MembersSkeleton />
        ) : list.state === 'failed' ? (
          <Failure title="Les jetons n'ont pas pu être lus." error={list.error} onRetry={reload} />
        ) : list.value.length === 0 ? (
          <p className="text-muted text-[13px]">Aucun jeton.</p>
        ) : (
          <ul className="border-line divide-line-soft flex flex-col divide-y rounded-lg border">
            {list.value.map((token) => (
              <TokenRow key={token.id} token={token} onRevoked={reload} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NewToken({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [life, setLife] = useState<string>('90');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReadError | null>(null);
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();

    if (name.trim() === '') return;

    setBusy(true);
    setError(null);

    try {
      const created = await createAccessToken(api, { name: name.trim(), expiresInDays: daysOf(life) });

      setMade({ name: created.name, token: created.token });
      setName('');
      onCreated();
    } catch (failure) {
      setError(readErrorOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={create} aria-label="Créer un jeton" className="bg-panel flex flex-col gap-4 rounded-lg p-4">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div className="flex min-w-60 flex-1 flex-col gap-1.5">
            <label htmlFor="token-name" className="text-muted text-xs font-medium">
              Nom, pour le reconnaître plus tard
            </label>
            <Input
              id="token-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Agent de traduction, CI…"
              maxLength={80}
              className="h-9 bg-white text-[13px]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted text-xs font-medium" aria-hidden="true">
              Durée
            </span>
            <Choice label="Durée" value={life} items={LIFE_ITEMS} onChange={setLife} className="w-44" />
          </div>
          <Button type="submit" isDisabled={busy || name.trim() === ''}>
            {busy ? (
              <>
                <Busy />
                Création…
              </>
            ) : (
              'Créer le jeton'
            )}
          </Button>
        </div>
        {error && <Failure title="Le jeton n'a pas été créé." error={error} written />}
      </form>

      {made && <MadeToken name={made.name} token={made.token} onClose={() => setMade(null)} />}
    </div>
  );
}

/** The new token, shown this one time. The editor keeps only its hash. */
function MadeToken({ name, token, onClose }: { name: string; token: string; onClose: () => void }) {
  const [copied, setCopied] = useState<'done' | 'refused' | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied('done');
    } catch {
      setCopied('refused');
    }
  };

  return (
    <div role="status" className="border-line flex flex-col gap-3 rounded-lg border bg-white p-4">
      <p className="text-sm leading-normal">
        <strong className="font-semibold">Jeton « {name} » créé.</strong> Copiez-le maintenant : il ne sera plus
        affiché.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          aria-label="Nouveau jeton"
          className="bg-panel min-w-0 flex-1 rounded-[5px] px-2.5 py-2 font-mono text-[12.5px] break-all select-all"
        >
          {token}
        </code>
        <Button size="sm" variant="ghost" onPress={() => void copy()}>
          <Copy size={14} />
          {copied === 'done' ? 'Copié' : 'Copier'}
        </Button>
        <Button size="sm" variant="ghost" onPress={onClose}>
          J'ai copié le jeton
        </Button>
      </div>
      {copied === 'refused' && (
        <p role="alert" className="text-alarm-strong text-[13px]">
          Le navigateur a refusé la copie. Sélectionnez le jeton, puis copiez-le à la main.
        </p>
      )}
    </div>
  );
}

function TokenRow({ token, onRevoked }: { token: AccessToken; onRevoked: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReadError | null>(null);

  const revoke = async () => {
    setBusy(true);
    setError(null);

    try {
      await revokeAccessToken(api, token.id);
      onRevoked();
    } catch (failure) {
      setError(readErrorOf(failure));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <li aria-label={token.name} className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {token.name} <span className="text-muted font-mono text-xs font-normal">{token.start}…</span>
          </span>
          <span className="text-muted truncate text-xs">{detailOf(token)}</span>
        </div>
        <div className="flex items-center gap-2">
          {confirming ? (
            <>
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setConfirming(false)}>
                Garder
              </Button>
              <Button size="sm" variant="danger" isDisabled={busy} onPress={revoke}>
                {busy ? <Busy /> : null}
                Confirmer la révocation
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onPress={() => setConfirming(true)}>
              Révoquer
            </Button>
          )}
        </div>
      </div>
      {error && <Failure title="Le jeton n'a pas été révoqué." error={error} written />}
    </li>
  );
}

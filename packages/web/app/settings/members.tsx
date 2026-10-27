import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import {
  addMember,
  changeInvitation,
  changeMember,
  readMembers,
  removeInvitation,
  removeMember,
  sendInvitationLink,
  type AddedMember,
  type Invitation,
  type Member,
  type MemberRights,
  type Repository,
} from '@i18n-editor/mcp/api';
import { useState } from 'react';
import { api } from '~/utils/api';
import { Failure, Loading } from '~/editor/states';
import { Busy, Choice, Tick } from '~/editor/ui';
import { readErrorOf, useRead, type ReadError } from '~/editor/use-read';
import { personOf, rightsChange, ROLE_ITEMS, sameRights } from './members-rules';

/**
 * The members of a repository and the invitations that wait (DB-637).
 *
 * An admin or an owner of the repository opens it. Each change is sent at
 * once, apart from the form of the settings.
 */
export function MembersPanel({ repository }: { repository: Repository }) {
  const [list, reload] = useRead(`members\n${repository.id}`, () => readMembers(api, repository.id));

  if (list.state === 'loading') return <Loading>Lecture des membres…</Loading>;
  if (list.state === 'failed') {
    return <Failure title="Les membres n'ont pas pu être lus." error={list.error} onRetry={reload} />;
  }

  const { members, invitations } = list.value;

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sub -mt-2 text-[13px] leading-normal">
        Un traducteur propose dans ses langues, un relecteur les publie aussi, et un propriétaire gère en plus les
        membres. « Source » donne le droit d'écrire le français.
      </p>

      <AddPerson repository={repository} onAdded={reload} />

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Membres · {members.length}</h3>
        {members.length === 0 ? (
          <p className="text-muted text-[13px]">Aucun membre. Un admin lit le dépôt sans en être membre.</p>
        ) : (
          <ul className="border-line divide-line-soft flex flex-col divide-y rounded-lg border">
            {members.map((member) => (
              <PersonRow
                key={member.id}
                repository={repository}
                entry={{ kind: 'member', value: member }}
                onChanged={reload}
              />
            ))}
          </ul>
        )}
      </div>

      {invitations.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">En attente de connexion · {invitations.length}</h3>
          <ul className="border-line divide-line-soft flex flex-col divide-y rounded-lg border">
            {invitations.map((invitation) => (
              <PersonRow
                key={invitation.id}
                repository={repository}
                entry={{ kind: 'invitation', value: invitation }}
                onChanged={reload}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const NEW_RIGHTS: MemberRights = { role: 'translator', languages: [], writesSource: false };

const ADDED_TEXT = (added: AddedMember, who: string): string =>
  added.outcome === 'member'
    ? `${who} est maintenant membre du dépôt.`
    : added.by === 'github'
      ? `${who} deviendra membre à sa première connexion avec GitHub.`
      : added.linkSent === false
        ? `L'invitation de ${who} est enregistrée, mais le lien de connexion n'est pas parti. Renvoyez-le depuis la liste.`
        : `Invitation envoyée à ${who}. Le lien de connexion expire dans 5 minutes : la personne peut en redemander un depuis la page de connexion.`;

function AddPerson({ repository, onAdded }: { repository: Repository; onAdded: () => void }) {
  const [who, setWho] = useState('');
  const [rights, setRights] = useState<MemberRights>(NEW_RIGHTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReadError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const person = personOf(who);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!person) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const added = await addMember(api, repository.id, { ...person, ...rights });

      setDone(ADDED_TEXT(added, who.trim()));
      setWho('');
      setRights(NEW_RIGHTS);
      onAdded();
    } catch (failure) {
      setError(readErrorOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={add} aria-label="Ajouter une personne" className="bg-panel flex flex-col gap-4 rounded-lg p-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="member-who" className="text-muted text-xs font-medium">
          Ajouter une personne, par son adresse email ou son pseudo GitHub
        </label>
        <Input
          id="member-who"
          value={who}
          onChange={(event) => {
            setWho(event.target.value);
            setDone(null);
            setError(null);
          }}
          placeholder="ana@exemple.fr ou octocat"
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={who.trim() !== '' && !person}
          aria-describedby="member-who-hint"
          className="h-9 bg-white text-[13px]"
        />
        <span id="member-who-hint" className="text-muted text-xs">
          {who.trim() === ''
            ? 'Une adresse reçoit un lien de connexion par email. Un pseudo GitHub se connecte avec GitHub.'
            : !person
              ? "Ce n'est ni une adresse email ni un pseudo GitHub."
              : 'email' in person
                ? 'Cette adresse recevra un lien de connexion, sans compte GitHub.'
                : 'Ce pseudo GitHub se connectera avec GitHub.'}
        </span>
      </div>

      <RightsFields repository={repository} rights={rights} onChange={setRights} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" isDisabled={busy || !person}>
          {busy ? (
            <>
              <Busy />
              Ajout…
            </>
          ) : (
            'Ajouter'
          )}
        </Button>
        <span role="status" className="text-sub text-[13px]">
          {done}
        </span>
      </div>

      {error && <Failure title="La personne n'a pas été ajoutée." error={error} written />}
    </form>
  );
}

/** The role, the languages and the right to write the source, as one member holds them. */
function RightsFields({
  repository,
  rights,
  onChange,
  isDisabled,
}: {
  repository: Repository;
  rights: MemberRights;
  onChange: (rights: MemberRights) => void;
  isDisabled?: boolean;
}) {
  const toggle = (language: string) =>
    onChange({
      ...rights,
      languages: rights.languages.includes(language)
        ? rights.languages.filter((held) => held !== language)
        : [...rights.languages, language].sort(),
    });

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <Choice
        label="Rôle"
        value={rights.role}
        items={ROLE_ITEMS}
        onChange={(role) => onChange({ ...rights, role: role as MemberRights['role'] })}
        isDisabled={isDisabled}
        className="w-40"
      />
      <div role="group" aria-label="Langues" className="flex flex-wrap items-center gap-1.5">
        {repository.targets.length === 0 && <span className="text-muted text-xs">Aucune langue cible.</span>}
        {repository.targets.map((language) => {
          const on = rights.languages.includes(language);

          return (
            <button
              key={language}
              type="button"
              aria-pressed={on}
              disabled={isDisabled}
              onClick={() => toggle(language)}
              className={`h-7 cursor-pointer rounded-full border px-2.5 font-mono text-xs disabled:cursor-default disabled:opacity-60 ${
                on ? 'border-ink bg-ink text-white' : 'border-line text-sub hover:text-ink bg-white'
              }`}
            >
              {language}
            </button>
          );
        })}
      </div>
      <span className="inline-flex items-center gap-2">
        <Tick
          label={`Écrit la source (${repository.source})`}
          isSelected={rights.writesSource}
          isDisabled={isDisabled}
          onChange={(writesSource) => onChange({ ...rights, writesSource })}
        />
        <span className="text-sub text-[13px]" aria-hidden="true">
          Source ({repository.source})
        </span>
      </span>
    </div>
  );
}

type Entry = { kind: 'member'; value: Member } | { kind: 'invitation'; value: Invitation };

function PersonRow({ repository, entry, onChanged }: { repository: Repository; entry: Entry; onChanged: () => void }) {
  const saved: MemberRights = {
    role: entry.value.role,
    languages: entry.value.languages,
    writesSource: entry.value.writesSource,
  };
  // Null while the row is not edited: the row then follows the list, also after another manager changes it.
  const [edited, setEdited] = useState<MemberRights | null>(null);
  const draft = edited ?? saved;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ReadError | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  const changed = !sameRights(saved, draft);
  // A refusal speaks of the draft that was sent. A new draft makes it out of date.
  const edit = (rights: MemberRights) => {
    setEdited(sameRights(rights, saved) ? null : rights);
    setError(null);
  };
  const { id } = entry.value;
  const title =
    entry.kind === 'member'
      ? entry.value.name
      : (entry.value.email ?? (entry.value.githubLogin ? `@${entry.value.githubLogin}` : 'Invitation'));
  const detail =
    entry.kind === 'member'
      ? entry.value.email
      : entry.value.email
        ? 'Invitée par email · lien de connexion'
        : 'Invitée par pseudo GitHub · connexion avec GitHub';

  const run = async (write: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);

    try {
      await write();
      setEdited(null);
      onChanged();
    } catch (failure) {
      setError(readErrorOf(failure));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const save = () =>
    run(() =>
      entry.kind === 'member'
        ? changeMember(api, repository.id, id, rightsChange(saved, draft))
        : changeInvitation(api, repository.id, id, rightsChange(saved, draft)),
    );
  const resend = async () => {
    setBusy(true);
    setError(null);
    setLinkSent(false);

    try {
      await sendInvitationLink(api, repository.id, id);
      setLinkSent(true);
    } catch (failure) {
      setError(readErrorOf(failure));
    } finally {
      setBusy(false);
    }
  };
  const remove = () =>
    run(() =>
      entry.kind === 'member' ? removeMember(api, repository.id, id) : removeInvitation(api, repository.id, id),
    );

  return (
    <li aria-label={title} className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="text-muted truncate text-xs">{detail}</span>
        </div>
        <div className="flex items-center gap-2">
          {changed && (
            <>
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => edit(saved)}>
                Annuler
              </Button>
              <Button size="sm" isDisabled={busy} onPress={save}>
                {busy ? <Busy /> : null}
                Enregistrer
              </Button>
            </>
          )}
          {!changed &&
            (confirming ? (
              <>
                <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setConfirming(false)}>
                  Garder
                </Button>
                <Button size="sm" variant="danger" isDisabled={busy} onPress={remove}>
                  {busy ? <Busy /> : null}
                  {entry.kind === 'member' ? 'Confirmer le retrait' : "Confirmer l'annulation"}
                </Button>
              </>
            ) : (
              <>
                {entry.kind === 'invitation' && entry.value.email && (
                  <Button size="sm" variant="ghost" isDisabled={busy} onPress={resend}>
                    {linkSent ? 'Lien renvoyé' : 'Renvoyer le lien'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onPress={() => setConfirming(true)}>
                  {entry.kind === 'member' ? 'Retirer' : "Annuler l'invitation"}
                </Button>
              </>
            ))}
        </div>
      </div>
      <RightsFields repository={repository} rights={draft} onChange={edit} isDisabled={busy} />
      {error && (
        <Failure
          title={
            entry.kind === 'member'
              ? "Le membre n'a pas été modifié. Rien n'a changé."
              : "L'invitation n'a pas été modifiée."
          }
          error={error}
          written
        />
      )}
    </li>
  );
}

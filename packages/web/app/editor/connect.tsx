import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import { useEffect, useRef, useState } from 'react';
import {
  addRepository,
  detection as readDetection,
  type Detection,
  type PublishMode,
  type Repository,
} from '@i18n-editor/mcp/api';
import { api } from '~/utils/api';
import { Branch, Github, Info, Plus, Wrench } from './icons';
import { bodyOf, problemsOf, type ConnectField, type ConnectForm, type RepositoryChoice } from './connect-flow';
import { RepositoryPicker, useReachable } from './repository-picker';
import { Blocked, Failure, Loading } from './states';
import { Busy } from './ui';
import { PublishModeSwitch } from './pull-state';
import { readErrorOf, type ReadError } from './use-read';

interface Props {
  /** Where GitHub installs the App. The API gives it to an admin alone. */
  installUrl: string;
  /** The repositories the editor already translates. */
  connected: readonly Repository[];
  /** The installation that GitHub named in the address of the return, if any. */
  justInstalled: number | null;
  /** The repository is connected, or was already: the editor opens it. */
  onConnected: (repositoryId: string) => void;
  /** Absent while no repository is connected: there is nothing to go back to. */
  onCancel?: () => void;
}

/**
 * Connects a repository, for an admin (DB-581).
 *
 * 1. The App is installed on GitHub, which sends the browser back to `/setup`.
 * 2. The admin picks a repository among those the installations reach.
 * 3. The form starts from what the API detects in it, and every field stays editable.
 */
export function ConnectRepository({ installUrl, connected, justInstalled, onConnected, onCancel }: Props) {
  const reachable = useReachable(connected);
  const { listing, load } = reachable;
  const [picked, setPicked] = useState<RepositoryChoice | null>(null);

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Brancher un dépôt</h1>
        <p className="text-sub text-sm leading-normal">
          L'éditeur lit et écrit les fichiers de langue d'un dépôt GitHub, au travers de son App.
        </p>
      </div>
      {onCancel && (
        <Button variant="ghost" onPress={onCancel}>
          Revenir aux traductions
        </Button>
      )}
    </div>
  );

  // The first page, with no search, says whether the App reaches anything at all.
  const firstPage = listing.query === '' && listing.rows.length === 0;

  if (firstPage && listing.status === 'loading') {
    return (
      <Section>
        {header}
        <Loading>Lecture des dépôts que l'App atteint…</Loading>
      </Section>
    );
  }

  if (firstPage && listing.status === 'failed' && listing.error) {
    return (
      <Section>
        {header}
        {listing.error.status === 503 ? (
          <Blocked icon={<Wrench size={18} />}>
            <p className="text-sm leading-normal">La GitHub App de l'éditeur n'est pas encore configurée.</p>
            <p className="text-muted max-w-xl font-mono text-xs break-words">{listing.error.message}</p>
          </Blocked>
        ) : (
          <Failure
            title="Les dépôts que l'App atteint n'ont pas pu être lus."
            error={listing.error}
            onRetry={() => void load('', 1)}
          />
        )}
      </Section>
    );
  }

  if (firstPage && listing.status === 'idle') {
    return (
      <Section>
        {header}
        <Step number={1} title="Installer l'App sur GitHub">
          <p className="text-sub text-sm leading-normal">
            L'App n'est installée sur aucun dépôt. Installez-la sur le dépôt qui contient vos fichiers de langue :
            GitHub vous ramène ensuite ici.
          </p>
          <div>
            <InstallLink href={installUrl}>Installer l'App sur GitHub</InstallLink>
          </div>
        </Step>
      </Section>
    );
  }

  return (
    <Section>
      {header}
      <Step number={1} title="Choisir le dépôt">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <RepositoryPicker reachable={reachable} picked={picked} onPick={setPicked} onOpen={onConnected} />
          <a href={installUrl} className="text-signal text-[13px] whitespace-nowrap hover:underline">
            Installer sur d'autres dépôts
          </a>
        </div>
        {justInstalled !== null && !picked && (
          <p className="text-sub flex items-start gap-2 text-[13px] leading-normal">
            <Info size={15} className="text-muted mt-0.5" />
            L'App est installée. Choisissez le dépôt à traduire.
          </p>
        )}
      </Step>

      {picked && (
        // The key restarts the form for each repository: what was typed for one must not reach another.
        <RepositoryForm key={`${picked.owner}/${picked.name}`} choice={picked} onConnected={onConnected} />
      )}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 pt-4">{children}</section>;
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="border-line-strong arrive flex flex-col gap-4 rounded-[10px] border p-5">
      <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
        <span
          aria-hidden="true"
          className="bg-ink inline-flex size-6 items-center justify-center rounded-full font-mono text-xs text-white"
        >
          {number}
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

/** GitHub opens in this tab: it sends the browser back to `/setup` after the installation. */
function InstallLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    // A link drawn as the primary button of HeroUI: `app.css` imports its `button.css`.
    <a href={href} className="button button--primary inline-flex items-center gap-2 no-underline">
      <Github size={16} />
      {children}
    </a>
  );
}

const EMPTY_FORM: ConnectForm = { branch: '', localesPath: '', manifestPath: '', languages: '' };

/** The form, filled from a detection. A field the admin typed in keeps what was typed. */
const filledFrom = (detection: Detection, before: ConnectForm, typed: ReadonlySet<ConnectField>): ConnectForm => ({
  branch: typed.has('branch') ? before.branch : detection.branch,
  localesPath: typed.has('localesPath') ? before.localesPath : (detection.localesPath ?? ''),
  manifestPath: typed.has('manifestPath') ? before.manifestPath : (detection.manifestPath ?? ''),
  languages: typed.has('languages') ? before.languages : detection.languages.join(', '),
});

function RepositoryForm({
  choice,
  onConnected,
}: {
  choice: RepositoryChoice;
  onConnected: (repositoryId: string) => void;
}) {
  const [form, setForm] = useState<ConnectForm>(EMPTY_FORM);
  const typed = useRef(new Set<ConnectField>());
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [detectError, setDetectError] = useState<ReadError | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<ReadError | null>(null);
  const [already, setAlready] = useState<Repository | null>(null);
  const [publishMode, setPublishMode] = useState<PublishMode>('commit');
  // A ruleset found on the branch chooses the pull request, until the admin chooses.
  const modeChosen = useRef(false);
  // The answer of an older detection must not fill the form after a newer one started.
  const turn = useRef(0);

  const detect = async (query: { branch?: string; localesPath?: string }) => {
    const mine = (turn.current += 1);

    setDetecting(true);
    setDetectError(null);

    try {
      const found = await readDetection(api, { ...choice, ...query });

      if (mine !== turn.current) return;

      setDetection(found);
      setForm((before) => filledFrom(found, before, typed.current));
      if (!modeChosen.current && found.requiresPullRequest != null) {
        setPublishMode(found.requiresPullRequest ? 'pull_request' : 'commit');
      }
    } catch (error) {
      if (mine === turn.current) setDetectError(readErrorOf(error));
    } finally {
      if (mine === turn.current) setDetecting(false);
    }
  };

  // The key of the form changes with the repository, so the first detection runs once for each.
  const firstDetection = useRef(detect);

  useEffect(() => {
    void firstDetection.current({});
  }, []);

  const problems = problemsOf(form);
  const shown = tried ? problems : {};

  const set = (field: ConnectField) => (event: React.ChangeEvent<HTMLInputElement>) => {
    typed.current.add(field);
    setForm((before) => ({ ...before, [field]: event.target.value }));
  };

  /** A folder found in the repository fills the folder, the manifest and the languages again. */
  const pickFolder = (path: string) => {
    typed.current.delete('localesPath');
    typed.current.delete('manifestPath');
    typed.current.delete('languages');
    void detect({ branch: form.branch.trim() || undefined, localesPath: path });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);

    if (Object.keys(problems).length > 0 || busy) return;

    setBusy(true);
    setSendError(null);

    try {
      const answer = await addRepository(api, bodyOf(choice, form, publishMode));

      // The API answers the row that holds the repository when one does, and writes nothing.
      if (answer.created === false) setAlready(answer);
      else onConnected(answer.id);
    } catch (error) {
      setSendError(readErrorOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step number={2} title={`Régler ${choice.owner}/${choice.name}`}>
      {detecting && !detection && <Loading>Lecture du dépôt…</Loading>}

      {detectError && (
        <Failure
          title="Le dépôt n'a pas pu être lu. Remplissez les champs vous-même, ou réessayez."
          error={detectError}
          onRetry={() => void detect({ branch: form.branch.trim() || undefined })}
        />
      )}

      {(detection || detectError) && (
        <form
          onSubmit={submit}
          aria-label={`Réglages de ${choice.owner}/${choice.name}`}
          className="flex flex-col gap-4"
        >
          {detection && detection.candidates.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-muted text-xs font-medium">Dossiers de langues trouvés</span>
              <div className="flex flex-wrap gap-2">
                {detection.candidates.map((candidate) => (
                  <Button
                    key={candidate.path}
                    size="sm"
                    variant={candidate.path === form.localesPath.trim() ? 'outline' : 'ghost'}
                    aria-pressed={candidate.path === form.localesPath.trim()}
                    isDisabled={detecting}
                    onPress={() => pickFolder(candidate.path)}
                    className="font-mono text-xs"
                  >
                    {candidate.path} · {candidate.languages.join(', ')}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {detection && detection.candidates.length === 0 && (
            <Notice>
              Aucun dossier de la branche {detection.branch} ne contient un dossier par langue avec des fichiers .json.
              Indiquez le chemin vous-même.
            </Notice>
          )}

          {detection?.truncated && (
            <Notice>
              GitHub n'a pas listé tout le dépôt, qui est très grand : un dossier profond peut manquer à la liste.
            </Notice>
          )}

          <Field
            id="connect-branch"
            label="Branche"
            hint={detection ? `Branche par défaut : ${detection.defaultBranch}` : undefined}
            problem={shown.branch}
          >
            <Input
              id="connect-branch"
              value={form.branch}
              onChange={set('branch')}
              onBlur={() => {
                const branch = form.branch.trim();

                if (branch && detection && branch !== detection.branch) void detect({ branch });
              }}
              spellCheck={false}
              autoCapitalize="none"
              aria-invalid={shown.branch !== undefined}
              aria-describedby="connect-branch-problem"
              className="h-9 font-mono text-[13px]"
            />
          </Field>

          <Field
            id="connect-locales"
            label="Dossier des langues"
            hint="Il contient un dossier par langue : fr/common.json, en/common.json…"
            problem={shown.localesPath}
          >
            <Input
              id="connect-locales"
              value={form.localesPath}
              onChange={set('localesPath')}
              placeholder="src/locales"
              spellCheck={false}
              autoCapitalize="none"
              aria-invalid={shown.localesPath !== undefined}
              aria-describedby="connect-locales-problem"
              className="h-9 font-mono text-[13px]"
            />
          </Field>

          <Field
            id="connect-manifest"
            label="Manifeste (facultatif)"
            hint="Vide : manifest.json à côté des dossiers de langues, s'il existe."
            problem={shown.manifestPath}
          >
            <Input
              id="connect-manifest"
              value={form.manifestPath}
              onChange={set('manifestPath')}
              placeholder="src/locales/manifest.json"
              spellCheck={false}
              autoCapitalize="none"
              aria-invalid={shown.manifestPath !== undefined}
              aria-describedby="connect-manifest-problem"
              className="h-9 font-mono text-[13px]"
            />
          </Field>

          <Field
            id="connect-languages"
            label="Langues, la source en premier"
            hint={
              detection?.source
                ? `Le manifeste nomme ${detection.source} comme source.`
                : 'La première langue est celle depuis laquelle les autres sont traduites.'
            }
            problem={shown.languages}
          >
            <Input
              id="connect-languages"
              value={form.languages}
              onChange={set('languages')}
              placeholder="fr, en"
              spellCheck={false}
              autoCapitalize="none"
              aria-invalid={shown.languages !== undefined}
              aria-describedby="connect-languages-problem"
              className="h-9 font-mono text-[13px]"
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-muted text-xs font-medium">Publier</span>
            <PublishModeSwitch
              label="Publier par"
              value={publishMode}
              onChange={(mode) => {
                modeChosen.current = true;
                setPublishMode(mode);
              }}
            />
            <span className="text-muted text-xs">
              {detection?.requiresPullRequest
                ? `Une règle de ${form.branch.trim() || 'la branche'} exige une pull request : une publication ouvre la PR i18n/publish, ou la complète.`
                : publishMode === 'pull_request'
                  ? 'Une publication ouvre la PR i18n/publish, ou la complète. Il faut que l’App ait la permission « Pull requests ».'
                  : 'Une publication est un commit sur la branche. Choisissez pull request si la branche est protégée.'}
            </span>
          </div>

          {already && (
            <Notice>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                Ce dépôt était déjà branché : rien n'a changé.
                <Button size="sm" variant="outline" onPress={() => onConnected(already.id)}>
                  Ouvrir son tableau
                </Button>
              </span>
            </Notice>
          )}

          {sendError && <Failure title="Le dépôt n'a pas été branché. Rien n'a été écrit." error={sendError} written />}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted inline-flex items-center gap-1.5 text-xs">
              <Branch size={13} />
              {publishMode === 'pull_request'
                ? `L'éditeur écrit sur une branche par langue et sur i18n/publish, jamais sur ${form.branch.trim() || 'la branche'}.`
                : `L'éditeur écrit sur ${form.branch.trim() || 'la branche'} et sur une branche par langue.`}
            </span>
            <Button type="submit" isDisabled={busy || detecting}>
              {busy ? (
                <>
                  <Busy />
                  Branchement…
                </>
              ) : (
                <>
                  <Plus size={15} />
                  Brancher ce dépôt
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </Step>
  );
}

/** A label, its field, a hint and the message of a problem. The message is not in the label, which would name the field by its own error. */
function Field({
  id,
  label,
  hint,
  problem,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  problem?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-muted text-xs font-medium">
        {label}
      </label>
      {children}
      {hint && <span className="text-muted text-xs">{hint}</span>}
      <span id={`${id}-problem`} role="status" className="text-alarm-strong min-h-4 text-xs">
        {problem}
      </span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="bg-panel text-sub flex items-start gap-2.5 rounded-md px-3 py-2 text-[13px] leading-normal">
      <Info size={15} className="text-muted mt-0.5" />
      {children}
    </p>
  );
}

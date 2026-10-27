import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import { TextArea } from '@heroui/react/textarea';
import { DEFAULT_TEMPLATES, type TemplateKind } from '@i18n-editor/db/messages';
import {
  issuesOf,
  repositories as readRepositories,
  rightsIn,
  rightsOf,
  updateRepository,
  type Repository,
} from '@i18n-editor/mcp/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams, useSearchParams } from 'react-router';
import { api } from '~/utils/api';
import { Info, Lock, Published, Undo } from '~/editor/icons';
import { PublishModeSwitch } from '~/editor/pull-state';
import { Signed } from '~/editor/shell';
import { SettingsSkeleton } from '~/editor/skeleton';
import { Blocked, Failure } from '~/editor/states';
import { Busy } from '~/editor/ui';
import { MembersPanel } from './members';
import { forgetReads, readErrorOf, useRead, type ReadError } from '~/editor/use-read';
import {
  changeOf,
  fieldOfIssue,
  firstSectionWith,
  formOf,
  previewOf,
  problemsOf,
  sectionOf,
  sectionsFor,
  SETTINGS_SECTIONS,
  type SettingsSectionEntry,
  variablesOf,
  type SettingsField,
  type SettingsForm,
  type SettingsSection,
} from './form';

/** What each template is, in the words of the page. */
const TEMPLATE_TEXT: Record<TemplateKind, { label: string; hint: string }> = {
  proposalCommit: {
    label: "Commit d'une proposition",
    hint: "Une ligne. L'éditeur ajoute dessous la ligne Read-at:, qu'il relit.",
  },
  publicationCommit: {
    label: "Commit d'une publication",
    hint: "Une ligne. L'éditeur ajoute dessous une ligne par clé, qu'il relit. {action} vaut published, ou created pour une nouvelle clé.",
  },
  pullRequestTitle: {
    label: 'Titre de la pull request',
    hint: 'Une ligne. Il est réécrit à chaque publication.',
  },
  pullRequestBody: {
    label: 'Corps de la pull request',
    hint: '{keys_list} liste les clés publiées, par langue.',
  },
};

const TEMPLATE_KINDS_SHOWN: readonly TemplateKind[] = [
  'proposalCommit',
  'publicationCommit',
  'pullRequestTitle',
  'pullRequestBody',
];

/** Where the table of a repository is. */
const tablePathOf = (repositoryId: string): string => `/repositories/${encodeURIComponent(repositoryId)}`;

/** The settings of a repository, for an admin (DB-609), and its members for an owner (DB-637). */
export default function SettingsScreen() {
  return <Signed>{({ waiting }) => <Settings waiting={waiting} />}</Signed>;
}

function Settings({ waiting }: { waiting: React.RefObject<number> }) {
  const repositoryId = useParams().id ?? null;
  const [me, reloadMe] = useRead('me', () => rightsOf(api));
  const [repositories, reloadRepositories] = useRead('repositories', () => readRepositories(api));

  if (me.state === 'loading' || repositories.state === 'loading') return <SettingsSkeleton />;
  if (me.state === 'failed')
    return <Failure title="Le compte n'a pas pu être lu." error={me.error} onRetry={reloadMe} />;
  if (repositories.state === 'failed') {
    return (
      <Failure title="Les dépôts n'ont pas pu être lus." error={repositories.error} onRetry={reloadRepositories} />
    );
  }

  const admin = me.value.admin;
  const owner = repositoryId !== null && rightsIn(me.value, repositoryId).rights?.role === 'owner';

  if (!admin && !owner) {
    return (
      <Blocked icon={<Lock size={18} />}>
        <p className="text-sm leading-normal">Seuls un admin et un propriétaire du dépôt ouvrent ses réglages.</p>
        <Link
          to={repositoryId ? tablePathOf(repositoryId) : '/'}
          viewTransition
          className="text-sub text-[13px] underline"
        >
          Revenir aux traductions
        </Link>
      </Blocked>
    );
  }

  const repository = repositories.value.find((row) => row.id === repositoryId);

  if (!repository) {
    return (
      <Blocked icon={<Info size={18} />}>
        <p className="text-sm leading-normal">Ce dépôt n'est pas branché à l'éditeur.</p>
        <Link to="/" viewTransition className="text-sub text-[13px] underline">
          Revenir aux traductions
        </Link>
      </Blocked>
    );
  }

  const saved = () => {
    reloadRepositories();
    // The languages, the files or the branch can change: every read of the repository is out of date.
    for (const kind of ['catalogue', 'proposed', 'progress', 'publication']) forgetReads(`${kind}\n${repository.id}`);
    forgetReads('overview');
  };

  return <SettingsOf repository={repository} admin={admin} waiting={waiting} onSaved={saved} />;
}

function SettingsOf({
  repository,
  admin,
  waiting,
  onSaved,
}: {
  repository: Repository;
  /** An owner who is not an admin opens the members alone. */
  admin: boolean;
  waiting: React.RefObject<number>;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<SettingsForm>(() => formOf(repository));
  const [form, setForm] = useState<SettingsForm>(saved);
  const [touched, setTouched] = useState<ReadonlySet<SettingsField>>(new Set());
  const [refused, setRefused] = useState<Partial<Record<SettingsField, string>>>({});
  const [sendError, setSendError] = useState<ReadError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [params, setParams] = useSearchParams();
  const sections = sectionsFor(admin);
  const section = sectionOf(params.get('section'), sections);

  const change = useMemo(() => changeOf(saved, form), [saved, form]);
  const changed = Object.keys(change).length;
  const problems = problemsOf(form);
  const blocked = Object.keys(problems).length > 0;

  // The header signs out, and the guard of the page asks before a navigation.
  waiting.current = changed;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => changed > 0 && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;

    if (window.confirm('Les réglages modifiés ne sont pas enregistrés. Quitter la page ?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (changed === 0) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [changed]);

  const set = (field: SettingsField, value: string) => {
    setForm((before) => ({ ...before, [field]: value }));
    setTouched((before) => new Set(before).add(field));
    setRefused(({ [field]: _gone, ...rest }) => rest);
    setDone(false);
  };

  // A template shows its problem as it is typed: its preview depends on it.
  // A place shows its problem once the field is left, or on a save.
  const shown = (field: SettingsField): string | undefined =>
    refused[field] ?? (touched.has(field) || field in TEMPLATE_TEXT ? problems[field] : undefined);

  const open = (next: SettingsSection) =>
    setParams(
      (before) => {
        const after = new URLSearchParams(before);

        after.set('section', next);

        return after;
      },
      { replace: true, preventScrollReset: true },
    );

  // Stay on the open section if it shows a problem. Else open the first section that shows one.
  const openProblem = (fields: SettingsField[]) => {
    const here = SETTINGS_SECTIONS.find(({ id }) => id === section)?.fields ?? [];

    if (fields.some((field) => (here as readonly SettingsField[]).includes(field))) return;

    const first = firstSectionWith(fields);

    if (first) open(first);
  };

  const changedFields = new Set(Object.keys(change).map(fieldOfIssue));
  const marks = Object.fromEntries(
    SETTINGS_SECTIONS.map(({ id, fields }) => [
      id,
      fields.some((field) => shown(field) !== undefined)
        ? 'problem'
        : fields.some((field) => changedFields.has(field))
          ? 'changed'
          : null,
    ]),
  ) as Record<SettingsSection, TabMark | null>;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(new Set(Object.keys(form) as SettingsField[]));

    if (blocked) openProblem(Object.keys(problems) as SettingsField[]);
    if (blocked || changed === 0) return;

    setBusy(true);
    setSendError(null);

    try {
      const answer = await updateRepository(api, repository.id, change);
      const next = formOf(answer);

      setSaved(next);
      setForm(next);
      setTouched(new Set());
      setDone(true);
      onSaved();
    } catch (error) {
      const issues = issuesOf(error);
      const byField: Partial<Record<SettingsField, string>> = {};
      const unplaced: string[] = [];

      for (const issue of issues) {
        const field = fieldOfIssue(issue.field);

        if (field) byField[field] = issue.message;
        else unplaced.push(issue.message);
      }

      setRefused(byField);
      openProblem(Object.keys(byField) as SettingsField[]);

      if (issues.length === 0 || unplaced.length > 0) {
        const read = readErrorOf(error);

        setSendError(unplaced.length > 0 ? { ...read, message: unplaced.join(' ') } : read);
      }
    } finally {
      setBusy(false);
    }
  };

  const panels: Record<Exclude<SettingsSection, 'members'>, React.ReactNode> = {
    repository: (
      <>
        <Field id="settings-branch" label="Branche" problem={shown('branch')}>
          <Input
            id="settings-branch"
            value={form.branch}
            onChange={(event) => set('branch', event.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={shown('branch') !== undefined}
            aria-describedby="settings-branch-problem"
            className="h-9 font-mono text-[13px]"
          />
        </Field>
        <Field
          id="settings-locales"
          label="Dossier des langues"
          hint="Il contient un dossier par langue : fr/common.json, en/common.json…"
          problem={shown('localesPath')}
        >
          <Input
            id="settings-locales"
            value={form.localesPath}
            onChange={(event) => set('localesPath', event.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={shown('localesPath') !== undefined}
            aria-describedby="settings-locales-problem"
            className="h-9 font-mono text-[13px]"
          />
        </Field>
        <Field
          id="settings-manifest"
          label="Manifeste"
          hint="Vide : manifest.json à côté des dossiers de langues."
          problem={shown('manifestPath')}
        >
          <Input
            id="settings-manifest"
            value={form.manifestPath}
            onChange={(event) => set('manifestPath', event.target.value)}
            placeholder={`${form.localesPath.trim() || 'src/locales'}/manifest.json`}
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={shown('manifestPath') !== undefined}
            aria-describedby="settings-manifest-problem"
            className="h-9 font-mono text-[13px]"
          />
        </Field>
        <Field
          id="settings-languages"
          label="Langues, la source en premier"
          hint="La première langue est celle depuis laquelle les autres sont traduites."
          problem={shown('languages')}
        >
          <Input
            id="settings-languages"
            value={form.languages}
            onChange={(event) => set('languages', event.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={shown('languages') !== undefined}
            aria-describedby="settings-languages-problem"
            className="h-9 font-mono text-[13px]"
          />
        </Field>
      </>
    ),
    publication: (
      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-xs font-medium">Publier</span>
        <PublishModeSwitch
          value={form.publishMode}
          onChange={(mode) => {
            setForm((before) => ({ ...before, publishMode: mode }));
            setDone(false);
          }}
        />
        <span className="text-muted text-xs">
          {form.publishMode === 'pull_request'
            ? `Une publication ouvre la PR i18n/publish vers ${form.branch.trim() || 'la branche'}, ou la complète. Il faut que l'App ait la permission « Pull requests ».`
            : `Une publication est un commit sur ${form.branch.trim() || 'la branche'}. Choisissez pull request si la branche est protégée.`}
        </span>
      </div>
    ),
    messages: (
      <>
        <p className="text-sub -mt-2 text-[13px] leading-normal">
          Le format des messages que l'éditeur écrit sur GitHub. Une variable s'écrit entre accolades, comme{' '}
          <code className="font-mono text-xs">{'{language}'}</code> ; <code className="font-mono text-xs">{'{{'}</code>{' '}
          écrit une accolade. Un champ vide garde le format par défaut.
        </p>
        {TEMPLATE_KINDS_SHOWN.map((kind) => (
          <TemplateField
            key={kind}
            kind={kind}
            value={form[kind]}
            problem={shown(kind)}
            onChange={(value) => set(kind, value)}
          />
        ))}
      </>
    ),
  };
  const title = SETTINGS_SECTIONS.find(({ id }) => id === section)?.title;

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">
            Réglages de{' '}
            <span className="font-mono text-[20px]">
              {repository.owner}/{repository.name}
            </span>
          </h1>
          <p className="text-sub text-sm leading-normal">
            {admin
              ? "Ce que l'éditeur lit de ce dépôt, comment il y écrit, et qui le traduit."
              : 'Qui traduit ce dépôt, et ce que chacun peut faire.'}
          </p>
        </div>
        <Link
          to={tablePathOf(repository.id)}
          viewTransition
          className="text-sub hover:text-ink text-[13px] no-underline"
        >
          Revenir aux traductions
        </Link>
      </div>

      <div className="flex flex-col gap-6 md:grid md:grid-cols-[176px_minmax(0,1fr)] md:items-start md:gap-10">
        <SectionTabs sections={sections} current={section} marks={marks} onSelect={open} />

        {section === 'members' ? (
          <section
            role="tabpanel"
            id="settings-panel-members"
            aria-labelledby="settings-tab-members"
            className="flex min-w-0 flex-col gap-4"
          >
            <h2 className="border-line border-b pb-2 text-[15px] font-semibold">{title}</h2>
            <MembersPanel repository={repository} />
          </section>
        ) : (
          <form
            onSubmit={save}
            aria-label={`Réglages de ${repository.owner}/${repository.name}`}
            className="flex min-w-0 flex-col gap-8"
          >
            <section
              role="tabpanel"
              id={`settings-panel-${section}`}
              aria-labelledby={`settings-tab-${section}`}
              className="flex flex-col gap-4"
            >
              <h2 className="border-line border-b pb-2 text-[15px] font-semibold">{title}</h2>
              {panels[section]}
            </section>
            {sendError && (
              <Failure title="Les réglages n'ont pas été enregistrés. Rien n'a changé." error={sendError} written />
            )}

            <div className="border-line sticky bottom-0 -mx-2 flex flex-wrap items-center justify-between gap-3 border-t bg-white px-2 py-3">
              <span role="status" className="text-muted inline-flex items-center gap-1.5 text-xs">
                {done ? (
                  <>
                    <Published size={14} />
                    Réglages enregistrés.
                  </>
                ) : changed > 0 ? (
                  `${changed} ${changed > 1 ? 'réglages modifiés' : 'réglage modifié'}, pas encore enregistrés.`
                ) : (
                  'Aucun changement.'
                )}
              </span>
              <div className="flex items-center gap-2">
                {changed > 0 && (
                  <Button
                    variant="ghost"
                    isDisabled={busy}
                    onPress={() => {
                      setForm(saved);
                      setTouched(new Set());
                      setRefused({});
                      setSendError(null);
                    }}
                  >
                    <Undo size={15} />
                    Annuler les changements
                  </Button>
                )}
                <Button type="submit" isDisabled={busy || changed === 0 || blocked}>
                  {busy ? (
                    <>
                      <Busy />
                      Enregistrement…
                    </>
                  ) : (
                    'Enregistrer'
                  )}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

type TabMark = 'problem' | 'changed';

const MARK_TEXT: Record<TabMark, string> = {
  problem: 'un réglage à corriger',
  changed: 'modifié, pas encore enregistré',
};

/** The tabs of the sections: a column beside the page on a wide screen, a row above it on a narrow one. */
function SectionTabs({
  sections,
  current,
  marks,
  onSelect,
}: {
  sections: readonly SettingsSectionEntry[];
  current: SettingsSection;
  marks: Record<SettingsSection, TabMark | null>;
  onSelect: (section: SettingsSection) => void;
}) {
  const tabs = useRef<Partial<Record<SettingsSection, HTMLButtonElement | null>>>({});

  const move = (event: React.KeyboardEvent, index: number) => {
    const last = sections.length - 1;
    const step: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key in step
            ? (index + step[event.key] + last + 1) % (last + 1)
            : null;

    if (to === null) return;

    event.preventDefault();

    const next = sections[to].id;

    onSelect(next);
    tabs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Sections des réglages"
      className="border-line flex gap-1 overflow-x-auto border-b pb-2 md:sticky md:top-4 md:flex-col md:overflow-visible md:border-b-0 md:pb-0"
    >
      {sections.map(({ id, title }, index) => {
        const selected = id === current;
        const mark = marks[id];

        return (
          <button
            key={id}
            ref={(node) => {
              tabs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={selected}
            aria-controls={selected ? `settings-panel-${id}` : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => move(event, index)}
            className={`flex h-9 shrink-0 cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-left text-[13.5px] whitespace-nowrap ${
              selected ? 'bg-chosen text-ink font-medium' : 'text-sub hover:bg-hover hover:text-ink'
            }`}
          >
            {title}
            {mark && (
              <span
                title={MARK_TEXT[mark]}
                className={`size-2 shrink-0 rounded-full ${mark === 'problem' ? 'bg-alarm-strong' : 'bg-signal'}`}
              >
                <span className="sr-only">{`, ${MARK_TEXT[mark]}`}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TemplateField({
  kind,
  value,
  problem,
  onChange,
}: {
  kind: TemplateKind;
  value: string;
  problem?: string;
  onChange: (value: string) => void;
}) {
  const id = `settings-${kind}`;
  const { label, hint } = TEMPLATE_TEXT[kind];
  const isDefault = value.trim() === '' || value === DEFAULT_TEMPLATES[kind];
  const multiline = kind === 'pullRequestBody';
  const control = {
    id,
    value,
    placeholder: DEFAULT_TEMPLATES[kind],
    spellCheck: false,
    autoCapitalize: 'none',
    'aria-invalid': problem !== undefined,
    'aria-describedby': `${id}-problem ${id}-preview`,
  } as const;

  return (
    <Field id={id} label={label} hint={hint} problem={problem}>
      <div className="flex items-start gap-2">
        {multiline ? (
          <TextArea
            {...control}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
            className="flex-1 font-mono text-[13px]"
          />
        ) : (
          <Input
            {...control}
            onChange={(event) => onChange(event.target.value)}
            className="h-9 flex-1 font-mono text-[13px]"
          />
        )}
        <Button variant="ghost" size="sm" isDisabled={isDefault} onPress={() => onChange('')} className="h-9 shrink-0">
          <Undo size={14} />
          Rétablir le défaut
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted text-xs">Variables :</span>
        {variablesOf(kind).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(`${value.trim() === '' ? DEFAULT_TEMPLATES[kind] : value}{${name}}`)}
            title={`Ajouter {${name}} à la fin`}
            className="bg-panel text-sub hover:text-ink cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11.5px]"
          >
            {`{${name}}`}
          </button>
        ))}
      </div>
      <div id={`${id}-preview`} className="bg-panel flex flex-col gap-1 rounded-md px-3 py-2">
        <span className="text-muted text-[11px] font-medium tracking-wide uppercase">
          Aperçu
          {isDefault ? ' — format par défaut' : problem ? ' — format par défaut, tant que ce format est refusé' : ''}
        </span>
        <pre className="text-ink font-mono text-[12.5px] break-words whitespace-pre-wrap">{previewOf(kind, value)}</pre>
      </div>
    </Field>
  );
}

/** A label, its field, a hint and the message of a problem, as the connection of a repository draws them. */
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

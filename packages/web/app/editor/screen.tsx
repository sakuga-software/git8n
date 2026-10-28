import { Button } from '@heroui/react/button';
import { ToggleButton } from '@heroui/react/toggle-button';
import { ToggleButtonGroup } from '@heroui/react/toggle-button-group';
import { Tooltip } from '@heroui/react/tooltip';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import {
  catalogueStream as readCatalogueStream,
  createKeys,
  keepTranslations,
  progress as readProgress,
  propose,
  proposedKeys as readProposedKeys,
  publicationState as readPublication,
  publish,
  repositories as readRepositories,
  rightsIn,
  rightsOf,
  type CatalogueProgress,
  type PublishPull,
  type RefusedKey,
} from '@i18n-editor/mcp/api';
import { api } from '~/utils/api';
import { ChevronDown, Gear, Info, KeyView, Lock, Plus, Published, Repository, TableView } from '~/editor/icons';
import { ConnectRepository } from '~/editor/connect';
import { SETUP_PATH, setupReturnOf } from '~/editor/connect-flow';
import { branchUrl, commitUrl, fileUrl, repositoryUrl } from '~/editor/github';
import { NewKey } from '~/editor/new-key';
import { OwnerAvatar } from '~/editor/owner-avatar';
import { Busy, Choice } from '~/editor/ui';
import { PullBand } from '~/editor/pull-state';
import { publishedWhere } from '~/editor/publication';
import { AccountFailure, mayLeave, ShellSlots, Signed } from '~/editor/shell';
import { FilesTree, scopeIdOf, type Scope } from '~/editor/files-tree';
import { KeyByKey } from '~/editor/key-by-key';
import { LanguageHeader } from '~/editor/language-header';
import { PendingBar } from '~/editor/pending-bar';
import { KeySearch } from '~/editor/search';
import { Languages } from '~/editor/languages';
import { treeOf, under } from '~/editor/tree';
import { CatalogueLoading } from '~/editor/catalogue-progress';
import { Blocked, Failure, Loading } from '~/editor/states';
import { Sliding, useSwap } from '~/editor/motion';
import { KeyTable } from '~/editor/table';
import {
  accessOf,
  afterProposal,
  afterPublication,
  countsOf,
  draftsAfterProposal,
  filesIn,
  idOf,
  manages,
  matching,
  neighboursOf,
  openOf,
  pageNumbersOf,
  pageOf,
  ROW_STATES,
  statesOf,
  rowsOf,
  withPublished,
  emptyCountOf,
  type PublishedValue,
  withWrites,
  type Page,
  type Row,
  type RowState,
  type Writes,
} from '~/editor/rows';
import { forgetReads, readErrorOf, useRead, type ReadError } from '~/editor/use-read';

const PAGE = 100;

/** How long a row takes to close. `--motion-leave` in `app.css` holds the same duration. */
const LEAVE_MS = 200;

/** How often an open page reads GitHub again, to show a change made outside the editor (DB-651). */
const POLL_MS = 30_000;

const names = new Intl.DisplayNames('fr', { type: 'language', fallback: 'code' });

/** « Anglais » for « anglais »: a title starts with a capital, and `Intl` gives none. */
const titleOf = (name: string): string => name.charAt(0).toLocaleUpperCase('fr-FR') + name.slice(1);

/** « anglais » for `en`. A tag that names no language is shown as it is. */
const nameOf = (language: string): string => {
  try {
    return names.of(language) ?? language;
  } catch {
    return language;
  }
};

const FILTER_LABEL: Record<RowState, string> = {
  missing: 'Manquantes',
  review: 'À revoir',
  proposed: 'Proposées',
  published: 'Publiées',
};

const EMPTY: Record<RowState, string> = {
  missing: 'Aucune clé manquante.',
  review: 'Aucune traduction à revoir.',
  proposed: 'Aucune proposition en attente.',
  published: 'Aucune clé publiée.',
};

/** The same, when a file or a search narrows the table: « none » is then true of what is shown only. */
const EMPTY_NARROWED: Record<RowState, string> = {
  missing: 'Aucune clé manquante ne correspond à ce filtre.',
  review: 'Aucune traduction à revoir ne correspond à ce filtre.',
  proposed: 'Aucune proposition en attente ne correspond à ce filtre.',
  published: 'Aucune clé publiée ne correspond à ce filtre.',
};

/** « 1 671 », as French writes a count. */
const countOf = (value: number): string => value.toLocaleString('fr-FR');

/**
 * The table of the missing keys, empty while proposals still wait (DB-614).
 * The language is translated on the editor, but not on the repository yet.
 */
function NothingMissing({
  narrowed,
  proposed,
  mayPublish,
  onShow,
}: {
  narrowed: boolean;
  proposed: number;
  mayPublish: boolean;
  onShow: () => void;
}) {
  const many = proposed > 1;

  return (
    <span className="flex flex-col items-center gap-2">
      <span>{narrowed ? EMPTY_NARROWED.missing : 'Toutes les clés ont une traduction.'}</span>
      <span>
        {countOf(proposed)} {many ? 'propositions attendent' : 'proposition attend'}{' '}
        {mayPublish ? 'votre relecture avant de partir sur le dépôt.' : "la relecture d'un relecteur."}
      </span>
      <button type="button" onClick={onShow} className="text-signal cursor-pointer hover:underline">
        Voir {many ? 'les propositions' : 'la proposition'}
      </button>
    </span>
  );
}

/** Why a publication left a key where it was, as `RefusedKey.reason` names it. */
const REFUSAL: Record<RefusedKey['reason'], string> = {
  'source-changed': 'Le texte source a changé depuis la proposition.',
  'not-on-the-branch': "La proposition n'est plus sur la branche.",
  'no-revision': 'Le lot ne dit pas contre quelle révision il a été écrit.',
  'changed-since-approval': 'Une proposition plus récente a changé la valeur.',
  disabled: "Ce fichier n'a pas de version dans cette langue.",
};

/**
 * A link to a page of GitHub, in a new tab: the table holds what was typed,
 * and a page that replaces it loses it.
 *
 * A translator is added with no access to GitHub (DB-210). For that person a
 * private repository answers 404, and the title says so before the click.
 */
function Outside({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Ouvre GitHub dans un nouvel onglet. Un dépôt privé demande d'y avoir accès."
      className={`hover:text-signal hover:underline ${className ?? ''}`}
    >
      {children}
    </a>
  );
}

/** The pill of a count wears the colour of its state. The word beside it says the state. */
const PILL: Record<RowState, string> = {
  missing: 'bg-missing text-missing-ink',
  review: 'bg-alarm text-alarm-ink',
  proposed: 'bg-proposed text-proposed-ink',
  published: 'bg-hover text-sub',
};

/**
 * The count of a tab. It marks itself for a moment when it changes, so the eye
 * finds where a row went. The first count that is read does not: nothing moved.
 */
function Count({ value, state }: { value: number | null; state: RowState }) {
  const before = useRef(value);
  // It stays set: a render that follows the change must not cut the mark short.
  const [marks, setMarks] = useState(false);

  useEffect(() => {
    if (before.current !== null && value !== null && before.current !== value) setMarks(true);

    before.current = value;
  }, [value]);

  // A tab with no row shows no count (DB-657).
  if (value === 0) return null;

  return (
    // The key starts the mark again at each change.
    <span
      key={value ?? 'unread'}
      className={`count font-mono text-xs font-medium ${PILL[state]} ${marks ? 'count-changed' : ''}`}
    >
      {/* A count nobody read is a dash, never a zero: zero says « nothing is missing ». */}
      {value === null ? '–' : countOf(value)}
    </span>
  );
}

const PAGE_BUTTON = 'size-9 min-w-9 rounded-[7px] p-0 text-sm';

/**
 * The pages of the table, by number. It shows nothing for a list of one page.
 *
 * The open number says where the page sits. A reader of the screen hears it
 * from a live region, « Page 2 sur 17 », after a change.
 */
function Pager({ page, onPage }: { page: Page<Row>; onPage: (page: number) => void }) {
  if (page.pages === 1) return null;

  return (
    <nav aria-label="Pages du tableau" className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-muted text-[13px]">
        Clés {countOf(page.from)} à {countOf(page.to)} sur {countOf(page.total)}
        <span role="status" className="sr-only">
          Page {countOf(page.page)} sur {countOf(page.pages)}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          aria-label="Page précédente"
          isDisabled={page.page === 1}
          onPress={() => onPage(page.page - 1)}
          className={PAGE_BUTTON}
        >
          <ChevronDown size={16} className="rotate-90" />
        </Button>
        {pageNumbersOf(page.page, page.pages).map((place) =>
          typeof place === 'number' ? (
            <Button
              key={place}
              variant={place === page.page ? 'outline' : 'ghost'}
              aria-label={`Page ${countOf(place)}`}
              aria-current={place === page.page ? 'page' : undefined}
              onPress={() => onPage(place)}
              className={`${PAGE_BUTTON} ${place === page.page ? 'border-signal text-signal font-semibold' : 'text-sub'}`}
            >
              {countOf(place)}
            </Button>
          ) : (
            // The dots are a button: they open the middle of the pages they stand for.
            <Button
              key={`gap-${place.from}`}
              variant="ghost"
              aria-label={`Pages ${countOf(place.from)} à ${countOf(place.to)}`}
              onPress={() => onPage(Math.round((place.from + place.to) / 2))}
              className={`${PAGE_BUTTON} text-muted`}
            >
              …
            </Button>
          ),
        )}
        <Button
          variant="outline"
          aria-label="Page suivante"
          isDisabled={page.page === page.pages}
          onPress={() => onPage(page.page + 1)}
          className={PAGE_BUTTON}
        >
          <ChevronDown size={16} className="-rotate-90" />
        </Button>
      </div>
    </nav>
  );
}

const VIEW = 'i18n.view';

type View = 'table' | 'key';

/** The view that was used last, kept by the browser. The table is the one a first visit opens. */
const viewAtStart = (): View => {
  try {
    return window.localStorage.getItem(VIEW) === 'key' ? 'key' : 'table';
  } catch {
    return 'table';
  }
};

/** The switch between the table and the view of one key. */
function ViewSwitch({ view, onView, isDisabled }: { view: View; onView: (view: View) => void; isDisabled: boolean }) {
  return (
    <ToggleButtonGroup
      aria-label="Vue"
      selectionMode="single"
      disallowEmptySelection
      isDisabled={isDisabled}
      selectedKeys={[view]}
      onSelectionChange={(keys) => {
        const [next] = [...keys];

        if (next) onView(next as View);
      }}
      className="switch"
    >
      <Tooltip delay={300}>
        <ToggleButton id="table" aria-label="Tableau">
          <TableView size={15} />
        </ToggleButton>
        <Tooltip.Content>Tableau</Tooltip.Content>
      </Tooltip>
      <Tooltip delay={300}>
        <ToggleButton id="key" aria-label="Clé par clé">
          <KeyView size={15} />
        </ToggleButton>
        <Tooltip.Content>Clé par clé</Tooltip.Content>
      </Tooltip>
    </ToggleButtonGroup>
  );
}

function Editor({
  account,
  waiting,
  repositoryId,
}: {
  account: string;
  waiting: React.RefObject<number>;
  /** The repository of the address `/repositories/:id`. None on `/setup`, which opens the first one. */
  repositoryId: string | null;
}) {
  const slots = use(ShellSlots);
  const search = useRef<HTMLInputElement>(null);

  // « / » goes to the search, as the key drawn in the field says. A slash typed in a field is a slash.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      const at = event.target;

      if (at instanceof HTMLElement && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) return;
      if (!search.current || search.current.disabled) return;

      event.preventDefault();
      search.current.focus();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  const [me, reloadMe] = useRead('me', () => rightsOf(api));
  const [repositories, reloadRepositories] = useRead('repositories', () => readRepositories(api));
  const navigate = useNavigate();
  const openRepository = (id: string, options?: { replace?: boolean }) =>
    navigate(`/repositories/${encodeURIComponent(id)}`, { ...options, viewTransition: true });
  const [language, setLanguage] = useState<string | null>(null);
  // GitHub sends the browser back to `/setup` after an installation of the App (DB-581).
  const [connecting, setConnecting] = useState(() => window.location.pathname === SETUP_PATH);
  const [justInstalled] = useState(() => setupReturnOf(window.location.search).installationId);

  const repository =
    repositories.state === 'done'
      ? repositoryId
        ? (repositories.value.find((row) => row.id === repositoryId) ?? null)
        : (repositories.value[0] ?? null)
      : null;
  const access = useMemo(
    () =>
      me.state === 'done' && repository
        ? accessOf(rightsIn(me.value, repository.id), repository.targets, repository.source)
        : null,
    [me, repository],
  );
  // The source comes first in the list, and opens only when it is chosen: a
  // visit opens the first language there is to translate (DB-607).
  const opened =
    access && language && access.languages.includes(language)
      ? language
      : (access?.languages.find((code) => code !== repository?.source) ?? access?.languages[0] ?? null);
  const readKey = repository && opened ? `${repository.id}\n${opened}` : null;

  // A value typed and not sent stays on the rows it was typed against: the poll waits for it.
  const poll = { everyMs: POLL_MS, when: () => waiting.current === 0 };
  // The count of files read shows on the first read alone: a poll reads with no sign.
  const [catalogueProgress, setCatalogueProgress] = useState<({ key: string } & CatalogueProgress) | null>(null);
  const showsProgress = useRef(true);
  const [catalogue, reloadCatalogue] = useRead(
    readKey && `catalogue\n${readKey}`,
    () => {
      const key = readKey!;

      return readCatalogueStream(api, repository!.id, opened!, (progress) => {
        if (showsProgress.current) setCatalogueProgress({ key, ...progress });
      });
    },
    poll,
  );

  showsProgress.current = catalogue.state !== 'done';
  const [proposed, reloadProposed] = useRead(
    readKey && `proposed\n${readKey}`,
    () => readProposedKeys(api, repository!.id, opened!),
    poll,
  );
  // The other languages of the side panel. The open one counts its own rows, which a write changes at once.
  const [progress, reloadProgress] = useRead(
    repository ? `progress\n${repository.id}` : null,
    () => readProgress(api, repository!.id),
    poll,
  );
  // The pull request that carries the publications, for a repository that publishes through one (DB-606).
  const [publication, reloadPublication] = useRead(
    repository?.publishMode === 'pull_request' ? `publication\n${repository.id}` : null,
    () => readPublication(api, repository!.id),
    poll,
  );

  const [filter, setFilter] = useState<RowState>('missing');
  const [query, setQuery] = useState('');
  // The file or the section the table is narrowed to, from the side panel. It
  // names whole segments, which a search cannot.
  const [scope, setScope] = useState<Scope | null>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<ReadError | null>(null);
  const [createdNote, setCreatedNote] = useState<{
    file: string;
    key: string;
    commit: string;
    pullRequest: PublishPull | null;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [view, setViewState] = useState<View>(viewAtStart);
  // The key that the view of one key shows. A key that left the list gives its place to the next one.
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = useRef(0);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  const [published, setPublished] = useState<ReadonlyMap<string, PublishedValue>>(new Map());
  const [busy, setBusy] = useState<'proposing' | 'publishing' | 'keeping' | null>(null);
  const [writeError, setWriteError] = useState<{
    title: string;
    error: ReadError;
    of: 'proposal' | 'publication' | 'review';
  } | null>(null);
  const [report, setReport] = useState<{
    published: number;
    refused: RefusedKey[];
    pullRequest: PublishPull | null;
  } | null>(null);
  const [writes, setWrites] = useState<Writes | null>(null);
  const [sentNote, setSentNote] = useState<{ keys: number; commit: string } | null>(null);

  // What was typed, ticked or just published belongs to one language of one
  // repository. Kept across a change, a draft would be sent to another language.
  useEffect(() => {
    setDrafts(new Map());
    setApproved(new Set());
    setPublished(new Map());
    setWrites(null);
    setWriteError(null);
    setReport(null);
    setSentNote(null);
    setPage(1);
    setQuery('');
    setScope(null);
    setOpenId(null);
    openIndex.current = 0;
    setUnfolded(new Set());
    setCreating(false);
    setCreateError(null);
    setCreatedNote(null);
  }, [readKey]);

  const sourceCode = repository?.source ?? null;

  // The source has no tab « À revoir » (DB-607).
  useEffect(() => {
    if (opened !== null && opened === sourceCode) setFilter((before) => (before === 'review' ? 'missing' : before));
  }, [opened, sourceCode]);

  // A reload or a closed tab drops what was typed. The browser asks first.
  useEffect(() => {
    const ask = (event: BeforeUnloadEvent) => {
      if (waiting.current > 0) event.preventDefault();
    };

    window.addEventListener('beforeunload', ask);

    return () => {
      window.removeEventListener('beforeunload', ask);
      waiting.current = 0;
    };
  }, [waiting]);

  const rows = useMemo(
    () =>
      catalogue.state === 'done' && proposed.state === 'done'
        ? rowsOf(withPublished(catalogue.value, published), withWrites(proposed.value, writes))
        : [],
    [catalogue, proposed, published, writes],
  );

  const byId = useMemo(() => new Map(rows.map((row) => [idOf(row), row])), [rows]);
  const changed = useMemo(
    () =>
      [...drafts].filter(([id, value]) => {
        const row = byId.get(id);

        return row !== undefined && value.trim().length > 0 && value !== (row.proposal?.value ?? row.published ?? '');
      }),
    [drafts, byId],
  );

  // The keys of the source, by file: what a new key must not name again.
  const keysByFile = useMemo(() => {
    const byFile = new Map<string, Set<string>>();

    if (catalogue.state === 'done') {
      for (const entry of catalogue.value.entries) {
        if (!byFile.has(entry.file)) byFile.set(entry.file, new Set());

        byFile.get(entry.file)!.add(entry.key);
      }
    }

    return byFile;
  }, [catalogue]);

  // The header and the guard of the browser read it. An effect writes it, so a
  // render that React drops leaves no count behind.
  useEffect(() => {
    waiting.current = changed.length;
  }, [changed.length, waiting]);

  // A row that a write takes out of the list closes before it leaves.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const settling = useRef<number | undefined>(undefined);
  const top = useRef<HTMLDivElement>(null);
  const swapped = useRef<HTMLDivElement>(null);

  useSwap(swapped, filter);

  useEffect(
    () => () => {
      window.clearTimeout(settling.current);
      setLeaving(new Set());
    },
    [readKey],
  );

  if (me.state === 'failed') return <AccountFailure error={me.error} onRetry={reloadMe} />;
  if (repositories.state === 'failed')
    return <AccountFailure error={repositories.error} onRetry={reloadRepositories} />;
  if (me.state === 'loading' || repositories.state === 'loading') return <Loading>Lecture du compte…</Loading>;

  const installUrl = me.value.admin ? me.value.installUrl : null;

  /** Leaves `/setup` for the address of the editor, so a reload opens the table and not the flow again. */
  const closeConnect = () => {
    setConnecting(false);

    if (window.location.pathname !== SETUP_PATH) return;

    if (repository) openRepository(repository.id, { replace: true });
    else void navigate('/', { replace: true });
  };

  if (installUrl && (connecting || !repository)) {
    return (
      <ConnectRepository
        installUrl={installUrl}
        connected={repositories.value}
        justInstalled={justInstalled}
        onConnected={(id) => {
          setConnecting(false);
          openRepository(id, { replace: window.location.pathname === SETUP_PATH });
          reloadRepositories();
          forgetReads('overview');
        }}
        onCancel={repository ? closeConnect : undefined}
      />
    );
  }

  if (!repository && repositoryId && repositories.value.length > 0) {
    return (
      <Blocked icon={<Repository size={18} />}>
        <p className="text-sm leading-normal">Ce dépôt n'est pas branché, ou il ne l'est plus.</p>
        <Link to="/" viewTransition className="hover:text-signal text-[13px] underline">
          Voir tous les dépôts
        </Link>
      </Blocked>
    );
  }

  if (!repository) {
    return (
      <Blocked icon={<Repository size={18} />}>
        <p className="text-sm leading-normal">Aucun dépôt n'est configuré pour la traduction.</p>
        <p className="text-sub text-sm leading-normal">Demandez à un admin de brancher un dépôt.</p>
      </Blocked>
    );
  }

  if (!access || !opened) {
    return (
      <Blocked icon={<Lock size={18} />}>
        <span className="border-line-strong rounded-md border px-3 py-1.5 font-mono text-xs">
          {repository.owner}/{repository.name}
        </span>
        <p className="text-sm leading-normal">Ce compte n'a aucune langue ouverte sur ce dépôt.</p>
      </Blocked>
    );
  }

  const mayPropose = access.mayPropose(opened);
  // A source text says something: only a translation is left empty on purpose (DB-611).
  const mayMark = mayPropose && opened !== repository.source;
  const editsSource = opened === repository.source;
  const states = statesOf(editsSource);
  const mayPublish = access.mayPublish(opened);
  const read = catalogue.state === 'done' && proposed.state === 'done';
  const failed = catalogue.state === 'failed' || proposed.state === 'failed';
  const refreshing =
    (catalogue.state === 'done' && catalogue.refreshing === true) ||
    (proposed.state === 'done' && proposed.refreshing === true);
  const edited = new Set(changed.map(([id]) => id));
  // An edited proposal is not published: the publication copies the value of
  // the branch, not the text in the field.
  const ticked = [...approved].filter((id) => byId.get(id)?.proposal && !edited.has(id));
  // A translation « à revoir » that a reviewer keeps as it is (DB-607).
  const mayReview = access.mayReview(opened);
  const keptIds = [...approved].filter((id) => byId.get(id)?.state === 'review' && !edited.has(id));
  // The tick column shows where a tick acts: the proposals to publish, the translations to keep.
  const tickable = (mayPublish && filter === 'proposed') || (mayReview && filter === 'review') ? approved : null;
  const found = matching(rows, query);
  const narrowed = scope ? under(found, scope) : found;
  // The counts follow the file and the search, so a tab never says more than its table shows.
  const counts = countsOf(narrowed);
  const visible = narrowed.filter((row) => row.state === filter);
  const isNarrowed = scope !== null || query.trim() !== '';
  const empty =
    filter === 'missing' && counts.proposed > 0 ? (
      <NothingMissing
        narrowed={isNarrowed}
        proposed={counts.proposed}
        mayPublish={mayPublish}
        onShow={() => {
          setFilter('proposed');
          setPage(1);
          setOpenId(null);
          openIndex.current = 0;
        }}
      />
    ) : isNarrowed ? (
      EMPTY_NARROWED[filter]
    ) : (
      EMPTY[filter]
    );
  const open = openOf(visible, openId, openIndex.current);
  // The pull request is where the proposals go when they are published.
  const pullBand =
    repository.publishMode === 'pull_request' && filter === 'proposed' ? (
      <PullBand read={publication} branch={repository.branch} onRetry={reloadPublication} />
    ) : null;
  // In the view of one key, the page of the list is the page of the open key.
  const paged = pageOf(visible, view === 'key' && open ? Math.floor(open.index / PAGE) + 1 : page, PAGE);
  // What waits and is not on the screen. The table shows a page; the view of one key walks the whole list.
  const onScreen = new Set((view === 'key' ? visible : paged.rows).map(idOf));
  const changedElsewhere = changed.filter(([id]) => !onScreen.has(id)).length;
  const tickedElsewhere = ticked.filter((id) => !onScreen.has(id)).length;

  const setView = (next: View) => {
    // The table opens on the page of the key that was open, and not on the one it showed before.
    if (next === 'table' && open) setPage(Math.floor(open.index / PAGE) + 1);

    setViewState(next);

    try {
      window.localStorage.setItem(VIEW, next);
    } catch {
      // The view still changes. Only the next visit forgets it.
    }
  };

  const approve = (ids: readonly string[], on: boolean) =>
    setApproved((before) => {
      const next = new Set(before);

      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }

      return next;
    });

  const viewSwitch = <ViewSwitch view={view} onView={setView} isDisabled={!read} />;
  const refusedWhy = new Map((report?.refused ?? []).map((row) => [idOf(row), REFUSAL[row.reason]]));

  /**
   * Applies a write to the table after the rows it takes out have closed.
   *
   * With reduced motion nothing closes: the write applies at once.
   */
  const settle = (ids: readonly string[], apply: () => void) => {
    if (ids.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();

      return;
    }

    setLeaving(new Set(ids));
    // One write settles at a time. A timer that is left would open the rows of the next one.
    window.clearTimeout(settling.current);
    settling.current = window.setTimeout(() => {
      apply();
      setLeaving(new Set());
    }, LEAVE_MS);
  };

  /**
   * Proposes values. A row sent with `empty` takes the mark « vide voulu », and one sent
   * without it loses the mark (DB-611).
   */
  const send = async (sent: Array<{ row: Row; value: string; empty?: true }>) => {
    if (catalogue.state !== 'done' || proposed.state !== 'done') return;

    if (sent.length === 0 || busy !== null || leaving.size > 0) return;

    setBusy('proposing');
    setWriteError(null);
    setReport(null);
    setSentNote(null);

    try {
      const answer = await propose(api, {
        repository: repository.id,
        language: opened,
        // The revision the translator read. The API refuses a head of its own.
        readAt: catalogue.value.commit,
        values: sent.map(({ row, value, empty }) => ({
          file: row.file,
          key: row.key,
          value,
          ...(empty ? { empty } : {}),
        })),
      });

      // The cache keeps no read that the page draws under its own record of the write.
      forgetReads(`proposed\n${readKey}`);
      forgetReads('overview');
      setSentNote({ keys: sent.length, commit: answer.commit });
      // A proposed key leaves every list but the one of the proposals.
      settle(filter === 'proposed' ? [] : sent.map(({ row }) => idOf(row)), () => {
        setWrites((before) =>
          afterProposal(
            before,
            proposed.value,
            sent.map(({ row, value, empty }) => ({
              file: row.file,
              key: row.key,
              value,
              current: row.published,
              source: row.source,
              commit: answer.commit,
              readAt: answer.readAt,
              author: account,
              at: new Date().toISOString(),
              ...(empty ? { empty } : {}),
            })),
          ),
        );
        // A text typed while the proposal was on its way stays in its field.
        setDrafts((now) => draftsAfterProposal(now, new Map(sent.map(({ row, value }) => [idOf(row), value]))));
        reloadProposed();
        reloadProgress();
      });
    } catch (error) {
      setWriteError({
        title: "Les propositions n'ont pas été écrites. Les textes saisis sont toujours dans leurs champs.",
        error: readErrorOf(error),
        of: 'proposal',
      });
    } finally {
      setBusy(null);
    }
  };

  const save = () => send(changed.map(([id, value]) => ({ row: byId.get(id)!, value })));

  /**
   * Proposes `""` with the mark « vide voulu », or removes the mark.
   *
   * A removal proposes the published value again: a key that the base branch left empty is then missing.
   */
  const markEmpty = (row: Row, empty: boolean) =>
    send([{ row, value: empty ? '' : (row.published ?? ''), ...(empty ? { empty: true as const } : {}) }]);

  const release = async () => {
    if (proposed.state !== 'done' || ticked.length === 0 || busy !== null || leaving.size > 0) return;

    setBusy('publishing');
    setWriteError(null);
    setReport(null);
    setSentNote(null);

    try {
      const sent = ticked.map((id) => byId.get(id)!);
      const answer = await publish(api, {
        repository: repository.id,
        language: opened,
        approved: sent.map((row) => ({ file: row.file, key: row.key, commit: row.proposal!.commit })),
      });

      forgetReads(`catalogue\n${readKey}`);
      forgetReads(`proposed\n${readKey}`);
      forgetReads('overview');
      const values = new Map(
        sent.map((row) => [idOf(row), { value: row.proposal!.value, empty: row.proposal!.empty }]),
      );

      setReport({
        published: answer.published.length,
        refused: answer.refused,
        pullRequest: answer.pullRequest ?? null,
      });
      if (answer.pullRequest) reloadPublication();

      setApproved(new Set());
      settle(filter === 'published' ? [] : answer.published.map(idOf), () => {
        // The published value and the end of the proposal come together: one alone shows a row in a state it never had.
        setPublished(
          (before) =>
            new Map([...before, ...answer.published.map((row) => [idOf(row), values.get(idOf(row))!] as const)]),
        );
        setWrites((before) => afterPublication(before, proposed.value, answer.published.map(idOf)));
        reloadProposed();
        reloadProgress();
      });
    } catch (error) {
      const failed = readErrorOf(error);

      setWriteError({
        title:
          failed.status === 503 && repository.publishMode === 'pull_request'
            ? "Les clés n'ont pas été publiées : l'App GitHub n'a pas encore la permission « Pull requests ». Les cases cochées le sont toujours."
            : failed.status === 409 && repository.publishMode === 'pull_request'
              ? "Les clés n'ont pas été publiées : la pull request des publications est en conflit avec la branche. Les cases cochées le sont toujours."
              : "Les clés n'ont pas été publiées. Les cases cochées le sont toujours.",
        error: failed,
        of: 'publication',
      });
    } finally {
      setBusy(null);
    }
  };

  const keep = async () => {
    if (keptIds.length === 0 || busy !== null || leaving.size > 0) return;

    setBusy('keeping');
    setWriteError(null);
    setReport(null);
    setSentNote(null);

    try {
      const sent = keptIds.map((id) => byId.get(id)!);
      const answer = await keepTranslations(api, {
        repository: repository.id,
        language: opened,
        keys: sent.map((row) => ({ file: row.file, key: row.key })),
      });

      forgetReads(`catalogue\n${readKey}`);
      forgetReads(`proposed\n${readKey}`);
      forgetReads('overview');

      if (answer.pullRequest) reloadPublication();

      setApproved(new Set());
      // A kept translation reads as published again: its value does not change.
      settle(filter === 'published' ? [] : answer.kept.map(idOf), () => {
        setPublished(
          (before) =>
            new Map([
              ...before,
              ...answer.kept.map((row) => {
                const held = byId.get(idOf(row));

                // A key left empty on purpose is kept empty, with its mark (DB-611).
                return [
                  idOf(row),
                  { value: held?.published ?? '', ...(held?.empty ? { empty: true as const } : {}) },
                ] as const;
              }),
            ]),
        );
        reloadProgress();
      });
    } catch (error) {
      setWriteError({
        title: "Les traductions n'ont pas été gardées. Les cases cochées le sont toujours.",
        error: readErrorOf(error),
        of: 'review',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {slots.project &&
        createPortal(
          <>
            <span className="inline-flex items-center gap-2">
              {repositories.value.length > 1 || installUrl ? (
                <Choice
                  label="Changer de projet"
                  value={repository.id}
                  items={repositories.value.map((row) => ({
                    value: row.id,
                    label: row.name,
                    icon: <OwnerAvatar owner={row.owner} src={row.avatarUrl} />,
                  }))}
                  onChange={(next) => next !== repository.id && mayLeave(changed.length) && openRepository(next)}
                  action={
                    installUrl
                      ? {
                          label: 'Ajouter un dépôt',
                          icon: <Plus size={14} />,
                          onAction: () => mayLeave(changed.length) && setConnecting(true),
                        }
                      : undefined
                  }
                  className="min-w-[170px]"
                />
              ) : (
                // One repository is no choice: its name is a link, and no button.
                <Outside
                  href={repositoryUrl(repository)}
                  className="inline-flex items-center gap-2 text-[13px] font-medium no-underline"
                >
                  <OwnerAvatar owner={repository.owner} src={repository.avatarUrl} />
                  {repository.name}
                </Outside>
              )}
            </span>
            {manages(rightsIn(me.value, repository.id)) && (
              <Link
                to={`/repositories/${encodeURIComponent(repository.id)}/settings`}
                viewTransition
                onClick={(event) => {
                  if (!mayLeave(changed.length)) event.preventDefault();
                }}
                className="button button--sm button--ghost text-sub hover:text-ink text-[13px] no-underline"
              >
                <Gear size={14} />
                Réglages
              </Link>
            )}
            {manages(rightsIn(me.value, repository.id)) && (
              <span title="La branche et le commit lus par cette page" className="text-muted font-mono text-xs">
                <Outside href={branchUrl(repository)} className="text-sub no-underline">
                  {repository.branch}
                </Outside>{' '}
                @{' '}
                {catalogue.state === 'done' ? (
                  // The commit that was read, not the head of the branch.
                  <Outside href={commitUrl(repository, catalogue.value.commit)} className="text-sub no-underline">
                    {catalogue.value.commit.slice(0, 7)}
                  </Outside>
                ) : (
                  '–'
                )}
              </span>
            )}
          </>,
          slots.project,
        )}

      {slots.side &&
        createPortal(
          <>
            <Languages
              languages={access.languages.map((code) => ({
                code,
                name: code === repository.source ? `${titleOf(nameOf(code))} (source)` : titleOf(nameOf(code)),
                counts:
                  code === opened && read
                    ? countsOf(rows)
                    : progress.state === 'done'
                      ? (progress.value.find((row) => row.language === code) ?? null)
                      : null,
                readOnly: !access.mayPropose(code),
              }))}
              opened={opened}
              onOpen={(next) => next !== opened && mayLeave(changed.length) && setLanguage(next)}
              folded={slots.folded}
              onFold={slots.setFolded}
              // One language has no other to read: its card counts its own rows.
              onRetry={progress.state === 'failed' && access.languages.length > 1 ? reloadProgress : null}
            />
            {/* The rail holds the languages alone. A file that was chosen stays chosen. */}
            {read && !slots.folded && (
              <FilesTree
                // The counts follow the search: the tree says where the keys it keeps are.
                tree={treeOf(found, filesIn(catalogue.value, 'disabled'))}
                scope={scope}
                opened={unfolded}
                onOpened={setUnfolded}
                onScope={(node) => {
                  setScope(node && { file: node.file, path: node.path });
                  openIndex.current = 0;
                  // The tree counts the missing keys. A node with nothing in the open tab would land on an empty table.
                  if (node && node.counts[filter] === 0)
                    setFilter(ROW_STATES.find((state) => node.counts[state] > 0) ?? filter);
                  setPage(1);
                }}
              />
            )}
          </>,
          slots.side,
        )}

      <LanguageHeader
        name={opened === repository.source ? `${titleOf(nameOf(opened))} (source)` : titleOf(nameOf(opened))}
        code={opened}
        // The source is translated from nothing.
        source={
          read && opened !== repository.source
            ? { name: nameOf(catalogue.value.source), code: catalogue.value.source }
            : null
        }
        // The whole language, not what the file or the search keeps.
        counts={read ? countsOf(rows) : null}
        emptyCount={read ? emptyCountOf(rows) : 0}
        readOnly={read && !mayPropose}
        compact={view === 'key'}
        aside={view === 'key' ? viewSwitch : undefined}
        newKeyDisabled={!read || creating}
        onNewKey={
          access.mayCreate
            ? () => {
                setCreateError(null);
                setCreating(true);
              }
            : null
        }
      />

      {read && creating && (
        <NewKey
          // An API before DB-225 names no file: the files of the rows are then what is known.
          files={[...new Set([...Object.keys(catalogue.value.files ?? {}), ...rows.map((row) => row.file)])].sort()}
          disabled={new Set(filesIn(catalogue.value, 'disabled'))}
          language={nameOf(opened)}
          source={{ name: nameOf(catalogue.value.source), code: catalogue.value.source }}
          existing={keysByFile}
          startFile={scope?.file ?? ''}
          error={createError}
          onCancel={() => setCreating(false)}
          onCreate={async (created) => {
            setCreateError(null);

            try {
              const answer = await createKeys(api, { repository: repository.id, values: [created] });

              setCreating(false);
              setCreatedNote({
                file: created.file,
                key: created.key,
                commit: answer.commit,
                pullRequest: answer.pullRequest ?? null,
              });
              if (answer.pullRequest) reloadPublication();
              // The table goes to the key: it is missing in this language, and that is where it shows.
              setFilter('missing');
              setScope({ file: created.file, path: '' });
              setQuery(created.key);
              setPage(1);
              reloadCatalogue();
              // A new key is missing in every language.
              reloadProgress();
              forgetReads(`catalogue\n${repository.id}`);
              forgetReads('overview');
            } catch (error) {
              setCreateError(readErrorOf(error));
            }
          }}
        />
      )}

      {createdNote && (
        <section
          aria-label="Compte rendu de création"
          role="status"
          className="arrive border-line-strong flex flex-wrap items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm"
        >
          <Published />
          <span className="font-semibold">Clé créée.</span>
          <span className="font-mono text-[13px]">
            {createdNote.file} · {createdNote.key}
          </span>
          <span className="text-sub">
            Commit{' '}
            <Outside href={commitUrl(repository, createdNote.commit)} className="font-mono text-[13px] underline">
              {createdNote.commit.slice(0, 7)}
            </Outside>
            {createdNote.pullRequest && (
              <>
                {' '}
                dans la{' '}
                <Outside href={createdNote.pullRequest.url} className="underline">
                  PR #{createdNote.pullRequest.number}
                </Outside>
              </>
            )}
            . Elle est maintenant à traduire.
          </span>
          <button type="button" onClick={() => setCreatedNote(null)} className="link ml-auto text-[13px]">
            Fermer
          </button>
        </section>
      )}

      {/* The tabs and the actions stay in reach from the hundredth row. */}
      {view === 'table' && (
        <div className="sticky top-0 z-10 -mx-8 flex flex-col bg-white px-8">
          <div className="border-line flex flex-wrap items-end justify-between gap-x-6 border-b">
            <Sliding selected={read ? filter : null} markClassName="tabs-mark">
              <ToggleButtonGroup
                aria-label="Filtrer par état"
                selectionMode="single"
                disallowEmptySelection
                isDisabled={!read}
                // Nothing is pressed while nothing is read: a pressed tab would name a list that is not there.
                selectedKeys={read ? [filter] : []}
                onSelectionChange={(keys) => {
                  const [next] = [...keys];

                  if (next) {
                    setFilter(next as RowState);
                    setPage(1);
                  }
                }}
                className="tabs"
              >
                {states.map((state) => (
                  <ToggleButton key={state} id={state}>
                    {FILTER_LABEL[state]} <Count value={read ? counts[state] : null} state={state} />
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Sliding>

            <div className="my-[5px] flex flex-wrap items-center gap-2.5">
              <KeySearch
                rows={scope ? under(rows, scope) : rows}
                query={query}
                isDisabled={!read}
                onQuery={(next) => {
                  setQuery(next);
                  setPage(1);
                }}
                onPick={(row) => {
                  // The key opens in its own list, with the search that found it.
                  setFilter(row.state);
                  setOpenId(idOf(row));
                  setView('key');
                }}
                inputRef={search}
              />
              {viewSwitch}
            </div>
          </div>
        </div>
      )}

      {catalogue.state === 'failed' && (
        <Failure title="Les traductions n'ont pas pu être lues." error={catalogue.error} onRetry={reloadCatalogue} />
      )}
      {catalogue.state !== 'failed' && proposed.state === 'failed' && (
        <Failure title="Les propositions n'ont pas pu être lues." error={proposed.error} onRetry={reloadProposed} />
      )}
      {!read && !failed && (
        <div className="border-line rounded-[10px] border">
          <CatalogueLoading progress={catalogueProgress?.key === readKey ? catalogueProgress : null} />
        </div>
      )}
      {catalogue.state === 'done' && catalogue.stale && (
        <Failure
          title="Les traductions n'ont pas pu être relues. Ce qui est affiché peut être périmé."
          error={catalogue.stale}
          onRetry={reloadCatalogue}
        />
      )}
      {proposed.state === 'done' && proposed.stale && (
        <Failure
          title="Les propositions n'ont pas pu être relues. Ce qui est affiché peut être périmé."
          error={proposed.stale}
          onRetry={reloadProposed}
        />
      )}

      {writeError && (
        <Failure
          title={writeError.title}
          error={writeError.error}
          onRetry={writeError.of === 'proposal' ? save : writeError.of === 'review' ? keep : release}
          written
        />
      )}

      {sentNote && (
        <section
          aria-label="Compte rendu de proposition"
          role="status"
          className="arrive border-line-strong flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm"
        >
          <Published />
          <span className="font-semibold">
            {countOf(sentNote.keys)} {sentNote.keys > 1 ? 'traductions proposées' : 'traduction proposée'}.
          </span>
          <span className="text-sub">
            Lot{' '}
            <Outside href={commitUrl(repository, sentNote.commit)} className="font-mono text-[13px] underline">
              {sentNote.commit.slice(0, 7)}
            </Outside>
            , en attente de relecture.
          </span>
          <button type="button" onClick={() => setSentNote(null)} className="link ml-auto text-[13px]">
            Fermer
          </button>
        </section>
      )}

      {report && (
        <section
          aria-label="Compte rendu de publication"
          role="status"
          className="arrive border-line-strong flex flex-col gap-2.5 rounded-lg border px-4 py-3.5"
        >
          <div className="flex items-center gap-2.5 text-sm font-semibold">
            {report.published > 0 ? <Published /> : <Info size={18} className="text-muted" />}
            {report.published === 0
              ? `Aucune clé publiée ${publishedWhere(repository.branch, report.pullRequest)}.`
              : `${countOf(report.published)} ${report.published > 1 ? 'clés publiées' : 'clé publiée'} ${publishedWhere(repository.branch, report.pullRequest)}.`}
            {report.pullRequest && (
              <Outside href={report.pullRequest.url} className="text-[13px] font-normal underline">
                Ouvrir la PR #{report.pullRequest.number}
              </Outside>
            )}
            <button type="button" onClick={() => setReport(null)} className="link ml-auto text-[13px] font-normal">
              Fermer
            </button>
          </div>
          {report.refused.length > 0 && (
            <div className="flex flex-col gap-1.5 pl-7">
              <span className="text-alarm-strong text-[13px] font-semibold">
                {report.refused.length} {report.refused.length > 1 ? 'clés refusées' : 'clé refusée'}
              </span>
              <ul className="flex flex-col gap-1">
                {report.refused.map((row) => (
                  <li key={idOf(row)} className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-normal">
                    <span className="min-w-[260px] font-mono">
                      {row.file} · {row.key}
                    </span>
                    <span className="text-sub">{REFUSAL[row.reason]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {read && (
        <>
          {/* The line keeps its height when nothing is read again, so the table does not move. */}
          <div
            ref={top}
            className="text-muted -my-3 flex min-h-5 scroll-mt-[72px] items-center justify-end gap-4 text-xs"
          >
            <span role="status" className="inline-flex items-center gap-1.5">
              {refreshing && (
                <>
                  <Busy />
                  Relecture…
                </>
              )}
            </span>
          </div>
          {view === 'key' ? (
            <KeyByKey
              page={paged}
              onPage={(next) => setOpenId(idOf(visible[(next - 1) * PAGE]))}
              open={open && { row: open.row, place: open.index + 1 }}
              onOpen={setOpenId}
              onPlace={(index) => {
                openIndex.current = index;
              }}
              onStep={(by) => {
                const next = open && visible[open.index + by];

                if (next) setOpenId(idOf(next));

                return Boolean(next);
              }}
              filter={filter}
              onFilter={(next) => {
                setFilter(next);
                setPage(1);
                // Another list: its first key, and not the place the last one was left at.
                setOpenId(null);
                openIndex.current = 0;
              }}
              counts={counts}
              query={query}
              onQuery={(next) => {
                setQuery(next);
                setPage(1);
                // The open key stays open if the search keeps it. If not, the first one opens.
                openIndex.current = 0;
              }}
              search={search}
              language={{ name: nameOf(opened), code: opened }}
              source={{ name: nameOf(catalogue.value.source), code: catalogue.value.source }}
              drafts={drafts}
              onDraft={(id, value) => setDrafts((before) => new Map(before).set(id, value))}
              onReset={(id) =>
                setDrafts((before) => {
                  const next = new Map(before);

                  next.delete(id);

                  return next;
                })
              }
              readOnly={!mayPropose}
              editsSource={editsSource}
              states={states}
              approved={tickable}
              onApprove={approve}
              refused={refusedWhy}
              onSubmit={save}
              onMark={mayMark ? markEmpty : undefined}
              markDisabled={busy !== null || leaving.size > 0}
              empty={empty}
              notice={pullBand}
              fileHref={(name) => fileUrl(repository, catalogue.value.commit, catalogue.value.source, name)}
              commitHref={(commit) => commitUrl(repository, commit)}
              neighbours={open ? neighboursOf(rows, open.row, drafts) : null}
              onNeighbour={(id) => {
                const next = byId.get(id);

                if (!next) return;

                // The key can sit outside the list on the screen: its state, the search or the scope can hide it.
                // The list follows the key, so the open key is always in it.
                setFilter(next.state);
                setQuery('');
                if (scope && under([next], scope).length === 0) setScope(null);
                setOpenId(id);
              }}
              onSection={(section) => {
                if (!open) return;

                const target = { file: open.row.file, path: section };

                setScope(target);
                setQuery('');
                // The tab of the open key: the key is in its section, so the list keeps it open.
                setFilter(open.row.state);
                // The side panel shows the section: its file unfolds, so the chosen entry is in sight.
                setUnfolded((before) => new Set(before).add(scopeIdOf({ file: target.file, path: '' })));
              }}
            />
          ) : (
            <>
              <div ref={swapped} className="flex flex-col gap-3">
                {pullBand}
                <KeyTable
                  rows={paged.rows}
                  language={{ name: nameOf(opened), code: opened }}
                  source={{ name: nameOf(catalogue.value.source), code: catalogue.value.source }}
                  drafts={drafts}
                  onDraft={(id, value) => setDrafts((before) => new Map(before).set(id, value))}
                  readOnly={!mayPropose}
                  editsSource={editsSource}
                  ticksKeep={filter === 'review'}
                  // The column of the ticks shows where a tick acts: under « Proposées », and under « À revoir ».
                  approved={tickable}
                  onApprove={approve}
                  refused={refusedWhy}
                  leaving={leaving}
                  onSubmit={save}
                  onMark={mayMark ? markEmpty : undefined}
                  markDisabled={busy !== null || leaving.size > 0}
                  empty={empty}
                  fileHref={(name) => fileUrl(repository, catalogue.value.commit, catalogue.value.source, name)}
                  commitHref={(commit) => commitUrl(repository, commit)}
                />
              </div>
              <Pager
                page={paged}
                onPage={(next) => {
                  setPage(next);
                  // The pager sits under the table: the new page starts at its top.
                  top.current?.scrollIntoView({ block: 'start' });
                }}
              />
            </>
          )}
          {mayPropose && (
            <PendingBar
              editsSource={editsSource}
              changed={changed.length}
              changedElsewhere={changedElsewhere}
              ticked={mayPublish ? ticked.length : null}
              tickedElsewhere={tickedElsewhere}
              kept={mayReview ? keptIds.length : null}
              onKeep={keep}
              elsewhere={view === 'key' ? 'hors de la liste filtrée' : 'hors de cette page'}
              busy={busy}
              locked={busy !== null || leaving.size > 0}
              onPropose={save}
              onPublish={release}
              onUndo={() => {
                // The one action of the page that drops a work with no word from the server.
                if (
                  changed.length > 1 &&
                  !window.confirm(`Annuler ${countOf(changed.length)} traductions saisies ? Elles seront perdues.`)
                )
                  return;

                setDrafts(new Map());
              }}
            />
          )}
        </>
      )}
    </>
  );
}

/** The table of one repository, behind the sign-in. */
export default function Screen({ repositoryId }: { repositoryId: string | null }) {
  return (
    <Signed>
      {({ account, waiting }) => <Editor account={account} waiting={waiting} repositoryId={repositoryId} />}
    </Signed>
  );
}

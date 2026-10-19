import { Button } from '@heroui/react/button';
import { SearchField } from '@heroui/react/search-field';
import { ToggleButton } from '@heroui/react/toggle-button';
import { ToggleButtonGroup } from '@heroui/react/toggle-button-group';
import { Dropdown } from '@heroui/react/dropdown';
import { createContext, use, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  catalogue as readCatalogue,
  createKeys,
  progress as readProgress,
  propose,
  proposedKeys as readProposedKeys,
  publish,
  repositories as readRepositories,
  rightsOf,
  type RefusedKey,
} from '@i18n-editor/mcp/api';
import { api } from '~/utils/api';
import { signOut, useSession } from '~/utils/auth-client';
import { ChevronDown, Info, KeyView, Lock, Published, Repository, TableView, Wrench } from '~/editor/icons';
import { branchUrl, commitUrl, fileUrl, repositoryUrl } from '~/editor/github';
import { NewKey } from '~/editor/new-key';
import { Busy, Choice } from '~/editor/ui';
import { SignIn } from '~/editor/sign-in';
import { FilesTree, scopeIdOf, type Scope } from '~/editor/files-tree';
import { KeyByKey } from '~/editor/key-by-key';
import { LanguageHeader } from '~/editor/language-header';
import { PendingBar } from '~/editor/pending-bar';
import { Languages } from '~/editor/languages';
import { treeOf, under } from '~/editor/tree';
import { Blocked, Failure, Loading } from '~/editor/states';
import { KeyTable } from '~/editor/table';
import {
  accessOf,
  afterProposal,
  afterPublication,
  countsOf,
  draftsAfterProposal,
  filesIn,
  idOf,
  matching,
  neighboursOf,
  openOf,
  pageNumbersOf,
  pageOf,
  ROW_STATES,
  rowsOf,
  withPublished,
  withWrites,
  type Page,
  type Row,
  type RowState,
  type Writes,
} from '~/editor/rows';
import { readErrorOf, useRead, type ReadError } from '~/editor/use-read';

const PAGE = 100;

/** How long a row takes to close. `app.css` holds the same duration. */
const LEAVE_MS = 200;

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
  proposed: 'Proposées',
  published: 'Publiées',
};

const EMPTY: Record<RowState, string> = {
  missing: 'Aucune clé manquante.',
  proposed: 'Aucune proposition en attente.',
  published: 'Aucune clé publiée.',
};

/** The same, when a file or a search narrows the table: « none » is then true of what is shown only. */
const EMPTY_NARROWED: Record<RowState, string> = {
  missing: 'Aucune clé manquante ne correspond à ce filtre.',
  proposed: 'Aucune proposition en attente ne correspond à ce filtre.',
  published: 'Aucune clé publiée ne correspond à ce filtre.',
};

/**
 * Asks before an action that drops what was typed and not proposed.
 * It answers yes at once when nothing waits.
 */
const mayLeave = (waiting: number): boolean =>
  waiting === 0 ||
  window.confirm(
    waiting > 1
      ? `${waiting} traductions ne sont pas encore proposées. Elles seront perdues. Continuer ?`
      : "Une traduction n'est pas encore proposée. Elle sera perdue. Continuer ?",
  );

/** « 1 671 », as French writes a count. */
const countOf = (value: number): string => value.toLocaleString('fr-FR');

/** « CL » for Camille Laurent, and one letter for an address. */
const initialsOf = (account: string): string =>
  account
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

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

/**
 * The places of the frame that the editor fills once it knows what it reads:
 * the project beside the brand, and the side panel.
 *
 * The frame is drawn before the account is read, so that a failure or a
 * refusal sits in the same page as the table does. The editor reaches these
 * places with a portal.
 */
interface Slots {
  project: HTMLElement | null;
  side: HTMLElement | null;
  /** The side panel is a rail of language codes. */
  folded: boolean;
  setFolded: (folded: boolean) => void;
}

const ShellSlots = createContext<Slots>({ project: null, side: null, folded: false, setFolded: () => {} });

const FOLDED = 'i18n.side-panel.folded';
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
      <ToggleButton id="table">
        <TableView size={15} />
        Tableau
      </ToggleButton>
      <ToggleButton id="key">
        <KeyView size={15} />
        Clé par clé
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

/** The choice of the person, kept by the browser. A browser that refuses the storage keeps the panel open. */
const foldedAtStart = (): boolean => {
  try {
    return window.localStorage.getItem(FOLDED) === '1';
  } catch {
    return false;
  }
};

function Shell({
  account,
  waiting,
  children,
}: {
  account: string;
  /** How many translations are typed and not proposed. */
  waiting: React.RefObject<number>;
  children: React.ReactNode;
}) {
  const [project, setProject] = useState<HTMLElement | null>(null);
  const [side, setSide] = useState<HTMLElement | null>(null);
  const [folded, setFoldedState] = useState(foldedAtStart);
  const slots = useMemo(
    () => ({
      project,
      side,
      folded,
      setFolded: (next: boolean) => {
        setFoldedState(next);

        try {
          window.localStorage.setItem(FOLDED, next ? '1' : '0');
        } catch {
          // The panel still folds. Only the next visit forgets it.
        }
      },
    }),
    [project, side, folded],
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="border-line border-b bg-white">
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <a href="/" className="text-ink hover:text-ink flex items-center gap-2.5 no-underline">
              <span
                aria-hidden="true"
                className="bg-ink inline-flex size-7 items-center justify-center rounded-[7px] font-mono text-[10px] font-medium text-white"
              >
                i18n
              </span>
              <span className="text-base font-semibold tracking-[-0.01em]">Traductions</span>
            </a>
            <span aria-hidden="true" className="bg-line h-5 w-px" />
            <div ref={setProject} className="flex flex-wrap items-center gap-x-4 gap-y-2 empty:hidden" />
          </div>

          <Dropdown>
            <Dropdown.Trigger
              aria-label={`Mon compte, ${account}`}
              className="hover:bg-hover inline-flex h-9 cursor-pointer items-center gap-2 rounded-full pr-1.5 pl-1 text-sm"
            >
              <span
                aria-hidden="true"
                className="bg-hover text-sub inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold"
              >
                {initialsOf(account)}
              </span>
              {account}
              <ChevronDown size={16} className="text-muted" />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                aria-label="Mon compte"
                onAction={(key) => {
                  if (key === 'sign-out' && mayLeave(waiting.current)) void signOut();
                }}
              >
                <Dropdown.Item id="sign-out" textValue="Se déconnecter">
                  Se déconnecter
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </header>

      <div className="flex flex-wrap items-stretch">
        {/* The panel takes no room while the editor has put nothing in it. */}
        <aside
          ref={setSide}
          aria-label="Langues et fichiers"
          className={`border-line bg-side flex min-w-0 flex-col gap-[22px] border-r pt-3.5 pb-5 empty:hidden ${
            folded ? 'flex-[0_0_60px] px-2.5' : 'flex-[1_1_264px] px-3'
          }`}
        />
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 px-8 pt-6 pb-10">
          <ShellSlots value={slots}>{children}</ShellSlots>
        </main>
      </div>
    </div>
  );
}

/** What stops the page before the table, by the status of the read that failed. */
function AccountFailure({ error, onRetry }: { error: ReadError; onRetry: () => void }) {
  if (error.status === 403) {
    return (
      <Blocked icon={<Lock size={18} />}>
        <p className="text-sm leading-normal">Ce compte n'administre pas et ne traduit aucune langue.</p>
        <button
          type="button"
          onClick={() => signOut()}
          className="hover:text-signal cursor-pointer text-[13px] underline"
        >
          Se déconnecter
        </button>
      </Blocked>
    );
  }

  if (error.status === 503) {
    return (
      <Blocked icon={<Wrench size={18} />}>
        <p className="text-sm leading-normal">L'outil de traduction n'est pas encore configuré.</p>
        <p className="text-muted max-w-xl font-mono text-xs break-words">{error.message}</p>
      </Blocked>
    );
  }

  return <Failure title="Le compte n'a pas pu être lu." error={error} onRetry={onRetry} />;
}

function Editor({ account, waiting }: { account: string; waiting: React.RefObject<number> }) {
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
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);

  const repository =
    repositories.state === 'done'
      ? (repositories.value.find((row) => row.id === repositoryId) ?? repositories.value[0] ?? null)
      : null;
  const access = useMemo(
    () => (me.state === 'done' && repository ? accessOf(me.value, repository.targets) : null),
    [me, repository],
  );
  const opened = access && language && access.languages.includes(language) ? language : (access?.languages[0] ?? null);
  const readKey = repository && opened ? `${repository.id}:${opened}` : null;

  const [catalogue, reloadCatalogue] = useRead(readKey, () => readCatalogue(api, repository!.id, opened!));
  const [proposed, reloadProposed] = useRead(readKey, () => readProposedKeys(api, repository!.id, opened!));
  // The other languages of the side panel. The open one counts its own rows, which a write changes at once.
  const [progress, reloadProgress] = useRead(repository ? `progress\n${repository.id}` : null, () =>
    readProgress(api, repository!.id),
  );

  const [filter, setFilter] = useState<RowState>('missing');
  const [query, setQuery] = useState('');
  // The file or the section the table is narrowed to, from the side panel. It
  // names whole segments, which a search cannot.
  const [scope, setScope] = useState<Scope | null>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<ReadError | null>(null);
  const [createdNote, setCreatedNote] = useState<{ file: string; key: string; commit: string } | null>(null);
  const [page, setPage] = useState(1);
  const [view, setViewState] = useState<View>(viewAtStart);
  // The key that the view of one key shows. A key that left the list gives its place to the next one.
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = useRef(0);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  const [published, setPublished] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState<'proposing' | 'publishing' | null>(null);
  const [writeError, setWriteError] = useState<{
    title: string;
    error: ReadError;
    of: 'proposal' | 'publication';
  } | null>(null);
  const [report, setReport] = useState<{ published: number; refused: RefusedKey[] } | null>(null);
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

  if (!repository) {
    return (
      <Blocked icon={<Repository size={18} />}>
        <p className="text-sm leading-normal">Aucun dépôt n'est configuré pour la traduction.</p>
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
  const found = matching(rows, query);
  const narrowed = scope ? under(found, scope) : found;
  // The counts follow the file and the search, so a tab never says more than its table shows.
  const counts = countsOf(narrowed);
  const visible = narrowed.filter((row) => row.state === filter);
  const open = openOf(visible, openId, openIndex.current);
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

  const save = async () => {
    if (catalogue.state !== 'done' || proposed.state !== 'done') return;

    if (changed.length === 0 || busy !== null || leaving.size > 0) return;

    setBusy('proposing');
    setWriteError(null);
    setReport(null);
    setSentNote(null);

    try {
      const sent = changed.map(([id, value]) => ({ row: byId.get(id)!, value }));
      const answer = await propose(api, {
        repository: repository.id,
        language: opened,
        // The revision the translator read. The API refuses a head of its own.
        readAt: catalogue.value.commit,
        values: sent.map(({ row, value }) => ({ file: row.file, key: row.key, value })),
      });
      setSentNote({ keys: sent.length, commit: answer.commit });
      // A proposed key leaves every list but the one of the proposals.
      settle(filter === 'proposed' ? [] : sent.map(({ row }) => idOf(row)), () => {
        setWrites((before) =>
          afterProposal(
            before,
            proposed.value,
            sent.map(({ row, value }) => ({
              file: row.file,
              key: row.key,
              value,
              current: row.published,
              source: row.source,
              commit: answer.commit,
              readAt: answer.readAt,
              author: account,
              at: new Date().toISOString(),
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
      const values = new Map(sent.map((row) => [idOf(row), row.proposal!.value]));

      setReport({ published: answer.published.length, refused: answer.refused });

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
      setWriteError({
        title: "Les clés n'ont pas été publiées. Les cases cochées le sont toujours.",
        error: readErrorOf(error),
        of: 'publication',
      });
    } finally {
      setBusy(null);
    }
  };

  const notices: string[] = read
    ? [
        ...filesIn(catalogue.value, 'disabled').map(
          (name) =>
            `${name} n'a pas de version en ${nameOf(opened)} : ses clés ne sont pas listées, et rien n'y manque.`,
        ),
        ...filesIn(catalogue.value, 'partial').map(
          (name) =>
            `${name} est en cours de traduction : l'application ne le charge pas encore, ses utilisateurs lisent le ${nameOf(catalogue.value.source)}.`,
        ),
      ]
    : [];

  return (
    <>
      {slots.project &&
        createPortal(
          <>
            {repositories.value.length > 1 ? (
              <Choice
                label="Changer de projet"
                value={repository.id}
                items={repositories.value.map((row) => ({ value: row.id, label: row.name }))}
                onChange={(next) => next !== repository.id && mayLeave(changed.length) && setRepositoryId(next)}
                className="min-w-[170px]"
              />
            ) : (
              // One repository is no choice: its name is a link, and no button.
              <Outside
                href={repositoryUrl(repository)}
                className="inline-flex items-center gap-2 text-[13px] font-medium no-underline"
              >
                <Repository size={14} className="text-muted" />
                {repository.name}
              </Outside>
            )}
            {/* The window: a translator must know which state of the repository this is. */}
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
          </>,
          slots.project,
        )}

      {slots.side &&
        createPortal(
          <>
            <Languages
              languages={access.languages.map((code) => ({
                code,
                name: titleOf(nameOf(code)),
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
        name={titleOf(nameOf(opened))}
        code={opened}
        sourceName={read ? nameOf(catalogue.value.source) : null}
        // The whole language, not what the file or the search keeps.
        counts={read ? countsOf(rows) : null}
        readOnly={read && !mayPropose}
        notices={notices}
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
              setCreatedNote({ file: created.file, key: created.key, commit: answer.commit });
              // The table goes to the key: it is missing in this language, and that is where it shows.
              setFilter('missing');
              setScope({ file: created.file, path: '' });
              setQuery(created.key);
              setPage(1);
              reloadCatalogue();
              // A new key is missing in every language.
              reloadProgress();
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
              {ROW_STATES.map((state) => (
                <ToggleButton key={state} id={state}>
                  {FILTER_LABEL[state]} <Count value={read ? counts[state] : null} state={state} />
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <div className="my-[5px] flex flex-wrap items-center gap-2.5">
              <SearchField
                aria-label="Chercher une clé ou un texte"
                aria-keyshortcuts="/"
                value={query}
                isDisabled={!read}
                onChange={(next) => {
                  setQuery(next);
                  setPage(1);
                }}
                className="w-[280px]"
              >
                <SearchField.Group className="h-9">
                  <SearchField.SearchIcon />
                  <SearchField.Input ref={search} placeholder="Chercher une clé ou un texte" />
                  {/* The key gives way to the button that clears, which takes its place. */}
                  {query === '' && (
                    <kbd aria-hidden="true" className="kbd mr-2">
                      /
                    </kbd>
                  )}
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
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
          <Loading>Lecture des traductions…</Loading>
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
          onRetry={writeError.of === 'proposal' ? save : release}
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
              ? `Aucune clé publiée sur ${repository.branch}.`
              : `${countOf(report.published)} ${report.published > 1 ? 'clés publiées' : 'clé publiée'} sur ${repository.branch}.`}
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
              approved={mayPublish && filter === 'proposed' ? approved : null}
              onApprove={approve}
              refused={refusedWhy}
              onSubmit={save}
              empty={scope === null && query.trim() === '' ? EMPTY[filter] : EMPTY_NARROWED[filter]}
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
              <KeyTable
                rows={paged.rows}
                language={{ name: nameOf(opened), code: opened }}
                source={{ name: nameOf(catalogue.value.source), code: catalogue.value.source }}
                drafts={drafts}
                onDraft={(id, value) => setDrafts((before) => new Map(before).set(id, value))}
                readOnly={!mayPropose}
                // The column that publishes shows where a proposal can be: under « Proposées ».
                approved={mayPublish && filter === 'proposed' ? approved : null}
                onApprove={approve}
                refused={refusedWhy}
                leaving={leaving}
                onSubmit={save}
                empty={scope === null && query.trim() === '' ? EMPTY[filter] : EMPTY_NARROWED[filter]}
                fileHref={(name) => fileUrl(repository, catalogue.value.commit, catalogue.value.source, name)}
                commitHref={(commit) => commitUrl(repository, commit)}
              />
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
              changed={changed.length}
              changedElsewhere={changedElsewhere}
              ticked={mayPublish ? ticked.length : null}
              tickedElsewhere={tickedElsewhere}
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

/** The editor behind its sign-in. It imports the client of better-auth, which needs the address of the API. */
export default function Screen() {
  const session = useSession();
  // The header signs out, and the table knows what that would drop.
  const waiting = useRef(0);

  if (session.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading>Lecture de la session…</Loading>
      </div>
    );
  }

  if (!session.data) return <SignIn />;

  return (
    <Shell account={session.data.user.name || session.data.user.email} waiting={waiting}>
      <Editor account={session.data.user.name || session.data.user.email} waiting={waiting} />
    </Shell>
  );
}

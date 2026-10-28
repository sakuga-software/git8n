import { Button } from '@heroui/react/button';
import { SearchField } from '@heroui/react/search-field';
import { Table } from '@heroui/react/table';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  overview,
  progress,
  rightsOf,
  type LanguageProgress,
  type OverviewSort,
  type RepositoryOverview,
} from '@git8n/mcp/api';
import { api } from '~/utils/api';
import { ChevronDown, Plus, Repository } from '~/editor/icons';
import { PUBLISH_MODE_LABEL } from '~/editor/publication';
import { pageNumbersOf } from '~/editor/rows';
import { AccountFailure, Signed } from '~/editor/shell';
import { Bone, RepositoryRowsSkeleton } from '~/editor/skeleton';
import { Blocked, Failure } from '~/editor/states';
import { useRead } from '~/editor/use-read';
import {
  LIST_PAGE,
  pagesOf,
  paramsOf,
  percentOf,
  SEARCH_DELAY_MS,
  searchedFor,
  sortedBy,
  stateOf,
  type ListState,
} from './list';

const countOf = (value: number): string => value.toLocaleString('fr-FR');

const dateOf = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

const COLUMN_LABEL: Record<OverviewSort, string> = {
  name: 'Dépôt',
  progress: 'Progression',
  created: 'Branché le',
};

/** One language: its code, a bar, and the share published. */
function LanguageBar({ row }: { row: LanguageProgress }) {
  const percent = percentOf(row);

  return (
    <span
      className="flex items-center gap-2"
      title={`${countOf(row.published)} publiées, ${countOf(row.proposed)} proposées, ${countOf(row.missing)} manquantes sur ${countOf(row.total)}`}
    >
      <span className="text-sub w-7 font-mono text-[11px] uppercase">{row.language}</span>
      <span aria-hidden="true" className="bg-hover h-1.5 w-20 overflow-hidden rounded-full">
        <span className="bg-published-ink block h-full" style={{ width: `${percent}%` }} />
      </span>
      <span className="text-sub text-xs tabular-nums">{percent} %</span>
    </span>
  );
}

function Bars({ languages, error }: { languages: LanguageProgress[] | null; error?: string }) {
  if (!languages) {
    return (
      <span className="text-alarm-ink text-xs" title={error}>
        Illisible pour l'instant
      </span>
    );
  }

  if (languages.length === 0) return <span className="text-muted text-xs">Aucune langue ouverte</span>;

  return (
    <span className="flex flex-col gap-1">
      {languages.map((language) => (
        <LanguageBar key={language.language} row={language} />
      ))}
    </span>
  );
}

/** A row whose progress the list did not hold (DB-679): it reads its own, and the list does not wait for it. */
function PendingProgress({ row }: { row: RepositoryOverview }) {
  const [read] = useRead(`progress\n${row.id}`, () => progress(api, row.id));

  if (read.state === 'loading') {
    return (
      <span className="flex flex-col gap-1" aria-label="Progression en cours de lecture">
        {row.targets.map((language) => (
          <Bone key={language} className="h-4 w-44" />
        ))}
      </span>
    );
  }

  // Since DB-675 the route answers the source too. The list shows the targets only, as for a held row.
  return read.state === 'done' ? (
    <Bars languages={read.value.filter((language) => row.targets.includes(language.language))} />
  ) : (
    <Bars languages={null} error={read.error.message} />
  );
}

function Progress({ row }: { row: RepositoryOverview }) {
  if (row.progressPending) return <PendingProgress row={row} />;

  return <Bars languages={row.progress} error={row.progressError} />;
}

/** The pages of the list, drawn as the pages of the table of a repository. */
function Pager({ state, total, onPage }: { state: ListState; total: number; onPage: (page: number) => void }) {
  const pages = pagesOf(total, LIST_PAGE);

  if (pages === 1) return null;

  const button = 'size-9 min-w-9 rounded-[7px] p-0 text-sm';

  return (
    <nav aria-label="Pages des dépôts" className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-muted text-[13px]">
        Dépôts {countOf((state.page - 1) * LIST_PAGE + 1)} à {countOf(Math.min(state.page * LIST_PAGE, total))} sur{' '}
        {countOf(total)}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          aria-label="Page précédente"
          isDisabled={state.page === 1}
          onPress={() => onPage(state.page - 1)}
          className={button}
        >
          <ChevronDown size={16} className="rotate-90" />
        </Button>
        {pageNumbersOf(state.page, pages).map((place) =>
          typeof place === 'number' ? (
            <Button
              key={place}
              variant={place === state.page ? 'outline' : 'ghost'}
              aria-label={`Page ${countOf(place)}`}
              aria-current={place === state.page ? 'page' : undefined}
              onPress={() => onPage(place)}
              className={`${button} ${place === state.page ? 'border-signal text-signal font-semibold' : 'text-sub'}`}
            >
              {countOf(place)}
            </Button>
          ) : (
            <Button
              key={`gap-${place.from}`}
              variant="ghost"
              aria-label={`Pages ${countOf(place.from)} à ${countOf(place.to)}`}
              onPress={() => onPage(Math.round((place.from + place.to) / 2))}
              className={`${button} text-muted`}
            >
              …
            </Button>
          ),
        )}
        <Button
          variant="outline"
          aria-label="Page suivante"
          isDisabled={state.page === pages}
          onPress={() => onPage(state.page + 1)}
          className={button}
        >
          <ChevronDown size={16} className="-rotate-90" />
        </Button>
      </div>
    </nav>
  );
}

function Repositories() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const state = stateOf(params);
  const go = (next: ListState, options?: { replace?: boolean }) => setParams(paramsOf(next), options);
  const [typed, setTyped] = useState(state.q);
  const [me, reloadMe] = useRead('me', () => rightsOf(api));
  const key = paramsOf(state).toString();
  const [list, reloadList] = useRead(`overview\n${key}`, () =>
    overview(api, { ...state, q: state.q || undefined, perPage: LIST_PAGE }),
  );

  // The search follows the field alone. The ref gives it the state of the last render without restarting it.
  const latest = useRef({ state, go });

  latest.current = { state, go };

  // The address can change without the field: the back button, a link. A space being typed is not a change.
  useEffect(() => setTyped((before) => (before.trim() === state.q ? before : state.q)), [state.q]);

  // The search asks the API once the typing stops, and replaces the entry of the history rather than adding one per key.
  useEffect(() => {
    const { state: now, go: write } = latest.current;

    if (typed.trim() === now.q) return;

    const timer = window.setTimeout(() => write(searchedFor(now, typed), { replace: true }), SEARCH_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [typed]);

  if (me.state === 'failed') return <AccountFailure error={me.error} onRetry={reloadMe} />;
  if (list.state === 'failed' && (list.error.status === 403 || list.error.status === 503)) {
    return <AccountFailure error={list.error} onRetry={reloadList} />;
  }
  // The account says which actions a row offers. Until it is read, the rows wait with it, in the frame of the page.
  const admin = me.state === 'done' && me.value.admin === true;
  const rows = me.state === 'done' ? list : ({ state: 'loading' } as const);
  const open = (row: RepositoryOverview) =>
    navigate(`/repositories/${encodeURIComponent(row.id)}`, { viewTransition: true });
  const nothingAtAll = rows.state === 'done' && rows.value.total === 0 && !state.q;

  if (nothingAtAll) {
    return (
      <Blocked icon={<Repository size={18} />}>
        <p className="text-sm leading-normal">Aucun dépôt n'est configuré pour la traduction.</p>
        {admin ? (
          <Link to="/setup" viewTransition className="button button--primary">
            <Plus size={14} />
            Brancher un dépôt
          </Link>
        ) : (
          <p className="text-sub text-sm leading-normal">Demandez à un admin de brancher un dépôt.</p>
        )}
      </Blocked>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Dépôts</h1>
          {rows.state === 'done' ? (
            <p className="text-sub text-sm">
              {`${countOf(rows.value.total)} ${rows.value.total > 1 ? 'dépôts' : 'dépôt'}${state.q ? ` pour « ${state.q} »` : ''}`}
            </p>
          ) : (
            <Bone className="my-[3px] h-3.5 w-20" />
          )}
        </div>
        {/* The account brings the button. Outside the box of the search, the button moves nothing on the page. */}
        {admin && (
          <Link to="/setup" viewTransition className="button button--primary button--sm ml-auto md:h-9">
            <Plus size={14} />
            Brancher un dépôt
          </Link>
        )}
        <SearchField aria-label="Chercher un dépôt" value={typed} onChange={setTyped} className="w-[280px]">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Chercher owner/nom" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      {rows.state === 'failed' ? (
        <Failure title="Les dépôts n'ont pas pu être lus." error={rows.error} onRetry={reloadList} />
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Dépôts branchés"
              sortDescriptor={{ column: state.sort, direction: state.order === 'asc' ? 'ascending' : 'descending' }}
              onSortChange={(next) => go(sortedBy(state, next.column as OverviewSort))}
              onRowAction={(id) => {
                const row = rows.state === 'done' ? rows.value.rows.find((one) => one.id === id) : undefined;

                if (row) open(row);
              }}
              className="min-w-[760px]"
            >
              <Table.Header>
                <Table.Column id="name" isRowHeader allowsSorting className="w-[31%]">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      {COLUMN_LABEL.name}
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="progress" allowsSorting className="w-[29%]">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      {COLUMN_LABEL.progress}
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="publication" className="w-[18%]">
                  Publication
                </Table.Column>
                <Table.Column id="created" allowsSorting className="w-[15%]">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      {COLUMN_LABEL.created}
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="actions" className="w-24">
                  <span className="sr-only">Actions</span>
                </Table.Column>
              </Table.Header>
              <Table.Body
                items={rows.state === 'done' ? rows.value.rows : []}
                renderEmptyState={() =>
                  rows.state === 'loading' ? (
                    <RepositoryRowsSkeleton />
                  ) : (
                    <p className="text-sub px-4 py-10 text-center text-sm">
                      Aucun dépôt ne correspond à « {state.q} ».
                    </p>
                  )
                }
              >
                {(row) => (
                  <Table.Row id={row.id} className="cursor-pointer">
                    <Table.Cell>
                      <span className="flex flex-col gap-0.5">
                        <Link
                          to={`/repositories/${encodeURIComponent(row.id)}`}
                          viewTransition
                          className="text-ink hover:text-signal text-sm font-medium no-underline"
                        >
                          {row.owner}/{row.name}
                        </Link>
                        <span className="text-muted font-mono text-xs">
                          {row.branch} · source {row.source}
                        </span>
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <Progress row={row} />
                    </Table.Cell>
                    <Table.Cell>
                      <span className="flex flex-col gap-0.5 text-[13px]">
                        {PUBLISH_MODE_LABEL[row.publishMode]}
                        {row.pullRequest && (
                          <a
                            href={row.pullRequest.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="text-proposed-ink text-xs"
                          >
                            PR #{row.pullRequest.number} ouverte
                          </a>
                        )}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-sub text-[13px]">{dateOf(row.createdAt)}</span>
                    </Table.Cell>
                    <Table.Cell>
                      {admin && (
                        <Link
                          to={`/repositories/${encodeURIComponent(row.id)}/settings`}
                          viewTransition
                          onClick={(event) => event.stopPropagation()}
                          className="text-sub hover:text-ink text-[13px] no-underline"
                        >
                          Réglages
                        </Link>
                      )}
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

      {rows.state === 'done' && (
        <Pager state={state} total={rows.value.total} onPage={(page) => go({ ...state, page })} />
      )}
    </div>
  );
}

/** The page of every repository, behind the sign-in (DB-610). */
export default function RepositoriesScreen() {
  return <Signed>{() => <Repositories />}</Signed>;
}

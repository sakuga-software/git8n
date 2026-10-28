import { Button } from '@heroui/react/button';
import { Chip } from '@heroui/react/chip';
import { ComboBox } from '@heroui/react/combo-box';
import { Input } from '@heroui/react/input';
import { ListBox } from '@heroui/react/list-box';
import { Collection, ListBoxLoadMoreItem } from '@heroui/react/rac';
import { useCallback, useEffect, useRef, useState } from 'react';
import { reachableRepositories, type Repository } from '@git8n/mcp/api';
import { api } from '~/utils/api';
import { Retry } from './icons';
import { keyOf, PICKER_PAGE, pushedAgo, SEARCH_DELAY_MS, withPage, type RepositoryChoice } from './connect-flow';
import { Busy } from './ui';
import { readErrorOf, type ReadError } from './use-read';

export interface Listing {
  /** What the rows answer: the search typed, once the delay passed. */
  query: string;
  rows: RepositoryChoice[];
  total: number;
  /** The page to load next, or null when the last one is loaded. */
  next: number | null;
  status: 'loading' | 'idle' | 'loading-more' | 'failed';
  error: ReadError | null;
}

const START: Listing = { query: '', rows: [], total: 0, next: 1, status: 'loading', error: null };

/**
 * The repositories the installations reach, page after page, and searched on
 * the server (DB-581). A search reaches a repository that no loaded page holds.
 */
export const useReachable = (connected: readonly Repository[]) => {
  const [listing, setListing] = useState<Listing>(START);
  // The answer of an older read must not land after a newer one started.
  const turn = useRef(0);
  const fresh = useRef(true);

  const load = useCallback(
    async (query: string, page: number) => {
      const mine = (turn.current += 1);

      setListing((before) =>
        page === 1 ? { ...START, query, status: 'loading' } : { ...before, status: 'loading-more', error: null },
      );

      try {
        // The first read drops what the API holds: the admin may just have installed the App on GitHub.
        const asFresh = fresh.current;

        fresh.current = false;

        const answer = await reachableRepositories(api, { page, perPage: PICKER_PAGE, q: query, fresh: asFresh });

        if (mine !== turn.current) return;

        setListing((before) => ({
          query,
          rows: withPage(page === 1 ? [] : before.rows, answer.rows, connected),
          total: answer.total,
          next: answer.hasMore ? page + 1 : null,
          status: 'idle',
          error: null,
        }));
      } catch (error) {
        if (mine === turn.current) {
          setListing((before) => ({ ...before, status: 'failed', error: readErrorOf(error) }));
        }
      }
    },
    [connected],
  );

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  // The text that a selection writes in the field is the name of a repository, not a search.
  const selectedText = useRef<string | null>(null);

  useEffect(() => {
    const typed = input.trim();

    if (typed === selectedText.current) return;

    const timer = window.setTimeout(() => setQuery(typed), SEARCH_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [input]);

  // The first page loads here, before the picker shows: it says whether the App reaches anything.
  useEffect(() => {
    void load(query, 1);
  }, [query, load]);

  return { listing, load, input, setInput, selectedText };
};

export type Reachable = ReturnType<typeof useReachable>;

interface Props {
  reachable: Reachable;
  picked: RepositoryChoice | null;
  onPick: (choice: RepositoryChoice) => void;
  /** A connected repository opens rather than being picked again. */
  onOpen: (repositoryId: string) => void;
}

/**
 * The searchable select of step 1: `owner/name`, a badge for a private
 * repository, and the account of its installation.
 */
export function RepositoryPicker({ reachable, picked, onPick, onOpen }: Props) {
  const { listing, load, input, setInput, selectedText } = reachable;
  const loadMore = () => {
    if (listing.next !== null && listing.status === 'idle') void load(listing.query, listing.next);
  };

  const byKey = new Map(listing.rows.map((row) => [keyOf(row), row]));

  return (
    <ComboBox
      aria-label="Dépôt"
      items={listing.rows}
      inputValue={input}
      onInputChange={setInput}
      selectedKey={picked ? keyOf(picked) : null}
      onSelectionChange={(key) => {
        const choice = key === null ? undefined : byKey.get(String(key));

        if (!choice) return;

        selectedText.current = `${choice.owner}/${choice.name}`;

        if (choice.connectedId) onOpen(choice.connectedId);
        else onPick(choice);
      }}
      allowsEmptyCollection
      menuTrigger="focus"
      className="min-w-0 flex-1"
    >
      <ComboBox.InputGroup>
        <Input
          placeholder="Rechercher un dépôt…"
          spellCheck={false}
          autoCapitalize="none"
          className="font-mono text-[13px]"
        />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover className="max-h-96 w-(--trigger-width)">
        <ListBox
          aria-label="Dépôts que l'App atteint"
          className="max-h-80 overflow-y-auto"
          renderEmptyState={() =>
            listing.status === 'loading' ? (
              <p className="text-sub flex items-center gap-2 px-3 py-2.5 text-[13px]">
                <Busy />
                Lecture des dépôts…
              </p>
            ) : listing.status === 'failed' ? null : (
              <p className="text-sub px-3 py-2.5 text-[13px]">
                {listing.query ? `Aucun dépôt ne correspond à « ${listing.query} ».` : "L'App n'atteint aucun dépôt."}
              </p>
            )
          }
        >
          <Collection items={listing.rows}>
            {(row) => (
              <ListBox.Item id={keyOf(row)} textValue={`${row.owner}/${row.name}`}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-mono text-[13px]">
                    {row.owner}/{row.name}
                  </span>
                  {row.private && (
                    <Chip size="sm" variant="soft">
                      Privé
                    </Chip>
                  )}
                </span>
                <span className="text-muted text-xs whitespace-nowrap">
                  {[row.connectedId ? 'Déjà branché' : row.account, pushedAgo(row.pushedAt, Date.now())]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </Collection>
          <ListBoxLoadMoreItem onLoadMore={loadMore} isLoading={listing.status === 'loading-more'}>
            <span className="text-sub flex items-center gap-2 px-3 py-2 text-[13px]">
              <Busy />
              Chargement…
            </span>
          </ListBoxLoadMoreItem>
        </ListBox>

        {listing.status === 'failed' && listing.error && (
          <div role="alert" className="border-line flex flex-wrap items-center gap-2 border-t px-3 py-2.5 text-[13px]">
            <span className="text-alarm-strong min-w-0 flex-1 break-words">
              {listing.rows.length > 0 ? 'La page suivante' : 'La liste'} n'a pas pu être lue : {listing.error.message}
            </span>
            <Button
              size="sm"
              variant="outline"
              onPress={() => void load(listing.query, listing.rows.length > 0 ? (listing.next ?? 1) : 1)}
            >
              <Retry />
              Réessayer
            </Button>
          </div>
        )}

        {listing.status !== 'failed' && listing.rows.length > 0 && (
          <div className="border-line text-muted flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
            <span role="status">
              {listing.rows.length} sur {listing.total}
            </span>
            {listing.next !== null && (
              <Button size="sm" variant="ghost" isDisabled={listing.status !== 'idle'} onPress={loadMore}>
                Afficher plus
              </Button>
            )}
          </div>
        )}
      </ComboBox.Popover>
    </ComboBox>
  );
}

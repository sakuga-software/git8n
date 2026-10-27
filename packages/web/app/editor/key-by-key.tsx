import { Button } from '@heroui/react/button';
import { SearchField } from '@heroui/react/search-field';
import { TextArea } from '@heroui/react/textarea';
import { ToggleButton } from '@heroui/react/toggle-button';
import { ToggleButtonGroup } from '@heroui/react/toggle-button-group';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Copy, External, StateMark, Undo } from './icons';
import { idOf, isEdited, ROW_STATES, type Neighbours, type Page, type Row, type RowState } from './rows';
import { dayOf, OUTSIDE } from './table';
import { SameSection } from './neighbours';
import { WasSource } from './was-source';
import { EmptyMark, isMarkedEmpty } from './empty-mark';
import { Tick } from './ui';
import { Sliding, useSwap } from './motion';

const STATE_LABEL: Record<RowState, string> = {
  missing: 'Manquante',
  review: 'À revoir',
  proposed: 'Proposée',
  published: 'Publiée',
};
const FILTER_LABEL: Record<RowState, string> = {
  missing: 'Manquantes',
  review: 'À revoir',
  proposed: 'Proposées',
  published: 'Publiées',
};

const STATE_STYLE: Record<RowState, string> = {
  missing: 'bg-missing border-missing-line text-missing-ink',
  review: 'bg-alarm border-alarm-line text-alarm-ink',
  proposed: 'bg-proposed border-proposed-line text-proposed-ink',
  published: 'bg-published border-published-line text-published-ink',
};

const COUNT_STYLE: Record<RowState, string> = {
  missing: 'text-missing-ink',
  review: 'text-alarm-ink',
  proposed: 'text-proposed-ink',
  published: 'text-muted',
};

const countOf = (value: number): string => value.toLocaleString('fr-FR');

/** « 61 caractères ». A letter with an accent or an emoji counts for one. */
const lengthOf = (text: string): string => {
  const length = [...text].length;

  return `${countOf(length)} ${length > 1 ? 'caractères' : 'caractère'}`;
};

function KeyName({ name, className }: { name: string; className?: string }) {
  const cut = name.lastIndexOf('.') + 1;

  return (
    <code className={`font-mono [overflow-wrap:anywhere] ${className ?? ''}`}>
      <span className="text-muted">{name.slice(0, cut)}</span>
      <span className="font-medium">{name.slice(cut)}</span>
    </code>
  );
}

interface Props {
  /** The page of the list that holds the open key. */
  page: Page<Row>;
  onPage: (page: number) => void;
  /** The open key, and its place in the whole list, from 1. `null` when the list holds nothing. */
  open: { row: Row; place: number } | null;
  onOpen: (id: string) => void;
  /** Tells where the open key sits, from 0. The key that takes its place after a proposal is found there. */
  onPlace: (index: number) => void;
  /** Opens the key before (-1) or after (1). It returns false at an end of the list. */
  onStep: (by: -1 | 1) => boolean;
  filter: RowState;
  onFilter: (state: RowState) => void;
  /** The tabs of the open language, in order. */
  states?: readonly RowState[];
  /** The open language is the source: the field writes the source text, not a translation (DB-607). */
  editsSource?: boolean;
  /** `null` while nothing is read: a count is then a dash. */
  counts: Record<RowState, number> | null;
  query: string;
  onQuery: (query: string) => void;
  search: React.Ref<HTMLInputElement>;
  language: { name: string; code: string };
  source: { name: string; code: string };
  drafts: ReadonlyMap<string, string>;
  onDraft: (id: string, value: string) => void;
  /** Gives the field of one key its value of before. */
  onReset: (id: string) => void;
  readOnly: boolean;
  /** The proposals a reviewer ticked. `null` when the account cannot publish, or outside « Proposées ». */
  approved: ReadonlySet<string> | null;
  onApprove: (ids: readonly string[], approved: boolean) => void;
  refused: ReadonlyMap<string, string>;
  /** Control or Command with Enter, from the field. */
  onSubmit: () => void;
  empty: React.ReactNode;
  /** A band above the list, for what the open tab must say. */
  notice?: React.ReactNode;
  fileHref: (file: string) => string;
  commitHref: (commit: string) => string;
  /** The keys beside the open one (DB-277). `null` while no key is open. */
  neighbours: Neighbours | null;
  /** Opens a key beside the open one, which can sit outside the list on the screen. */
  onNeighbour: (id: string) => void;
  /** Opens the section of the open key in the list. */
  onSection: (section: string) => void;
  /** Proposes the mark « vide voulu » of a key, or its removal (DB-611). Absent when the account cannot. */
  onMark?: (row: Row, empty: boolean) => void;
  /** A write is on its way: a mark waits for it. */
  markDisabled?: boolean;
}

/**
 * One key at a time, in large, beside the list it comes from (DB-276).
 *
 * The list is the list of the table: the same state, the same search, the
 * same file. This view changes how a key is shown, not which keys are shown.
 */
export function KeyByKey({
  states = ROW_STATES,
  editsSource = false,
  page,
  onPage,
  open,
  onOpen,
  onPlace,
  onStep,
  filter,
  onFilter,
  counts,
  query,
  onQuery,
  search,
  language,
  source,
  drafts,
  onDraft,
  onReset,
  readOnly,
  approved,
  onApprove,
  refused,
  onSubmit,
  empty,
  notice,
  fileHref,
  commitHref,
  neighbours,
  onNeighbour,
  onSection,
  onMark,
  markDisabled = false,
}: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useSwap(list, filter);
  const [copied, setCopied] = useState<'done' | 'refused' | null>(null);
  const openId = open ? idOf(open.row) : null;

  // The open entry stays in sight when the arrows walk past the edge of the list.
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    setCopied(null);
  }, [openId]);

  const index = open ? open.place - 1 : 0;
  const place = useRef(onPlace);

  useEffect(() => {
    place.current = onPlace;
  });

  useEffect(() => {
    place.current(index);
  }, [index]);

  useEffect(() => {
    if (copied === null) return;

    const timer = window.setTimeout(() => setCopied(null), 2000);

    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied('done');
    } catch {
      // A page that is not in front, or a browser that refuses: the key was not copied, and the page says so.
      setCopied('refused');
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();

      return;
    }

    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      onStep(event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  const row = open?.row ?? null;
  const id = row ? idOf(row) : '';
  const held = row ? (row.proposal?.value ?? row.published ?? '') : '';
  const draft = drafts.get(id);
  const edited = row !== null && isEdited(row, draft);
  const why = refused.get(id);

  return (
    <div className="border-line flex grow flex-wrap items-stretch overflow-hidden rounded-[10px] border">
      <div className="border-line flex min-w-0 flex-[1_1_340px] flex-col border-r">
        <div className="border-line flex flex-col gap-2.5 border-b p-3">
          <Sliding selected={counts === null ? null : filter} markClassName="segments-mark">
            <ToggleButtonGroup
              aria-label="Filtrer par état"
              selectionMode="single"
              disallowEmptySelection
              isDisabled={counts === null}
              selectedKeys={counts === null ? [] : [filter]}
              onSelectionChange={(keys) => {
                const [next] = [...keys];

                if (next) onFilter(next as RowState);
              }}
              className="segments"
            >
              {states.map((state) => (
                <ToggleButton key={state} id={state}>
                  {FILTER_LABEL[state]} {/* A count nobody read is a dash. A tab with no row shows no count. */}
                  {counts?.[state] !== 0 && (
                    <span className={`font-mono text-xs ${COUNT_STYLE[state]}`}>
                      {counts === null ? '–' : countOf(counts[state])}
                    </span>
                  )}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Sliding>

          <SearchField
            aria-label="Chercher une clé ou un texte"
            aria-keyshortcuts="/"
            value={query}
            isDisabled={counts === null}
            onChange={onQuery}
            fullWidth
          >
            <SearchField.Group className="h-[34px]">
              <SearchField.SearchIcon />
              <SearchField.Input ref={search} placeholder="Chercher une clé ou un texte" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>

        {notice && <div className="border-line border-b p-3">{notice}</div>}

        <ul
          ref={list}
          aria-label="Clés"
          className="flex max-h-[520px] min-h-40 flex-1 flex-col overflow-y-auto p-1.5 md:max-h-none md:basis-0"
        >
          {page.rows.map((entry) => {
            const entryId = idOf(entry);
            const current = entryId === openId;

            return (
              <li key={entryId}>
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onOpen(entryId)}
                  className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-left ${current ? 'bg-[#e9ecf3]' : 'hover:bg-hover'}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <KeyName name={entry.key} className="text-[12.5px]" />
                    {isEdited(entry, drafts.get(entryId)) ? (
                      <span className="text-sub inline-flex flex-none items-center gap-1.5 text-xs">
                        <span className="bg-ink size-1.5 rounded-full" />
                        Modifiée
                      </span>
                    ) : (
                      <span className="text-muted flex-none text-xs">{entry.file}</span>
                    )}
                  </span>
                  <span lang={source.code} className="text-sub truncate text-[13px]">
                    {entry.source}
                  </span>
                </button>
              </li>
            );
          })}
          {page.rows.length === 0 && <li className="text-muted px-3 py-10 text-center text-sm">{empty}</li>}
        </ul>

        <div className="border-line text-muted flex min-h-11 items-center justify-between gap-3 border-t px-3.5 py-1.5 text-xs">
          <span>
            {page.total === 0
              ? 'Aucune clé'
              : `Clés ${countOf(page.from)} à ${countOf(page.to)} sur ${countOf(page.total)}`}
            {page.rows.length > 8 && ' · la liste défile'}
          </span>
          {page.pages > 1 && (
            <span className="flex gap-1">
              <Button
                variant="ghost"
                aria-label="Cent clés précédentes"
                isDisabled={page.page === 1}
                onPress={() => onPage(page.page - 1)}
                className="size-8 min-w-8 p-0"
              >
                <ChevronDown size={15} className="rotate-90" />
              </Button>
              <Button
                variant="ghost"
                aria-label="Cent clés suivantes"
                isDisabled={page.page === page.pages}
                onPress={() => onPage(page.page + 1)}
                className="size-8 min-w-8 p-0"
              >
                <ChevronDown size={15} className="-rotate-90" />
              </Button>
            </span>
          )}
        </div>
      </div>

      <section aria-label="Clé ouverte" className="flex min-w-0 flex-[999_1_520px] flex-col gap-4 px-7 pt-[22px] pb-7">
        {row === null || open === null ? (
          <p className="text-muted py-16 text-center text-sm">{empty}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="font-mono text-[15px] font-normal [overflow-wrap:anywhere]">
                  <span className="text-muted">{row.file} / </span>
                  <KeyName name={row.key} />
                </h2>
                <Button
                  variant="ghost"
                  aria-label="Copier la clé"
                  onPress={() => void copy(row.key)}
                  className="text-muted size-8 min-w-8 p-0"
                >
                  <Copy size={15} />
                </Button>
                <a
                  href={fileHref(row.file)}
                  {...OUTSIDE}
                  aria-label="Ouvrir le fichier sur GitHub"
                  className="text-muted hover:bg-hover hover:text-signal inline-flex size-8 items-center justify-center rounded-md"
                >
                  <External size={15} />
                </a>
                <span role="status" className="text-sub text-xs">
                  {copied === 'done' && 'Clé copiée'}
                  {copied === 'refused' && "Le navigateur a refusé la copie : la clé n'est pas copiée."}
                </span>
              </div>
              <div className="flex flex-none items-center gap-2">
                <span className="text-muted mr-1 text-[13px]">
                  {countOf(open.place)} sur {countOf(page.total)}
                </span>
                <Button
                  variant="outline"
                  aria-label="Clé précédente"
                  isDisabled={open.place === 1}
                  onPress={() => onStep(-1)}
                  className="size-[34px] min-w-[34px] p-0"
                >
                  <ChevronDown size={16} className="rotate-180" />
                </Button>
                <Button
                  variant="outline"
                  aria-label="Clé suivante"
                  isDisabled={open.place === page.total}
                  onPress={() => onStep(1)}
                  className="size-[34px] min-w-[34px] p-0"
                >
                  <ChevronDown size={16} />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
              <span
                className={`inline-flex h-[26px] items-center gap-1.5 rounded-full border pr-2.5 pl-2 text-[13px] font-semibold ${STATE_STYLE[row.state]}`}
              >
                <StateMark state={row.state} />
                {STATE_LABEL[row.state]}
              </span>
              {edited && (
                <span className="appear text-sub inline-flex items-center gap-1.5 text-[13px]">
                  <span className="bg-ink size-1.5 rounded-full" />
                  {row.proposal && approved
                    ? 'Modifiée : proposez la correction avant de publier'
                    : 'Modifiée, pas encore proposée'}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-semibold">
                  {editsSource ? 'Texte publié' : 'Source'} · {source.name}
                </span>
                <span className="text-muted text-xs">{lengthOf(row.source)}</span>
              </div>
              <p
                id="open-key-source"
                lang={source.code}
                className="border-line-soft bg-panel rounded-[9px] border px-[18px] py-3.5 text-[17px] leading-[1.55] whitespace-pre-line"
              >
                {row.source}
              </p>
              {row.was !== null && <WasSource was={row.was} lang={source.code} />}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="open-key-field" className="text-xs font-semibold">
                  {editsSource ? 'Nouveau texte' : 'Traduction'} · {language.name}
                </label>
                <span className="text-muted text-xs">{lengthOf(draft ?? held)}</span>
              </div>
              <TextArea
                ref={field}
                id="open-key-field"
                aria-label={`${editsSource ? 'Texte' : 'Traduction'} de ${row.key} (${row.file})`}
                aria-describedby="open-key-source"
                aria-keyshortcuts="Alt+ArrowDown Alt+ArrowUp"
                lang={language.code}
                value={draft ?? held}
                readOnly={readOnly}
                placeholder={isMarkedEmpty(row) ? 'Vide voulu' : readOnly ? undefined : 'À traduire'}
                onChange={(event) => onDraft(id, event.target.value)}
                onKeyDown={onKeyDown}
                className={`open-field ${edited ? 'is-edited' : ''}`}
              />
              {why && <span className="appear text-alarm-strong text-xs font-medium">Publication refusée : {why}</span>}
              {row.proposal && (
                <span className="text-muted text-xs leading-normal">
                  Proposée par{' '}
                  <a href={commitHref(row.proposal.commit)} {...OUTSIDE} className="hover:text-signal underline">
                    {row.proposal.author}
                  </a>
                  {dayOf(row.proposal.at) && <> le {dayOf(row.proposal.at)}</>}
                  {row.published !== null && (
                    <>
                      {' '}
                      · remplace « <span lang={language.code}>{row.published}</span> »
                    </>
                  )}
                </span>
              )}
              <EmptyMark row={row} onMark={onMark} isDisabled={markDisabled || edited} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                {!readOnly && (
                  <Button variant="ghost" isDisabled={!edited} onPress={() => onReset(id)} className="text-sub -ml-2">
                    <Undo size={15} />
                    Rétablir
                  </Button>
                )}
                {approved && (row.proposal || row.state === 'review') && (
                  <label className="text-sub inline-flex items-center gap-2 text-[13px]">
                    <Tick
                      label={`${row.state === 'review' ? 'Garder' : 'Publier'} ${row.key} (${row.file})`}
                      isSelected={!edited && approved.has(id)}
                      isDisabled={edited}
                      onChange={(on) => onApprove([id], on)}
                    />
                    {row.state === 'review' ? 'Garder cette traduction' : 'Publier cette clé'}
                  </label>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="text-muted inline-flex items-center gap-1 text-xs">
                  <kbd className="kbd">Alt</kbd> + <kbd className="kbd">↓</kbd>
                </span>
                <Button
                  variant="outline"
                  isDisabled={open.place === page.total}
                  onPress={() => {
                    // It moves on and sends nothing: the floating bar sends, so that a batch stays a batch.
                    if (onStep(1)) field.current?.focus();
                  }}
                  className="border-ink"
                >
                  Clé suivante
                  <ArrowRight size={15} />
                </Button>
              </div>
            </div>

            {neighbours && (
              <SameSection
                neighbours={neighbours}
                language={language}
                source={source}
                onOpen={onNeighbour}
                onSection={neighbours.section ? () => onSection(neighbours.section) : undefined}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

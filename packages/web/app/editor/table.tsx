import { TextArea } from '@heroui/react/textarea';
import { useEffect, useRef } from 'react';
import { FileIcon } from './icons';
import { idOf, isEdited, linesOf, type Row } from './rows';
import { Tick } from './ui';
import { WasSource } from './was-source';
import { EmptyMark, isMarkedEmpty } from './empty-mark';

interface Props {
  rows: readonly Row[];
  /** The open language is the source: the field writes the source text, not a translation (DB-607). */
  editsSource?: boolean;
  /** The ticks keep translations « à revoir » as they are, rather than publish proposals (DB-607). */
  ticksKeep?: boolean;
  /** The two languages: the name the headers say (« anglais »), and the tag the browser reads (`en`). */
  language: { name: string; code: string };
  source: { name: string; code: string };
  drafts: ReadonlyMap<string, string>;
  onDraft: (id: string, value: string) => void;
  /** No grant on this language: the values are read and not written. */
  readOnly: boolean;
  /** The proposals a reviewer ticked. `null` when the account cannot publish. */
  approved: ReadonlySet<string> | null;
  onApprove: (ids: readonly string[], approved: boolean) => void;
  /** Why the last publication left a key where it was, by the id of the row. */
  refused: ReadonlyMap<string, string>;
  /** The rows a write takes out of the list. They close before they leave. */
  leaving: ReadonlySet<string>;
  /** Control or Command with Enter, from a field. */
  onSubmit: () => void;
  /** What the table says when it holds no row. */
  empty: React.ReactNode;
  /** The page that shows the source file of a row, as it was read. */
  fileHref: (file: string) => string;
  /** The page of the batch that proposed a value. */
  commitHref: (commit: string) => string;
  /** Proposes the mark « vide voulu » of a key, or its removal (DB-611). Absent when the account cannot. */
  onMark?: (row: Row, empty: boolean) => void;
  /** A write is on its way: a mark waits for it. */
  markDisabled?: boolean;
}

export const OUTSIDE = {
  target: '_blank',
  rel: 'noreferrer',
  title: "Ouvre GitHub dans un nouvel onglet. Un dépôt privé demande d'y avoir accès.",
} as const;

export const dayOf = (at: string): string => {
  const date = new Date(at);

  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

/** The box that ticks every proposal on the screen. It shows a dash when some are ticked and some are not. */
function TickAll({
  ticked,
  total,
  keeps,
  onChange,
}: {
  ticked: number;
  total: number;
  /** The rows are translations to keep, not proposals to publish (DB-607). */
  keeps: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span aria-hidden="true">{keeps ? 'Garder' : 'Publier'}</span>
      <Tick
        label={keeps ? 'Cocher toutes les traductions affichées' : 'Cocher toutes les propositions affichées'}
        isSelected={total > 0 && ticked === total}
        isIndeterminate={ticked > 0 && ticked < total}
        isDisabled={total === 0}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * A key, with its path dimmed. The last segment is what tells a key from the
 * ones around it, so it is what the eye must find first.
 */
function KeyName({ name }: { name: string }) {
  const cut = name.lastIndexOf('.') + 1;

  return (
    <code className="font-mono text-[13px] leading-[1.3] [overflow-wrap:anywhere]">
      <span className="text-muted">{name.slice(0, cut)}</span>
      <span className="font-medium">{name.slice(cut)}</span>
    </code>
  );
}

/**
 * The keys, one row each. The file and the key stay visible: the name of a
 * key says what the text is for, and a translation with no context is wrong.
 *
 * A row says no state: the tab that is open says it for all of them.
 */
export function KeyTable({
  rows,
  editsSource = false,
  ticksKeep = false,
  language,
  source,
  drafts,
  onDraft,
  readOnly,
  approved,
  onApprove,
  refused,
  leaving,
  onSubmit,
  empty,
  fileHref,
  commitHref,
  onMark,
  markDisabled = false,
}: Props) {
  // An edited proposal cannot be ticked: the publication copies the value of
  // the branch, not the text in the field.
  // A row « à revoir » is ticked to be kept as it is (DB-607).
  const tickable = rows
    .filter((row) => (row.proposal || row.state === 'review') && !isEdited(row, drafts.get(idOf(row))))
    .map(idOf);
  const table = useRef<HTMLDivElement>(null);
  // The field to go back to after a proposal from the keyboard. A row that is
  // proposed leaves the missing ones, and its field takes the focus with it.
  const resume = useRef<string | null>(null);

  useEffect(() => {
    const label = resume.current;

    if (label === null || document.activeElement !== document.body) return;

    resume.current = null;
    [...(table.current?.querySelectorAll('textarea') ?? [])].find((field) => field.ariaLabel === label)?.focus();
  }, [rows]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLTextAreaElement)) return;

    const fields = [...event.currentTarget.querySelectorAll('textarea')];

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      // The next field that holds nothing to send: it is still there after the proposal.
      resume.current =
        fields.slice(fields.indexOf(event.target) + 1).find((field) => !field.classList.contains('is-edited'))
          ?.ariaLabel ?? null;
      onSubmit();

      return;
    }

    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const next = fields[fields.indexOf(event.target) + (event.key === 'ArrowDown' ? 1 : -1)];

      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
  };

  return (
    <div className="border-line overflow-x-auto rounded-[10px] border">
      <div
        ref={table}
        role="table"
        aria-label="Clés à traduire"
        className="min-w-[900px]"
        onKeyDown={onKeyDown}
        onFocus={() => {
          resume.current = null;
        }}
      >
        <div
          role="row"
          className="border-line bg-panel text-sub flex items-end gap-6 border-b px-4 py-2.5 text-xs font-semibold tracking-[0.02em]"
        >
          <div role="columnheader" className="min-w-0 flex-1 basis-0">
            Clé
          </div>
          <div role="columnheader" className="min-w-0 flex-1 basis-0">
            {editsSource ? 'Texte publié' : 'Source'} · {source.name}
          </div>
          <div role="columnheader" className="min-w-0 flex-1 basis-0">
            {editsSource ? 'Nouveau texte' : 'Traduction'} · {language.name}
          </div>
          {approved && (
            <div role="columnheader" className="w-16 flex-none text-center">
              <TickAll
                ticked={tickable.filter((id) => approved.has(id)).length}
                total={tickable.length}
                keeps={ticksKeep}
                onChange={(on) => onApprove(tickable, on)}
              />
            </div>
          )}
        </div>

        {rows.map((row, index) => {
          const id = idOf(row);
          const held = row.proposal?.value ?? row.published ?? '';
          const draft = drafts.get(id);
          const edited = isEdited(row, draft);
          const why = refused.get(id);
          const sourceId = `source-${index}`;

          return (
            // Two boxes close a row: the outer one gives up its height, the inner one hides what is left.
            <div key={id} className="shut" data-leaving={leaving.has(id) || undefined}>
              <div className="min-h-0 overflow-hidden">
                <div
                  role="row"
                  className="border-line-soft flex items-start gap-6 border-b px-4 py-3.5 focus-within:bg-[#fafbfc]"
                >
                  <div role="cell" className="flex min-w-0 flex-1 basis-0 flex-col items-start gap-1.5 pt-0.5">
                    <KeyName name={row.key} />
                    <a
                      href={fileHref(row.file)}
                      {...OUTSIDE}
                      className="text-muted hover:text-signal inline-flex items-center gap-1.5 text-xs hover:underline"
                    >
                      <FileIcon size={12} />
                      {row.file}
                    </a>
                  </div>

                  <div
                    role="cell"
                    id={sourceId}
                    lang={source.code}
                    className="min-w-0 flex-1 basis-0 pt-[9px] text-sm leading-normal whitespace-pre-line"
                  >
                    {row.source}
                    {row.was !== null && <WasSource was={row.was} lang={source.code} className="mt-2" />}
                  </div>

                  <div role="cell" className="flex min-w-0 flex-1 basis-0 flex-col gap-1.5">
                    <div className="relative">
                      <TextArea
                        aria-label={`${editsSource ? 'Texte' : 'Traduction'} de ${row.key} (${row.file})`}
                        aria-describedby={sourceId}
                        lang={language.code}
                        rows={Math.max(linesOf(row.source), linesOf(draft ?? held))}
                        value={draft ?? held}
                        readOnly={readOnly}
                        placeholder={isMarkedEmpty(row) ? 'Vide voulu' : readOnly ? undefined : 'À traduire'}
                        onChange={(event) => onDraft(id, event.target.value)}
                        className={edited ? 'peer is-edited' : 'peer'}
                      />
                      {/*
                        The help follows the cursor. It sits in the empty field and not under it: a line that
                        comes and goes under a field moves every row below at the moment of a click, and the
                        click then misses the button it aimed at.
                      */}
                      {!readOnly && (draft ?? held) === '' && (
                        <span
                          aria-hidden="true"
                          className="text-muted pointer-events-none absolute top-[9px] right-2.5 hidden items-center gap-1 text-xs peer-focus:flex"
                        >
                          <kbd className="kbd">Alt</kbd> + <kbd className="kbd">↓</kbd> champ suivant
                        </span>
                      )}
                    </div>
                    {edited && (
                      <span className="appear text-sub inline-flex items-center gap-1.5 text-xs">
                        <span className="bg-ink size-1.5 rounded-full" />
                        {row.proposal && approved
                          ? 'Modifiée : proposez la correction avant de publier'
                          : 'Modifiée, pas encore proposée'}
                      </span>
                    )}
                    {why && (
                      <span className="appear text-alarm-strong text-xs font-medium">Publication refusée : {why}</span>
                    )}
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

                  {approved && (
                    <div role="cell" className="w-16 flex-none">
                      {(row.proposal || row.state === 'review') && (
                        <div className="flex justify-center px-2 pt-2 pb-3">
                          <Tick
                            label={`${row.state === 'review' ? 'Garder' : 'Publier'} ${row.key} (${row.file})`}
                            isSelected={!edited && approved.has(id)}
                            isDisabled={edited}
                            onChange={(on) => onApprove([id], on)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {rows.length === 0 && <div className="text-muted px-4 py-12 text-center text-sm">{empty}</div>}
      </div>
    </div>
  );
}

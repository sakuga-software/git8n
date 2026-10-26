import { ComboBox } from '@heroui/react/combo-box';
import { Input } from '@heroui/react/input';
import { ListBox } from '@heroui/react/list-box';
import { idOf, matching, SUGGESTIONS_SHOWN, suggestionsOf, type Row, type RowState } from './rows';

const STATE_LABEL: Record<RowState, string> = {
  missing: 'Manquante',
  review: 'À revoir',
  proposed: 'Proposée',
  published: 'Publiée',
};

const STATE_INK: Record<RowState, string> = {
  missing: 'text-missing-ink',
  review: 'text-alarm-ink',
  proposed: 'text-proposed-ink',
  published: 'text-published-ink',
};

/** The characters of the text shown before the match, so the match stays in the line. */
const LEAD = 24;

function Marked({ text, at, lead = false }: { text: string; at: readonly [number, number] | null; lead?: boolean }) {
  if (!at) return text;

  const from = lead && at[0] > LEAD ? at[0] - LEAD : 0;

  return (
    <>
      {from > 0 && '…'}
      {text.slice(from, at[0])}
      <mark className="text-ink rounded-[2px] bg-[#fdf1c4]">{text.slice(at[0], at[1])}</mark>
      {text.slice(at[1])}
    </>
  );
}

const Magnifier = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
    className="text-field-placeholder pointer-events-none absolute left-3 z-10"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

interface Props {
  /** The rows the search reads: the language, under the file of the tree when one is open. */
  rows: readonly Row[];
  query: string;
  onQuery: (query: string) => void;
  /** Opens a suggested key. */
  onPick: (row: Row) => void;
  isDisabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * The search of the table, which suggests keys as the translator types (DB-619).
 *
 * The text filters the table as before. A suggestion opens its key. Enter
 * with no suggestion in focus keeps the filter.
 */
export function KeySearch({ rows, query, onQuery, onPick, isDisabled, inputRef }: Props) {
  const suggestions = suggestionsOf(rows, query);
  const byId = new Map(suggestions.map((suggestion) => [idOf(suggestion.row), suggestion.row]));
  const more = suggestions.length === SUGGESTIONS_SHOWN ? matching(rows, query).length - SUGGESTIONS_SHOWN : 0;

  return (
    <ComboBox
      aria-label="Chercher une clé ou un texte"
      aria-keyshortcuts="/"
      items={suggestions}
      inputValue={query}
      onInputChange={onQuery}
      selectedKey={null}
      onSelectionChange={(key) => {
        const row = key === null ? undefined : byId.get(String(key));

        if (row) onPick(row);
      }}
      allowsCustomValue
      menuTrigger="input"
      isDisabled={isDisabled}
      className="w-[280px]"
    >
      <ComboBox.InputGroup className="w-full">
        <Magnifier />
        <Input
          ref={inputRef}
          placeholder="Chercher une clé ou un texte"
          spellCheck={false}
          autoCapitalize="none"
          className="h-9 pr-8 pl-9"
        />
        {/* The key gives way to the button that clears, which takes its place. */}
        {query === '' ? (
          <kbd aria-hidden="true" className="kbd pointer-events-none absolute right-2.5">
            /
          </kbd>
        ) : (
          <button
            type="button"
            aria-label="Effacer la recherche"
            onClick={() => {
              onQuery('');
              inputRef.current?.focus();
            }}
            className="text-field-placeholder hover:text-ink absolute right-2 flex size-5 cursor-pointer items-center justify-center rounded-full"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
        {/* A search opens its list by typing, never by a button. */}
        <ComboBox.Trigger className="hidden" />
      </ComboBox.InputGroup>
      <ComboBox.Popover className="w-[440px]" placement="bottom end">
        <ListBox aria-label="Clés suggérées" className="max-h-96 overflow-y-auto">
          {suggestions.map(({ row, text, keyMatch, textMatch }) => (
            <ListBox.Item key={idOf(row)} id={idOf(row)} textValue={row.key}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-xs [overflow-wrap:anywhere]">
                    <Marked text={row.key} at={keyMatch} />
                  </span>
                  <span className={`text-[11px] font-medium whitespace-nowrap ${STATE_INK[row.state]}`}>
                    {STATE_LABEL[row.state]}
                  </span>
                </span>
                <span className="text-sub truncate text-[12.5px]">
                  <Marked text={text} at={textMatch} lead />
                </span>
              </span>
            </ListBox.Item>
          ))}
        </ListBox>
        {more > 0 && (
          <p className="border-line text-muted border-t px-3 py-2 text-xs">
            Et {more.toLocaleString('fr-FR')} autres clés : le tableau les montre toutes.
          </p>
        )}
      </ComboBox.Popover>
    </ComboBox>
  );
}

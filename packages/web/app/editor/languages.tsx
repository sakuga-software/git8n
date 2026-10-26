import { ListBox } from '@heroui/react/list-box';
import { Select } from '@heroui/react/select';
import { useEffect, useRef } from 'react';
import { PanelFold } from './icons';
import { shareOf, type RowState } from './rows';

export interface LanguageCard {
  code: string;
  /** « Anglais ». */
  name: string;
  /** `null` while nobody read it: the card then says a dash, never « 0 % ». */
  counts: Record<RowState, number> | null;
  /** The account reads this language and cannot write it. */
  readOnly: boolean;
}

const percentOf = (counts: LanguageCard['counts']): string => {
  const share = counts && shareOf(counts);

  return share === null || share === undefined ? '–' : `${share} %`;
};

function Bar({ counts }: { counts: LanguageCard['counts'] }) {
  const total = counts ? counts.published + counts.proposed + counts.missing + counts.review : 0;

  return (
    <span aria-hidden="true" className="bg-line flex h-1 overflow-hidden rounded-full">
      {counts && total > 0 && (
        <>
          <span className="bg-published-ink" style={{ width: `${(counts.published / total) * 100}%` }} />
          <span className="bg-signal" style={{ width: `${(counts.proposed / total) * 100}%` }} />
          <span className="bg-alarm-line" style={{ width: `${(counts.review / total) * 100}%` }} />
        </>
      )}
    </span>
  );
}

function LanguageLine({ language, selected }: { language: LanguageCard; selected: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-2 text-left">
      <span className="flex items-baseline gap-1.5">
        <span className={`truncate text-sm ${selected ? 'font-semibold' : 'font-medium'}`}>{language.name}</span>
        <span className="text-muted font-mono text-[11.5px]">{language.code}</span>
        <span className="text-sub ml-auto text-xs whitespace-nowrap">
          {percentOf(language.counts)}
          {language.readOnly && ' · lecture'}
        </span>
      </span>
      <Bar counts={language.counts} />
    </span>
  );
}

/**
 * The languages of the repository, in the side panel (DB-269).
 *
 * Unfolded, a select gives the count of languages. Each option says the name,
 * the share that is published, and a bar. Folded, the panel is a rail of language codes: the name and the share are
 * then in the label of each button.
 */
export function Languages({
  languages,
  opened,
  onOpen,
  folded,
  onFold,
  onRetry,
}: {
  languages: readonly LanguageCard[];
  opened: string;
  onOpen: (code: string) => void;
  folded: boolean;
  onFold: (folded: boolean) => void;
  /** The read of the other languages failed: a dash is then a failure, not a language nobody read. */
  onRetry: (() => void) | null;
}) {
  // The two shapes of the panel draw this button in two places, so React makes
  // a new one. Without this, a fold from the keyboard drops the focus on the page.
  const toggled = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!toggled.current) return;

    toggled.current = false;
    button.current?.focus();
  }, [folded]);

  const toggle = (
    <button
      ref={button}
      type="button"
      aria-label={folded ? 'Déplier le panneau' : 'Replier le panneau'}
      aria-expanded={!folded}
      title={folded ? 'Déplier le panneau' : 'Replier le panneau'}
      onClick={() => {
        toggled.current = true;
        onFold(!folded);
      }}
      className={`text-muted hover:bg-hover hover:text-ink flex flex-none cursor-pointer items-center justify-center rounded-md ${folded ? 'size-10' : 'size-8'}`}
    >
      <PanelFold size={16} className={folded ? '-scale-x-100' : ''} />
    </button>
  );

  if (folded) {
    return (
      <nav aria-label="Langues" className="flex flex-col items-center gap-2">
        {toggle}
        <span aria-hidden="true" className="bg-line h-px w-6" />
        {languages.map((language) => {
          // The rail draws no share, so its label is where a failure can say itself.
          const share = language.counts
            ? `${percentOf(language.counts)} publié`
            : onRetry
              ? "l'avancement n'a pas pu être lu, dépliez le panneau pour réessayer"
              : 'avancement non lu';
          const label = `${language.name}, ${share}${language.readOnly ? ', lecture seule' : ''}`;

          return (
            <button
              key={language.code}
              type="button"
              aria-label={label}
              title={label}
              aria-current={language.code === opened ? 'true' : undefined}
              onClick={() => onOpen(language.code)}
              className={`flex size-10 cursor-pointer items-center justify-center rounded-lg font-mono text-xs font-medium uppercase ${
                language.code === opened ? 'bg-ink text-white' : 'border-line hover:border-line-strong border bg-white'
              }`}
            >
              {language.code}
            </button>
          );
        })}
      </nav>
    );
  }

  const current = languages.find((language) => language.code === opened);
  const count = languages.length;

  return (
    <nav aria-label="Langues" className="flex flex-col gap-1">
      <div className="mb-1 flex items-center justify-between pl-2">
        <h2 id="languages-title" className="text-muted text-xs font-semibold">
          Langues · {count}
        </h2>
        {toggle}
      </div>
      <Select
        aria-labelledby="languages-title"
        selectedKey={opened}
        onSelectionChange={(key) => key !== null && onOpen(String(key))}
        className="w-full"
      >
        <Select.Trigger className="h-auto min-h-0 py-2.5 ps-3 pe-8">
          <Select.Value className="min-w-0 flex-1">
            {() => current && <LanguageLine language={current} selected />}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="max-h-80">
          <ListBox aria-label={`${count} ${count > 1 ? 'langues' : 'langue'}`}>
            {languages.map((language) => (
              <ListBox.Item
                key={language.code}
                id={language.code}
                textValue={`${language.name}, ${percentOf(language.counts)}${language.readOnly ? ', lecture seule' : ''}`}
                className="pe-8"
              >
                <LanguageLine language={language} selected={language.code === opened} />
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      {onRetry && (
        <p role="status" className="text-sub px-3 pt-1 text-xs leading-normal">
          L'avancement des autres langues n'a pas pu être lu.{' '}
          <button type="button" onClick={onRetry} className="link">
            Réessayer
          </button>
        </p>
      )}
    </nav>
  );
}

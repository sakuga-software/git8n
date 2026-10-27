import type { Row } from './rows';

/** Whether a row leaves its key empty on purpose: what waits on the branch first, then the base branch (DB-611). */
export const isMarkedEmpty = (row: Row): boolean => (row.proposal ? row.proposal.empty === true : row.empty);

/** What a proposal does to the mark of the base branch, or nothing when it leaves it as it is. */
const changeOf = (row: Row): 'added' | 'removed' | null => {
  if (!row.proposal) return null;
  if (row.proposal.empty && !row.empty) return 'added';
  if (!row.proposal.empty && row.empty) return 'removed';

  return null;
};

/** The badge « Vide voulu ». */
export function EmptyBadge() {
  return (
    <span className="border-line-strong text-sub inline-flex h-[22px] items-center rounded-full border px-2 text-xs font-medium">
      Vide voulu
    </span>
  );
}

/**
 * What a row says of its mark « vide voulu », and the button that adds or removes it (DB-611).
 *
 * `onMark` is absent for an account that cannot propose in the language, and for the source.
 */
export function EmptyMark({
  row,
  onMark,
  isDisabled,
}: {
  row: Row;
  onMark?: (row: Row, empty: boolean) => void;
  isDisabled: boolean;
}) {
  const marked = isMarkedEmpty(row);
  const change = changeOf(row);

  if (!marked && !change && !onMark) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
      {marked && <EmptyBadge />}
      {change === 'added' && <span className="text-muted">proposé, en attente de publication</span>}
      {change === 'removed' && (
        <span className="text-muted">Marque « vide voulu » retirée, en attente de publication</span>
      )}
      {!row.proposal && row.empty && row.state === 'review' && (
        <span className="text-alarm-ink">Le texte source a changé depuis la marque.</span>
      )}
      {marked && !row.proposal && row.state === 'published' && (
        <span className="text-muted">Cette langue n'affiche rien pour cette clé, et c'est voulu.</span>
      )}
      {onMark && (
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => onMark(row, !marked)}
          title={
            marked
              ? 'La clé redevient manquante, ou prend le texte que vous proposez.'
              : 'Propose une valeur vide, voulue : la clé quitte les manquantes après la publication.'
          }
          className="text-signal cursor-pointer hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
        >
          {marked ? 'Retirer « vide voulu »' : 'Marquer vide voulu'}
        </button>
      )}
    </div>
  );
}

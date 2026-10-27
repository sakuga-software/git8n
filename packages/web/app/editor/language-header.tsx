import { Button } from '@heroui/react/button';
import { Lock, Plus } from './icons';
import { shareOf, type RowState } from './rows';

const countOf = (value: number): string => value.toLocaleString('fr-FR');

const LEGEND: { state: RowState; one: string; many: string; mark: string }[] = [
  { state: 'published', one: 'publiée', many: 'publiées', mark: 'bg-published-ink' },
  { state: 'proposed', one: 'proposée', many: 'proposées', mark: 'bg-signal' },
  { state: 'review', one: 'à revoir', many: 'à revoir', mark: 'bg-alarm-line' },
  { state: 'missing', one: 'manquante', many: 'manquantes', mark: 'hatched' },
];

/**
 * The share of each state, as one bar. The missing part is hatched, so the
 * state that asks for work reads with no colour. The legend writes the numbers.
 */
function Progress({ counts }: { counts: Record<RowState, number> | null }) {
  const total = counts ? counts.published + counts.proposed + counts.missing + counts.review : 0;

  if (!counts || total === 0) {
    return <div aria-hidden="true" className="bg-line h-2 max-w-[640px] rounded-full" />;
  }

  return (
    <div aria-hidden="true" className="flex h-2 max-w-[640px] gap-0.5 overflow-hidden rounded-full">
      {counts.published > 0 && <span className="bg-published-ink" style={{ flexGrow: counts.published }} />}
      {/* A few proposals among two thousand keys would be thinner than a pixel. */}
      {counts.proposed > 0 && <span className="bg-signal min-w-1.5" style={{ flexGrow: counts.proposed }} />}
      {counts.review > 0 && <span className="bg-alarm-line min-w-1.5" style={{ flexGrow: counts.review }} />}
      {counts.missing > 0 && <span className="hatched min-w-1.5" style={{ flexGrow: counts.missing }} />}
    </div>
  );
}

/**
 * The top of the content: which language this is, and how far it is (DB-271).
 *
 * The counts are those of the whole language. The tabs under it follow the
 * file and the search; this is the summary that does not move with them.
 */
export function LanguageHeader({
  name,
  code,
  source,
  counts,
  emptyCount = 0,
  readOnly,
  onNewKey,
  newKeyDisabled,
  compact = false,
  aside,
}: {
  /** « Anglais ». */
  name: string;
  code: string;
  /** The language this one is translated from. `null` for the source itself, and before the first read. */
  source: { name: string; code: string } | null;
  /** `null` before the first read: the legend then says dashes, never zeros. */
  counts: Record<RowState, number> | null;
  /**
   * The published keys left empty on purpose (DB-611). They are in the published count: this
   * says how much of it holds no text, so that 100 % does not hide them.
   */
  emptyCount?: number;
  /** The account reads this language and cannot write it. The title says so: a dialog alone would hide why a field refuses. */
  readOnly: boolean;
  /** `null` for an account that does not write the source. */
  onNewKey: (() => void) | null;
  newKeyDisabled: boolean;
  /**
   * The header of the view of one key: one line and no bar. The room goes to
   * the key.
   */
  compact?: boolean;
  /** What the view puts at the right end: the switch between the two views. */
  aside?: React.ReactNode;
}) {
  const percent = counts && shareOf(counts);
  const share = percent === null ? '–' : `${percent} %`;

  return (
    <section
      aria-label="Langue"
      className={`flex flex-wrap justify-between gap-x-8 gap-y-4 ${compact ? 'items-center' : 'items-end'}`}
    >
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className={`leading-tight font-semibold tracking-[-0.02em] ${compact ? 'text-[22px]' : 'text-[28px]'}`}>
            {name}
          </h1>
          <span className="border-line-strong text-sub rounded-[5px] border px-1.5 py-px font-mono text-xs">
            {code}
          </span>
          {source && (
            <span
              title={`Traduit depuis le ${source.name}`}
              className="border-line text-muted rounded-[5px] border px-1.5 py-px text-xs"
            >
              source <span className="font-mono">{source.code.toUpperCase()}</span>
            </span>
          )}
          {compact && (
            <span className="text-sub text-[13px]">
              <strong className="text-ink font-semibold">{share}</strong> publié ·{' '}
              {counts
                ? `${countOf(counts.missing)} ${counts.missing > 1 ? 'manquantes' : 'manquante'}`
                : '– manquantes'}
            </span>
          )}
          {readOnly && (
            <span className="bg-panel text-sub inline-flex items-center gap-1.5 self-center rounded-md px-2 py-0.5 text-xs font-medium">
              <Lock size={12} className="text-muted" />
              Lecture seule : ce compte ne peut pas écrire cette langue
            </span>
          )}
        </div>

        {!compact && (
          <>
            <Progress counts={counts} />

            <p className="text-sub flex flex-wrap items-center gap-x-[18px] gap-y-1 text-[13px]">
              <span>
                <strong className="text-ink font-semibold">{share}</strong> publié
                {emptyCount > 0 && (
                  <span title="Des clés publiées sans texte, parce que cette langue n'en veut pas.">
                    {' '}
                    dont {countOf(emptyCount)} {emptyCount > 1 ? 'vides voulues' : 'vide voulue'}
                  </span>
                )}
              </span>
              {/* A language with nothing to read again does not say so: most never have any. */}
              {LEGEND.filter(({ state }) => state !== 'review' || (counts?.review ?? 0) > 0).map(
                ({ state, one, many, mark }) => (
                  <span key={state} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`size-2 rounded-xs ${mark}`} />
                    {counts ? `${countOf(counts[state])} ${counts[state] > 1 ? many : one}` : `– ${many}`}
                  </span>
                ),
              )}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {onNewKey && !compact && (
          <Button variant="outline" isDisabled={newKeyDisabled} onPress={onNewKey} className="border-ink">
            <Plus size={15} />
            Nouvelle clé
          </Button>
        )}
        {aside}
      </div>
    </section>
  );
}

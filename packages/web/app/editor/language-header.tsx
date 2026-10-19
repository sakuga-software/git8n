import { Button } from '@heroui/react/button';
import { Modal } from '@heroui/react/modal';
import { Info, Lock, Plus } from './icons';
import { shareOf, type RowState } from './rows';

const countOf = (value: number): string => value.toLocaleString('fr-FR');

const LEGEND: { state: RowState; one: string; many: string; mark: string }[] = [
  { state: 'published', one: 'publiée', many: 'publiées', mark: 'bg-published-ink' },
  { state: 'proposed', one: 'proposée', many: 'proposées', mark: 'bg-signal' },
  { state: 'missing', one: 'manquante', many: 'manquantes', mark: 'hatched' },
];

/**
 * The share of each state, as one bar. The missing part is hatched, so the
 * state that asks for work reads with no colour. The legend writes the numbers.
 */
function Progress({ counts }: { counts: Record<RowState, number> | null }) {
  const total = counts ? counts.published + counts.proposed + counts.missing : 0;

  if (!counts || total === 0) {
    return <div aria-hidden="true" className="bg-line h-2 max-w-[640px] rounded-full" />;
  }

  return (
    <div aria-hidden="true" className="flex h-2 max-w-[640px] gap-0.5 overflow-hidden rounded-full">
      {counts.published > 0 && <span className="bg-published-ink" style={{ flexGrow: counts.published }} />}
      {/* A few proposals among two thousand keys would be thinner than a pixel. */}
      {counts.proposed > 0 && <span className="bg-signal min-w-1.5" style={{ flexGrow: counts.proposed }} />}
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
  sourceName,
  counts,
  readOnly,
  notices,
  onNewKey,
  newKeyDisabled,
  compact = false,
  aside,
}: {
  /** « Anglais ». */
  name: string;
  code: string;
  /** « français », or `null` before the first read. */
  sourceName: string | null;
  /** `null` before the first read: the legend then says dashes, never zeros. */
  counts: Record<RowState, number> | null;
  /** The account reads this language and cannot write it. The title says so: a dialog alone would hide why a field refuses. */
  readOnly: boolean;
  notices: readonly string[];
  /** `null` for an account that does not write the source. */
  onNewKey: (() => void) | null;
  newKeyDisabled: boolean;
  /**
   * The header of the view of one key: one line, no bar, and the remarks as a
   * number. The room goes to the key.
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
          {sourceName && !compact && <span className="text-muted text-[13px]">traduit depuis le {sourceName}</span>}
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
              </span>
              {LEGEND.map(({ state, one, many, mark }) => (
                <span key={state} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={`size-2 rounded-xs ${mark}`} />
                  {counts ? `${countOf(counts[state])} ${counts[state] > 1 ? many : one}` : `– ${many}`}
                </span>
              ))}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {notices.length > 0 && (
          <Modal>
            <Button
              variant="tertiary"
              aria-label={`${notices.length} ${notices.length > 1 ? 'remarques' : 'remarque'}`}
              className="border-line bg-panel text-sub border"
            >
              <Info size={15} className="text-muted" />
              {notices.length} {!compact && (notices.length > 1 ? 'remarques' : 'remarque')}
            </Button>
            <Modal.Backdrop>
              <Modal.Container size="md">
                <Modal.Dialog>
                  <Modal.CloseTrigger aria-label="Fermer" />
                  <Modal.Header>
                    <Modal.Heading>À savoir sur cette langue</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <ul className="text-sub flex list-disc flex-col gap-2.5 pl-5 text-sm leading-normal">
                      {notices.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </Modal.Body>
                  <Modal.Footer>
                    <Button slot="close" variant="outline">
                      Fermer
                    </Button>
                  </Modal.Footer>
                </Modal.Dialog>
              </Modal.Container>
            </Modal.Backdrop>
          </Modal>
        )}
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

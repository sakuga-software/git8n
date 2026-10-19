import { Button } from '@heroui/react/button';
import { Send } from './icons';
import { Busy } from './ui';

const countOf = (value: number): string => value.toLocaleString('fr-FR');

/** « ⌘ ↵ » on a Mac, « Ctrl ↵ » elsewhere: the key that is drawn is the key of the keyboard in front of the person. */
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘ ↵' : 'Ctrl ↵';

interface Props {
  /** The translations that are typed and not proposed, and how many of them the screen does not show. */
  changed: number;
  changedElsewhere: number;
  /** The proposals that are ticked, and how many of them the screen does not show. `null` for an account that cannot publish. */
  ticked: number | null;
  tickedElsewhere: number;
  /** « hors de cette page »: where the ones that are not on the screen are, in the words of the view. */
  elsewhere: string;
  busy: 'proposing' | 'publishing' | null;
  /** A write is on its way, or its rows are closing: a second one must wait. */
  locked: boolean;
  onPropose: () => void;
  onPublish: () => void;
  /** Gives every field its value of before. It does not untick. */
  onUndo: () => void;
}

/**
 * What waits to be sent, and the buttons that send it (DB-275).
 *
 * The bar floats at the bottom of the screen, so the actions are in reach from
 * any row. It shows only when something waits: a text that is typed, or a
 * proposal that is ticked.
 */
export function PendingBar({
  changed,
  changedElsewhere,
  ticked,
  tickedElsewhere,
  elsewhere,
  busy,
  locked,
  onPropose,
  onPublish,
  onUndo,
}: Props) {
  const ticks = ticked ?? 0;

  if (changed === 0 && ticks === 0 && busy === null) return null;

  const aside = (hidden: number) => (hidden > 0 ? ` · dont ${countOf(hidden)} ${elsewhere}` : '');

  return (
    <div className="pointer-events-none sticky bottom-5 z-20 flex justify-center">
      <section
        aria-label="Modifications en attente"
        className="arrive bg-ink pointer-events-auto flex w-full max-w-[820px] flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[12px] py-2.5 pr-2.5 pl-5 text-white shadow-[0_16px_36px_-14px_rgba(21,23,28,0.5)]"
      >
        <p role="status" className="flex flex-col gap-0.5 text-sm">
          {changed > 0 && (
            <span>
              <strong className="font-semibold">
                {countOf(changed)} {changed > 1 ? 'traductions modifiées' : 'traduction modifiée'}
              </strong>
              <span className="text-[13px] text-[#b9bdc6]">{aside(changedElsewhere)}</span>
            </span>
          )}
          {ticks > 0 && (
            <span>
              <strong className="font-semibold">
                {countOf(ticks)} {ticks > 1 ? 'clés cochées' : 'clé cochée'}
              </strong>
              <span className="text-[13px] text-[#b9bdc6]">{aside(tickedElsewhere)}</span>
            </span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {changed > 0 && (
            <Button
              variant="outline"
              isDisabled={locked}
              onPress={onUndo}
              className="border-[#3a3e48] bg-transparent text-white hover:bg-white/10"
            >
              Tout annuler
            </Button>
          )}
          {(changed > 0 || busy === 'proposing') && (
            <Button
              isDisabled={locked}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onPress={onPropose}
              className="text-ink bg-white hover:bg-white/90"
            >
              {busy === 'proposing' ? (
                <>
                  <Busy />
                  Envoi de {countOf(changed)} {changed > 1 ? 'traductions' : 'traduction'}…
                </>
              ) : (
                <>
                  <Send size={16} />
                  Proposer {countOf(changed)} {changed > 1 ? 'traductions' : 'traduction'}
                  <kbd aria-hidden="true" className="bg-hover text-sub rounded px-1.5 py-0.5 font-sans text-[11px]">
                    {SHORTCUT}
                  </kbd>
                </>
              )}
            </Button>
          )}
          {ticked !== null && (ticks > 0 || busy === 'publishing') && (
            <Button
              isDisabled={locked}
              onPress={onPublish}
              // With nothing to propose, publishing is the one action of the bar and wears its weight.
              className={
                changed > 0
                  ? 'border border-white/60 bg-transparent text-white hover:bg-white/10'
                  : 'text-ink bg-white hover:bg-white/90'
              }
            >
              {busy === 'publishing' ? (
                <>
                  <Busy />
                  Publication de {countOf(ticks)} {ticks > 1 ? 'clés' : 'clé'}…
                </>
              ) : (
                <>
                  Publier {countOf(ticks)} {ticks > 1 ? 'clés' : 'clé'}
                </>
              )}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

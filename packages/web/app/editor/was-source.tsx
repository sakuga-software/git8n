/**
 * The source text that a translation answers, beside the source now (DB-607).
 *
 * A translation « à revoir » was written for this text. The reader compares
 * the two to decide whether the translation still fits.
 */
export function WasSource({ was, lang, className }: { was: string; lang: string; className?: string }) {
  return (
    <span className={`text-alarm-ink flex flex-col gap-0.5 text-xs leading-normal ${className ?? ''}`}>
      <span className="font-semibold">Traduit depuis l'ancien texte :</span>
      <del lang={lang} className="text-sub whitespace-pre-line">
        {was === '' ? '(aucun texte)' : was}
      </del>
    </span>
  );
}

import { Spinner } from '@heroui/react/spinner';
import type { CatalogueProgress } from '@i18n-editor/mcp/api';

const countOf = (value: number): string => value.toLocaleString('fr-FR');

/**
 * The first read of the translations, with how many files it has taken (DB-654).
 *
 * The status says once that the read goes on. The bar carries the count, so
 * a screen reader does not read each new file aloud.
 */
export function CatalogueLoading({ progress }: { progress: CatalogueProgress | null }) {
  const known = progress !== null && progress.total > 0;

  return (
    <div className="text-sub flex flex-col items-center justify-center gap-3 px-4 py-16 text-sm">
      <div role="status" className="flex items-center gap-2.5">
        <Spinner size="sm" color="current" />
        Lecture des traductions…
        {known && (
          <span aria-hidden="true" className="tabular-nums">
            {countOf(progress.done)} / {countOf(progress.total)} fichiers
          </span>
        )}
      </div>
      {known && (
        <div
          role="progressbar"
          aria-label="Fichiers lus"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={`${countOf(progress.done)} fichiers sur ${countOf(progress.total)}`}
          className="bg-line h-1.5 w-full max-w-[320px] overflow-hidden rounded-full"
        >
          <div
            className="bg-signal h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

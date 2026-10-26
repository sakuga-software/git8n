import { idOf, type NeighbourState, type Neighbours } from './rows';

const STATE_LABEL: Record<NeighbourState, string> = {
  published: 'Publiée',
  proposed: 'Proposée',
  edited: 'Modifiée',
  missing: 'Manquante',
  review: 'À revoir',
};

const STATE_INK: Record<NeighbourState, string> = {
  published: 'text-published-ink',
  proposed: 'text-proposed-ink',
  edited: 'text-sub',
  missing: 'text-missing-ink',
  review: 'text-alarm-ink',
};

const countOf = (value: number): string => value.toLocaleString('fr-FR');

interface Props {
  neighbours: Neighbours;
  language: { name: string; code: string };
  source: { name: string; code: string };
  onOpen: (id: string) => void;
  /** Opens the whole section in the list. Absent for the keys without a section, which have none to open. */
  onSection?: () => void;
}

/**
 * The keys beside the open one and their translation now, to keep the same
 * terms from a key to the next (DB-277). A row opens its key.
 */
export function SameSection({ neighbours, language, source, onOpen, onSection }: Props) {
  if (neighbours.total === 0) return null;

  return (
    <section aria-labelledby="same-section-title" className="border-line-soft flex flex-col gap-3 border-t pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="same-section-title" className="text-sm font-semibold">
          Dans la même section
        </h3>
        <span className="text-muted text-xs">Pour garder les mêmes termes d'une clé à l'autre</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] border-collapse text-[13.5px]">
          <thead>
            <tr className="text-muted border-line-soft border-b text-left text-xs">
              <th scope="col" className="py-2 pr-3 font-medium">
                Clé
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {source.name}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {language.name}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                État
              </th>
            </tr>
          </thead>
          <tbody>
            {neighbours.rows.map(({ row, value, state }) => (
              <tr
                key={idOf(row)}
                onClick={() => onOpen(idOf(row))}
                className="border-line-soft hover:bg-hover cursor-pointer border-b align-baseline last:border-b-0"
              >
                <td className="py-2 pr-3">
                  {/* The button carries the click for a keyboard; the row only widens the target. */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(idOf(row));
                    }}
                    aria-label={`Ouvrir ${row.key}`}
                    className="hover:text-signal cursor-pointer text-left font-mono text-xs [overflow-wrap:anywhere]"
                  >
                    {row.key}
                  </button>
                </td>
                <td lang={source.code} className="text-sub py-2 pr-3">
                  {row.source}
                </td>
                <td lang={language.code} className="py-2 pr-3">
                  {value ?? <span className="text-muted">—</span>}
                </td>
                <td className={`py-2 text-right text-xs font-medium whitespace-nowrap ${STATE_INK[state]}`}>
                  {STATE_LABEL[state]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {neighbours.total > neighbours.rows.length && onSection && (
        <button
          type="button"
          onClick={onSection}
          className="text-signal cursor-pointer self-start text-[13px] hover:underline"
        >
          Voir les {countOf(neighbours.total)} clés de <code className="font-mono">{neighbours.section}</code>
        </button>
      )}
    </section>
  );
}

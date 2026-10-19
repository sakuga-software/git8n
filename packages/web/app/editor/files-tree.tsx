import { ChevronDown } from './icons';
import type { TreeNode } from './tree';

/** What the table is narrowed to: a file, or a section of one. `path` is empty for the whole file. */
export type Scope = Pick<TreeNode, 'file' | 'path'>;

/** The name of a node in `opened`. A file is its node with the path `''`. */
export const scopeIdOf = (node: Scope): string => `${node.file}\n${node.path}`;
const idOf = scopeIdOf;
const countOf = (value: number): string => value.toLocaleString('fr-FR');

/** The sections of a node. A key is not one: the panel stops at the sections. */
const sectionsOf = (node: TreeNode): TreeNode[] => node.children.filter((child) => child.children.length > 0);

const ROW = 'flex h-8 w-full items-center gap-2 rounded-md pr-2.5 text-left text-[13px]';

function Node({
  node,
  depth,
  scope,
  opened,
  onToggle,
  onScope,
  tabStop,
}: {
  node: TreeNode;
  depth: number;
  scope: Scope | null;
  opened: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onScope: (node: TreeNode) => void;
  /** The one entry that Tab reaches. The arrows reach the others. */
  tabStop: string;
}) {
  const id = idOf(node);
  const sections = sectionsOf(node);
  const folds = sections.length > 0;
  const shown = folds && opened.has(id);
  const selected = scope !== null && idOf(scope) === id;

  // A file that holds no key in this language is one the manifest disables.
  if (node.total === 0 && depth === 0) {
    return (
      <li role="treeitem" aria-selected={false} aria-disabled="true">
        <div className={`${ROW} text-muted cursor-not-allowed pl-2`}>
          <span className="w-3.5 flex-none" />
          <span className="font-mono">{node.name}</span>
          <span className="ml-auto text-[11.5px]">pas de version</span>
        </div>
      </li>
    );
  }

  return (
    <li role="treeitem" aria-expanded={folds ? shown : undefined} aria-selected={selected}>
      <div
        className={`${ROW} ${selected ? 'bg-chosen font-medium' : 'hover:bg-hover'} ${depth > 0 ? 'text-sub' : ''}`}
        style={{ paddingLeft: 8 + depth * 22 }}
      >
        {folds ? (
          <button
            type="button"
            aria-label={`${shown ? 'Replier' : 'Déplier'} ${node.path || node.name}`}
            // The arrows fold and unfold from the entry, so Tab does not stop here.
            tabIndex={-1}
            onClick={() => onToggle(id)}
            className="text-muted hover:text-ink flex size-3.5 flex-none cursor-pointer items-center justify-center"
          >
            <ChevronDown size={14} className={shown ? '' : '-rotate-90'} />
          </button>
        ) : (
          <span className="w-3.5 flex-none" />
        )}
        <button
          type="button"
          aria-current={selected ? 'true' : undefined}
          data-entry={id}
          data-depth={depth}
          data-folds={folds ? (shown ? 'open' : 'closed') : undefined}
          tabIndex={tabStop === id ? 0 : -1}
          onClick={() => onScope(node)}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left font-mono"
        >
          <span className="truncate">{node.name}</span>
          {/* Zero is not written: the node can still hold keys that are proposed or published. */}
          {node.counts.missing > 0 && (
            <span className="text-missing-ink ml-auto text-xs">{countOf(node.counts.missing)}</span>
          )}
        </button>
      </div>

      {shown && (
        <ul role="group">
          {sections.map((child) => (
            <Node
              key={child.path}
              node={child}
              depth={depth + 1}
              scope={scope}
              opened={opened}
              onToggle={onToggle}
              onScope={onScope}
              tabStop={tabStop}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The files of the language and their sections, in the side panel (DB-270).
 *
 * The number beside a name is how many of its keys are missing, whatever tab
 * the table shows: it says where the work is. A click on a name narrows the
 * table to the keys under it, by whole segments. A click on a chevron unfolds
 * and narrows nothing.
 *
 * The keyboard is the one of a tree: Tab reaches one entry, the up and down
 * arrows go from entry to entry, the right arrow unfolds, the left arrow folds
 * or goes to the parent, Home and End go to the ends.
 */
export function FilesTree({
  tree,
  scope,
  opened,
  onOpened,
  onScope,
}: {
  tree: readonly TreeNode[];
  scope: Scope | null;
  opened: ReadonlySet<string>;
  onOpened: (opened: ReadonlySet<string>) => void;
  /** The node that was chosen, or `null` for every file. */
  onScope: (node: TreeNode | null) => void;
}) {
  const missing = tree.reduce((sum, file) => sum + file.counts.missing, 0);
  // By name: a file with no version sits among the others, where a reader looks for it.
  const files = [...tree].sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (id: string) => {
    const next = new Set(opened);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    onOpened(next);
  };

  const ALL = '';
  // The chosen entry is hidden when one of its parents is folded. Tab then reaches the first entry.
  const shownIds = new Set<string>();
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      shownIds.add(idOf(node));
      if (opened.has(idOf(node))) walk(sectionsOf(node));
    }
  };

  walk(tree);

  const tabStop = scope !== null && shownIds.has(idOf(scope)) ? idOf(scope) : ALL;

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-entry]')];
    const at = entries.indexOf(event.target as HTMLElement);

    if (at === -1) return;

    const entry = entries[at];
    const depth = Number(entry.dataset.depth);
    const folds = entry.dataset.folds;
    let next: HTMLElement | undefined;

    if (event.key === 'ArrowDown') next = entries[at + 1];
    else if (event.key === 'ArrowUp') next = entries[at - 1];
    else if (event.key === 'Home') next = entries[0];
    else if (event.key === 'End') next = entries.at(-1);
    else if (event.key === 'ArrowRight' && folds === 'closed') toggle(entry.dataset.entry!);
    else if (event.key === 'ArrowRight' && folds === 'open') next = entries[at + 1];
    else if (event.key === 'ArrowLeft' && folds === 'open') toggle(entry.dataset.entry!);
    else if (event.key === 'ArrowLeft')
      next = entries
        .slice(0, at)
        .reverse()
        .find((other) => Number(other.dataset.depth) < depth);
    else return;

    event.preventDefault();
    next?.focus();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="mx-2 mb-1 flex items-baseline justify-between">
        <h2 className="text-muted text-xs font-semibold">Fichiers</h2>
        <span className="text-muted text-[11.5px]">manquantes</span>
      </div>
      <ul role="tree" aria-label="Fichiers et sections" onKeyDown={onKeyDown} className="flex flex-col gap-px">
        <li role="treeitem" aria-selected={scope === null}>
          <button
            type="button"
            aria-current={scope === null ? 'true' : undefined}
            data-entry={ALL}
            data-depth={0}
            tabIndex={tabStop === ALL ? 0 : -1}
            onClick={() => onScope(null)}
            className={`${ROW} cursor-pointer pl-2 font-medium ${scope === null ? 'bg-chosen' : 'hover:bg-hover'}`}
          >
            <span className="w-3.5 flex-none" />
            Tous les fichiers
            {missing > 0 && <span className="text-missing-ink ml-auto font-mono text-xs">{countOf(missing)}</span>}
          </button>
        </li>
        {files.map((file) => (
          <Node
            key={file.file}
            node={file}
            depth={0}
            scope={scope}
            opened={opened}
            onToggle={toggle}
            onScope={onScope}
            tabStop={tabStop}
          />
        ))}
      </ul>
    </div>
  );
}

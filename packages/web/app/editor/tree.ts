import type { Row, RowState } from './rows';

/** A file, a section of a file, or a key, with the count of the keys under it by state. */
export interface TreeNode {
  /** What the tree shows: the name of the file, or one segment of the key. */
  name: string;
  file: string;
  /** The key down to this node: `analysis.requests`. Empty for a file. */
  path: string;
  counts: Record<RowState, number>;
  total: number;
  /** Sections first, then keys, each by name. A key has none. */
  children: TreeNode[];
}

const node = (name: string, file: string, path: string): TreeNode => ({
  name,
  file,
  path,
  counts: { missing: 0, review: 0, proposed: 0, published: 0 },
  total: 0,
  children: [],
});

const sorted = (nodes: TreeNode[]): TreeNode[] =>
  nodes
    .map((child) => ({ ...child, children: sorted(child.children) }))
    .sort((a, b) => Number(a.children.length === 0) - Number(b.children.length === 0) || a.name.localeCompare(b.name));

/**
 * The structure of the translations (DB-243): a file, its sections, its keys.
 *
 * A key is a dotted path, so the tree is in the data. Each node counts the
 * keys under it by state, and a file with no key in this language — one that
 * the manifest disables — is still a node, with a total of zero.
 */
export const treeOf = (rows: readonly Row[], files: readonly string[] = []): TreeNode[] => {
  const roots = new Map<string, TreeNode>(files.map((name) => [name, node(name, name, '')]));

  for (const row of rows) {
    let at = roots.get(row.file);

    if (!at) {
      at = node(row.file, row.file, '');
      roots.set(row.file, at);
    }

    at.counts[row.state] += 1;
    at.total += 1;

    const segments = row.key.split('.');

    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join('.');
      let child = at!.children.find((found) => found.path === path);

      if (!child) {
        child = node(segment, row.file, path);
        at!.children.push(child);
      }

      child.counts[row.state] += 1;
      child.total += 1;
      at = child;
    });
  }

  return sorted([...roots.values()]);
};

/** The rows under a node: every key of its file that is the path, or that starts with it and a dot. */
export const under = (rows: readonly Row[], target: Pick<TreeNode, 'file' | 'path'>): readonly Row[] =>
  rows.filter(
    (row) =>
      row.file === target.file &&
      (target.path === '' || row.key === target.path || row.key.startsWith(`${target.path}.`)),
  );

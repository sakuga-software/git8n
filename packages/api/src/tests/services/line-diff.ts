/**
 * The lines that differ between two texts, found from both ends (DB-608).
 *
 * A write changes one place of a file, so the common head and the common tail
 * hold everything else. What is left between them is what a reviewer reads in
 * the diff of the commit.
 */
export const lineDiff = (before: string, after: string): { removed: string[]; added: string[] } => {
  const old = before.split('\n');
  const now = after.split('\n');
  let head = 0;

  while (head < old.length && head < now.length && old[head] === now[head]) head += 1;

  let tail = 0;

  while (
    tail < old.length - head &&
    tail < now.length - head &&
    old[old.length - 1 - tail] === now[now.length - 1 - tail]
  ) {
    tail += 1;
  }

  return { removed: old.slice(head, old.length - tail), added: now.slice(head, now.length - tail) };
};

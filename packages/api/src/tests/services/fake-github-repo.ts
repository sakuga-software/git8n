import { createHash } from 'node:crypto';
import { vi, type Mock } from 'vitest';

/**
 * A repository of GitHub, answering enough of the API to run a write (DB-212).
 *
 * The write path builds blobs, a tree and a commit, then moves a branch. A
 * mock that answers a fixed body for each call proves none of that: it cannot
 * say whether the branch moved, whether the commit holds the files, or what a
 * later read sees. This holds real state, so a test reads back what the code
 * wrote.
 *
 * A commit holds the whole set of files rather than a tree of its own. That is
 * not how git stores them, but it answers every question these tests ask.
 */

interface Commit {
  sha: string;
  message: string;
  parents: string[];
  author: { name: string; email: string; date: string };
  files: Map<string, string>;
}

export interface FakeRepo {
  /** Typed so a test can call it through a wrapper of its own. */
  fetch: Mock<(url: string, init?: RequestInit) => Promise<unknown>>;
  /** The commits, newest last, by sha. */
  commits: Map<string, Commit>;
  refs: Map<string, string>;
  /** The files of a commit, for a test that reads back what was written. */
  filesAt: (ref: string) => Map<string, string>;
  /** Moves a branch behind the caller's back, as another writer would. */
  moveBranch: (branch: string, files: Record<string, unknown>, message?: string) => string;
  /** How many times the ref of the base branch refused a move. */
  refusals: number;
  /** Makes the next `n` moves of the base branch fail as a stale write. */
  refuseNextMoves: (n: number) => void;
  /** The pull requests, by number (DB-606). */
  pulls: Map<number, FakePull>;
  /** Merges a pull request as GitHub does: a merge commit on its base branch. */
  mergePull: (number: number) => string;
  closePull: (number: number) => void;
  /**
   * What the installation refuses, as GitHub answers a permission it lacks:
   * `pulls` refuses every call on the pull requests with a 403.
   */
  refuse: { pulls: boolean; mergeConflict: boolean };
}

export interface FakePull {
  number: number;
  head: string;
  base: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  title: string;
  body: string;
}

/**
 * The sha of a file follows its content, as a blob of git does. The read of
 * the proposed keys compares two of them to know whether a batch touched a
 * file (DB-213): a sha made from the path says « never ».
 */
const blobSha = (content: string) => createHash('sha1').update(content).digest('hex');

const json = (body: unknown) => ({ ok: true, headers: new Headers(), json: async () => body });
const fail = (status: number, message: string) => ({ ok: false, status, json: async () => ({ message }) });

/**
 * A repository whose base branch holds `files`, by path.
 *
 * `baseBranch` is the branch a publication writes onto, and the one a proposal
 * branches from.
 */
export const fakeRepo = (options: {
  owner: string;
  name: string;
  baseBranch: string;
  files: Record<string, unknown>;
}): FakeRepo => {
  const repo = `/repos/${options.owner}/${options.name}`;
  let counter = 0;
  // Forty lowercase hexadecimal characters, as GitHub answers. A shorter one,
  // or one holding a letter past `f`, would fail every check that reads a sha
  // and make the reason look like something else.
  const sha = (kind: 'c' | 'b' | 'd') => `${kind}${String((counter += 1)).padStart(39, '0')}`;

  const state: FakeRepo = {
    fetch: vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
    commits: new Map(),
    refs: new Map(),
    filesAt: (ref) => new Map(state.commits.get(ref)?.files ?? []),
    moveBranch: (branch, files, message) => {
      const at = state.refs.get(branch);
      const carried = new Map(at ? (state.commits.get(at)?.files ?? []) : []);

      for (const [path, content] of Object.entries(files)) carried.set(path, JSON.stringify(content, null, 2));

      const made = sha('c');

      state.commits.set(made, {
        sha: made,
        message: message ?? 'somebody else',
        parents: at ? [at] : [],
        author: { name: 'Somebody', email: 'somebody@example.test', date: new Date().toISOString() },
        files: carried,
      });
      state.refs.set(branch, made);

      return made;
    },
    refusals: 0,
    refuseNextMoves: (n) => {
      refusing = n;
    },
    pulls: new Map(),
    mergePull: (number) => {
      const pull = state.pulls.get(number)!;
      const made = mergeCommit(pull.base, pull.head, `Merge pull request #${number}`);

      pull.state = 'closed';
      pull.merged_at = new Date().toISOString();

      return made;
    },
    closePull: (number) => {
      state.pulls.get(number)!.state = 'closed';
    },
    refuse: { pulls: false, mergeConflict: false },
  };

  let refusing = 0;
  const blobs = new Map<string, string>();
  const trees = new Map<string, Map<string, string>>();
  const first = sha('c');

  state.commits.set(first, {
    sha: first,
    message: 'the first commit',
    parents: [],
    author: { name: 'Somebody', email: 'somebody@example.test', date: '2026-09-01T00:00:00Z' },
    files: new Map(Object.entries(options.files).map(([path, content]) => [path, JSON.stringify(content, null, 2)])),
  });
  state.refs.set(options.baseBranch, first);

  /** `commit` and every commit it was built on, through every parent of a merge. */
  const ancestry = (commit: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [commit];

    while (queue.length > 0) {
      const at = queue.shift()!;

      if (seen.has(at) || !state.commits.has(at)) continue;

      seen.add(at);
      queue.push(...state.commits.get(at)!.parents);
    }

    return seen;
  };

  /** Whether `commit` is `of` itself, or was built on it. */
  const descends = (commit: string, of: string): boolean => ancestry(commit).has(of);

  /**
   * A merge commit of `head` into the branch `into`, as GitHub makes one.
   *
   * A file that `head` changed since the two parted takes its version. Every
   * other file keeps the one of `into`.
   */
  const mergeCommit = (into: string, head: string, message: string): string => {
    const intoSha = state.refs.get(into)!;
    const headSha = state.refs.get(head) ?? head;
    const base = mergeBase(intoSha, headSha);
    const before = state.commits.get(base)?.files ?? new Map<string, string>();
    const files = new Map(state.commits.get(intoSha)!.files);

    for (const [path, content] of state.commits.get(headSha)!.files) {
      if (before.get(path) !== content) files.set(path, content);
    }

    const made = sha('c');

    state.commits.set(made, {
      sha: made,
      message,
      parents: [intoSha, headSha],
      author: { name: 'GitHub', email: 'noreply@github.com', date: new Date().toISOString() },
      files,
    });
    state.refs.set(into, made);

    return made;
  };

  /** The newest commit that both hold, as the compare of GitHub answers it. */
  const mergeBase = (base: string, head: string): string => {
    const held = ancestry(base);

    for (let at: string | undefined = head; at; at = state.commits.get(at)?.parents[0]) {
      if (held.has(at)) return at;
    }

    return '';
  };

  /** The commits of `head` that `base` does not hold, oldest first. */
  const ahead = (base: string, head: string): Commit[] => {
    const held = ancestry(base);

    const rows: Commit[] = [];

    for (let at: string | undefined = head; at && !held.has(at); at = state.commits.get(at)?.parents[0]) {
      const commit = state.commits.get(at);

      if (commit) rows.unshift(commit);
    }

    return rows;
  };

  state.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const at = new URL(String(url));
    const path = decodeURIComponent(at.pathname);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, never>) : undefined;

    if (!path.startsWith(repo)) return fail(404, `no ${path}`);

    const rest = path.slice(repo.length);

    if (method === 'GET' && rest.startsWith('/git/refs/heads/')) {
      const found = state.refs.get(rest.replace('/git/refs/heads/', ''));

      return found ? json({ object: { sha: found } }) : fail(404, 'Branch not found');
    }

    if (method === 'POST' && rest === '/git/refs') {
      state.refs.set(String(body!.ref).replace('refs/heads/', ''), String(body!.sha));

      return json({ object: { sha: body!.sha } });
    }

    if (method === 'PATCH' && rest.startsWith('/git/refs/heads/')) {
      const branch = rest.replace('/git/refs/heads/', '');
      const at = state.refs.get(branch);

      if (refusing > 0) {
        refusing -= 1;
        state.refusals += 1;

        return fail(422, 'Update is not a fast forward');
      }

      // **`force: false` is the protection under test.** A repository that
      // accepts any move makes the stale case unreachable except by forcing
      // it, so the test would prove the retry and not the refusal.
      if (body!.force !== true && at && !descends(String(body!.sha), at)) {
        state.refusals += 1;

        return fail(422, 'Update is not a fast forward');
      }

      state.refs.set(branch, String(body!.sha));

      return json({ object: { sha: body!.sha } });
    }

    if (method === 'POST' && rest === '/git/blobs') {
      const made = sha('b');

      blobs.set(made, Buffer.from(String(body!.content), 'base64').toString('utf8'));

      return json({ sha: made });
    }

    if (method === 'GET' && rest.startsWith('/git/commits/')) {
      const commit = state.commits.get(rest.replace('/git/commits/', ''));

      if (!commit) return fail(404, 'No commit');

      // The tree of a commit is named by the commit: this repository keeps the
      // files on the commit rather than in a tree of its own.
      trees.set(`t-${commit.sha}`, new Map(commit.files));

      return json({ tree: { sha: `t-${commit.sha}` }, message: commit.message });
    }

    if (method === 'POST' && rest === '/git/trees') {
      const made = sha('d');
      const carried = new Map(trees.get(String(body!.base_tree)) ?? []);

      for (const entry of body!.tree as unknown as Array<{ path: string; sha: string }>) {
        carried.set(entry.path, blobs.get(entry.sha) ?? '');
      }

      trees.set(made, carried);

      return json({ sha: made });
    }

    if (method === 'POST' && rest === '/git/commits') {
      const made = sha('c');

      state.commits.set(made, {
        sha: made,
        message: String(body!.message),
        parents: body!.parents as unknown as string[],
        author: body!.author as unknown as Commit['author'],
        files: new Map(trees.get(String(body!.tree)) ?? []),
      });

      return json({ sha: made });
    }

    if (method === 'GET' && rest.startsWith('/commits/')) {
      // GitHub answers a branch name here too, with the commit it points at.
      const named = decodeURIComponent(rest.replace('/commits/', ''));
      const commit = state.commits.get(state.refs.get(named) ?? named);

      return commit
        ? json({ sha: commit.sha, commit: { message: commit.message, author: commit.author } })
        : fail(404, 'No commit');
    }

    if (method === 'GET' && rest.startsWith('/compare/')) {
      const [base, head] = rest.replace('/compare/', '').split('...');
      const from = state.refs.get(base) ?? (state.commits.has(base) ? base : undefined);
      const to = state.refs.get(head) ?? (state.commits.has(head) ? head : undefined);

      if (!from || !to) return fail(404, 'Not found');

      // The status is what tells an ancestor from a stranger, which is what a
      // publication asks before it trusts the sha a caller sent.
      const status =
        from === to ? 'identical' : descends(to, from) ? 'ahead' : descends(from, to) ? 'behind' : 'diverged';

      return json({
        status,
        merge_base_commit: { sha: mergeBase(from, to) },
        commits: ahead(from, to).map((commit) => ({
          sha: commit.sha,
          commit: { message: commit.message, author: commit.author },
        })),
      });
    }

    if (rest === '/pulls' || rest.startsWith('/pulls/') || rest === '/merges') {
      if (rest !== '/merges' && state.refuse.pulls) return fail(403, 'Resource not accessible by integration');
    }

    if (method === 'GET' && rest === '/pulls') {
      const head = String(at.searchParams.get('head')).split(':')[1];
      const base = at.searchParams.get('base');
      const wanted = at.searchParams.get('state');
      const rows = [...state.pulls.values()]
        .filter((row) => row.head === head && (!base || row.base === base))
        .filter((row) => wanted === 'all' || row.state === wanted)
        .sort((a, b) => b.number - a.number)
        .slice(0, Number(at.searchParams.get('per_page') ?? 30));

      return json(rows.map((row) => ({ ...row, html_url: `https://github.com${repo.slice(6)}/pull/${row.number}` })));
    }

    if (rest.startsWith('/pulls/')) {
      const pull = state.pulls.get(Number(rest.replace('/pulls/', '')));

      if (!pull) return fail(404, 'No pull request');

      if (method === 'PATCH') Object.assign(pull, { title: body!.title, body: body!.body });

      return json({ ...pull, mergeable: true, html_url: `https://github.com${repo.slice(6)}/pull/${pull.number}` });
    }

    if (method === 'POST' && rest === '/pulls') {
      const pull: FakePull = {
        number: state.pulls.size + 1,
        head: String(body!.head),
        base: String(body!.base),
        state: 'open',
        merged_at: null,
        title: String(body!.title),
        body: String(body!.body),
      };

      state.pulls.set(pull.number, pull);

      return json({ ...pull, html_url: `https://github.com${repo.slice(6)}/pull/${pull.number}` });
    }

    if (method === 'POST' && rest === '/merges') {
      const into = String(body!.base);
      const from = state.refs.get(String(body!.head))!;

      if (descends(state.refs.get(into)!, from))
        return { ok: true, status: 204, headers: new Headers(), json: async () => null };
      if (state.refuse.mergeConflict) return fail(409, 'Merge conflict');

      return json({ sha: mergeCommit(into, String(body!.head), String(body!.commit_message)) });
    }

    if (method === 'GET' && rest.startsWith('/contents/')) {
      const ref = at.searchParams.get('ref') ?? '';
      const files = state.commits.get(ref)?.files ?? state.commits.get(state.refs.get(ref) ?? '')?.files;

      if (!files) return fail(404, `no ref ${ref}`);

      const wanted = rest.replace('/contents/', '');
      const exact = files.get(wanted);

      if (exact !== undefined) {
        return json({
          name: wanted.split('/').pop(),
          sha: blobSha(exact),
          content: Buffer.from(exact, 'utf8').toString('base64'),
          encoding: 'base64',
        });
      }

      const inside = [...files.keys()].filter((file) => file.startsWith(`${wanted}/`));

      if (inside.length === 0) return fail(404, `no ${wanted}`);

      return json(
        inside.map((file) => ({
          name: file.slice(wanted.length + 1),
          type: 'file',
          sha: blobSha(files.get(file) ?? ''),
        })),
      );
    }

    return fail(404, `the repository answers no ${method} ${path}`);
  });

  return state;
};

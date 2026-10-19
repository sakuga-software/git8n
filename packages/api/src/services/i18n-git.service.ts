import type { I18nRepository } from '@i18n-editor/db';
import { ask, GithubError, insideRepository, installationToken } from '@/services/github-app.service';
import { contentOf, filesOf, forgetCatalogues, manifestOf, pathsOf } from '@/services/i18n-catalogue.service';
import { languagesOf, UnknownLanguageError } from '@/services/i18n-repositories.service';

/**
 * The git path of the translations (DB-212).
 *
 * A proposal is a commit on the branch of its language, `i18n/<language>`. A
 * publication is a commit on the branch of the repository. **No pull request
 * exists**, so nothing waits on a merge and everything stays diffable and
 * revertible in git.
 *
 * One batch is one commit, not one per key. The contents API writes one file
 * per commit, so a batch of three hundred keys would be three hundred commits.
 * The git data API builds a tree and commits it once, which is what this
 * module uses.
 */

/** The branch a language is proposed on. */
export const branchOf = (language: string): string => `i18n/${language}`;

/**
 * The trailer that says which revision a proposal was written against.
 *
 * The merge base of the branch does not answer this. After two batches, the
 * branch point is one revision and each batch was read at another. A per-key
 * comparison needs the revision of its own batch, and the commit carries it.
 * The answer then stays in git, out of a table.
 */
const READ_AT = 'Read-at';

/**
 * The branch would not move: it points somewhere this commit is not built on.
 *
 * Only the ref update says this. A 422 from a blob or a tree is a body GitHub
 * refused, and retrying it would repeat the same refusal.
 */
export class StaleBranchError extends Error {
  constructor(branch: string, cause: unknown) {
    super(`${branch} moved under the write`, { cause });

    this.name = 'StaleBranchError';
  }
}

/** A token that may write this repository, and nothing else. */
const writeToken = (repository: I18nRepository) =>
  installationToken(repository.installationId, {
    repository: repository.name,
    permissions: { contents: 'write' },
  });

/** Who wrote a batch. git keeps the author; the App is only the committer. */
export interface Author {
  name: string;
  email: string;
}

/** One key of one file, and what it is proposed to say. */
export interface ProposedValue {
  file: string;
  key: string;
  value: string;
}

const refPath = (repository: I18nRepository, branch: string) =>
  `/repos/${insideRepository(repository.owner, repository.name)}/git/refs/heads/${insideRepository(branch)}`;

/** Whether `maybe` is `of` itself, or a commit `of` was built on. */
const isAncestor = async (repository: I18nRepository, token: string, maybe: string, of: string): Promise<boolean> => {
  const answer = await ask<{ status: string }>(
    `/repos/${insideRepository(repository.owner, repository.name)}/compare/${insideRepository(maybe)}...${insideRepository(of)}`,
    token,
  ).catch((error: unknown) => {
    if (error instanceof GithubError && error.status === 404) return null;

    throw error;
  });

  return answer !== null && (answer.status === 'ahead' || answer.status === 'identical');
};

/** The commit a branch points at, or nothing when the branch is not there. */
const headOf = async (repository: I18nRepository, token: string, branch: string): Promise<string | null> => {
  const answer = await ask<{ object: { sha: string } }>(refPath(repository, branch), token).catch((error: unknown) => {
    if (error instanceof GithubError && error.status === 404) return null;

    throw error;
  });

  return answer?.object.sha ?? null;
};

/**
 * A segment that names a property every object already has.
 *
 * `__proto__.x` does not write into the file: it walks to `Object.prototype`
 * and writes there, so every object made afterwards in this process carries
 * the value. A translator sends these keys, so the check is not optional.
 */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** A key that cannot be written, and why. The route answers 400. */
export class UnwritableKeyError extends Error {
  constructor(reason: string) {
    super(reason);

    this.name = 'UnwritableKeyError';
  }
}

/** Sets a dotted path of an object, making the objects on the way. */
const setAt = (node: Record<string, unknown>, key: string, value: string): void => {
  const parts = key.split('.');

  for (const part of parts) {
    if (part.length === 0) throw new UnwritableKeyError(`${key} holds an empty segment.`);
    if (UNSAFE_SEGMENTS.has(part)) throw new UnwritableKeyError(`${key} names ${part}, which every object holds.`);
  }

  let at = node;

  for (const part of parts.slice(0, -1)) {
    const next = at[part];

    if (next === undefined) {
      at[part] = {};
    } else if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      // Writing here would replace a translation that is already in the file.
      throw new UnwritableKeyError(`${key} passes through ${part}, which the file holds as a value.`);
    }

    at = at[part] as Record<string, unknown>;
  }

  at[parts[parts.length - 1]] = value;
};

/** A file to write, by its path in the repository. */
interface FileToWrite {
  path: string;
  content: Record<string, unknown>;
}

/**
 * One commit holding every file of a batch.
 *
 * The blobs, the tree and the commit are made first, and the branch is moved
 * last. Until that last call, no branch reaches the batch. A failure in the
 * middle leaves the repository as it was.
 *
 * `expected` is the commit the branch must still point at. GitHub refuses the
 * move otherwise, which is what keeps a publication from overwriting a change
 * it did not read.
 */
const commitBatch = async (
  repository: I18nRepository,
  token: string,
  batch: {
    branch: string;
    parent: string;
    expected: string | null;
    files: FileToWrite[];
    message: string;
    author: Author;
    at: Date;
  },
): Promise<string> => {
  const repo = `/repos/${insideRepository(repository.owner, repository.name)}`;
  const blobs = await Promise.all(
    batch.files.map(async (file) => ({
      path: file.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: (
        await ask<{ sha: string }>(`${repo}/git/blobs`, token, 'POST', {
          // The files end with a newline, as a file written by hand does. A
          // publication then shows no change nobody made.
          content: Buffer.from(`${JSON.stringify(file.content, null, 2)}\n`, 'utf8').toString('base64'),
          encoding: 'base64',
        })
      ).sha,
    })),
  );
  const parent = await ask<{ tree: { sha: string } }>(`${repo}/git/commits/${batch.parent}`, token);
  const tree = await ask<{ sha: string }>(`${repo}/git/trees`, token, 'POST', {
    base_tree: parent.tree.sha,
    tree: blobs,
  });
  const stamp = { name: batch.author.name, email: batch.author.email, date: batch.at.toISOString() };
  const commit = await ask<{ sha: string }>(`${repo}/git/commits`, token, 'POST', {
    message: batch.message,
    tree: tree.sha,
    parents: [batch.parent],
    // The translator authored it. The App only committed it, which is what
    // `git log` should say: the history names who wrote a translation.
    author: stamp,
  });

  // `force: false` is the whole protection: GitHub moves the branch only when
  // the new commit is built on where it points. A change nobody read is never
  // overwritten, and the refusal is what a replay listens for.
  try {
    if (batch.expected === null) {
      await ask(`${repo}/git/refs`, token, 'POST', { ref: `refs/heads/${batch.branch}`, sha: commit.sha });
    } else {
      await ask(refPath(repository, batch.branch), token, 'PATCH', { sha: commit.sha, force: false });
    }
  } catch (error) {
    if (error instanceof GithubError && (error.status === 422 || error.status === 409)) {
      throw new StaleBranchError(batch.branch, error);
    }

    throw error;
  }

  return commit.sha;
};

/** What a proposal ended as. */
export interface Proposal {
  /** The commit that now holds the batch. */
  commit: string;
  branch: string;
  /** The revision the batch was written against, as its trailer says. */
  readAt: string;
  /** How many keys the batch carries. */
  keys: number;
  /** The files it touched, by their path in the repository. */
  files: string[];
}

const messageOf = (language: string, count: number, author: Author, readAt: string) =>
  [
    `i18n(${language}): ${count} ${count === 1 ? 'key' : 'keys'} proposed by ${author.name}`,
    '',
    `${READ_AT}: ${readAt}`,
  ].join('\n');

/**
 * Writes a batch of translations on the branch of its language.
 *
 * The whole file is written back, not the keys alone. A key the target holds
 * and the source does not is then kept rather than dropped.
 */
export const propose = async (
  repository: I18nRepository,
  language: string,
  values: ProposedValue[],
  author: Author,
  /** The commit of the catalogue the translator read, which the trailer records. */
  readAt: string,
  options: { now?: Date } = {},
): Promise<Proposal> => {
  const { targets } = languagesOf(repository);

  if (!targets.includes(language)) {
    throw new UnknownLanguageError(
      `${language} is not a language this repository translates into. Known: ${targets.join(', ') || 'none'}`,
    );
  }

  if (values.length === 0) throw new UnknownLanguageError('A proposal carries at least one key.');

  const token = await writeToken(repository);
  const base = await headOf(repository, token, repository.branch);

  if (!base) throw new GithubError(`${repository.branch} is not a branch of this repository`, 404);

  // **The head at write time is not what the translator read.** The source can
  // move between the read and the submission, and the catalogue is held for
  // five minutes besides. Recording the head here would make the drift check
  // compare the new source with itself, and publish a translation of a text
  // that is gone.
  if (!(await isAncestor(repository, token, readAt, repository.branch))) {
    throw new UnknownLanguageError(`${readAt} is not a commit of ${repository.branch}. Read the catalogue again.`);
  }

  // The manifest is read on the base branch: a branch of proposals must not be
  // able to switch a file back on for itself.
  const stateOf = await manifestOf(repository, token, base);
  const disabled = [...new Set(values.map((value) => value.file))].filter(
    (file) => stateOf(file, language) === 'disabled',
  );

  if (disabled.length > 0) {
    throw new UnwritableKeyError(
      `${disabled.sort().join(', ')} has no ${language} version: the manifest of the locales disables it.`,
    );
  }

  const branch = branchOf(language);
  const head = await headOf(repository, token, branch);
  // A proposal is written on top of what the branch holds, or on the base
  // branch when there is none yet. The batch is read against the base, which
  // is what a translator saw.
  const parent = head ?? base;
  const known = await filesOf(repository, token, language, parent, { absentIsEmpty: true });
  const touched = [...new Set(values.map((value) => value.file))].sort();
  const files: FileToWrite[] = [];

  for (const file of touched) {
    const content = known.has(file) ? await contentOf(repository, token, language, file, parent) : {};

    for (const value of values.filter((row) => row.file === file)) setAt(content, value.key, value.value);

    files.push({ path: `${repository.localesPath}/${language}/${file}.json`, content });
  }

  const commit = await commitBatch(repository, token, {
    branch,
    parent,
    expected: head,
    files,
    message: messageOf(language, values.length, author, readAt),
    author,
    at: options.now ?? new Date(),
  });

  return { commit, branch, readAt, keys: values.length, files: files.map((file) => file.path) };
};

/** One batch waiting on the branch of a language. */
export interface WaitingBatch {
  commit: string;
  message: string;
  author: string;
  at: string;
  /** The revision the batch was written against. */
  readAt: string;
}

/**
 * A full sha, never a name.
 *
 * `\w+` would accept `Read-at: main`, and a commit whose message says that
 * makes the source at the trailer equal to the source now — which switches the
 * drift check off for every key of the batch.
 */
const readAtOf = (message: string): string => message.match(new RegExp(`^${READ_AT}: ([0-9a-f]{40})$`, 'm'))?.[1] ?? '';

/**
 * The batches that sit on the branch of a language and not on the base.
 *
 * This is what a reviewer reads before publishing. It comes from git alone: no
 * table records a proposal, so nothing can disagree with the repository.
 */
export const waiting = async (repository: I18nRepository, language: string): Promise<WaitingBatch[]> => {
  const token = await writeToken(repository);
  const branch = branchOf(language);
  const answer = await ask<{
    commits: Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>;
  }>(
    `/repos/${insideRepository(repository.owner, repository.name)}/compare/${insideRepository(repository.branch)}...${insideRepository(branch)}`,
    token,
  ).catch((error: unknown) => {
    // No branch for this language is no proposal, not a failure.
    if (error instanceof GithubError && error.status === 404) return { commits: [] };

    throw error;
  });

  return answer.commits.map((row) => ({
    commit: row.sha,
    message: row.commit.message.split('\n')[0],
    author: row.commit.author.name,
    at: row.commit.author.date,
    readAt: readAtOf(row.commit.message),
  }));
};

/** One key that a batch proposed, and that the base branch does not say yet. */
export interface ProposedKey {
  file: string;
  key: string;
  /** What the branch of the language says. */
  value: string;
  /** What the base branch says in this language now, or nothing. */
  current: string | null;
  /** What the source says on the base branch now, or nothing when the key left it. */
  source: string | null;
  /** The last batch that changed the key. A publication names it. */
  commit: string;
  author: string;
  at: string;
  /** The revision that batch was written against. */
  readAt: string;
}

/**
 * The keys that wait on the branch of a language, one row per key (DB-213).
 *
 * `waiting` answers batches, and a batch says nothing of its keys. A reviewer
 * approves keys, and `publish` wants the batch of each one.
 *
 * **« Proposed » is read per key, against the base branch.** A batch is
 * approved in parts, so the batch cannot say it. A key that the base branch
 * already says is published, and leaves this list without any state that
 * could contradict the repository.
 */
export const proposedKeys = async (repository: I18nRepository, language: string): Promise<ProposedKey[]> => {
  const { source, targets } = languagesOf(repository);

  if (!targets.includes(language)) {
    throw new UnknownLanguageError(
      `${language} is not a language this repository translates into. Known: ${targets.join(', ') || 'none'}`,
    );
  }

  const token = await writeToken(repository);
  const branch = branchOf(language);
  const compared = await ask<{
    merge_base_commit: { sha: string };
    commits: Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>;
  }>(
    `/repos/${insideRepository(repository.owner, repository.name)}/compare/${insideRepository(repository.branch)}...${insideRepository(branch)}`,
    token,
  ).catch((error: unknown) => {
    // No branch for this language is no proposal, not a failure.
    if (error instanceof GithubError && error.status === 404) return null;

    throw error;
  });

  if (!compared || compared.commits.length === 0) return [];

  const base = await headOf(repository, token, repository.branch);

  if (!base) throw new GithubError(`${repository.branch} is not a branch of this repository`, 404);

  const stateOf = await manifestOf(repository, token, base);
  // A batch rewrites the files that it touches, and no other. The sha of a
  // file says whether a batch touched it, so a branch of fifty batches does
  // not read every file fifty times.
  const contents = new Map<string, Map<string, unknown>>();
  const keysAt = async (lang: string, file: string, ref: string, sha: string) => {
    const held = contents.get(`${lang}/${file}:${sha}`);

    if (held) return held;

    const read = new Map(pathsOf(await contentOf(repository, token, lang, file, ref)));

    contents.set(`${lang}/${file}:${sha}`, read);

    return read;
  };

  const setBy = new Map<string, { file: string; key: string; batch: (typeof compared.commits)[number] }>();
  // The first batch is read against the commit the branch started from, not
  // against the base branch now. A key that somebody changed on the base
  // branch since then would read as a proposal to change it back.
  let before = { ref: compared.merge_base_commit.sha, files: new Map<string, string>() };

  before.files = await filesOf(repository, token, language, before.ref, { absentIsEmpty: true });

  for (const batch of compared.commits) {
    const files = await filesOf(repository, token, language, batch.sha, { absentIsEmpty: true });

    for (const [file, sha] of files) {
      const previousSha = before.files.get(file);

      if (previousSha === sha) continue;

      const now = await keysAt(language, file, batch.sha, sha);
      const then = previousSha ? await keysAt(language, file, before.ref, previousSha) : new Map<string, unknown>();

      for (const [key, value] of now) {
        if (typeof value === 'string' && value !== then.get(key)) setBy.set(`${file}\n${key}`, { file, key, batch });
      }
    }

    before = { ref: batch.sha, files };
  }

  const head = before;
  const baseFiles = await filesOf(repository, token, language, base, { absentIsEmpty: true });
  const sourceFiles = await filesOf(repository, token, source, base);
  const rows: ProposedKey[] = [];

  for (const { file, key, batch } of setBy.values()) {
    if (stateOf(file, language) === 'disabled') continue;

    const headSha = head.files.get(file);

    if (!headSha) continue;

    const value = (await keysAt(language, file, head.ref, headSha)).get(key);
    const baseSha = baseFiles.get(file);
    const current = baseSha ? (await keysAt(language, file, base, baseSha)).get(key) : undefined;

    if (typeof value !== 'string' || value === current) continue;

    const sourceSha = sourceFiles.get(file);
    const said = sourceSha ? (await keysAt(source, file, base, sourceSha)).get(key) : undefined;

    rows.push({
      file,
      key,
      value,
      current: typeof current === 'string' ? current : null,
      source: typeof said === 'string' ? said : null,
      commit: batch.sha,
      author: batch.commit.author.name,
      at: batch.commit.author.date,
      readAt: readAtOf(batch.commit.message),
    });
  }

  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key));
};

/** A key a reviewer approves, and the batch it comes from. */
export interface ApprovedKey {
  file: string;
  key: string;
  /** The commit of the batch that proposed it, which says what it was read against. */
  commit: string;
}

/** A key that was not published, and why. */
export interface RefusedKey extends ApprovedKey {
  /**
   * Why the publication left the key where it was.
   *
   * - `not-on-the-branch`: the key, or the commit named for it, is not there;
   * - `no-revision`: the commit carries no `Read-at`, so nothing says what the
   *   translation answered, and a key nobody can judge is not published;
   * - `changed-since-approval`: the branch says something else now than the
   *   approved batch did;
   * - `source-changed`: the text the translation answers is gone;
   * - `disabled`: the manifest of the locales says the file has no version in
   *   this language. A batch proposed before the file was disabled stays on
   *   the branch, and must not bring the file back.
   */
  reason: 'source-changed' | 'not-on-the-branch' | 'no-revision' | 'changed-since-approval' | 'disabled';
  /** What the source said when the key was proposed, and what it says now. */
  was?: string;
  now?: string;
}

export interface Publication {
  /** The commit on the base branch, or nothing when every key was refused. */
  commit: string | null;
  published: ApprovedKey[];
  refused: RefusedKey[];
}

const stringAt = (content: Record<string, unknown>, key: string): string | null => {
  const found = new Map(pathsOf(content)).get(key);

  return typeof found === 'string' ? found : null;
};

/**
 * Copies approved keys from the branch of a language onto the base branch.
 *
 * A key whose source changed since it was proposed is refused. The
 * translation answers a text that is no longer there, so it goes back to
 * being a proposal. A key whose commit names no revision is refused too:
 * nothing says what it answered, and a key nobody can judge is not published.
 *
 * A stale base is refused by GitHub, and that is the right answer. Somebody
 * can change the same file between the read and the write. The publication
 * reads the base again and replays the approved keys onto the new content. It
 * never overwrites.
 */
export const publish = async (
  repository: I18nRepository,
  language: string,
  approved: ApprovedKey[],
  reviewer: Author,
  options: { now?: Date; attempts?: number } = {},
): Promise<Publication> => {
  const { source, targets } = languagesOf(repository);

  if (!targets.includes(language)) {
    throw new UnknownLanguageError(
      `${language} is not a language this repository translates into. Known: ${targets.join(', ') || 'none'}`,
    );
  }

  const token = await writeToken(repository);
  const attempts = options.attempts ?? 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const base = await headOf(repository, token, repository.branch);

    if (!base) throw new GithubError(`${repository.branch} is not a branch of this repository`, 404);

    const branch = branchOf(language);
    const head = await headOf(repository, token, branch);

    if (!head) throw new GithubError(`${branch} holds no proposal to publish`, 404);

    const published: ApprovedKey[] = [];
    const refused: RefusedKey[] = [];
    const files = new Map<string, Record<string, unknown>>();
    const branchFiles = await filesOf(repository, token, language, head, { absentIsEmpty: true });
    const baseFiles = await filesOf(repository, token, language, base, { absentIsEmpty: true });
    const stateOf = await manifestOf(repository, token, base);
    // A file of twenty approved keys asked GitHub for the same batch and the
    // same source twenty times. The caches are made per attempt, so a replay
    // after a stale ref reads the new content rather than the old.
    const batches = new Map<string, { readAt: string; onTheBranch: boolean }>();
    const reads = new Map<string, Record<string, unknown>>();
    const readOnce = async (lang: string, file: string, ref: string) => {
      const key = `${ref}:${lang}/${file}`;
      const held = reads.get(key);

      if (held) return held;

      const read = await contentOf(repository, token, lang, file, ref);

      reads.set(key, read);

      return read;
    };
    const batchOf = async (commit: string) => {
      const held = batches.get(commit);

      if (held) return held;

      // **The sha comes from the caller.** A commit that is not on the branch
      // of this language proposed nothing, and its message would otherwise be
      // read as the revision a key was written against.
      const onTheBranch = await isAncestor(repository, token, commit, head);
      const message = onTheBranch
        ? (
            await ask<{ commit: { message: string } }>(
              `/repos/${insideRepository(repository.owner, repository.name)}/commits/${insideRepository(commit)}`,
              token,
            )
          ).commit.message
        : '';
      const row = { readAt: readAtOf(message), onTheBranch };

      batches.set(commit, row);

      return row;
    };

    for (const file of [...new Set(approved.map((row) => row.file))].sort()) {
      if (stateOf(file, language) === 'disabled') {
        refused.push(
          ...approved.filter((row) => row.file === file).map((row) => ({ ...row, reason: 'disabled' as const })),
        );
        continue;
      }

      if (!branchFiles.has(file)) {
        refused.push(
          ...approved
            .filter((row) => row.file === file)
            .map((row) => ({ ...row, reason: 'not-on-the-branch' as const })),
        );
        continue;
      }

      const proposed = await readOnce(language, file, head);
      const current = baseFiles.has(file) ? await readOnce(language, file, base) : {};
      const sourceNow = await readOnce(source, file, base);
      let changed = false;

      for (const row of approved.filter((entry) => entry.file === file)) {
        const value = stringAt(proposed, row.key);

        if (value === null) {
          refused.push({ ...row, reason: 'not-on-the-branch' });
          continue;
        }

        const batch = await batchOf(row.commit);

        if (!batch.onTheBranch) {
          refused.push({ ...row, reason: 'not-on-the-branch' });
          continue;
        }

        if (!batch.readAt) {
          refused.push({ ...row, reason: 'no-revision' });
          continue;
        }

        // **The approved value is the one of the approved batch.** A later
        // batch, or a push by hand, can have changed the key since. Taking the
        // head value would publish something the reviewer never saw, under the
        // revision of the batch they did.
        const atTheBatch = stringAt(await readOnce(language, file, row.commit), row.key);

        if (atTheBatch !== value) {
          refused.push({ ...row, reason: 'changed-since-approval', was: atTheBatch ?? '', now: value });
          continue;
        }

        // A key the base already says is nothing to publish, and an empty
        // commit is worse than no commit.
        if (stringAt(current, row.key) === value) {
          published.push(row);
          continue;
        }

        const sourceThen = await readOnce(source, file, batch.readAt);
        const was = stringAt(sourceThen, row.key);
        const now = stringAt(sourceNow, row.key);

        if (was !== now) {
          refused.push({ ...row, reason: 'source-changed', was: was ?? '', now: now ?? '' });
          continue;
        }

        setAt(current, row.key, value);
        published.push(row);
        changed = true;
      }

      if (changed) files.set(`${repository.localesPath}/${language}/${file}.json`, current);
    }

    if (files.size === 0) return { commit: null, published, refused };

    try {
      const commit = await commitBatch(repository, token, {
        branch: repository.branch,
        parent: base,
        expected: base,
        files: [...files].map(([path, content]) => ({ path, content })),
        message: `i18n(${language}): ${published.length} ${published.length === 1 ? 'key' : 'keys'} published by ${reviewer.name}`,
        author: reviewer,
        at: options.now ?? new Date(),
      });

      return { commit, published, refused };
    } catch (error) {
      // Only the ref move is a stale write. A refusal from a blob, a tree or a
      // commit is a body GitHub would refuse again, so it is not retried. A
      // stale one falls through to the next attempt, and out of the loop on
      // the last, where the caller reads why.
      if (!(error instanceof StaleBranchError)) throw error;
    }
  }

  throw new GithubError(`${repository.branch} moved under every attempt to publish onto it`, 409);
};

/** What the creation of keys ended as. */
export interface CreatedKeys {
  /** The commit of the base branch that now holds the keys. */
  commit: string;
  /** How many keys it carries. */
  keys: number;
  /** The files it touched, by their path in the repository. */
  files: string[];
}

/** Whether a file holds anything at a dotted path: a text, or the keys under it. */
const holds = (content: Record<string, unknown>, key: string): boolean => {
  let at: unknown = content;

  for (const part of key.split('.')) {
    if (typeof at !== 'object' || at === null || Array.isArray(at) || !Object.hasOwn(at, part)) return false;

    at = (at as Record<string, unknown>)[part];
  }

  return true;
};

/**
 * Adds keys to the source language, on the base branch (DB-238).
 *
 * **It adds, and never changes.** A key the file holds is refused: to change a
 * source text is to change what every translation of it answers, and that is
 * not what a form that creates a key is for. The whole batch is refused, so a
 * caller never has to find out which half was written.
 *
 * The key goes to the base branch with no proposal. It is inert until the code
 * of the product calls it, and it shows at once as missing in every target —
 * which is the point of creating it here.
 *
 * A stale base is replayed as a publication is: the files are read again, and
 * a key that somebody added in between is then refused, not written over.
 */
export const createKeys = async (
  repository: I18nRepository,
  values: ProposedValue[],
  author: Author,
  options: { now?: Date; attempts?: number } = {},
): Promise<CreatedKeys> => {
  const { source } = languagesOf(repository);

  if (values.length === 0) throw new UnwritableKeyError('A creation carries at least one key.');

  const blank = values.filter((value) => value.value.trim().length === 0).map((value) => value.key);

  if (blank.length > 0) {
    throw new UnwritableKeyError(`${blank.sort().join(', ')} has no text. A source key says something.`);
  }

  const token = await writeToken(repository);
  const attempts = options.attempts ?? 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const base = await headOf(repository, token, repository.branch);

    if (!base) throw new GithubError(`${repository.branch} is not a branch of this repository`, 404);

    const known = await filesOf(repository, token, source, base);
    const touched = [...new Set(values.map((value) => value.file))].sort();
    // A file the source does not hold is one the product does not load. A key
    // written there would look created and reach no screen.
    const unknown = touched.filter((file) => !known.has(file));

    if (unknown.length > 0) {
      throw new UnwritableKeyError(
        `${unknown.join(', ')} is not a file of ${source}. Known: ${[...known.keys()].sort().join(', ') || 'none'}`,
      );
    }

    const files: FileToWrite[] = [];

    for (const file of touched) {
      const content = await contentOf(repository, token, source, file, base);

      for (const value of values.filter((row) => row.file === file)) {
        // It also refuses a key named twice in the batch: the first one is in
        // the content by the time the second is read.
        if (holds(content, value.key)) {
          throw new UnwritableKeyError(`${value.key} is already in ${file}. A creation changes no key.`);
        }

        setAt(content, value.key, value.value);
      }

      files.push({ path: `${repository.localesPath}/${source}/${file}.json`, content });
    }

    try {
      const commit = await commitBatch(repository, token, {
        branch: repository.branch,
        parent: base,
        expected: base,
        files,
        message: `i18n(${source}): ${values.length} ${values.length === 1 ? 'key' : 'keys'} created by ${author.name}`,
        author,
        at: options.now ?? new Date(),
      });

      forgetCatalogues(repository.id);

      return { commit, keys: values.length, files: files.map((file) => file.path) };
    } catch (error) {
      if (!(error instanceof StaleBranchError)) throw error;
    }
  }

  throw new GithubError(`${repository.branch} moved under every attempt to create keys on it`, 409);
};

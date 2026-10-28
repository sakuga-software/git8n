import type { I18nRepository } from '@git8n/db';
import { ask, GithubError, insideRepository, installationToken } from '@/services/github-app.service';
import {
  contentOf,
  filesOf,
  fileTextOf,
  forgetCatalogues,
  manifestOf,
  manifestPathOf,
  manifestTextOf,
  pathsOf,
  readManifest,
} from '@/services/i18n-catalogue.service';
import { manifestFileOf, marksOf, sourceHashOf, writeMark } from '@/services/intended-empty';
import { languagesOf, UnknownLanguageError } from '@/services/i18n-repositories.service';
import {
  ensurePull,
  lastPullOf,
  mergeBaseInto,
  openPullOf,
  PUBLISH_BRANCH,
  publicationMessage,
  publishToken,
  type PublishPull,
} from '@/services/i18n-pull-request.service';
import { proposalSubject, publicationSubject } from '@/services/i18n-messages';
import { LocaleFile, UnwritableKeyError } from '@/services/locale-file';
import { reviewedLine, reviewsOf } from '@/services/i18n-review.service';
import { createCache } from '@/utils/cache';

export { UnwritableKeyError } from '@/services/locale-file';

/**
 * The git path of the translations (DB-212).
 *
 * A proposal is a commit on the branch of its language, `i18n/<language>`. A
 * publication is a commit on the branch of the repository. A repository whose
 * base branch requires a pull request publishes on `i18n/publish` instead, and
 * one pull request carries it (DB-606).
 *
 * One batch is one commit, not one per key. The contents API writes one file
 * per commit, so a batch of three hundred keys would be three hundred commits.
 * The git data API builds a tree and commits it once, which is what this
 * module uses.
 */

/** The branch a language is proposed on. */
export const branchOf = (language: string): string => `i18n/${language}`;

/** How long the proposals of a language are held. */
const WAITING_MS = 60 * 1000;

/**
 * Refuses a language that is not the source and not a target.
 *
 * The source is written as a target is, through a proposal and a publication
 * (DB-607). The route decides who may: `writes_source` for the source.
 */
const refuseAnUnknownLanguage = (repository: I18nRepository, language: string): void => {
  const { source, targets } = languagesOf(repository);

  if (language !== source && !targets.includes(language)) {
    throw new UnknownLanguageError(
      `${language} is not a language of this repository. Known: ${[source, ...targets].join(', ')}`,
    );
  }
};

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
  /** The key is left empty on purpose (DB-611). Absent or `false` removes a mark the branch holds. */
  empty?: boolean;
}

const idOf = (row: { file: string; key: string }): string => `${row.file}\n${row.key}`;

/**
 * The marks of a language at one revision, by `<file>\n<key>` (DB-611).
 *
 * A branch of proposals carries the marks it proposes in its own manifest. It
 * is read there for the marks alone: the state of a file is read on the base
 * branch.
 */
const marksAt = async (
  repository: I18nRepository,
  token: string,
  ref: string,
  language: string,
): Promise<Map<string, string>> => {
  if (language === languagesOf(repository).source) return new Map();

  const text = await manifestTextOf(repository, token, ref);

  return text === null ? new Map() : marksOf(JSON.parse(text), language);
};

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

/** A file to write, by its path in the repository. */
interface FileToWrite {
  path: string;
  content: LocaleFile;
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
    /**
     * Moves the branch even when the commit is not built on where it points.
     * Only the branch of the publications uses it, once its pull request is
     * merged or closed: what it held is on the base branch, or was dropped.
     */
    force?: boolean;
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
          // The text keeps every byte that the batch did not change: the key
          // order, the indentation and the last newline (DB-608).
          content: Buffer.from(file.content.toString(), 'utf8').toString('base64'),
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
      await ask(refPath(repository, batch.branch), token, 'PATCH', { sha: commit.sha, force: batch.force === true });
    }
  } catch (error) {
    if (error instanceof GithubError && (error.status === 422 || error.status === 409)) {
      throw new StaleBranchError(batch.branch, error);
    }

    throw error;
  }

  return commit.sha;
};

/**
 * Where a publication writes, and what it reads as already published.
 *
 * - `commit`: the base branch itself.
 * - `pull_request`: the branch of the publications. It is built on the base
 *   branch: a new one, a fresh one after its pull request is merged or closed,
 *   or the open one with the base branch merged in.
 */
interface PublishTarget {
  branch: string;
  /** The commit the new one is built on. What it says in a language is what is published already. */
  parent: string;
  /** Where the branch points now, or nothing when it is not there. */
  expected: string | null;
  force: boolean;
}

const publishTarget = async (repository: I18nRepository, token: string, base: string): Promise<PublishTarget> => {
  if (repository.publishMode !== 'pull_request') {
    return { branch: repository.branch, parent: base, expected: base, force: false };
  }

  const head = await headOf(repository, token, PUBLISH_BRANCH);

  if (!head) return { branch: PUBLISH_BRANCH, parent: base, expected: null, force: false };

  if (!(await openPullOf(repository, token))) {
    return { branch: PUBLISH_BRANCH, parent: base, expected: head, force: true };
  }

  const parent = (await isAncestor(repository, token, base, head))
    ? head
    : await mergeBaseInto(repository, token, head);

  return { branch: PUBLISH_BRANCH, parent, expected: parent, force: false };
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
  const { source } = languagesOf(repository);

  refuseAnUnknownLanguage(repository, language);

  if (values.length === 0) throw new UnknownLanguageError('A proposal carries at least one key.');

  if (language === source && values.some((value) => value.empty === true)) {
    throw new UnwritableKeyError('A source key says something. Only a translation can be empty on purpose.');
  }

  // A source text is what every translation answers, so an empty one is
  // refused. A target may leave a key empty: the key is then missing.
  if (language === source) {
    const blank = values.filter((value) => value.value.trim().length === 0).map((value) => value.key);

    if (blank.length > 0) {
      throw new UnwritableKeyError(`${blank.sort().join(', ')} has no text. A source key says something.`);
    }
  }

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

  // **A proposal of the source changes a key, and never adds one.** A new key
  // goes through « Nouvelle clé » (DB-238), which checks the file and the name.
  // Read on the base branch: a key that only a proposal holds is not a key.
  if (language === source) {
    const sourceFiles = await filesOf(repository, token, source, base);

    for (const file of touched) {
      const keys = sourceFiles.has(file)
        ? new Set(pathsOf(await contentOf(repository, token, source, file, base)).map(([key]) => key))
        : new Set<string>();
      const unknown = values.filter((row) => row.file === file && !keys.has(row.key)).map((row) => row.key);

      if (unknown.length > 0) {
        throw new UnwritableKeyError(
          `${unknown.sort().join(', ')} is not a key of ${source} ${file}. To add a key, use « Nouvelle clé ».`,
        );
      }
    }
  }

  for (const file of touched) {
    const content = known.has(file)
      ? LocaleFile.parse(await fileTextOf(repository, token, language, file, parent))
      : LocaleFile.empty();

    for (const value of values.filter((row) => row.file === file)) content.set(value.key, value.value);

    files.push({ path: `${repository.localesPath}/${language}/${file}.json`, content });
  }

  if (language !== source) {
    const manifest = await proposedMarks(repository, token, language, values, parent, readAt);

    if (manifest) files.push(manifest);
  }

  const commit = await commitBatch(repository, token, {
    branch,
    parent,
    expected: head,
    files,
    message: [proposalSubject(repository, language, values.length, author), '', `${READ_AT}: ${readAt}`].join('\n'),
    author,
    at: options.now ?? new Date(),
  });

  return { commit, branch, readAt, keys: values.length, files: files.map((file) => file.path) };
};

/**
 * The manifest of the branch with the marks of a batch, or nothing when no mark changes (DB-611).
 *
 * Each key of the batch takes the mark it asks for. A key sent with no
 * `empty` loses the mark the branch holds: a text proposed for a key is not
 * an empty key.
 *
 * The hash is the one of the source the translator read, at `readAt`.
 */
const proposedMarks = async (
  repository: I18nRepository,
  token: string,
  language: string,
  values: ProposedValue[],
  parent: string,
  readAt: string,
): Promise<FileToWrite | null> => {
  const { source } = languagesOf(repository);
  const text = await manifestTextOf(repository, token, parent);
  const held = text === null ? new Map<string, string>() : marksOf(JSON.parse(text), language);
  const concerned = values.filter((value) => value.empty === true || held.has(idOf(value)));

  if (concerned.length === 0) return null;

  const manifest = manifestFileOf(text);
  const sources = new Map<string, Map<string, unknown>>();
  let changed = false;

  for (const value of concerned) {
    let hash: string | null = null;

    if (value.empty === true) {
      if (!sources.has(value.file)) {
        sources.set(value.file, new Map(pathsOf(await contentOf(repository, token, source, value.file, readAt))));
      }

      const said = sources.get(value.file)!.get(value.key);

      hash = sourceHashOf(typeof said === 'string' ? said : String(said ?? ''));
    }

    changed = writeMark(manifest, language, value, hash) || changed;
  }

  return changed ? { path: manifestPathOf(repository), content: manifest } : null;
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

const waitingBatches = createCache<WaitingBatch[]>(WAITING_MS);

/**
 * `waiting` for a page that reads, held by `<repository>:<language>`.
 *
 * Each write of the editor drops it at once. A push to the branch that does
 * not come from the editor shows after `WAITING_MS`.
 */
export const heldWaiting = (repository: I18nRepository, language: string): Promise<WaitingBatch[]> =>
  waitingBatches.get(`${repository.id}:${language}`, () => waiting(repository, language));

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
  /** The batch leaves the key empty on purpose (DB-611). */
  empty?: true;
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
  const { source } = languagesOf(repository);

  refuseAnUnknownLanguage(repository, language);

  const token =
    repository.publishMode === 'pull_request' ? await publishToken(repository) : await writeToken(repository);
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
  let marksBefore = await marksAt(repository, token, before.ref, language);

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

    // A mark is proposed as a value is: the batch that added or removed it.
    const marksNow = await marksAt(repository, token, batch.sha, language);

    for (const id of new Set([...marksBefore.keys(), ...marksNow.keys()])) {
      if (marksBefore.get(id) === marksNow.get(id)) continue;

      const [file, key] = id.split('\n');

      setBy.set(id, { file, key, batch });
    }

    marksBefore = marksNow;
    before = { ref: batch.sha, files };
  }

  const head = before;
  const headMarks = marksBefore;
  const baseFiles = await filesOf(repository, token, language, base, { absentIsEmpty: true });
  // A key published in the open pull request waits on its merge, not on a
  // reviewer. Listed here, it would be approved and published a second time.
  const pending =
    repository.publishMode === 'pull_request' && (await openPullOf(repository, token))
      ? await headOf(repository, token, PUBLISH_BRANCH)
      : null;
  const pendingFiles = pending ? await filesOf(repository, token, language, pending, { absentIsEmpty: true }) : null;
  const sourceFiles = await filesOf(repository, token, source, base);
  const baseMarks = await marksAt(repository, token, base, language);
  const pendingMarks = pending ? await marksAt(repository, token, pending, language) : null;
  const rows: ProposedKey[] = [];

  for (const { file, key, batch } of setBy.values()) {
    if (stateOf(file, language) === 'disabled') continue;

    const headSha = head.files.get(file);

    if (!headSha) continue;

    const value = (await keysAt(language, file, head.ref, headSha)).get(key);
    const baseSha = baseFiles.get(file);
    const current = baseSha ? (await keysAt(language, file, base, baseSha)).get(key) : undefined;

    // Only whether a key is marked is proposed. A new hash comes from a reviewer who keeps the key empty.
    const empty = headMarks.has(idOf({ file, key }));

    if (typeof value !== 'string' || (value === current && empty === baseMarks.has(idOf({ file, key })))) continue;

    const pendingSha = pendingFiles?.get(file);

    if (
      pending &&
      pendingSha &&
      (await keysAt(language, file, pending, pendingSha)).get(key) === value &&
      empty === pendingMarks!.has(idOf({ file, key }))
    ) {
      continue;
    }

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
      ...(empty ? { empty: true as const } : {}),
    });
  }

  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key));
};

const waitingKeys = createCache<ProposedKey[]>(WAITING_MS);

/** `proposedKeys` for a page that reads, held as `heldWaiting` is. A write must not use it. */
export const heldProposedKeys = (repository: I18nRepository, language: string): Promise<ProposedKey[]> =>
  waitingKeys.get(`${repository.id}:${language}`, () => proposedKeys(repository, language));

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
  /** The commit on the branch it wrote, or nothing when no key changed. */
  commit: string | null;
  published: ApprovedKey[];
  refused: RefusedKey[];
  /** The pull request that carries it, in the mode `pull_request`. Null in the mode `commit`. */
  pullRequest: PublishPull | null;
}

const stringAt = (file: LocaleFile, key: string): string | null => {
  const found = new Map(pathsOf(file.content)).get(key);

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
  const { source } = languagesOf(repository);

  refuseAnUnknownLanguage(repository, language);

  const token = await publishToken(repository);
  const attempts = options.attempts ?? 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const base = await headOf(repository, token, repository.branch);

    if (!base) throw new GithubError(`${repository.branch} is not a branch of this repository`, 404);

    const target = await publishTarget(repository, token, base);
    const branch = branchOf(language);
    const head = await headOf(repository, token, branch);

    if (!head) throw new GithubError(`${branch} holds no proposal to publish`, 404);

    const published: ApprovedKey[] = [];
    const refused: RefusedKey[] = [];
    const files = new Map<string, LocaleFile>();
    const branchFiles = await filesOf(repository, token, language, head, { absentIsEmpty: true });
    // What the target says is what is published already. In the mode
    // `pull_request`, it holds the keys of the open pull request too, so a
    // second publication keeps them.
    const targetFiles = await filesOf(repository, token, language, target.parent, { absentIsEmpty: true });
    const stateOf = await manifestOf(repository, token, base);
    const headMarks = await marksAt(repository, token, head, language);
    const manifestText = await manifestTextOf(repository, token, target.parent);
    const targetMarks = manifestText === null ? new Map<string, string>() : marksOf(JSON.parse(manifestText), language);
    const manifest = manifestFileOf(manifestText);
    const batchMarks = new Map<string, Map<string, string>>();
    const marksOfBatch = async (commit: string) => {
      const held = batchMarks.get(commit);

      if (held) return held;

      const read = await marksAt(repository, token, commit, language);

      batchMarks.set(commit, read);

      return read;
    };
    let marksChanged = false;
    // A file of twenty approved keys asked GitHub for the same batch and the
    // same source twenty times. The caches are made per attempt, so a replay
    // after a stale ref reads the new content rather than the old.
    const batches = new Map<string, { readAt: string; onTheBranch: boolean }>();
    const reads = new Map<string, LocaleFile>();
    const readOnce = async (lang: string, file: string, ref: string) => {
      const key = `${ref}:${lang}/${file}`;
      const held = reads.get(key);

      if (held) return held;

      const read = LocaleFile.parse(await fileTextOf(repository, token, lang, file, ref));

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
      const current = targetFiles.has(file) ? await readOnce(language, file, target.parent) : LocaleFile.empty();
      const unchanged = current.toString();
      const sourceNow = await readOnce(source, file, base);

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
        const empty = headMarks.has(idOf(row));

        if (atTheBatch !== value || (await marksOfBatch(row.commit)).has(idOf(row)) !== empty) {
          refused.push({ ...row, reason: 'changed-since-approval', was: atTheBatch ?? '', now: value });
          continue;
        }

        // A key the base already says is nothing to publish, and an empty
        // commit is worse than no commit.
        if (stringAt(current, row.key) === value && targetMarks.has(idOf(row)) === empty) {
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

        current.set(row.key, value);
        // The mark goes with the value, hashed against the source it answers.
        marksChanged = writeMark(manifest, language, row, empty ? sourceHashOf(now ?? '') : null) || marksChanged;
        published.push(row);
      }

      if (current.toString() !== unchanged) files.set(`${repository.localesPath}/${language}/${file}.json`, current);
    }

    if (marksChanged) files.set(manifestPathOf(repository), manifest);

    const pullRequest = async () =>
      repository.publishMode === 'pull_request' ? await ensurePull(repository, token) : null;

    if (files.size === 0) {
      return {
        commit: null,
        published,
        refused,
        pullRequest: repository.publishMode === 'pull_request' ? await lastPullOf(repository, token) : null,
      };
    }

    try {
      const commit = await commitBatch(repository, token, {
        branch: target.branch,
        parent: target.parent,
        expected: target.expected,
        force: target.force,
        files: [...files].map(([path, content]) => ({ path, content })),
        message: publicationMessage(
          publicationSubject(repository, language, published.length, 'published', reviewer),
          language,
          published,
        ),
        author: reviewer,
        at: options.now ?? new Date(),
      });

      return { commit, published, refused, pullRequest: await pullRequest() };
    } catch (error) {
      // Only the ref move is a stale write. A refusal from a blob, a tree or a
      // commit is a body GitHub would refuse again, so it is not retried. A
      // stale one falls through to the next attempt, and out of the loop on
      // the last, where the caller reads why.
      if (!(error instanceof StaleBranchError)) throw error;
    }
  }

  throw new GithubError(`The branch moved under every attempt to publish onto it`, 409);
};

/** What the creation of keys ended as. */
export interface CreatedKeys {
  /** The commit that now holds the keys: on the base branch, or on the branch of the publications. */
  commit: string;
  /** How many keys it carries. */
  keys: number;
  /** The files it touched, by their path in the repository. */
  files: string[];
  /** The pull request that carries them, in the mode `pull_request`. */
  pullRequest: PublishPull | null;
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

  const token = await publishToken(repository);
  const attempts = options.attempts ?? 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const base = await headOf(repository, token, repository.branch);

    if (!base) throw new GithubError(`${repository.branch} is not a branch of this repository`, 404);

    const target = await publishTarget(repository, token, base);
    // A key created in an open pull request is created already: reading the
    // target refuses it a second time.
    const known = await filesOf(repository, token, source, target.parent);
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
      const content = LocaleFile.parse(await fileTextOf(repository, token, source, file, target.parent));

      for (const value of values.filter((row) => row.file === file)) {
        // It also refuses a key named twice in the batch: the first one is in
        // the content by the time the second is read.
        if (holds(content.content, value.key)) {
          throw new UnwritableKeyError(`${value.key} is already in ${file}. A creation changes no key.`);
        }

        content.set(value.key, value.value);
      }

      files.push({ path: `${repository.localesPath}/${source}/${file}.json`, content });
    }

    try {
      const commit = await commitBatch(repository, token, {
        branch: target.branch,
        parent: target.parent,
        expected: target.expected,
        force: target.force,
        files,
        message: publicationMessage(
          publicationSubject(repository, source, values.length, 'created', author),
          source,
          values,
        ),
        author,
        at: options.now ?? new Date(),
      });

      forgetCatalogues(repository.id);

      return {
        commit,
        keys: values.length,
        files: files.map((file) => file.path),
        pullRequest: repository.publishMode === 'pull_request' ? await ensurePull(repository, token) : null,
      };
    } catch (error) {
      if (!(error instanceof StaleBranchError)) throw error;
    }
  }

  throw new GithubError(`The branch moved under every attempt to create keys on it`, 409);
};

/**
 * The keys of `keys` left empty on purpose whose source changed since the mark (DB-611).
 *
 * It answers each one with the hash of its source now.
 */
const staleMarksOf = async (
  repository: I18nRepository,
  token: string,
  base: string,
  language: string,
  keys: Array<{ file: string; key: string }>,
): Promise<Map<string, string>> => {
  const { source } = languagesOf(repository);
  const marks = (await readManifest(repository, token, base)).marksOf(language);
  const stale = new Map<string, string>();
  const reads = new Map<string, Map<string, unknown>>();
  const keysOf = async (lang: string, file: string) => {
    const held = reads.get(`${lang}/${file}`);

    if (held) return held;

    const read = new Map(pathsOf(await contentOf(repository, token, lang, file, base).catch(() => ({}))));

    reads.set(`${lang}/${file}`, read);

    return read;
  };

  for (const row of keys) {
    const hash = marks.get(idOf(row));

    if (hash === undefined || (await keysOf(language, row.file)).get(row.key) !== '') continue;

    const said = (await keysOf(source, row.file)).get(row.key);
    const now = sourceHashOf(typeof said === 'string' ? said : String(said ?? ''));

    if (now !== hash) stale.set(idOf(row), now);
  }

  return stale;
};

/** What a review ended as. */
export interface Acknowledgement {
  /** The commit that holds the `Reviewed:` trailers, or nothing when no key was to read again. */
  commit: string | null;
  /** The keys kept as they are. */
  kept: Array<{ file: string; key: string }>;
  /** The keys that were not to read again, and so were left out. */
  skipped: Array<{ file: string; key: string }>;
  pullRequest: PublishPull | null;
}

/**
 * Keeps translations as they are, after their source changed (DB-607).
 *
 * A translation that still fits its new source has no new value to propose:
 * the editor refuses a proposal equal to what is published, and git has no
 * change to commit. So a reviewer keeps it here. The commit changes no file
 * and carries one `Reviewed:` trailer per key. `reviewsOf` reads it as the
 * last event of the key, which clears « à revoir ».
 *
 * The commit goes where a publication goes: the base branch, or the branch of
 * the publications in the mode `pull_request`. The state clears when it
 * reaches the base branch.
 */
export const acknowledge = async (
  repository: I18nRepository,
  language: string,
  keys: Array<{ file: string; key: string }>,
  reviewer: Author,
  options: { now?: Date; attempts?: number } = {},
): Promise<Acknowledgement> => {
  const { targets } = languagesOf(repository);

  if (!targets.includes(language)) {
    throw new UnknownLanguageError(
      `${language} is not a language this repository translates into. Known: ${targets.join(', ') || 'none'}`,
    );
  }

  if (keys.length === 0) throw new UnwritableKeyError('A review carries at least one key.');

  const token = await publishToken(repository);
  const attempts = options.attempts ?? 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const base = await headOf(repository, token, repository.branch);

    if (!base) throw new GithubError(`${repository.branch} is not a branch of this repository`, 404);

    const reviews = await reviewsOf(repository, token, base, language);
    const staleMarks = await staleMarksOf(repository, token, base, language, keys);
    const kept = keys.filter((row) => reviews.has(idOf(row)) || staleMarks.has(idOf(row)));
    const skipped = keys.filter((row) => !reviews.has(idOf(row)) && !staleMarks.has(idOf(row)));

    if (kept.length === 0) {
      return {
        commit: null,
        kept,
        skipped,
        pullRequest: repository.publishMode === 'pull_request' ? await lastPullOf(repository, token) : null,
      };
    }

    const target = await publishTarget(repository, token, base);
    const files: FileToWrite[] = [];

    // A key left empty on purpose has no text to keep. The mark takes the hash of the new source instead.
    if (staleMarks.size > 0) {
      const manifest = manifestFileOf(await manifestTextOf(repository, token, target.parent));

      for (const row of kept.filter((entry) => staleMarks.has(idOf(entry)))) {
        writeMark(manifest, language, row, staleMarks.get(idOf(row))!);
      }

      files.push({ path: manifestPathOf(repository), content: manifest });
    }

    try {
      const commit = await commitBatch(repository, token, {
        branch: target.branch,
        parent: target.parent,
        expected: target.expected,
        force: target.force,
        files,
        // The summary lists at most a few keys. The trailers list every one:
        // they are what clears the state, and a key cut from them stays to review.
        message: [
          publicationMessage(
            publicationSubject(repository, language, kept.length, 'reviewed', reviewer),
            language,
            kept,
          ),
          '',
          ...kept.filter((row) => reviews.has(idOf(row))).map((row) => reviewedLine(language, row)),
        ].join('\n'),
        author: reviewer,
        at: options.now ?? new Date(),
      });

      forgetCatalogues(repository.id);

      return {
        commit,
        kept,
        skipped,
        pullRequest: repository.publishMode === 'pull_request' ? await ensurePull(repository, token) : null,
      };
    } catch (error) {
      if (!(error instanceof StaleBranchError)) throw error;
    }
  }

  throw new GithubError(`The branch moved under every attempt to keep translations on it`, 409);
};

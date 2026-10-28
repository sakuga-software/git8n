import type {
  ApprovedKey,
  Catalogue,
  CatalogueEntry,
  LanguageProgress,
  Me,
  Proposal,
  ProposedKey,
  ProposedValue,
  Publication,
  RefusedKey,
  Repository,
  RepositoryOverview,
  Reviewed,
  WaitingBatch,
} from '@git8n/mcp/api';
import {
  ACCOUNT,
  AGENT_AUTHOR,
  AGENT_GERMAN,
  publishedIn,
  REPOSITORY,
  REVIEW,
  SOURCE,
  sourceEntries,
  TARGETS,
  WAITING,
  type Target,
} from './seed';

const idOf = (row: { file: string; key: string }): string => `${row.file}\n${row.key}`;

const newSha = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => byte.toString(16).padStart(2, '0')).join('');

interface Waiting {
  file: string;
  key: string;
  value: string;
  empty?: true;
  commit: string;
  author: string;
  at: string;
  readAt: string;
}

/**
 * The repository of the demo, in memory: what the base branch says in each
 * language, and what waits on each branch `i18n/<language>`.
 *
 * It answers what the API answers. A reload of the page starts it again.
 */
export class DemoStore {
  private head = newSha();
  private readonly published = new Map<string, Map<string, string>>();
  private readonly emptyOnPurpose = new Map<string, Set<string>>();
  /** The source text that a translation answers, when the source changed since. */
  private readonly answered = new Map<string, Map<string, string>>();
  private readonly branches = new Map<string, Map<string, Waiting>>();
  private readonly batches = new Map<string, WaitingBatch[]>();
  private readonly createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 40).toISOString();

  constructor() {
    for (const language of TARGETS) {
      this.published.set(language, new Map(publishedIn(language).map((row) => [idOf(row), row.value])));
      this.emptyOnPurpose.set(language, new Set());
      this.answered.set(language, new Map());
      this.branches.set(language, new Map());
      this.batches.set(language, []);
    }

    this.answered.get(REVIEW.language)!.set(idOf(REVIEW), REVIEW.was);
    this.write(WAITING.language, WAITING.values, WAITING.author, new Date(Date.now() - 1000 * 60 * 60 * 3));
  }

  readonly me = (): Me => ({
    admin: false,
    installUrl: null,
    memberships: [{ repositoryId: REPOSITORY.id, languages: [...TARGETS], role: 'reviewer', writesSource: false }],
  });

  readonly repository = (): Repository => ({
    ...REPOSITORY,
    avatarUrl: null,
    localesPath: 'locales',
    manifestPath: 'locales/manifest.json',
    publishMode: 'commit',
    proposalCommitTemplate: null,
    publicationCommitTemplate: null,
    pullRequestTitleTemplate: null,
    pullRequestBodyTemplate: null,
    source: SOURCE,
    targets: [...TARGETS],
  });

  readonly isTarget = (language: string): language is Target => (TARGETS as readonly string[]).includes(language);

  readonly catalogue = (language: string): Catalogue => {
    const entries = sourceEntries().map((row): CatalogueEntry => {
      if (language === SOURCE) return { ...row, value: row.source, state: 'translated' };

      const id = idOf(row);
      const value = this.published.get(language)?.get(id) ?? null;
      const empty = this.emptyOnPurpose.get(language)?.has(id) === true;
      const was = this.answered.get(language)?.get(id);

      if (value === null) return { ...row, value, state: 'missing' };
      if (was !== undefined) return { ...row, value, state: 'review', was };

      return { ...row, value, state: 'translated', ...(empty ? { empty: true as const } : {}) };
    });

    return {
      repository: REPOSITORY.id,
      language,
      source: SOURCE,
      commit: this.head,
      entries,
      files: Object.fromEntries([...new Set(entries.map((row) => row.file))].map((file) => [file, 'available'])),
    };
  };

  readonly files = (): string[] => [...new Set(sourceEntries().map((row) => row.file))];

  readonly proposedKeys = (language: string): ProposedKey[] => {
    const sources = new Map(sourceEntries().map((row) => [idOf(row), row.source]));

    return [...(this.branches.get(language)?.values() ?? [])].map((row) => ({
      ...row,
      current: this.published.get(language)?.get(idOf(row)) ?? null,
      source: sources.get(idOf(row)) ?? null,
    }));
  };

  readonly waiting = (language: string): WaitingBatch[] => [...(this.batches.get(language) ?? [])];

  readonly progress = (): LanguageProgress[] =>
    [SOURCE, ...TARGETS].map((language) => {
      const proposed = new Set(this.branches.get(language)?.keys() ?? []);
      const counts = { published: 0, proposed: 0, missing: 0, review: 0, empty: 0 };
      const entries = this.catalogue(language).entries;

      for (const entry of entries) {
        if (proposed.has(idOf(entry))) counts.proposed += 1;
        else if (entry.state === 'review') counts.review += 1;
        else if (entry.state === 'translated') {
          counts.published += 1;
          if (entry.empty) counts.empty += 1;
        } else counts.missing += 1;
      }

      return { language, ...counts, total: entries.length };
    });

  readonly overview = (): RepositoryOverview => ({
    id: REPOSITORY.id,
    owner: REPOSITORY.owner,
    name: REPOSITORY.name,
    branch: REPOSITORY.branch,
    publishMode: 'commit',
    source: SOURCE,
    targets: [...TARGETS],
    createdAt: this.createdAt,
    progress: this.progress().filter((row) => row.language !== SOURCE),
    pullRequest: null,
  });

  readonly propose = (
    language: Target,
    readAt: string,
    values: ProposedValue[],
    author: string = ACCOUNT.name,
  ): Proposal => {
    const commit = this.write(language, values, author, new Date(), readAt);

    return {
      commit,
      branch: `i18n/${language}`,
      readAt,
      keys: values.length,
      files: [...new Set(values.map((row) => row.file))],
    };
  };

  readonly publish = (language: Target, approved: ApprovedKey[]): Publication => {
    const branch = this.branches.get(language)!;
    const published: ApprovedKey[] = [];
    const refused: RefusedKey[] = [];

    for (const key of approved) {
      const waiting = branch.get(idOf(key));

      if (!waiting) refused.push({ ...key, reason: 'not-on-the-branch' });
      else if (waiting.commit !== key.commit) refused.push({ ...key, reason: 'changed-since-approval' });
      else {
        this.published.get(language)!.set(idOf(key), waiting.value);
        if (waiting.empty) this.emptyOnPurpose.get(language)!.add(idOf(key));
        else this.emptyOnPurpose.get(language)!.delete(idOf(key));
        this.answered.get(language)!.delete(idOf(key));
        branch.delete(idOf(key));
        published.push(key);
      }
    }

    if (published.length > 0) this.head = newSha();

    const commits = new Set([...branch.values()].map((row) => row.commit));

    this.batches.set(
      language,
      this.batches.get(language)!.filter((batch) => commits.has(batch.commit)),
    );

    return { commit: published.length > 0 ? this.head : null, published, refused, pullRequest: null };
  };

  readonly keep = (language: Target, keys: Array<{ file: string; key: string }>): Reviewed => {
    const answered = this.answered.get(language)!;
    const kept = keys.filter((key) => answered.delete(idOf(key)));

    if (kept.length > 0) this.head = newSha();

    return {
      commit: kept.length > 0 ? this.head : null,
      kept,
      skipped: keys.filter((key) => !kept.includes(key)),
      pullRequest: null,
    };
  };

  /** The German keys that are missing and not proposed: what `git8n keys --missing --lang de` lists. */
  readonly missingGerman = (): CatalogueEntry[] => {
    const proposed = this.branches.get('de')!;

    return this.catalogue('de').entries.filter((row) => row.state === 'missing' && !proposed.has(idOf(row)));
  };

  /** The batch of the agent: one proposal for every German key still missing. */
  readonly applyAgent = (): Proposal | null => {
    const values = this.missingGerman().flatMap((row) => {
      const value = AGENT_GERMAN[idOf(row)];

      return value === undefined ? [] : [{ file: row.file, key: row.key, value }];
    });

    return values.length === 0 ? null : this.propose('de', this.head, values, AGENT_AUTHOR);
  };

  private write(language: Target, values: ProposedValue[], author: string, at: Date, readAt = this.head): string {
    const commit = newSha();
    const branch = this.branches.get(language)!;

    for (const row of values) {
      branch.set(idOf(row), {
        file: row.file,
        key: row.key,
        value: row.value,
        ...(row.empty ? { empty: true as const } : {}),
        commit,
        author,
        at: at.toISOString(),
        readAt,
      });
    }

    this.batches.get(language)!.push({
      commit,
      message: `i18n(${language}): ${values.length} ${values.length > 1 ? 'keys' : 'key'}`,
      author,
      at: at.toISOString(),
      readAt,
    });

    return commit;
  }
}

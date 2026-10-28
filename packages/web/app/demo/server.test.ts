import {
  catalogueStream,
  keepTranslations,
  overview,
  progress,
  propose,
  proposedKeys,
  publish,
  repositories,
  rightsOf,
  waiting,
  type ApiConfig,
} from '@i18n-editor/mcp/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proposalSchema, publicationSchema, reviewSchema } from '../../../api/src/schemas/i18n';
import { answer } from './server';
import { DemoStore } from './store';
import { REPOSITORY, REVIEW, WAITING } from './seed';

const api: ApiConfig = { url: 'http://demo.test' };
const sent: Array<{ path: string; body: unknown }> = [];
let store: DemoStore;

beforeEach(() => {
  store = new DemoStore();
  sent.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);

    if (request.method === 'POST')
      sent.push({ path: new URL(request.url).pathname, body: await request.clone().json() });

    return (await answer(store, request, { answer: 0, file: 0 })) ?? new Response(null, { status: 599 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('the API of the demo, read with the client of the editor', () => {
  it('answers the account, its repository and the overview', async () => {
    const me = await rightsOf(api);

    expect(me.memberships).toEqual([
      expect.objectContaining({ repositoryId: REPOSITORY.id, role: 'reviewer', languages: ['de', 'fr'] }),
    ]);
    expect((await repositories(api)).map((row) => `${row.owner}/${row.name}`)).toEqual(['acme/shop']);
    expect((await overview(api)).rows).toHaveLength(1);
  });

  it('streams the catalogue with one progress line for each file', async () => {
    const steps: number[] = [];
    const catalogue = await catalogueStream(api, REPOSITORY.id, 'fr', ({ done }) => steps.push(done));

    expect(steps).toEqual([0, 1, 2, 3]);
    expect(catalogue.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(catalogue.entries.find((row) => row.key === REVIEW.key && row.file === REVIEW.file)).toMatchObject({
      state: 'review',
      was: REVIEW.was,
    });
  });

  it('proposes, then publishes, with bodies that the API accepts', async () => {
    const before = (await progress(api, REPOSITORY.id)).find((row) => row.language === 'de')!;
    const catalogue = await catalogueStream(api, REPOSITORY.id, 'de', () => {});
    const row = catalogue.entries.find((entry) => entry.state === 'missing')!;

    const proposal = await propose(api, {
      repository: REPOSITORY.id,
      language: 'de',
      readAt: catalogue.commit,
      values: [{ file: row.file, key: row.key, value: 'Übersetzt' }],
    });
    const waitingKey = (await proposedKeys(api, REPOSITORY.id, 'de')).find((key) => key.key === row.key)!;

    expect(waitingKey).toMatchObject({ value: 'Übersetzt', commit: proposal.commit, current: null });
    expect((await progress(api, REPOSITORY.id)).find((line) => line.language === 'de')).toMatchObject({
      proposed: before.proposed + 1,
      missing: before.missing - 1,
    });

    const publication = await publish(api, {
      repository: REPOSITORY.id,
      language: 'de',
      approved: [{ file: row.file, key: row.key, commit: proposal.commit }],
    });

    expect(publication.published).toHaveLength(1);
    expect(publication.refused).toEqual([]);
    expect(
      (await catalogueStream(api, REPOSITORY.id, 'de', () => {})).entries.find((entry) => entry.key === row.key),
    ).toMatchObject({ value: 'Übersetzt', state: 'translated' });

    expect(proposalSchema.safeParse(sent.find((call) => call.path === '/i18n/proposals')!.body).success).toBe(true);
    expect(publicationSchema.safeParse(sent.find((call) => call.path === '/i18n/publications')!.body).success).toBe(
      true,
    );
  });

  it('keeps a translation whose source changed', async () => {
    const keys = [{ file: REVIEW.file, key: REVIEW.key }];
    const reviewed = await keepTranslations(api, { repository: REPOSITORY.id, language: 'fr', keys });

    expect(reviewed.kept).toEqual(keys);
    expect(reviewSchema.safeParse(sent.at(-1)!.body).success).toBe(true);
  });

  it('holds the batch of another translator, and refuses an approval of an older commit', async () => {
    const [batch] = await waiting(api, REPOSITORY.id, WAITING.language);
    const [first] = WAITING.values;

    expect(batch).toMatchObject({ author: WAITING.author });

    const publication = await publish(api, {
      repository: REPOSITORY.id,
      language: WAITING.language,
      approved: [{ file: first!.file, key: first!.key, commit: '0'.repeat(40) }],
    });

    expect(publication.refused).toEqual([expect.objectContaining({ reason: 'changed-since-approval' })]);
  });

  it('lets the agent propose every German key that is missing, in one batch', async () => {
    const missing = store.missingGerman().length;
    const proposal = store.applyAgent();

    expect(proposal?.keys).toBe(missing);
    expect(store.missingGerman()).toEqual([]);
    expect(store.applyAgent()).toBeNull();
    expect(await waiting(api, REPOSITORY.id, 'de')).toEqual([expect.objectContaining({ commit: proposal!.commit })]);
  });

  it('refuses a language and a repository that the demo does not hold', async () => {
    await expect(catalogueStream(api, REPOSITORY.id, 'it', () => {})).rejects.toMatchObject({ status: 403 });
    await expect(progress(api, 'another')).rejects.toMatchObject({ status: 404 });
  });
});

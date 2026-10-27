import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, catalogueStream, type CatalogueProgress } from './api.ts';

/** An answer whose body comes in the chunks given, cut anywhere. */
const chunked = (...chunks: string[]) =>
  vi.fn(async () => {
    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  });

const CONFIG = { url: 'https://api.test', token: 'token' };
const CATALOGUE = { repository: 'r', language: 'en', source: 'fr', commit: 'c', entries: [] };

afterEach(() => vi.unstubAllGlobals());

describe('the stream of a catalogue (DB-654)', () => {
  it('calls onProgress for each line, even a line cut between two chunks, then answers the catalogue', async () => {
    const lines = [
      { progress: { done: 0, total: 2 } },
      { progress: { done: 1, total: 2 } },
      { progress: { done: 2, total: 2 } },
      { catalogue: CATALOGUE },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('');

    vi.stubGlobal('fetch', chunked(lines.slice(0, 7), lines.slice(7, 40), lines.slice(40)));

    const seen: CatalogueProgress[] = [];

    await expect(catalogueStream(CONFIG, 'r', 'en', (progress) => seen.push(progress))).resolves.toEqual(CATALOGUE);
    expect(seen).toEqual([0, 1, 2].map((done) => ({ done, total: 2 })));
  });

  it('throws the failure that a line carries, with its status', async () => {
    vi.stubGlobal('fetch', chunked(`${JSON.stringify({ error: { status: 400, message: 'de is not one of' } })}\n`));

    const failure = await catalogueStream(CONFIG, 'r', 'de', () => {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 400, message: 'de is not one of' });
  });

  it('throws when the answer ends with no catalogue', async () => {
    vi.stubGlobal('fetch', chunked(`${JSON.stringify({ progress: { done: 0, total: 1 } })}\n`));

    await expect(catalogueStream(CONFIG, 'r', 'en', () => {})).rejects.toMatchObject({ status: 502 });
  });
});

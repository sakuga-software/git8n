import type { DemoStore } from './store';
import { ACCOUNT } from './seed';

/** How long the fake API takes to answer, so that the page shows its loading states as it does on a real API. */
export interface Latency {
  answer: number;
  /** For each locale file of a first read of the catalogue. */
  file: number;
}

const raw = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const json = (data: unknown, status = 200): Response => raw(status < 400 ? { success: true, data } : data, status);

const refused = (status: number, message: string): Response => json({ message }, status);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const session = () => {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

  return {
    session: { id: 'demo-session', userId: ACCOUNT.id, token: 'demo', expiresAt, createdAt: now, updatedAt: now },
    user: { ...ACCOUNT, emailVerified: true, image: null, createdAt: now, updatedAt: now },
  };
};

/**
 * The catalogue as NDJSON, with one line of progress for each file (DB-654).
 * The editor reads the progress only on a first read.
 */
const catalogueStream = (store: DemoStore, language: string, latency: Latency): Response => {
  const files = store.files();
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let done = 0; done <= files.length; done += 1) {
          controller.enqueue(line({ progress: { done, total: files.length } }));
          if (done < files.length) await wait(latency.file);
        }

        controller.enqueue(line({ catalogue: store.catalogue(language) }));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } },
  );
};

const bodyOf = async <T>(request: Request): Promise<T | undefined> => {
  try {
    return (await request.json()) as T;
  } catch {
    return undefined;
  }
};

/**
 * Answers the requests of the page as the API does, from the store.
 *
 * It answers only the routes of `/i18n` and `/api/auth`. It returns null for
 * any other address: the caller lets those go to the network.
 */
export async function answer(store: DemoStore, request: Request, latency: Latency): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (!/^\/(i18n|api\/auth)(\/|$)/.test(path)) return null;

  await wait(latency.answer);

  // better-auth answers its own shapes, with no `data` envelope.
  if (path === '/api/auth/get-session') return raw(session());
  if (path.startsWith('/api/auth/')) return raw({ success: true });

  const repository = url.searchParams.get('repository');
  const language = url.searchParams.get('language') ?? '';

  if (repository !== null && repository !== store.repository().id) {
    return refused(404, 'La démo ne connaît que le dépôt acme/shop.');
  }

  const readable = language === '' || language === store.repository().source || store.isTarget(language);

  if (!readable) return refused(403, `Ce compte de démo ne lit pas ${language}.`);

  switch (`${method} ${path}`) {
    case 'GET /i18n/me':
      return json(store.me());
    case 'GET /i18n/repositories':
      return json([store.repository()]);
    case 'GET /i18n/overview':
      return json({ rows: [store.overview()], page: 1, perPage: 50, total: 1, hasMore: false });
    case 'GET /i18n/catalogue':
      return json(store.catalogue(language));
    case 'GET /i18n/catalogue/stream':
      return catalogueStream(store, language, latency);
    case 'GET /i18n/proposals/keys':
      return json(store.proposedKeys(language));
    case 'GET /i18n/proposals':
      return json(store.waiting(language));
    case 'GET /i18n/progress':
      return json(store.progress());
    case 'GET /i18n/publication':
      return json({ publishMode: 'commit', pullRequest: null });
    case 'GET /i18n/tokens':
      return json([]);
  }

  if (method === 'POST' && path === '/i18n/proposals') {
    const body = await bodyOf<{ language: string; readAt: string; values: [] }>(request);

    if (!body || !store.isTarget(body.language)) return refused(403, 'La démo propose en allemand et en français.');

    return json(store.propose(body.language, body.readAt, body.values));
  }

  if (method === 'POST' && path === '/i18n/publications') {
    const body = await bodyOf<{ language: string; approved: [] }>(request);

    if (!body || !store.isTarget(body.language)) return refused(403, 'La démo publie en allemand et en français.');

    return json(store.publish(body.language, body.approved));
  }

  if (method === 'POST' && path === '/i18n/reviews') {
    const body = await bodyOf<{ language: string; keys: [] }>(request);

    if (!body || !store.isTarget(body.language)) return refused(403, 'La démo relit en allemand et en français.');

    return json(store.keep(body.language, body.keys));
  }

  return refused(403, "La démo ne fait pas cette action. Dans l'éditeur, elle passe par GitHub.");
}

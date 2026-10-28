import { reads } from '~/editor/use-read';
import { REPOSITORY } from './seed';
import { answer, type Latency } from './server';
import { DemoStore } from './store';

/** The `type` of every message between the demo and the page that holds it. */
export const DEMO_MESSAGE = 'i18n-editor-demo';

/** The event that the banner of the demo listens to, to show a note. */
export const DEMO_NOTE = 'i18n-editor-demo:note';

const LATENCY: Latency = { answer: 180, file: 260 };

const note = (text: string) => window.dispatchEvent(new CustomEvent(DEMO_NOTE, { detail: text }));

/**
 * Makes the page answer its own requests to the API, from a repository in memory.
 *
 * Call it before the router starts: the client of better-auth and the reads
 * of the editor then use the patched `fetch`.
 */
export function installDemo(): void {
  const store = new DemoStore();
  const network = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const request = new Request(input, init);

    return (await answer(store, request, LATENCY)) ?? network(request);
  };

  // The demo opens on its repository rather than on the list of one repository.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  if ([base, `${base}/`, `${base}/index.html`].includes(window.location.pathname)) {
    window.history.replaceState(null, '', `${base}/repositories/${REPOSITORY.id}`);
  }

  // The links of the editor lead to the repository on GitHub. The repository of the demo does not exist.
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="https://github.com"]') : null;

      if (!link) return;

      event.preventDefault();
      note("Dans l'éditeur, ce lien ouvre le commit sur GitHub. Le dépôt de la démo n'existe pas.");
    },
    true,
  );

  const parentOrigin = window.location.origin;

  window.addEventListener('message', (event) => {
    const message = event.data as { type?: unknown; action?: unknown } | null;

    if (event.origin !== parentOrigin || message?.type !== DEMO_MESSAGE || event.source === null) return;

    const reply = (body: object) => (event.source as Window).postMessage({ type: DEMO_MESSAGE, ...body }, parentOrigin);

    if (message.action === 'ping') reply({ event: 'ready' });

    if (message.action === 'missing') {
      reply({ event: 'missing', keys: store.missingGerman().map(({ file, key, source }) => ({ file, key, source })) });
    }

    if (message.action === 'apply') {
      const proposal = store.applyAgent();

      reply({ event: 'applied', proposal });
      void reads.invalidateQueries();
      if (proposal) {
        note(`L'agent a proposé ${proposal.keys} textes en allemand. Cochez-les, puis publiez-les.`);
      }
    }
  });

  if (window.parent !== window) window.parent.postMessage({ type: DEMO_MESSAGE, event: 'ready' }, parentOrigin);
}

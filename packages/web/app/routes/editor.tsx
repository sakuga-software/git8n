import { lazy, Suspense } from 'react';
import { Unlinked } from '~/editor/icons';
import { Blocked, Loading } from '~/editor/states';
import { apiUrl } from '~/utils/env';

export const meta = () => [{ title: 'Traductions' }];

/**
 * WARNING: the screen must not load without the address of the API. Its
 * module makes the client of better-auth, which throws on a base URL with no
 * origin. The route module then fails to load, and React Router loads the
 * page again without end.
 */
const Screen = lazy(() => import('~/editor/screen'));

export default function EditorRoute() {
  if (!apiUrl) {
    return (
      <div role="alert" className="flex min-h-screen items-center justify-center">
        <Blocked icon={<Unlinked size={18} />}>
          <p className="text-sm leading-normal">L'éditeur ne sait pas où est l'API.</p>
          <p className="text-muted font-mono text-xs">VITE_API n'était pas défini quand cette page a été construite.</p>
        </Blocked>
      </div>
    );
  }

  return (
    <Suspense fallback={<Loading>Chargement…</Loading>}>
      <Screen />
    </Suspense>
  );
}

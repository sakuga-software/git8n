import { lazy, Suspense } from 'react';
import { Loading } from '~/editor/states';

export const meta = () => [{ title: 'Traductions' }];

const Screen = lazy(() => import('~/editor/screen'));

export default function EditorRoute() {
  return (
    <Suspense fallback={<Loading>Chargement…</Loading>}>
      <Screen />
    </Suspense>
  );
}

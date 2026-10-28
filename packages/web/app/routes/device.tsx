import { lazy, Suspense } from 'react';
import { Loading } from '~/editor/states';

export const meta = () => [{ title: 'Connecter un terminal · git8n' }];

const Device = lazy(() => import('~/device/screen'));

/** The approval of the code that `git8n login` shows (DB-669). */
export default function DeviceRoute() {
  return (
    <Suspense fallback={<Loading>Chargement…</Loading>}>
      <Device />
    </Suspense>
  );
}

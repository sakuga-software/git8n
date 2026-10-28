import { lazy, Suspense } from 'react';
import { Loading } from '~/editor/states';

export const meta = () => [{ title: 'Dépôts · git8n' }];

const Repositories = lazy(() => import('~/repositories/screen'));

export default function RepositoriesRoute() {
  return (
    <Suspense fallback={<Loading>Chargement…</Loading>}>
      <Repositories />
    </Suspense>
  );
}

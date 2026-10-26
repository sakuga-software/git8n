import { lazy, Suspense } from 'react';
import { useParams } from 'react-router';
import { Loading } from '~/editor/states';

export const meta = () => [{ title: 'Traductions' }];

const Screen = lazy(() => import('~/editor/screen'));

export default function EditorRoute() {
  const { id } = useParams();

  return (
    <Suspense fallback={<Loading>Chargement…</Loading>}>
      <Screen repositoryId={id ?? null} />
    </Suspense>
  );
}

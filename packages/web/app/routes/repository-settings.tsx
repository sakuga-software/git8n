import { lazy, Suspense } from 'react';
import { Loading } from '~/editor/states';

export const meta = () => [{ title: 'Réglages · Traductions' }];

const Settings = lazy(() => import('~/settings/screen'));

/** The settings of one repository, for an admin (DB-609). */
export default function RepositorySettingsRoute() {
  return (
    <Suspense fallback={<Loading>Chargement…</Loading>}>
      <Settings />
    </Suspense>
  );
}

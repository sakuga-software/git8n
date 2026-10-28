import { lazy, Suspense } from 'react';
import { Loading } from '~/editor/states';

export const meta = () => [{ title: "Jetons d'accès · git8n" }];

const Tokens = lazy(() => import('~/tokens/screen'));

/** The access tokens of the signed-in account (DB-669). */
export default function TokensRoute() {
  return (
    <Suspense fallback={<Loading>Chargement…</Loading>}>
      <Tokens />
    </Suspense>
  );
}

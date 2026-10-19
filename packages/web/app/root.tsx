import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

import type { Route } from './+types/root';
import './app.css';

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap',
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/** The page of an error nothing else caught. It says what to do, in the language of the editor. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  const detail = import.meta.env.DEV && error instanceof Error ? (error.stack ?? error.message) : undefined;

  return (
    <main className="mx-auto flex max-w-[560px] flex-col gap-3 px-8 pt-24">
      <h1 className="text-[22px] font-semibold tracking-[-0.01em]">
        {missing ? "Cette page n'existe pas." : "L'éditeur s'est arrêté sur une erreur."}
      </h1>
      <p className="text-sub text-sm leading-normal">
        {missing
          ? "L'éditeur des traductions tient sur une seule page."
          : "Ce qui était saisi et pas encore proposé n'a pas été envoyé. Rechargez la page pour reprendre."}
      </p>
      <p>
        {/* A link drawn as the primary button of HeroUI: `app.css` imports its `button.css`, which holds both classes. */}
        <a href="/" className="button button--primary">
          {missing ? "Ouvrir l'éditeur" : 'Recharger'}
        </a>
      </p>
      {detail && (
        <pre className="border-line bg-panel mt-4 overflow-x-auto rounded-md border p-4 font-mono text-xs">
          <code>{detail}</code>
        </pre>
      )}
    </main>
  );
}

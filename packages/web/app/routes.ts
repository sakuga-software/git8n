import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  // Every repository, searched and sorted (DB-610). « i18n Traductions » leads here.
  index('routes/repositories.tsx'),
  route('repositories/:id', 'routes/editor.tsx'),
  // The settings of one repository, for an admin (DB-609).
  route('repositories/:id/settings', 'routes/repository-settings.tsx'),
  // GitHub sends the browser here after an installation of the App. The editor reads the address (DB-581).
  route('setup', 'routes/editor.tsx', { id: 'setup' }),
] satisfies RouteConfig;

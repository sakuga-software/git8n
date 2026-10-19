import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/editor.tsx'),
  // GitHub sends the browser here after an installation of the App. The editor reads the address (DB-581).
  route('setup', 'routes/editor.tsx', { id: 'setup' }),
] satisfies RouteConfig;

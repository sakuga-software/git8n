import type { Config } from '@react-router/dev/config';
import { DEMO, DEMO_BASE } from './demo.config.ts';

export default {
  // The session cookie belongs to the origin of the API, so a server here could not read it.
  ssr: false,
  ...(DEMO ? { basename: DEMO_BASE, buildDirectory: 'build-demo' } : {}),
} satisfies Config;

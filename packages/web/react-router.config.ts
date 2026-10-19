import type { Config } from '@react-router/dev/config';

export default {
  // The session cookie belongs to the origin of the API, so a server here could not read it.
  ssr: false,
} satisfies Config;

// Copies the build of the demo (`pnpm -F @i18n-editor/web build:demo`) where the site serves it: /docs/demo/.
import { cp, rm } from 'node:fs/promises';

const from = new URL('../../packages/web/build-demo/client/', import.meta.url);
const to = new URL('../public/demo/', import.meta.url);

await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
console.log(`The demo is in ${to.pathname}`);

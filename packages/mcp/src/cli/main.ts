#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { main } from './node.ts';

const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

await main(version);

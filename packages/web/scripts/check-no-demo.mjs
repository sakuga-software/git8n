// Fails the build of the editor if a part of the demo of the documentation is in it (DB-673).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MARKS = ['git8n-demo', "rien n'est envoyé à GitHub", 'demo-acme-shop'];
const root = new URL('../build/client/', import.meta.url).pathname;

const filesOf = async (dir) =>
  (await readdir(dir, { withFileTypes: true })).flatMap((entry) =>
    entry.isDirectory() ? [] : [join(dir, entry.name)],
  );

const assets = await filesOf(join(root, 'assets'));
const files = [...assets, join(root, 'index.html')];
const found = [];

for (const file of files) {
  const text = await readFile(file, 'utf8');

  for (const mark of MARKS) if (text.includes(mark)) found.push(`${file}: ${mark}`);
}

if (found.length > 0) {
  console.error(`The build of the editor holds the demo:\n${found.join('\n')}`);
  process.exit(1);
}

console.log(`No demo in the build of the editor (${files.length} files read).`);

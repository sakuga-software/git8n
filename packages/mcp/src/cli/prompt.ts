import type { Catalogue, CatalogueEntry } from '../api.ts';
import { idOf, neighboursOf } from './keys.ts';

export interface PromptKey {
  id: string;
  source: string;
  /** For a key to review: the source that the translation answers. */
  was?: string;
  /** For a key to review: the translation now. */
  value?: string | null;
  neighbours: Array<{ id: string; source: string; value: string | null }>;
}

export const promptKeysOf = (read: Catalogue, entries: CatalogueEntry[]): PromptKey[] =>
  entries.map((entry) => ({
    id: idOf(entry),
    source: entry.source,
    ...(entry.state === 'review' ? { was: entry.was, value: entry.value } : {}),
    neighbours: neighboursOf(read, entry, 3).map((other) => ({
      id: idOf(other),
      source: other.source,
      value: other.value,
    })),
  }));

const quoted = (text: string | null | undefined) => (text ? `« ${text} »` : '(none)');

/** A prompt that an LLM or an agent can answer, and that `git8n apply` reads back. */
export const translatePrompt = (args: {
  repository: string;
  read: Catalogue;
  keys: PromptKey[];
  total: number;
  nextCursor: number | null;
}): string => {
  const { repository, read, keys } = args;
  const lines = [
    `# Translate ${repository} from ${read.source} to ${read.language}`,
    '',
    `You translate the texts of the interface of ${repository}. The source language is ${read.source}. The target language is ${read.language}.`,
    '',
    'Rules:',
    '- Keep each placeholder as it is: {{name}}, {count}, <0>…</0>, %s, $t(…).',
    '- Keep the tone and about the length of the source. A button stays short.',
    '- The id of a key and its neighbours say where the text shows. Use them.',
    '- Translate only the keys of this list.',
    '',
    `Revision of the source: ${read.commit}`,
    '',
    `## Keys (${keys.length} of ${args.total})`,
  ];

  for (const key of keys) {
    lines.push('', `### ${key.id}`, `Source: ${quoted(key.source)}`);

    if (key.was !== undefined) {
      lines.push(`The source was: ${quoted(key.was)}`, `The translation now: ${quoted(key.value)}`);
    }

    if (key.neighbours.length > 0) {
      lines.push('Neighbours:');

      for (const other of key.neighbours) {
        lines.push(`- ${other.id}: ${quoted(other.source)} → ${quoted(other.value)}`);
      }
    }
  }

  lines.push(
    '',
    '## Answer',
    '',
    'Answer with one JSON object only: one entry for each key above, the id as the name and the translation as the value.',
    '',
    '```json',
    JSON.stringify(Object.fromEntries(keys.slice(0, 2).map((key) => [key.id, '…'])), null, 2),
    '```',
    '',
    `Then send it with: git8n apply - --repo ${repository} --lang ${read.language} --read-at ${read.commit}`,
  );

  if (args.nextCursor !== null) lines.push('', `More keys wait: add --cursor ${args.nextCursor} for the next ones.`);

  return `${lines.join('\n')}\n`;
};

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiError, type ApiConfig } from './api.ts';
import {
  createCatalogues,
  listKeys,
  listProposals,
  listRepositories,
  languageSchema,
  listSchema,
  proposeBatch,
  proposeSchema,
  readKey,
  readSchema,
  whoAmI,
} from './tools.ts';

/**
 * The translations, as an agent reads and writes them (DB-211).
 *
 * It translates nothing itself. It answers the catalogue and takes a batch;
 * the agent is what writes the words.
 */

/**
 * What the API refused, said as text rather than thrown.
 *
 * A tool that throws gives the agent a transport failure. A tool that answers
 * `isError` with the message of the API gives it the reason — which language
 * it may not write, which repository it named, what a body was missing — and
 * that is what it can act on.
 */
const answering = <T>(run: () => Promise<T>) =>
  run().catch((error: unknown) => {
    const said = error instanceof ApiError ? `${error.status} — ${error.message}` : String(error);

    return { isError: true, content: [{ type: 'text' as const, text: said }] };
  });

export const buildServer = (config: ApiConfig): McpServer => {
  const server = new McpServer({ name: 'i18n-editor', version: '0.1.0' });
  // One per server: two servers in one process must not answer each other's
  // readings, which their tokens may not reach.
  const held = createCatalogues();

  server.registerTool(
    'i18n_repositories',
    {
      title: 'The repositories to translate',
      description: 'Which repositories the editor translates, their source language and their targets.',
      inputSchema: {},
    },
    () => answering(() => listRepositories(config)),
  );

  server.registerTool(
    'i18n_me',
    {
      title: 'What this token may do',
      description:
        'The repositories where this account is a member, and in each one its role, the languages it may propose in, and whether it writes the source. A translator writes proposals and does not publish. A reviewer or an owner also publishes.',
      inputSchema: {},
    },
    () => answering(() => whoAmI(config)),
  );

  server.registerTool(
    'i18n_keys',
    {
      title: 'The keys of a language',
      description:
        'Every key of the source beside what one language says about it, filtered by state and by file. The answer carries the `commit` the values were read at; a proposal takes it back.',
      inputSchema: listSchema,
    },
    (input) => answering(() => listKeys(config, input, held)),
  );

  server.registerTool(
    'i18n_key',
    {
      title: 'One key, with its context',
      description:
        'One key: what the source says, what the target says, and its state. The file and the dotted path are the context — `analysis.requests_export_hint` says what the string is for, and a translation without it is a wrong translation.',
      inputSchema: readSchema,
    },
    (input) => answering(() => readKey(config, input, held)),
  );

  server.registerTool(
    'i18n_propose',
    {
      title: 'Propose a batch of translations',
      description:
        'Writes a whole batch as one commit on the branch of its language. Three hundred keys are one commit, not three hundred. Nothing is published: a reviewer does that.',
      inputSchema: proposeSchema,
    },
    (input) => answering(() => proposeBatch(config, input)),
  );

  server.registerTool(
    'i18n_proposals',
    {
      title: 'What is waiting on a language',
      description: 'The batches the branch of a language holds and the base does not, with who wrote each one.',
      inputSchema: languageSchema,
    },
    (input) => answering(() => listProposals(config, input)),
  );

  return server;
};

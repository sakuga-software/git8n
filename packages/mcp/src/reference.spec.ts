import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ANSWERS, REFERENCE_PATH, formatted, listedTools, renderReference } from './reference.ts';

/**
 * The page of the MCP tools (G8N-81).
 *
 * It comes from the schemas that a client lists. A change to a tool that does not run
 * `pnpm -F @git8n/mcp docs:tools` leaves a page that describes another tool.
 */

describe('the reference of the MCP tools', () => {
  it('is the page on disk', async () => {
    const page = formatted(renderReference(await listedTools()));

    expect(await readFile(REFERENCE_PATH, 'utf8'), 'Run `pnpm -F @git8n/mcp docs:tools`.').toBe(page);
  }, 30_000);

  it('gives the answer of each tool, and of no tool that is gone', async () => {
    const names = (await listedTools()).map((tool) => tool.name).sort();

    expect(Object.keys(ANSWERS).sort()).toEqual(names);
  });

  it('marks every tool read-only, except the one that writes', async () => {
    const writes = (await listedTools()).filter((tool) => !tool.annotations?.readOnlyHint).map((tool) => tool.name);

    expect(writes).toEqual(['i18n_propose']);
  });

  it('describes every field of an input', async () => {
    const undescribed = (await listedTools()).flatMap((tool) => {
      const walk = (schema: { properties?: Record<string, never> }, at: string): string[] =>
        Object.entries(schema.properties ?? {}).flatMap(([name, field]: [string, any]) => [
          ...(field.description ? [] : [`${at}.${name}`]),
          ...(field.items ? walk(field.items, `${at}.${name}[]`) : []),
        ]);

      return walk(tool.inputSchema as never, tool.name);
    });

    expect(undescribed).toEqual([]);
  });
});

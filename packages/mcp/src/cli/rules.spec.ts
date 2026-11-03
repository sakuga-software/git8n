import { describe, expect, it } from 'vitest';
import { checkExample, RULES, type Rule } from './check.ts';
import { errorUrl, ruleUrl } from './docs.ts';
import { ERRORS, type ErrorCode } from './errors.ts';

/**
 * The registry that the pages of the documentation come from (G8N-82).
 *
 * Each page shows the output of its examples. An example that finds another rule, or a « valid »
 * example that still finds a problem, would show a page that contradicts itself.
 */

const rules = Object.keys(RULES) as Rule[];

describe('the rules of check', () => {
  it.each(rules)('%s: the invalid example finds this rule, and only this rule', async (rule) => {
    const report = await checkExample(RULES[rule].invalid);

    expect(report.problems.length).toBeGreaterThan(0);
    expect(new Set(report.problems.map((problem) => problem.rule))).toEqual(new Set([rule]));
    expect(report.problems.every((problem) => problem.severity === RULES[rule].severity)).toBe(true);
  });

  it.each(rules)('%s: the valid example finds nothing', async (rule) => {
    expect((await checkExample(RULES[rule].valid)).problems).toEqual([]);
  });

  it.each(rules)('%s: has a page of the documentation', (rule) => {
    expect(RULES[rule].why).not.toBe('');
    expect(RULES[rule].fix).not.toBe('');
    expect(ruleUrl(rule)).toBe(`https://git8n.sakuga.dev/docs/reference/rules/${rule}.html`);
  });
});

describe('the error codes', () => {
  it.each(Object.keys(ERRORS) as ErrorCode[])('%s: says what to do, and has a page', (code) => {
    expect(ERRORS[code].fix).not.toBe('');
    expect(errorUrl(code)).toBe(`https://git8n.sakuga.dev/docs/reference/errors/${code.toLowerCase()}.html`);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  EXAMPLE_VALUES,
  messageOf,
  parseTemplate,
  renderTemplate,
  TEMPLATE_KINDS,
  TEMPLATE_VARIABLES,
  templateProblem,
} from '@git8n/db/messages';
import { proposalSubject, publicationSubject } from '@/services/i18n-messages';

/**
 * The formats of the messages (DB-609): what a repository may write, and what
 * a write does with a format that is absent or wrong.
 */

const repository = {
  owner: 'acme',
  name: 'acme-app',
  branch: 'main',
  proposalCommitTemplate: null,
  publicationCommitTemplate: null,
};

describe('the default formats', () => {
  it('write the messages of before DB-609', () => {
    expect(proposalSubject(repository, 'en', 1, { name: 'Ada' })).toBe('i18n(en): 1 key proposed by Ada');
    expect(publicationSubject(repository, 'en', 3, 'published', { name: 'Ada' })).toBe(
      'i18n(en): 3 keys published by Ada',
    );
    expect(publicationSubject(repository, 'fr', 2, 'created', { name: 'Ada' })).toBe('i18n(fr): 2 keys created by Ada');
  });

  it.each(TEMPLATE_KINDS)('pass their own check: %s', (kind) => {
    expect(templateProblem(kind, DEFAULT_TEMPLATES[kind])).toBeNull();
  });

  it.each(TEMPLATE_KINDS)('name only the variables of their kind: %s', (kind) => {
    const parsed = parseTemplate(DEFAULT_TEMPLATES[kind]);

    if ('problem' in parsed) throw new Error('the default format does not parse');

    const known: readonly string[] = TEMPLATE_VARIABLES[kind];

    for (const part of parsed.parts) if ('variable' in part) expect(known).toContain(part.variable);
  });
});

describe('renderTemplate', () => {
  it('writes each variable', () => {
    expect(renderTemplate('{repository}@{branch}: {count_keys}', EXAMPLE_VALUES.pullRequestTitle)).toBe(
      'acme/acme-app@main: 4 keys',
    );
  });

  it('writes a brace for {{ and }}, and reads no variable inside them', () => {
    expect(renderTemplate('{{language}} = {language} }}', { language: 'en' })).toBe('{language} = en }');
  });

  it('does not read a variable inside a value', () => {
    expect(renderTemplate('{author}', { author: '{language}' })).toBe('{language}');
  });

  it('keeps an unknown variable as it is written', () => {
    expect(renderTemplate('{nope} {language}', { language: 'en' })).toBe('{nope} en');
  });
});

describe('templateProblem', () => {
  it('refuses a variable that the kind does not know, and names the ones it does', () => {
    expect(templateProblem('pullRequestTitle', 'i18n: {author}')).toEqual({
      code: 'unknown_variable',
      variable: 'author',
      known: TEMPLATE_VARIABLES.pullRequestTitle,
    });
  });

  it('refuses a { that opens no variable, and a } that closes none', () => {
    expect(templateProblem('proposalCommit', 'i18n({language')).toEqual({ code: 'unclosed_brace', at: 5 });
    expect(templateProblem('proposalCommit', 'i18n({Language})')).toEqual({ code: 'unclosed_brace', at: 5 });
    expect(templateProblem('proposalCommit', 'i18n} {language}')).toEqual({ code: 'lone_closing_brace', at: 4 });
  });

  it('refuses a second line in a subject or a title, and takes it in a body', () => {
    expect(templateProblem('publicationCommit', '{count_keys}\nmore')).toEqual({ code: 'multiline' });
    expect(templateProblem('pullRequestTitle', '{count_keys}\r\nmore')).toEqual({ code: 'multiline' });
    expect(templateProblem('pullRequestBody', '{count_keys}\n\n{keys_list}')).toBeNull();
  });

  it('refuses a format that writes nothing', () => {
    expect(templateProblem('proposalCommit', '   ')).toEqual({ code: 'empty' });
  });

  it('refuses a format longer than its kind takes', () => {
    expect(templateProblem('proposalCommit', 'x'.repeat(201))).toEqual({ code: 'too_long', max: 200 });
  });
});

describe('messageOf', () => {
  it('uses the format of the repository', () => {
    expect(messageOf('pullRequestTitle', 'Translations: {languages}', EXAMPLE_VALUES.pullRequestTitle)).toBe(
      'Translations: de, en',
    );
  });

  it('uses the default format for a format that is absent or that a hand wrote wrong', () => {
    const expected = 'i18n: 4 keys published (de, en)';

    expect(messageOf('pullRequestTitle', null, EXAMPLE_VALUES.pullRequestTitle)).toBe(expected);
    expect(messageOf('pullRequestTitle', '{author}', EXAMPLE_VALUES.pullRequestTitle)).toBe(expected);
    expect(messageOf('pullRequestTitle', 'a\nb', EXAMPLE_VALUES.pullRequestTitle)).toBe(expected);
  });

  it('uses the default format when the values make the result empty', () => {
    expect(messageOf('proposalCommit', '{author}', { ...EXAMPLE_VALUES.proposalCommit, author: '  ' })).toBe(
      'i18n(en): 3 keys proposed by',
    );
  });

  it('cuts a commit subject at 100 characters, with … at the end', () => {
    const subject = messageOf('proposalCommit', '{author}', {
      ...EXAMPLE_VALUES.proposalCommit,
      author: 'a'.repeat(150),
    });

    expect(subject).toHaveLength(100);
    expect(subject.endsWith('…')).toBe(true);
  });

  it('cuts a title at 256 characters, the most GitHub takes', () => {
    const title = messageOf('pullRequestTitle', '{languages}', {
      ...EXAMPLE_VALUES.pullRequestTitle,
      languages: 'x'.repeat(400),
    });

    expect(title).toHaveLength(256);
  });
});

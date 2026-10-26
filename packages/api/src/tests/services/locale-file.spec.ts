import { describe, expect, it } from 'vitest';
import { LocaleFile, UnwritableKeyError } from '@/services/locale-file';
import { lineDiff } from './line-diff';

/**
 * A locale file is edited as text, not parsed and serialized (DB-608).
 *
 * The bug: `JSON.stringify` of a parsed object put the keys that look like
 * integers first, so a proposal of one key moved `3_image` and `5_image` after
 * `"12"` in the hints of Woodlock.
 */

/** The shape of the hints of `en/woodlock.json`, where the bug showed. */
const HINTS = `{
  "woodlock": {
    "hints": {
      "find_password": {
        "1": "Find where Henry stored his passwords.",
        "2": "His backpack contained various belongings, didn’t it?",
        "3": "Have you tried inspecting the pen?",
        "3_image": "",
        "4": "Try unscrewing the pen.",
        "5": "Still can’t find anything?",
        "5_image": "/img/box2-b-indice3.png",
        "6": "Those tiny coloured squares look peculiar.",
        "7": "By placing the red folder over the note, we can read 4537.",
        "8": "One of the voice messages has been left by a certain Tom.",
        "9": "Maybe Tom is a shortened form of a longer name.",
        "10": "There are two professors called Thomas.",
        "11": "Henry used his ID card to gain entry to building M6.",
        "12": "It would appear the note was written by Thomas Young."
      }
    }
  }
}
`;

const edited = (text: string, key: string, value: string): string => {
  const file = LocaleFile.parse(text);

  file.set(key, value);

  return file.toString();
};

describe('a locale file', () => {
  it('keeps the order of the keys that look like integers when one value changes', () => {
    const after = edited(HINTS, 'woodlock.hints.find_password.3_image', '/img/box2-b-indice2.png');

    expect(lineDiff(HINTS, after)).toEqual({
      removed: ['        "3_image": "",'],
      added: ['        "3_image": "/img/box2-b-indice2.png",'],
    });
  });

  it('changes the last value of an object without a comma', () => {
    const after = edited(HINTS, 'woodlock.hints.find_password.12', 'Thomas Young wrote the note.');

    expect(lineDiff(HINTS, after)).toEqual({
      removed: ['        "12": "It would appear the note was written by Thomas Young."'],
      added: ['        "12": "Thomas Young wrote the note."'],
    });
  });

  it('adds a key after the last sibling when the siblings are not in alphabetical order', () => {
    const after = edited(HINTS, 'woodlock.hints.find_password.13', 'One more hint.');

    // The line before gains its comma, as JSON requires.
    expect(lineDiff(HINTS, after)).toEqual({
      removed: ['        "12": "It would appear the note was written by Thomas Young."'],
      added: [
        '        "12": "It would appear the note was written by Thomas Young.",',
        '        "13": "One more hint."',
      ],
    });
  });

  it('adds a key at its alphabetical place when the siblings are in alphabetical order, as one line', () => {
    const before = '{\n  "alpha": "A",\n  "gamma": "G"\n}\n';
    const after = edited(before, 'beta', 'B');

    expect(after).toBe('{\n  "alpha": "A",\n  "beta": "B",\n  "gamma": "G"\n}\n');
    expect(lineDiff(before, after)).toEqual({ removed: [], added: ['  "beta": "B",'] });
  });

  it('makes the objects on the way, indented as the file is', () => {
    const before = '{\n    "a": "A"\n}\n';

    expect(edited(before, 'b.c.d', 'D')).toBe(
      '{\n    "a": "A",\n    "b": {\n        "c": {\n            "d": "D"\n        }\n    }\n}\n',
    );
  });

  it('writes into an empty object', () => {
    expect(edited('{\n  "a": {}\n}\n', 'a.b', 'B')).toBe('{\n  "a": {\n    "b": "B"\n  }\n}\n');
  });

  it('writes a file the repository does not hold yet with two spaces and a last newline', () => {
    const file = LocaleFile.empty();

    file.set('hello', 'Hi');
    file.set('buttons.back', 'Back');

    // `buttons` goes before `hello`: the siblings are in alphabetical order.
    expect(file.toString()).toBe(`${JSON.stringify({ buttons: { back: 'Back' }, hello: 'Hi' }, null, 2)}\n`);
  });

  it('adds a key after an object, not inside it', () => {
    const before = '{\n  "hello": "Bonjour",\n  "buttons": {\n    "back": "Retour"\n  }\n}\n';

    expect(edited(before, 'bye', 'Au revoir')).toBe(
      '{\n  "hello": "Bonjour",\n  "buttons": {\n    "back": "Retour"\n  },\n  "bye": "Au revoir"\n}\n',
    );
  });

  it.each([
    ['tabs', '{\n\t"a": {\n\t\t"b": "x"\n\t},\n\t"c": "y"\n}\n'],
    ['four spaces', '{\n    "a": {\n        "b": "x"\n    },\n    "c": "y"\n}'],
    ['escapes and unicode', '{\n  "q": "Il a dit \\"oui\\" \\u00e9t\\/é — 😀",\n  "n": "a\\nb"\n}\n'],
    ['a line break of Windows', '{\r\n  "a": "x",\r\n  "b": "y"\r\n}\r\n'],
  ])('keeps every byte of a file with %s when a value is written again as it was', (_name, text) => {
    const file = LocaleFile.parse(text);
    const [key, value] = Object.entries(file.content).find(([, entry]) => typeof entry === 'string')!;

    file.set(key, value as string);

    expect(file.toString()).toBe(text);
  });

  it('keeps the indentation of a file in tabs when it adds a key', () => {
    const before = '{\n\t"a": {\n\t\t"b": "x"\n\t}\n}\n';

    expect(edited(before, 'a.c', 'y')).toBe('{\n\t"a": {\n\t\t"b": "x",\n\t\t"c": "y"\n\t}\n}\n');
  });

  it('keeps the line breaks of Windows when it adds a key', () => {
    expect(edited('{\r\n  "a": "x"\r\n}\r\n', 'b', 'y')).toBe('{\r\n  "a": "x",\r\n  "b": "y"\r\n}\r\n');
  });

  it('writes a value with quotes and line breaks as a JSON string', () => {
    const after = edited('{\n  "a": "x"\n}\n', 'a', 'Il a dit "oui"\net partit');

    expect(after).toBe('{\n  "a": "Il a dit \\"oui\\"\\net partit"\n}\n');
    expect(JSON.parse(after)).toEqual({ a: 'Il a dit "oui"\net partit' });
  });

  it('changes the last of a key named twice, as JSON.parse reads it', () => {
    const after = edited('{\n  "a": "first",\n  "a": "second"\n}\n', 'a', 'new');

    expect(after).toBe('{\n  "a": "first",\n  "a": "new"\n}\n');
  });

  it.each([
    ['a.', 'holds an empty segment'],
    ['__proto__.x', 'names __proto__'],
    ['constructor', 'names constructor'],
  ])('refuses the key %s', (key, reason) => {
    expect(() => LocaleFile.parse('{}').set(key, 'x')).toThrow(UnwritableKeyError);
    expect(() => LocaleFile.parse('{}').set(key, 'x')).toThrow(reason);
  });

  it('refuses a key that passes through a translation', () => {
    expect(() => LocaleFile.parse('{\n  "hello": "Hi"\n}').set('hello.deeper', 'x')).toThrow(
      'hello.deeper passes through hello, which the file holds as a value.',
    );
  });

  it('refuses a text that is not a JSON object', () => {
    expect(() => LocaleFile.parse('{ "a": ')).toThrow(SyntaxError);
    expect(() => LocaleFile.parse('["a"]')).toThrow(SyntaxError);
  });
});

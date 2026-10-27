/**
 * A locale file as its text, changed one value at a time (DB-608).
 *
 * The writes used to parse the file into an object and serialize it again.
 * JavaScript orders the keys that look like integers before every other key,
 * so `"3_image"` moved after `"12"`, and a proposal of one key rewrote the
 * order of a whole object. This class edits the text instead. A changed value
 * replaces its own span, and a new key adds one line. Every other byte of the
 * file stays as it was: the key order, the indentation, the escapes and the
 * last newline.
 */

/** A key that cannot be written, and why. The route answers 400. */
export class UnwritableKeyError extends Error {
  constructor(reason: string) {
    super(reason);

    this.name = 'UnwritableKeyError';
  }
}

/**
 * A segment that names a property every object already has.
 *
 * `__proto__.x` does not write into a parsed object: it walks to
 * `Object.prototype`. The text edit has no such risk, but a translator sends
 * these keys, and the file must not hold a key that the reads cannot reach.
 */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

interface ObjectNode {
  kind: 'object';
  /** The position of `{`. */
  start: number;
  /** The position of `}`. */
  end: number;
  members: Member[];
}

interface ValueNode {
  kind: 'value';
  start: number;
  /** The position after the last character of the value. */
  end: number;
}

type JsonNode = ObjectNode | ValueNode;

interface Member {
  key: string;
  /** The position of the opening quote of the key. */
  keyStart: number;
  /** The position after the closing quote of the key. */
  keyEnd: number;
  value: JsonNode;
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/** Reads the text into nodes with positions. It throws on a text that `JSON.parse` refuses. */
const scan = (text: string): ObjectNode => {
  let at = 0;

  const skip = () => {
    while (at < text.length && WHITESPACE.has(text[at])) at += 1;
  };

  const fail = (what: string): never => {
    throw new SyntaxError(`${what} at position ${at} of a locale file`);
  };

  const stringEnd = (from: number): number => {
    let index = from + 1;

    while (index < text.length) {
      if (text[index] === '\\') index += 2;
      else if (text[index] === '"') return index + 1;
      else index += 1;
    }

    return fail('An unclosed string');
  };

  const value = (): JsonNode => {
    skip();

    if (text[at] === '{') return object();

    const start = at;

    if (text[at] === '"') {
      at = stringEnd(at);
    } else if (text[at] === '[') {
      let depth = 0;

      do {
        if (text[at] === '"') {
          at = stringEnd(at);
          continue;
        }
        if (text[at] === '[' || text[at] === '{') depth += 1;
        if (text[at] === ']' || text[at] === '}') depth -= 1;
        at += 1;
      } while (depth > 0 && at < text.length);
    } else {
      while (at < text.length && !WHITESPACE.has(text[at]) && text[at] !== ',' && text[at] !== '}') at += 1;
    }

    if (at === start) fail('A missing value');

    return { kind: 'value', start, end: at };
  };

  const object = (): ObjectNode => {
    const node: ObjectNode = { kind: 'object', start: at, end: -1, members: [] };

    at += 1;
    skip();

    while (text[at] !== '}') {
      if (text[at] !== '"') fail('A key that is not a string');

      const keyStart = at;

      at = stringEnd(at);

      const keyEnd = at;
      const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;

      skip();
      if (text[at] !== ':') fail('A missing colon');
      at += 1;

      node.members.push({ key, keyStart, keyEnd, value: value() });

      skip();
      if (text[at] === ',') {
        at += 1;
        skip();
      } else if (text[at] !== '}') {
        fail('A missing comma');
      }
    }

    node.end = at;
    at += 1;

    return node;
  };

  // `JSON.parse` is the judge of what a valid file is. The scan only locates.
  JSON.parse(text);
  skip();

  if (text[at] !== '{') fail('A file that is not an object');

  return object();
};

/** The whitespace at the start of the line that holds `position`. */
const indentOfLine = (text: string, position: number): string => {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart));

  return match ? match[0] : '';
};

/** The position after the last character of a value, `}` included. */
const endOf = (node: JsonNode): number => (node.kind === 'object' ? node.end + 1 : node.end);

/** The last member of that key, as `JSON.parse` keeps the last of a duplicate. */
const memberOf = (node: ObjectNode, key: string): Member | undefined =>
  [...node.members].reverse().find((member) => member.key === key);

export class LocaleFile {
  private text: string;
  private parsed: Record<string, unknown> | undefined;

  private constructor(text: string) {
    this.text = text;
  }

  /** A file read from the repository. It throws on a text that is not a JSON object. */
  static parse(text: string): LocaleFile {
    const file = new LocaleFile(text);

    scan(text);

    return file;
  }

  /** A file the repository does not hold yet. */
  static empty(): LocaleFile {
    return new LocaleFile('{}\n');
  }

  /** What the file says, for the reads. */
  get content(): Record<string, unknown> {
    this.parsed ??= JSON.parse(this.text) as Record<string, unknown>;

    return this.parsed;
  }

  toString(): string {
    return this.text;
  }

  /** The line break of the file. */
  private get newline(): string {
    return this.text.includes('\r\n') ? '\r\n' : '\n';
  }

  /** One level of indentation, read from the first member on a line of its own. */
  private get unit(): string {
    const match = /\{\r?\n([ \t]+)"/.exec(this.text);

    return match ? match[1] : '  ';
  }

  /**
   * Sets a dotted key to a string, and makes the objects on the way.
   *
   * - An existing value is replaced where it is.
   * - A new key goes where an alphabetical order puts it, if its siblings are
   *   in alphabetical order. Otherwise, it goes after the last sibling.
   */
  set(key: string, value: string): void {
    this.setAt(key.split('.'), value);
  }

  /**
   * Sets the string at a path of segments, as `set` does with a dotted key.
   *
   * A segment can hold a dot here. The manifest names a key as `<file>:<key>`
   * in one segment (DB-611).
   */
  setAt(parts: readonly string[], value: string): void {
    const key = parts.join('.');

    for (const part of parts) {
      if (part.length === 0) throw new UnwritableKeyError(`${key} holds an empty segment.`);
      if (UNSAFE_SEGMENTS.has(part)) throw new UnwritableKeyError(`${key} names ${part}, which every object holds.`);
    }

    let node = scan(this.text);

    for (const [index, part] of parts.entries()) {
      const member = memberOf(node, part);
      const last = index === parts.length - 1;

      if (last && member) {
        const current = this.text.slice(member.value.start, endOf(member.value));

        // The same text, written with other escapes, stays as the file wrote it.
        if (member.value.kind === 'value' && JSON.parse(current) === value) return;

        this.splice(member.value.start, endOf(member.value), JSON.stringify(value));

        return;
      }

      if (!member) {
        this.insert(node, parts.slice(index), value);

        return;
      }

      if (member.value.kind !== 'object') {
        // Writing here would replace a translation that is already in the file.
        throw new UnwritableKeyError(`${key} passes through ${part}, which the file holds as a value.`);
      }

      node = member.value;
    }
  }

  /**
   * Removes the member at a path of segments, with its comma and its line.
   *
   * An object that the removal leaves empty is removed too, up to the root. A
   * mark that is added and then removed thus gives back the same text. A path
   * the file does not hold changes nothing.
   */
  removeAt(parts: readonly string[]): void {
    const path: Array<{ node: ObjectNode; member: Member }> = [];
    let node = scan(this.text);

    for (const part of parts) {
      const member = memberOf(node, part);

      if (!member) return;

      path.push({ node, member });

      if (member.value.kind !== 'object') break;

      node = member.value;
    }

    if (path.length !== parts.length) return;

    let cut = path.length - 1;

    // An object that holds only the removed member goes with it, but never the root.
    while (cut > 0 && path[cut].node.members.length === 1) cut -= 1;

    const { node: parent, member } = path[cut];
    const index = parent.members.indexOf(member);

    if (parent.members.length === 1) {
      this.splice(parent.start, parent.end + 1, '{}');
    } else if (index < parent.members.length - 1) {
      this.splice(member.keyStart, parent.members[index + 1].keyStart, '');
    } else {
      this.splice(endOf(parent.members[index - 1].value), endOf(member.value), '');
    }
  }

  private splice(start: number, end: number, replacement: string): void {
    this.text = this.text.slice(0, start) + replacement + this.text.slice(end);
    this.parsed = undefined;
  }

  /** Adds `parts` to `node`, as one member that holds the objects of the rest of the path. */
  private insert(node: ObjectNode, parts: string[], value: string): void {
    const { newline, unit } = this;
    const [first, ...rest] = parts;
    const onLines = node.members.length === 0 || /\n/.test(this.text.slice(node.start, node.members[0].keyStart));
    const closingIndent = indentOfLine(this.text, node.start);
    const indent = node.members.length > 0 ? indentOfLine(this.text, node.members[0].keyStart) : closingIndent + unit;
    const separator =
      node.members.length > 0
        ? this.text.slice(node.members[0].keyEnd, node.members[0].value.start)
        : (this.text.match(/"\s*:\s*/)?.[0].slice(1) ?? ': ');

    const valueText = (depth: number, remaining: string[]): string => {
      if (remaining.length === 0) return JSON.stringify(value);

      const inner = indent + unit.repeat(depth + 1);
      const outer = indent + unit.repeat(depth);

      return `{${newline}${inner}${JSON.stringify(remaining[0])}${separator}${valueText(depth + 1, remaining.slice(1))}${newline}${outer}}`;
    };

    const member = `${JSON.stringify(first)}${separator}${valueText(0, rest)}`;

    if (node.members.length === 0) {
      this.splice(node.start, node.end + 1, `{${newline}${indent}${member}${newline}${closingIndent}}`);

      return;
    }

    const keys = node.members.map((entry) => entry.key);
    const sorted = keys.every((entry, index) => index === 0 || keys[index - 1] <= entry);
    const before = sorted ? node.members.find((entry) => entry.key > first) : undefined;
    const gap = onLines ? `${newline}${indent}` : ' ';

    if (before) {
      this.splice(before.keyStart, before.keyStart, `${member},${gap}`);
    } else {
      const after = node.members[node.members.length - 1];

      this.splice(endOf(after.value), endOf(after.value), `,${gap}${member}`);
    }
  }
}

import { describe, expect, it } from 'vitest';
import { normalCode, shownCode, stateOf } from './rules';

describe('the code of a terminal', () => {
  it('reads a code as a person types it', () => {
    expect(normalCode(' abcd-1234 ')).toBe('ABCD1234');
    expect(shownCode('abcd 1234')).toBe('ABCD-1234');
  });

  it('asks the account to approve a code that waits for it', () => {
    expect(stateOf({ status: 'pending', client_id: 'i18n-editor-cli' })).toEqual({ kind: 'review' });
  });

  it('says that another account holds a code that waits with no client', () => {
    expect(stateOf({ status: 'pending' })).toEqual({ kind: 'elsewhere' });
  });

  it('says what became of a code, and that a code is unknown', () => {
    expect(stateOf({ status: 'approved' })).toEqual({ kind: 'approved' });
    expect(stateOf({ status: 'denied' })).toEqual({ kind: 'denied' });
    expect(stateOf(null)).toEqual({ kind: 'unknown' });
  });
});

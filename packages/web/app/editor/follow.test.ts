import { describe, expect, it } from 'vitest';
import { followOf } from './follow';

describe('followOf', () => {
  it('puts the tooltip a little left of the pointer', () => {
    expect(followOf(200, 640, 120)).toBe(188);
  });

  it('keeps the tooltip under the bar at both ends', () => {
    expect(followOf(5, 640, 120)).toBe(0);
    expect(followOf(630, 640, 120)).toBe(520);
  });

  it('does not move a tooltip wider than the bar', () => {
    expect(followOf(300, 100, 160)).toBe(0);
  });
});

/** The tooltip starts this far left of the pointer, so the pointer stays over its first line. */
const POINTER_LEAD = 12;

/**
 * How far a tooltip that opens under the start of a bar moves to follow the pointer (DB-676).
 *
 * It stays under the bar: from its start to the place where its right edge meets the end of the bar.
 */
export const followOf = (pointerX: number, barWidth: number, tooltipWidth: number): number =>
  Math.round(Math.min(Math.max(0, barWidth - tooltipWidth), Math.max(0, pointerX - POINTER_LEAD)));

import { validateTaste } from './domain';

/** Display only. Allocate leftover whole percentages by largest remainder.
 * A stable axis tie-break prevents flicker; basis points are never mutated. */
export function tastePercentages(taste: readonly number[]): number[] {
  validateTaste([...taste]);
  const values = taste.map(value => Math.floor(value / 100));
  const order = taste.map((value, i) => ({ i, remainder: value % 100 }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const missing = 100 - values.reduce((sum, value) => sum + value, 0);
  for (let n = 0; n < missing; n++) values[order[n].i]++;
  return values;
}

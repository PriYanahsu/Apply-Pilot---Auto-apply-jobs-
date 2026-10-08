/**
 * FILE: shared/sleep.ts
 * WHAT: sleep(ms) and randomDelay({min,max}) - used to look human and to wait for Naukri's UI.
 * CALLED BY: steps, naukri DOM helpers.
 */

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

/** Waits a random time inside the range and returns how long it waited. */
export async function randomDelay(range: { min: number; max: number }): Promise<number> {
  const waitMs = randomBetween(range.min, range.max);
  await sleep(waitMs);
  return waitMs;
}

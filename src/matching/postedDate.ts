/**
 * FILE: matching/postedDate.ts
 * WHAT: Turns Naukri's "2 days ago" labels into a date, and decides if a job is too old (freshness rule R2).
 * CALLED BY: steps/3-searchJobs.ts (gate #1), steps/5-enrichJobs.ts (gate #2), steps/7-queueJobs.ts (final check)
 * RETURNS: parsePostedText -> ISO date string, or null when unknown / "30+ days" (caller marks the job stale).
 * IF IT BREAKS: add the new label wording to the patterns below and a test in tests/postedDate.test.ts.
 */

const TODAY_PATTERNS = [/just now/i, /few hours? ago/i, /\d+\s*hours? ago/i, /\d+\s*min(ute)?s? ago/i, /^today$/i, /today/i];
const DAYS_AGO_PATTERN = /(\d+)\s*\+?\s*days?\s*ago/i;
const WEEKS_AGO_PATTERN = /(\d+)\s*weeks?\s*ago/i; // LinkedIn: "1 week ago"
const ONE_DAY_PATTERNS = [/^a day ago$/i, /yesterday/i];
const TOO_OLD_PATTERN = /30\s*\+/;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBefore(now: Date, days: number): string {
  const day = startOfLocalDay(now);
  day.setDate(day.getDate() - days);
  return day.toISOString();
}

export function parsePostedText(postedText: string, now: Date = new Date()): string | null {
  const text = postedText.trim();
  if (!text || TOO_OLD_PATTERN.test(text)) return null;
  if (TODAY_PATTERNS.some((pattern) => pattern.test(text))) return daysBefore(now, 0);
  if (ONE_DAY_PATTERNS.some((pattern) => pattern.test(text))) return daysBefore(now, 1);
  const daysMatch = text.match(DAYS_AGO_PATTERN);
  // "5+ days ago" is a lower bound, so the job might be older; we still use 5 and gate #2 checks again.
  if (daysMatch) return daysBefore(now, Number(daysMatch[1]));
  const weeksMatch = text.match(WEEKS_AGO_PATTERN);
  if (weeksMatch) return daysBefore(now, Number(weeksMatch[1]) * 7);
  return null;
}

/** Whole calendar days between the posted day and today. */
export function jobAgeInDays(postedAtIso: string, now: Date = new Date()): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const posted = startOfLocalDay(new Date(postedAtIso)).getTime();
  return Math.round((startOfLocalDay(now).getTime() - posted) / millisecondsPerDay);
}

/** True when the job must NOT be applied to. Missing/invalid dates count as too old (safe default). */
export function isJobTooOld(postedAtIso: string | null | undefined, maxJobAgeDays: number, now: Date = new Date()): boolean {
  if (!postedAtIso || Number.isNaN(new Date(postedAtIso).getTime())) return true;
  return jobAgeInDays(postedAtIso, now) > maxJobAgeDays;
}

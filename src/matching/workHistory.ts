/**
 * FILE: matching/workHistory.ts
 * WHAT: Turns the resume's work history into per-skill years, computed in code (not guessed by the AI):
 *       a skill's years = the total time of the jobs where it was used, overlapping jobs counted once.
 *       Also formats the work history as short text for the scoring / answer prompts.
 * CALLED BY: steps/2-buildProfile.ts, ai/prompts.ts
 */
import type { Skill, WorkEntry } from '../db/types';
import { normalizeSkill } from './skillSynonyms';

/** 'YYYY-MM' (or 'YYYY') -> months since year 0; 'present' -> now. undefined when unreadable. */
export function monthIndex(date: string | undefined, now: Date = new Date()): number | undefined {
  if (!date) return undefined;
  if (/present|current|now|till date/i.test(date)) return now.getFullYear() * 12 + now.getMonth();
  const match = date.match(/(\d{4})(?:\D+(\d{1,2}))?/);
  if (!match) return undefined;
  const month = match[2] ? Math.min(Math.max(Number(match[2]), 1), 12) - 1 : 0;
  return Number(match[1]) * 12 + month;
}

/** [start, end) month ranges of one job, or null when the dates are unknown. */
function jobMonths(entry: WorkEntry, now: Date): [number, number] | null {
  const start = monthIndex(entry.start, now);
  const end = monthIndex(entry.end ?? 'present', now);
  if (start === undefined || end === undefined || end < start) return null;
  return [start, end + 1];
}

/** Total months covered by the ranges, counting overlaps once. */
function coveredMonths(ranges: [number, number][]): number {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  let total = 0;
  let currentEnd = -Infinity;
  for (const [start, end] of sorted) {
    const from = Math.max(start, currentEnd);
    if (end > from) total += end - from;
    currentEnd = Math.max(currentEnd, end);
  }
  return total;
}

/** Normalized skill -> years (rounded to 0.5), from the jobs where the skill was used. */
export function yearsBySkill(workHistory: WorkEntry[], now: Date = new Date()): Map<string, number> {
  const rangesBySkill = new Map<string, [number, number][]>();
  for (const entry of workHistory) {
    const months = jobMonths(entry, now);
    if (!months) continue;
    for (const skill of new Set(entry.skills.map(normalizeSkill))) {
      if (!skill) continue;
      rangesBySkill.set(skill, [...(rangesBySkill.get(skill) ?? []), months]);
    }
  }
  const years = new Map<string, number>();
  for (const [skill, ranges] of rangesBySkill) years.set(skill, Math.round((coveredMonths(ranges) / 12) * 2) / 2);
  return years;
}

/** Fills skills that have no years yet from the work history. Years already stated (resume / Naukri) are kept. */
export function fillSkillYears(skills: Skill[], workHistory: WorkEntry[], now: Date = new Date()): Skill[] {
  const years = yearsBySkill(workHistory, now);
  return skills.map((skill) => {
    if (skill.years !== undefined) return skill;
    const fromHistory = years.get(normalizeSkill(skill.name));
    return fromHistory !== undefined && fromHistory > 0 ? { ...skill, years: fromHistory } : skill;
  });
}

/** "Frontend Developer at Acme (2021-04 to present): React, TypeScript" - one line per job. */
export function workHistoryText(workHistory: WorkEntry[] | undefined): string {
  if (!workHistory || workHistory.length === 0) return 'not available';
  return workHistory
    .map((entry) => `${entry.title} at ${entry.company} (${entry.start ?? '?'} to ${entry.end ?? '?'})${entry.skills.length > 0 ? `: ${entry.skills.join(', ')}` : ''}`)
    .join('\n');
}

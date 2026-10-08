/**
 * FILE: tests/searchTasks.test.ts
 * WHAT: The search plan (your keywords first, then resume-suggested titles) and the per-day memory key.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config';
import { buildSearchCombos, searchLogKey } from '../src/steps/3-searchJobs';

describe('search plan', () => {
  it('your keywords x locations come first', () => {
    const combos = buildSearchCombos({ ...DEFAULT_SETTINGS, keywords: ['react', 'java'], locations: ['Pune', 'Delhi'] });
    expect(combos.map((combo) => `${combo.keyword}@${combo.location}`)).toEqual(['react@Pune', 'react@Delhi', 'java@Pune', 'java@Delhi']);
    expect(combos.every((combo) => !combo.suggested)).toBe(true);
  });
  it('adds resume-suggested titles afterwards, without repeating your keywords', () => {
    const combos = buildSearchCombos(
      { ...DEFAULT_SETTINGS, keywords: ['Java Developer'], locations: [] },
      { searchKeywords: ['java developer', 'Spring Boot Developer'], targetTitles: ['Full Stack Engineer', 'Spring Boot Developer'] },
    );
    expect(combos).toEqual([
      { keyword: 'Java Developer', location: '', suggested: false },
      { keyword: 'Spring Boot Developer', location: '', suggested: true },
      { keyword: 'Full Stack Engineer', location: '', suggested: true },
    ]);
  });
  it('keys searches by day, so tomorrow starts fresh', () => {
    const task = { keyword: 'React Developer', location: 'Pune', page: 2 };
    expect(searchLogKey('2026-10-08', task)).toBe('2026-10-08|react developer|pune|2');
    expect(searchLogKey('2026-10-09', task)).not.toBe(searchLogKey('2026-10-08', task));
  });
});

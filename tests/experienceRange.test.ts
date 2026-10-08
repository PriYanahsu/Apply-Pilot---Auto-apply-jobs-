/**
 * FILE: tests/experienceRange.test.ts
 * WHAT: "2-5 Yrs" parsing and the experience-fit rule from §5.4.
 */
import { describe, expect, it } from 'vitest';
import { experienceFits, parseExperienceRange } from '../src/matching/experienceRange';

describe('parseExperienceRange', () => {
  it.each([
    ['2-5 Yrs', { min: 2, max: 5 }],
    ['0-1 Yrs', { min: 0, max: 1 }],
    ['10 - 15 Years', { min: 10, max: 15 }],
    ['3 to 6 years', { min: 3, max: 6 }],
    ['5+ years', { min: 5, max: 99 }],
    ['4 Yrs', { min: 4, max: 4 }],
    ['Fresher', { min: 0, max: 0 }],
  ])('%s', (text, expected) => {
    expect(parseExperienceRange(text)).toEqual(expected);
  });
  it('returns undefined when there are no numbers', () => {
    expect(parseExperienceRange('Not disclosed')).toBeUndefined();
  });
});

describe('experienceFits', () => {
  const range = { min: 3, max: 5 };
  it('allows min - 1 up to max + 2', () => {
    expect(experienceFits(2, range)).toBe(true);
    expect(experienceFits(7, range)).toBe(true);
  });
  it('rejects outside that window', () => {
    expect(experienceFits(1.5, range)).toBe(false);
    expect(experienceFits(7.5, range)).toBe(false);
  });
  it('lets unknown ranges through', () => {
    expect(experienceFits(10, undefined)).toBe(true);
  });
});

/**
 * FILE: tests/postedDate.test.ts
 * WHAT: Freshness rules (acceptance #1): labels -> dates, and "too old" decisions.
 */
import { describe, expect, it } from 'vitest';
import { isJobTooOld, jobAgeInDays, parsePostedText } from '../src/matching/postedDate';

const NOW = new Date(2026, 9, 8, 15, 30); // 8 Oct 2026, 15:30 local

describe('parsePostedText', () => {
  it.each(['Just now', 'Few hours ago', 'Today', '5 hours ago', 'Just Now', '30 mins ago'])('"%s" is today', (label) => {
    expect(jobAgeInDays(parsePostedText(label, NOW)!, NOW)).toBe(0);
  });
  it.each([['1 day ago', 1], ['2 days ago', 2], ['3 Days Ago', 3], ['Yesterday', 1], ['5+ days ago', 5]])('"%s" is %i days old', (label, days) => {
    expect(jobAgeInDays(parsePostedText(label, NOW)!, NOW)).toBe(days);
  });
  it.each(['30+ days ago', '30+ Days Ago', '', 'sometime', 'Posted a while back'])('"%s" is unknown -> null', (label) => {
    expect(parsePostedText(label, NOW)).toBeNull();
  });
});

describe('isJobTooOld', () => {
  it('keeps jobs within the limit and rejects older ones', () => {
    expect(isJobTooOld(parsePostedText('3 days ago', NOW), 3, NOW)).toBe(false);
    expect(isJobTooOld(parsePostedText('4 days ago', NOW), 3, NOW)).toBe(true);
    expect(isJobTooOld(parsePostedText('Today', NOW), 1, NOW)).toBe(false);
    expect(isJobTooOld(parsePostedText('2 days ago', NOW), 1, NOW)).toBe(true);
  });
  it('treats missing or invalid dates as too old (safe default)', () => {
    expect(isJobTooOld(null, 7, NOW)).toBe(true);
    expect(isJobTooOld('', 7, NOW)).toBe(true);
    expect(isJobTooOld('not a date', 7, NOW)).toBe(true);
  });
});

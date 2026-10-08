/**
 * FILE: tests/effectiveFacts.test.ts
 * WHAT: Your details per site: resume first, then that site's profile, then the other site's, then your corrections.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config';
import { getEffectiveFacts } from '../src/db/database';
import type { CandidateProfile } from '../src/db/types';

const profile = {
  autoFacts: { fullName: 'Priyanshu', currentLocation: 'Noida', currentCtcLpa: 9.5, noticePeriodDays: 15 },        // resume + Naukri
  linkedin: { autoFacts: { fullName: 'Priyanshu', currentLocation: 'Greater Delhi Area' }, factSources: {}, profileText: '', headline: '', syncedAt: '' }, // resume + LinkedIn
} as unknown as CandidateProfile;

describe('getEffectiveFacts', () => {
  it('Naukri: Naukri details win, LinkedIn only fills gaps', () => {
    expect(getEffectiveFacts(DEFAULT_SETTINGS, profile, 'naukri')).toMatchObject({ currentLocation: 'Noida', currentCtcLpa: 9.5 });
  });
  it('LinkedIn: LinkedIn details win, Naukri still fills CTC / notice', () => {
    expect(getEffectiveFacts(DEFAULT_SETTINGS, profile, 'linkedin')).toMatchObject({ currentLocation: 'Greater Delhi Area', currentCtcLpa: 9.5, noticePeriodDays: 15 });
  });
  it('your corrections always win', () => {
    expect(getEffectiveFacts({ ...DEFAULT_SETTINGS, factOverrides: { currentLocation: 'Pune' } }, profile, 'linkedin').currentLocation).toBe('Pune');
  });
});

/**
 * FILE: linkedin/searchUrl.ts
 * WHAT: Builds a LinkedIn job search URL: full-time (f_JT=F), your experience level (f_E), posted in the last N days
 *       (f_TPR, seconds), newest first (sortBy=DD), 25 per page (start). Easy Apply only (f_AL) is optional.
 * CALLED BY: steps/linkedin/li-3-searchJobs.ts
 * IF IT BREAKS: set the filters on linkedin.com by hand and compare the address bar with this.
 */
import { LINKEDIN_BASE_URL, LINKEDIN_RESULTS_PER_PAGE } from '../config';

export interface LinkedInSearchInput {
  keyword: string;
  location: string; // '' = anywhere
  page: number;     // 1-based
  maxJobAgeDays: number;
  experienceYears?: number; // -> LinkedIn experience level (f_E)
  easyApplyOnly?: boolean;  // false = also find "apply on company website" jobs (saved under Company site)
}

/** LinkedIn levels: 1 Internship, 2 Entry level, 3 Associate, 4 Mid-Senior, 5 Director. */
export function linkedInExperienceLevels(years: number): string {
  if (years < 1) return '1,2';
  if (years < 3) return '2,3';
  if (years < 7) return '3,4';
  return '4,5';
}

const SECONDS_PER_DAY = 86_400;

export function buildLinkedInSearchUrl(input: LinkedInSearchInput): string {
  const params = new URLSearchParams();
  params.set('keywords', input.keyword);
  if (input.location) params.set('location', input.location);
  if (input.easyApplyOnly) params.set('f_AL', 'true');
  params.set('f_JT', 'F'); // full-time
  if (input.experienceYears !== undefined) params.set('f_E', linkedInExperienceLevels(input.experienceYears));
  params.set('f_TPR', `r${Math.max(1, input.maxJobAgeDays) * SECONDS_PER_DAY}`);
  params.set('sortBy', 'DD');
  if (input.page > 1) params.set('start', String((input.page - 1) * LINKEDIN_RESULTS_PER_PAGE));
  return `${LINKEDIN_BASE_URL}/jobs/search/?${params.toString()}`;
}

export function linkedInJobUrl(linkedInId: string): string {
  return `${LINKEDIN_BASE_URL}/jobs/view/${linkedInId}/`;
}

/** Our DB id for a LinkedIn job ('li-' prefix keeps it apart from Naukri ids). */
export function linkedInJobKey(linkedInId: string): string {
  return `li-${linkedInId}`;
}

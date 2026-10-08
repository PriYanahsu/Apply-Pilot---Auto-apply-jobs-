/**
 * FILE: naukri/searchUrl.ts
 * WHAT: Builds a Naukri search URL for one keyword + location + page, filtered by job age (freshness gate #1).
 * CALLED BY: steps/3-searchJobs.ts
 * RETURNS: a full https://www.naukri.com/... URL string.
 * IF IT BREAKS: open a real search on naukri.com with the "Freshness" filter and compare the URL with SEARCH_URL in selectors.ts.
 */
import { NAUKRI_BASE_URL, NAUKRI_JOB_AGE_FILTER_DAYS } from '../config';
import { SEARCH_URL } from './selectors';

export interface SearchUrlInput {
  keyword: string;
  location: string; // '' = anywhere
  page: number;     // 1-based
  experienceYears: number;
  maxJobAgeDays: number;
}

export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Naukri only filters by 1/3/7/15/30 days: e.g. 5 -> 7 (our own gates then drop the 6-7 day old ones). */
export function naukriJobAgeFilter(maxJobAgeDays: number): number {
  return NAUKRI_JOB_AGE_FILTER_DAYS.find((days) => days >= maxJobAgeDays) ?? 30;
}

export function buildSearchUrl(input: SearchUrlInput): string {
  const locationPart = input.location ? SEARCH_URL.locationPart.replace('{locationSlug}', slugify(input.location)) : '';
  const pagePart = input.page > 1 ? SEARCH_URL.pagePart.replace('{page}', String(input.page)) : '';
  const path = SEARCH_URL.pathTemplate
    .replace('{keywordSlug}', slugify(input.keyword))
    .replace('{locationPart}', locationPart)
    .replace('{pagePart}', pagePart);

  const params = new URLSearchParams();
  params.set(SEARCH_URL.params.keyword, input.keyword);
  if (input.location) params.set(SEARCH_URL.params.location, input.location);
  if (input.experienceYears > 0) params.set(SEARCH_URL.params.experience, String(Math.floor(input.experienceYears)));
  params.set(SEARCH_URL.params.jobAge, String(naukriJobAgeFilter(input.maxJobAgeDays)));
  return `${NAUKRI_BASE_URL}${path}?${params.toString()}`;
}

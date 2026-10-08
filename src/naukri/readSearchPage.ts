/**
 * FILE: naukri/readSearchPage.ts
 * WHAT: Reads every job card on a Naukri search-results page.
 * CALLED BY: entrypoints/naukri.content.ts (command SCRAPE_SEARCH_PAGE) and tests/readSearchPage.test.ts
 * RETURNS: SearchCard[] (an empty list when the page has no results).
 * IF IT BREAKS: "no jobs found" usually means SEL.searchCard changed. Check Debug > Snapshots.
 */
import { JOB_ID_IN_URL_PATTERN } from './selectors';
import { cleanText, makeError, queryAll, queryOptional, textOf } from './domHelpers';
import type { SearchCard } from '../shared/messages';

export function readSearchPage(root: ParentNode = document): SearchCard[] {
  const cardElements = queryAll(root, 'searchCard');
  if (cardElements.length === 0) {
    if (queryOptional(root, 'noResults')) return [];
    throw makeError('SELECTOR_MISSING', 'No job cards found on the search page', 'searchCard');
  }
  const cards: SearchCard[] = [];
  for (const cardElement of cardElements) {
    const card = readOneCard(cardElement);
    if (card) cards.push(card);
  }
  return cards;
}

function readOneCard(cardElement: HTMLElement): SearchCard | null {
  const titleLink = queryOptional(cardElement, 'cardTitle') as HTMLAnchorElement | null;
  const url = titleLink?.href ?? '';
  const jobId = cardElement.getAttribute('data-job-id') ?? jobIdFromUrl(url);
  // A card without an id or link can't be applied to or de-duplicated, so we skip it.
  if (!jobId || !url) return null;
  return {
    jobId,
    url,
    title: cleanText(titleLink?.textContent),
    company: textOf(cardElement, 'cardCompany'),
    location: textOf(cardElement, 'cardLocation'),
    experienceText: textOf(cardElement, 'cardExperience'),
    salaryText: textOf(cardElement, 'cardSalary'),
    skills: queryAll(cardElement, 'cardSkills').map((element) => cleanText(element.textContent)).filter(Boolean),
    description: textOf(cardElement, 'cardDescription'),
    postedText: textOf(cardElement, 'cardPosted'),
  };
}

export function jobIdFromUrl(url: string): string {
  return url.match(JOB_ID_IN_URL_PATTERN)?.[1] ?? '';
}

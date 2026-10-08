/**
 * FILE: linkedin/readSearchPage.ts
 * WHAT: Reads the job cards on a LinkedIn search results page.
 *       New UI (Oct 2026): <div role="button" componentkey="job-card-component-ref-<jobId>"> with <p> lines.
 *       Classic UI: <li data-occludable-job-id="<jobId>"> with title link / lockup subtitle (company) / caption (location);
 *       its cards are EMPTY until scrolled into view, so the content script scrolls each one first.
 * CALLED BY: entrypoints/linkedin.content.ts (LI_SCRAPE_SEARCH_PAGE) and tests
 * RETURNS: SearchCard[] (jobId = 'li-<id>'); [] when the page has no results.
 */
import { makeError } from '../naukri/domHelpers';
import type { SearchCard } from '../shared/messages';
import { liQueryAll, visibleText } from './dom';
import { linkedInJobKey, linkedInJobUrl } from './searchUrl';
import { LI_TEXT } from './selectors';

const NO_RESULTS = /no matching jobs found|no results found|we couldn('|’)t find/i;

export function linkedInIdOfCard(card: HTMLElement): string {
  const componentKey = card.getAttribute('componentkey') ?? '';
  const fromKey = componentKey.match(/job-card-component-ref-(\d+)/)?.[1];
  const fromData = card.getAttribute('data-occludable-job-id') ?? card.getAttribute('data-job-id');
  const fromUrn = card.getAttribute('data-entity-urn')?.match(/jobPosting:(\d+)/)?.[1];
  const fromLink = card.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"]')?.href.match(/\/jobs\/view\/(\d+)/)?.[1];
  return fromKey ?? fromData ?? fromUrn ?? fromLink ?? '';
}

// Classic job search (logged in): title link, then "lockup" subtitle (company) and caption (location).
const CLASSIC_LINE_SELECTORS = [
  '.job-card-list__title, .job-card-container__link, a[href*="/jobs/view/"]',
  '.artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-container__company-name',
  '.artdeco-entity-lockup__caption, .job-card-container__metadata-wrapper, .job-card-container__metadata-item',
];
// New UI (<p> lines) and the public guest page.
const NEW_LINE_SELECTOR = 'p, h3, h4, .base-search-card__title, .base-search-card__subtitle, .job-search-card__location';
const NOT_A_LINE = /^(viewed|promoted|easy apply|actively recruiting|you('|’)d be a top applicant|be an early applicant|verified|applied)$/i;

function unique(lines: string[]): string[] {
  return lines.filter((line, index) => line && lines.indexOf(line) === index && !NOT_A_LINE.test(line));
}

/** Last resort: every visible text-only element, in order (works whatever the class names are). */
function leafLines(card: HTMLElement): string[] {
  const leaves = Array.from(card.querySelectorAll<HTMLElement>('*')).filter((element) => element.childElementCount === 0 || element.tagName === 'STRONG');
  return unique(leaves.map((element) => visibleText(element)).filter((text) => text.length > 1 && text.length < 150));
}

/** Lines of text in the card - [title, company, location, ...] - without aria-hidden duplicates. */
function cardLines(card: HTMLElement): string[] {
  const classic = CLASSIC_LINE_SELECTORS.map((selector) => visibleText(card.querySelector(selector)));
  if (classic[0] && classic[1]) return unique(classic);
  const newUi = unique(Array.from(card.querySelectorAll(NEW_LINE_SELECTOR)).map((element) => visibleText(element)));
  return newUi.length >= 2 ? newUi : leafLines(card);
}

function readOneCard(card: HTMLElement): SearchCard | null {
  const id = linkedInIdOfCard(card);
  const lines = cardLines(card);
  if (!id || lines.length === 0) return null;
  const allText = visibleText(card);
  return {
    jobId: linkedInJobKey(id),
    url: linkedInJobUrl(id),
    title: lines[0] ?? '',
    company: lines[1] ?? '',
    location: lines[2] ?? '',
    experienceText: '',
    salaryText: lines.find((line) => /₹|inr|lpa|\/yr|per year|lakh/i.test(line)) ?? '',
    skills: [],
    description: '',
    postedText: allText.match(LI_TEXT.posted)?.[0] ?? card.querySelector('time')?.textContent?.trim() ?? '',
    easyApply: /easy apply/i.test(allText),
  };
}

export function readLinkedInSearchPage(root: ParentNode = document): SearchCard[] {
  const cards = liQueryAll(root, 'searchCard');
  if (cards.length === 0) {
    const pageText = visibleText((root as Document).body ?? (root as Element));
    if (NO_RESULTS.test(pageText)) return [];
    throw makeError('SELECTOR_MISSING', 'No job cards found on the LinkedIn search page', 'searchCard');
  }
  const seen = new Set<string>();
  const results: SearchCard[] = [];
  for (const card of cards) {
    const result = readOneCard(card);
    if (result && !seen.has(result.jobId)) {
      seen.add(result.jobId);
      results.push(result);
    }
  }
  return results;
}

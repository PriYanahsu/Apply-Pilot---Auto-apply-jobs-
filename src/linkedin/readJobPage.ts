/**
 * FILE: linkedin/readJobPage.ts
 * WHAT: Reads a LinkedIn job page: title, company, location, posted, the full "About the job" text,
 *       and how you can apply: Easy Apply / company website / already applied / closed.
 * CALLED BY: entrypoints/linkedin.content.ts (LI_SCRAPE_JOB)
 * IF IT BREAKS: Easy Apply not found -> LI_SEL.easyApplyButton (aria-label "Easy Apply to this job").
 */
import { makeError, waitForCondition } from '../naukri/domHelpers';
import type { LinkedInJobDetail } from '../shared/messages';
import { liButtonByText, liQuery, visibleText } from './dom';
import { LI_TEXT } from './selectors';

const JOB_PAGE_WAIT_MS = 15_000;

/** The job text: a known description block, else the "About the job" heading's section. */
function readDescription(root: ParentNode): string {
  const block = liQuery(root, 'jobDescription');
  if (block && visibleText(block).length > 50) return visibleText(block).replace(/^About the job\s*/i, '').slice(0, 15_000);
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p, span'));
  const aboutHeading = headings.find((element) => /^about the job$/i.test(visibleText(element)));
  let container: HTMLElement | null = aboutHeading?.parentElement ?? null;
  while (container && visibleText(container).length < 300 && container.parentElement) container = container.parentElement;
  return visibleText(container).replace(/^About the job\s*/i, '').slice(0, 15_000);
}

/** Last resort: everything the job panel shows, without menus, headers and side columns. */
function panelText(root: ParentNode): string {
  const panel = root instanceof Document ? root.body : (root as Element);
  if (!panel) return '';
  const copy = panel.cloneNode(true) as Element;
  copy.querySelectorAll('nav, header, aside, footer, [role="navigation"], [role="banner"], [role="complementary"]').forEach((node) => node.remove());
  return visibleText(copy).slice(0, 8_000);
}

function findAppliedStatus(root: ParentNode): boolean {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('span, p, div'));
  return candidates.some((element) => element.childElementCount === 0 && LI_TEXT.jobApplied.test(visibleText(element)));
}

export function detectLinkedInApplyType(root: ParentNode = document): LinkedInJobDetail['applyType'] {
  if (findAppliedStatus(root)) return 'already_applied';
  if (LI_TEXT.jobClosed.test(visibleText((root as Document).body ?? (root as Element)))) return 'closed';
  if (liQuery(root, 'easyApplyButton')) return 'easy_apply';
  if (liQuery(root, 'externalApplyButton') || liButtonByText(root, ['apply'])) return 'external';
  throw makeError('SELECTOR_MISSING', 'No Easy Apply / Apply / Applied on the LinkedIn job page', 'easyApplyButton');
}

/** True once the page shows how to apply AND the job text (a closed job has no text to wait for). */
function applyStateVisible(): boolean {
  try {
    const applyType = detectLinkedInApplyType();
    return applyType === 'closed' || readDescription(document).length > 50;
  } catch (error) {
    // Still rendering - the wait below tries again on the next DOM change.
    console.log('[li-job] apply state not visible yet', String(error));
    return false;
  }
}

export async function waitForLinkedInJobPage(): Promise<void> {
  try {
    await waitForCondition(applyStateVisible, JOB_PAGE_WAIT_MS, 'LinkedIn job page did not finish loading');
  } catch (error) {
    // Not fatal: readLinkedInJobPage() throws a precise SELECTOR_MISSING error if something is really missing.
    console.log('[li-job] job page still incomplete after waiting', error);
  }
}

export function readLinkedInJobPage(root: ParentNode = document): LinkedInJobDetail {
  const details = liQuery(root, 'jobDetails') ?? (root as Document).body;
  const title = visibleText(details?.querySelector('h1')) || (root as Document).title?.split('|')[0]?.trim() || '';
  const topLine = Array.from(details?.querySelectorAll<HTMLElement>('p, span, div') ?? [])
    .map((element) => visibleText(element))
    .find((text) => text.includes('·') && LI_TEXT.posted.test(text) && text.length < 200) ?? '';
  const [location = ''] = topLine.split('·').map((part) => part.trim());
  const applyType = detectLinkedInApplyType(root);
  // Known description blocks first; otherwise the job panel's whole visible text (title, details, description).
  // A job is never failed for its text: scoring still works from the title and company.
  const description = readDescription(root) || readDescription(details ?? root) || panelText(details ?? root);
  return {
    title,
    company: visibleText(details ? details.querySelector('a[href*="/company/"]') : null),
    location,
    postedText: topLine.match(LI_TEXT.posted)?.[0] ?? '',
    description,
    applyType,
  };
}

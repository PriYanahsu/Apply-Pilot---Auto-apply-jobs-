/**
 * FILE: naukri/readJobPage.ts
 * WHAT: Reads a Naukri job detail page: full description, skills, posted date and HOW you can apply.
 *       Waits first: Naukri renders the job page with JavaScript, so right after "page loaded" the
 *       description and Apply button may not exist yet.
 * CALLED BY: entrypoints/naukri.content.ts (command SCRAPE_JOB_DETAIL)
 * RETURNS: JobDetail (applyType = 'naukri' | 'external' | 'already_applied')
 * IF IT BREAKS: empty descriptions -> SEL.jobDescription; wrong apply type -> detectApplyType() below.
 */
import { BUTTON_TEXT } from './selectors';
import {
  cleanText, findButtonByText, isVisible, makeError, queryAll, queryOptional, queryVisible, textOf, waitForCondition,
} from './domHelpers';
import type { JobDetail } from '../shared/messages';

const JOB_PAGE_WAIT_MS = 15_000;

/** Waits until the description AND one of the apply buttons are on screen. */
export async function waitForJobPage(): Promise<void> {
  try {
    await waitForCondition(() => queryOptional(document, 'jobDescription') && findApplyState(document), JOB_PAGE_WAIT_MS, 'Job page did not finish rendering');
  } catch (error) {
    // Not fatal here: readJobPage() below throws a precise SELECTOR_MISSING error naming what is missing.
    console.log('[readJobPage] job page still incomplete after waiting', error);
  }
}

export function readJobPage(root: ParentNode = document): JobDetail {
  const descriptionElement = queryOptional(root, 'jobDescription');
  const description = cleanText(descriptionElement?.innerText || descriptionElement?.textContent);
  if (!description) throw makeError('SELECTOR_MISSING', 'Job description not found on job page', 'jobDescription');

  const otherDetails = readLabelledDetails(root);
  const skillChips = queryAll(root, 'jobSkills');
  const education = [otherDetails.ug && `UG: ${otherDetails.ug}`, otherDetails.pg && `PG: ${otherDetails.pg}`, otherDetails.education].filter(Boolean).join(' | ');
  return {
    title: textOf(root, 'jobTitle'),
    company: textOf(root, 'jobCompany'),
    description,
    skills: skillChips.map((chip) => cleanText(chip.textContent)).filter(Boolean),
    preferredSkills: skillChips.filter((chip) => queryOptional(chip, 'jobSkillPreferredIcon')).map((chip) => cleanText(chip.textContent)),
    postedText: readPostedText(root),
    experienceText: textOf(root, 'jobExperience'),
    location: textOf(root, 'jobLocation'),
    role: otherDetails.role ?? '',
    industry: otherDetails['industry type'] ?? otherDetails.industry ?? '',
    education,
    naukriMatch: readNaukriMatchScore(root),
    applyType: detectApplyType(root),
  };
}

/** "Job match score" items: a check icon = match, anything else = no match. Empty when logged out. */
function readNaukriMatchScore(root: ParentNode): Record<string, boolean> {
  const match: Record<string, boolean> = {};
  for (const item of queryAll(root, 'matchScoreItem')) {
    const label = cleanText(item.textContent).toLowerCase();
    if (label) match[label] = queryOptional(item, 'matchScoreCheckIcon') !== null;
  }
  return match;
}

/** The header shows "Posted: 1 day ago | Openings: 4 | Applicants: 100+". */
function readPostedText(root: ParentNode): string {
  for (const stat of queryAll(root, 'jobStats')) {
    const text = cleanText(stat.textContent);
    if (text.toLowerCase().startsWith('posted')) return text.replace(/^posted\s*:?\s*/i, '');
  }
  // Fallback: find "Posted: ..." anywhere in the job header text.
  const headerText = cleanText(queryOptional(root, 'jobHeader')?.textContent);
  return headerText.match(/posted\s*:?\s*(.+?ago|today|just now)/i)?.[1] ?? '';
}

/** "Role: Frontend Developer" style rows -> { role: 'Frontend Developer' } (keys lowercase). */
function readLabelledDetails(root: ParentNode): Record<string, string> {
  const details: Record<string, string> = {};
  for (const row of queryAll(root, 'jobOtherDetails')) {
    const [label, ...rest] = cleanText(row.textContent).split(':');
    // Naukri ends multi-value rows with a comma: "IT Services & Consulting,"
    if (label && rest.length > 0) details[label.trim().toLowerCase()] = rest.join(':').trim().replace(/,$/, '');
  }
  return details;
}

/**
 * Only VISIBLE buttons count. Order matters: "Applied" and "Apply on company site" both also start with "apply".
 * Returns null when no apply button is on screen yet.
 */
/** "Applied" can be a badge or label, not only a button: any visible header element whose own text is exactly it. */
function headerSaysApplied(root: ParentNode): boolean {
  const header = queryOptional(root, 'jobHeader');
  if (!header) return false;
  return Array.from(header.querySelectorAll<HTMLElement>('*')).some((element) => {
    const ownText = cleanText(Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' ')).toLowerCase();
    return BUTTON_TEXT.applied.some((text) => ownText === text) && isVisible(element);
  });
}

export function findApplyState(root: ParentNode = document): JobDetail['applyType'] | null {
  if (queryVisible(root, 'alreadyApplied') || findButtonByText(BUTTON_TEXT.applied, true, root) || headerSaysApplied(root)) return 'already_applied';
  if (queryVisible(root, 'companySiteButton') || findButtonByText(BUTTON_TEXT.companySite, false, root)) return 'external';
  if (queryVisible(root, 'applyButton') || findButtonByText(BUTTON_TEXT.apply, true, root)) return 'naukri';
  return null;
}

export function detectApplyType(root: ParentNode = document): JobDetail['applyType'] {
  const state = findApplyState(root);
  if (!state) throw makeError('SELECTOR_MISSING', 'No Apply / Applied / Company-site button on the job page', 'applyButton');
  return state;
}

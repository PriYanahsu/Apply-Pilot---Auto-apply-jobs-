/**
 * FILE: naukri/readProfilePage.ts
 * WHAT: Reads the user's own Naukri profile (/mnjuser/profile): skills, experience, CTC, notice, locations.
 *       Read-only - we NEVER change the profile.
 * CALLED BY: entrypoints/naukri.content.ts (command SCRAPE_PROFILE)
 * RETURNS: NaukriProfile. Numbers we can't find are left undefined; fullText is always filled.
 * IF IT BREAKS: the profile page selectors (profile*) in selectors.ts are the least verified ones.
 *   Even if they all fail, fullText still lets the merge step and Gemini see the profile.
 */
import { cleanText, queryAll, queryOptional, textOf, waitForCondition } from './domHelpers';
import type { NaukriProfile } from '../shared/messages';

const PROFILE_WAIT_MS = 15_000;
const MIN_PROFILE_TEXT_CHARS = 1_500;
const PROFILE_SCROLL_STEPS = 6;
const PERSONAL_DETAILS_CHARS = 1_500;

/** The profile page loads its sections lazily; wait until a reasonable amount of text is there. */
export async function waitForProfilePage(): Promise<void> {
  try {
    await waitForCondition(() => (document.body?.innerText ?? '').length > MIN_PROFILE_TEXT_CHARS, PROFILE_WAIT_MS, 'Profile page still loading');
  } catch (error) {
    console.log('[readProfilePage] profile page has little text; reading what is there', error);
  }
  // Scrolling down step by step makes Naukri render its lazy sections (key skills, IT skills, employment,
  // personal details at the very bottom). One jump to the end can skip the ones in between.
  for (let step = 1; step <= PROFILE_SCROLL_STEPS; step += 1) {
    window.scrollTo(0, (document.body.scrollHeight * step) / PROFILE_SCROLL_STEPS);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

/**
 * The "Personal details" block (date of birth, gender, languages, category...) is at the very bottom of the
 * page, so it is moved to the FRONT of the profile text: excerpts and length limits can never cut it off.
 */
export function withPersonalDetailsFirst(fullText: string): string {
  const start = fullText.search(/personal details/i);
  if (start < 0) return fullText;
  const block = fullText.slice(start, start + PERSONAL_DETAILS_CHARS);
  return `${block}\n\n${fullText}`;
}

export function readProfilePage(root: Document = document): NaukriProfile {
  const fullText = cleanText(root.body?.innerText ?? root.body?.textContent);
  return {
    name: textOf(root, 'profileName'),
    headline: textOf(root, 'profileHeadline'),
    keySkills: queryAll(root, 'profileKeySkills').map((element) => cleanText(element.textContent)).filter(Boolean),
    itSkills: readItSkills(root),
    employmentText: cleanText(queryOptional(root, 'profileEmployment')?.textContent).slice(0, 4_000),
    totalExperienceYears: parseExperienceYears(fullText),
    currentLocation: '',
    preferredLocations: [],
    currentCtcLpa: parseRupeesToLpa(fullText.match(/₹\s*([\d,.]+)\s*(lacs?|lakhs?|lpa)?/i)),
    expectedCtcLpa: parseRupeesToLpa(fullText.match(/expected\s*(?:ctc|salary)[^₹\d]*₹?\s*([\d,.]+)\s*(lacs?|lakhs?|lpa)?/i)),
    noticePeriodDays: parseNoticeDays(fullText),
    phone: fullText.match(/(?:\+91[\s-]?)?[6-9]\d{9}/)?.[0] ?? '',
    fullText: withPersonalDetailsFirst(fullText).slice(0, 20_000),
  };
}

/** IT-skills table rows look like: Skill | Version | Last used | Experience ("3 Years 2 Months"). */
function readItSkills(root: ParentNode): { name: string; years?: number }[] {
  const skills: { name: string; years?: number }[] = [];
  for (const row of queryAll(root, 'profileItSkillRows')) {
    const cells = Array.from(row.querySelectorAll('td')).map((cell) => cleanText(cell.textContent));
    if (cells.length === 0 || !cells[0]) continue;
    skills.push({ name: cells[0], years: parseExperienceYears(cells.join(' ')) });
  }
  return skills;
}

/** "4 Years 6 Months" -> 4.5 */
export function parseExperienceYears(text: string): number | undefined {
  const match = text.match(/(\d+)\s*years?(?:\s*(\d+)\s*months?)?/i);
  if (!match) return undefined;
  const months = match[2] ? Number(match[2]) : 0;
  return Math.round((Number(match[1] ?? 0) + months / 12) * 10) / 10;
}

/** "₹ 8,50,000" -> 8.5 ; "₹ 12 Lacs" -> 12 */
export function parseRupeesToLpa(match: RegExpMatchArray | null): number | undefined {
  if (!match) return undefined;
  const amount = Number((match[1] ?? '').replace(/,/g, ''));
  if (Number.isNaN(amount)) return undefined;
  if (match[2]) return amount; // already in lakhs
  return Math.round((amount / 100_000) * 100) / 100;
}

/** "15 Days or less notice period" -> 15 ; "2 Months notice" -> 60 ; "Serving notice" -> 0 */
export function parseNoticeDays(text: string): number | undefined {
  const match = text.match(/(\d+)\s*(days?|months?)[^.]{0,20}notice/i);
  if (match) return Number(match[1]) * ((match[2] ?? '').toLowerCase().startsWith('month') ? 30 : 1);
  if (/serving notice|immediate/i.test(text)) return 0;
  return undefined;
}

/**
 * FILE: matching/hardFilters.ts
 * WHAT: Cheap, certain filters (no AI) from §5.4. Returns WHY a job is rejected, or null if it passes.
 * CALLED BY: steps/4-filterJobs.ts, steps/8-applyToJob.ts (re-checked before applying, acceptance #2)
 * IF IT BREAKS: wrong jobs passing/failing? The reason text is saved on job.filterReason - start there.
 */
import { experienceFits, parseExperienceRange } from './experienceRange';
import { skillOverlap, titleSimilarity } from './ruleScore';

export interface FilterJobInput {
  title: string;
  company: string;
  location: string;
  experienceText: string;
  skills: string[];
}

export interface FilterSettingsInput {
  excludeTitleWords: string[];
  excludeCompanies: string[];
  locations: string[];
  candidateYears: number;
}

export interface FilterProfileInput {
  skillNames: string[];
  targetTitles: string[];
}

const ALWAYS_ALLOWED_LOCATIONS = ['remote', 'work from home', 'wfh', 'anywhere'];
const LOCATION_ALIASES: Record<string, string> = { bengaluru: 'bangalore', gurugram: 'gurgaon', bombay: 'mumbai', 'new delhi': 'delhi' };

function normalizeLocation(text: string): string {
  let lower = text.toLowerCase();
  for (const [alias, canonical] of Object.entries(LOCATION_ALIASES)) lower = lower.split(alias).join(canonical);
  return lower;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function titleHasExcludedWord(title: string, excludeTitleWords: string[]): string | null {
  for (const word of excludeTitleWords) {
    if (!word.trim()) continue;
    const wholeWord = new RegExp(`(^|[^a-z0-9])${escapeRegex(word.trim().toLowerCase())}($|[^a-z0-9])`, 'i');
    if (wholeWord.test(title)) return word;
  }
  return null;
}

export function locationMatches(jobLocation: string, wantedLocations: string[]): boolean {
  if (wantedLocations.length === 0) return true;
  const job = normalizeLocation(jobLocation);
  if (ALWAYS_ALLOWED_LOCATIONS.some((allowed) => job.includes(allowed))) return true;
  return wantedLocations.some((wanted) => job.includes(normalizeLocation(wanted.trim())));
}

export function checkHardFilters(job: FilterJobInput, settings: FilterSettingsInput, profile: FilterProfileInput): string | null {
  const badWord = titleHasExcludedWord(job.title, settings.excludeTitleWords);
  if (badWord) return `Title contains excluded word "${badWord}"`;

  const company = job.company.toLowerCase();
  const excludedCompany = settings.excludeCompanies.find((name) => name.trim() && company.includes(name.trim().toLowerCase()));
  if (excludedCompany) return `Company "${job.company}" is excluded`;

  const range = parseExperienceRange(job.experienceText);
  if (!experienceFits(settings.candidateYears, range)) {
    return `Experience ${job.experienceText} doesn't fit your ${settings.candidateYears} yrs`;
  }

  if (!locationMatches(job.location, settings.locations)) return `Location "${job.location}" not in your locations`;

  const overlap = skillOverlap(job.skills, profile.skillNames);
  const similarity = titleSimilarity(job.title, profile.targetTitles);
  if (overlap === 0 && similarity === 0) return 'No skill overlap and title shares no word with your target titles';
  return null;
}

/**
 * FILE: matching/experienceRange.ts
 * WHAT: Parses Naukri experience labels: "2-5 Yrs" -> { min: 2, max: 5 }, "3+ years" -> { min: 3, max: 99 }.
 * CALLED BY: steps/3-searchJobs.ts, matching/hardFilters.ts
 * RETURNS: { min, max } or undefined when the label has no numbers.
 */

export interface ExperienceRange {
  min: number;
  max: number;
}

const OPEN_ENDED_MAX_YEARS = 99;

export function parseExperienceRange(text: string): ExperienceRange | undefined {
  const cleaned = text.toLowerCase();
  if (/fresher/.test(cleaned) && !/\d/.test(cleaned)) return { min: 0, max: 0 };
  const range = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const openEnded = cleaned.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (openEnded) return { min: Number(openEnded[1]), max: OPEN_ENDED_MAX_YEARS };
  const single = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:yrs?|years?)/);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return undefined;
}

/** Rule from §5.4: reject if candidate < min - 1 or candidate > max + 2. */
export function experienceFits(candidateYears: number, range: ExperienceRange | undefined): boolean {
  if (!range) return true; // unknown range -> let scoring decide
  return candidateYears >= range.min - 1 && candidateYears <= range.max + 2;
}

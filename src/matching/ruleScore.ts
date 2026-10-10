/**
 * FILE: matching/ruleScore.ts
 * WHAT: The cheap, deterministic part of the match score (no AI):
 *       ruleScore = round(55 * skillOverlap + 25 * titleSimilarity + 20 * experienceFit)
 *       When the job's experience range is unknown, skills and title share the full 100.
 *       Jobs without skill tags (e.g. LinkedIn) get their skills from the description text.
 * CALLED BY: matching/hardFilters.ts, steps/6-scoreJobs.ts
 * RETURNS: numbers between 0 and 100 (overlap/similarity/fit are 0..1).
 */
import { parseExperienceRange } from './experienceRange';
import { COMMON_SKILLS, SKILL_SYNONYMS, normalizeSkill, normalizeSkillSet } from './skillSynonyms';

const SKILL_WEIGHT = 55;
const TITLE_WEIGHT = 25;
const EXPERIENCE_WEIGHT = 20;
// Fit drops by this much per year outside the job's range (2 years under the minimum = 0.5).
const EXPERIENCE_FIT_LOSS_PER_YEAR = 0.25;
// Words that appear in almost every title and say nothing about the role.
const TITLE_STOP_WORDS = new Set(['sr', 'senior', 'junior', 'jr', 'lead', 'i', 'ii', 'iii', 'the', 'a', 'an', 'and', 'of', 'for', 'with', '-', 'immediate', 'joiner']);
// Skill names that are also everyday English words: never looked for in free text ("go live", "the rest of").
// Raw spellings (not normalized), compared with the variant being looked for.
const AMBIGUOUS_IN_TEXT = new Set(['go', 'rest', 'spring', 'swift', 'rails', 'excel', 'dart', 'sap', 'r', 'c', 'ai', 'ml', 'dl', 'js', 'ts', 'node', 'py']);

/** Share of the job's skills the candidate has. */
export function skillOverlap(jobSkills: string[], candidateSkills: string[]): number {
  const jobSet = normalizeSkillSet(jobSkills);
  const candidateSet = normalizeSkillSet(candidateSkills);
  let matched = 0;
  for (const skill of jobSet) if (candidateSet.has(skill)) matched += 1;
  return matched / Math.max(jobSet.size, 1);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9+#])${escapeRegex(term)}($|[^a-z0-9+#])`).test(text);
}

/**
 * Skills named in a job description: common skills (and their spelling variants) plus your own skills.
 * Returns canonical names. Used when a job has no skill tags.
 */
export function skillsInText(text: string, candidateSkills: string[]): string[] {
  const lower = ` ${text.toLowerCase()} `;
  const variants = new Map<string, string>(); // what to look for -> canonical name
  for (const skill of [...COMMON_SKILLS, ...candidateSkills]) variants.set(skill.toLowerCase().trim(), normalizeSkill(skill));
  for (const [variant, canonical] of Object.entries(SKILL_SYNONYMS)) variants.set(variant, canonical);
  const found = new Set<string>();
  for (const [variant, canonical] of variants) {
    if (!variant || AMBIGUOUS_IN_TEXT.has(variant) || found.has(canonical)) continue;
    if (mentions(lower, variant)) found.add(canonical);
  }
  return Array.from(found);
}

/** The job's skills: its tags when it has any, otherwise the skills its description names. */
export function jobSkillsFor(job: { skills: string[]; description?: string; title?: string }, candidateSkills: string[]): string[] {
  if (job.skills.length > 0) return job.skills;
  return skillsInText(`${job.title ?? ''}\n${job.description ?? ''}`, candidateSkills);
}

/** The job's skills you have, in the job's wording. */
export function matchedSkills(jobSkills: string[], candidateSkills: string[]): string[] {
  const candidateSet = normalizeSkillSet(candidateSkills);
  return jobSkills.filter((skill) => candidateSet.has(normalizeSkill(skill)));
}

export function titleWords(title: string): string[] {
  return title.toLowerCase().split(/[^a-z0-9.#+]+/).map(normalizeSkill).filter((word) => word && !TITLE_STOP_WORDS.has(word));
}

/** Best match between the job title and any target title: share of the target title's words found in the job title. */
export function titleSimilarity(jobTitle: string, targetTitles: string[]): number {
  const jobWords = new Set(titleWords(jobTitle));
  let best = 0;
  for (const target of targetTitles) {
    const targetWords = titleWords(target);
    if (targetWords.length === 0) continue;
    const shared = targetWords.filter((word) => jobWords.has(word)).length;
    best = Math.max(best, shared / targetWords.length);
  }
  return best;
}

/** 1 = your years are inside the job's range, less the further outside. undefined = the job states no range. */
export function experienceFit(candidateYears: number, experienceText: string): number | undefined {
  const range = parseExperienceRange(experienceText);
  if (!range) return undefined;
  const yearsOff = candidateYears < range.min ? range.min - candidateYears : candidateYears > range.max ? candidateYears - range.max : 0;
  return Math.max(0, 1 - yearsOff * EXPERIENCE_FIT_LOSS_PER_YEAR);
}

export function computeRuleScore(jobSkills: string[], jobTitle: string, candidateSkills: string[], targetTitles: string[], fit?: number): number {
  const skillPart = skillOverlap(jobSkills, candidateSkills);
  const titlePart = titleSimilarity(jobTitle, targetTitles);
  if (fit === undefined) {
    // No experience range to compare: skills and title share the full score in the same proportion.
    const total = SKILL_WEIGHT + TITLE_WEIGHT;
    return Math.round((100 * (SKILL_WEIGHT * skillPart + TITLE_WEIGHT * titlePart)) / total);
  }
  return Math.round(SKILL_WEIGHT * skillPart + TITLE_WEIGHT * titlePart + EXPERIENCE_WEIGHT * fit);
}

export function computeFinalScore(ruleScore: number, aiScore: number, dealBreaker: boolean, ruleWeight: number, aiWeight: number, dealBreakerMax: number): number {
  const combined = Math.round(ruleWeight * ruleScore + aiWeight * aiScore);
  return dealBreaker ? Math.min(combined, dealBreakerMax) : combined;
}

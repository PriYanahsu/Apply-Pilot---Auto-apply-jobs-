/**
 * FILE: matching/ruleScore.ts
 * WHAT: The cheap, deterministic part of the match score (no AI):
 *       ruleScore = round(70 * skillOverlap + 30 * titleSimilarity)
 * CALLED BY: matching/hardFilters.ts, steps/6-scoreJobs.ts
 * RETURNS: numbers between 0 and 100 (overlap/similarity are 0..1).
 */
import { normalizeSkill, normalizeSkillSet } from './skillSynonyms';

const SKILL_WEIGHT = 70;
const TITLE_WEIGHT = 30;
// Words that appear in almost every title and say nothing about the role.
const TITLE_STOP_WORDS = new Set(['sr', 'senior', 'junior', 'jr', 'lead', 'i', 'ii', 'iii', 'the', 'a', 'an', 'and', 'of', 'for', 'with', '-', 'immediate', 'joiner']);

/** Share of the job's skills the candidate has. Skills are also matched inside the job title/description text. */
export function skillOverlap(jobSkills: string[], candidateSkills: string[]): number {
  const jobSet = normalizeSkillSet(jobSkills);
  const candidateSet = normalizeSkillSet(candidateSkills);
  let matched = 0;
  for (const skill of jobSet) if (candidateSet.has(skill)) matched += 1;
  return matched / Math.max(jobSet.size, 1);
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

export function computeRuleScore(jobSkills: string[], jobTitle: string, candidateSkills: string[], targetTitles: string[]): number {
  return Math.round(SKILL_WEIGHT * skillOverlap(jobSkills, candidateSkills) + TITLE_WEIGHT * titleSimilarity(jobTitle, targetTitles));
}

export function computeFinalScore(ruleScore: number, aiScore: number, dealBreaker: boolean, ruleWeight: number, aiWeight: number, dealBreakerMax: number): number {
  const combined = Math.round(ruleWeight * ruleScore + aiWeight * aiScore);
  return dealBreaker ? Math.min(combined, dealBreakerMax) : combined;
}

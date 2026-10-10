/**
 * FILE: matching/answerRules.ts
 * WHAT: Answers screening questions WITHOUT Gemini: (1) saved answers (exact, then fuzzy), (2) simple rules
 *       for experience / CTC / notice / location / relocation. Returns null when unsure (never guesses).
 * CALLED BY: steps/8-applyToJob.ts
 * IF IT BREAKS: a common question answered wrongly? Fix it in the Answers tab, or adjust the rule below.
 */
import { FUZZY_QUESTION_MATCH_THRESHOLD } from '../config';
import type { CandidateProfile, Facts, SavedAnswer } from '../db/types';
import { SKILL_SYNONYMS, normalizeSkill } from './skillSynonyms';

/** The memory key for a question: lowercase words only. */
export function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(normalizeQuestion(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeQuestion(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / (leftTokens.size + rightTokens.size - shared);
}

export function findSavedAnswer(question: string, savedAnswers: SavedAnswer[]): SavedAnswer | null {
  const key = normalizeQuestion(question);
  const exact = savedAnswers.find((saved) => saved.qKey === key);
  if (exact) return exact;
  let best: SavedAnswer | null = null;
  let bestScore = 0;
  for (const saved of savedAnswers) {
    const score = tokenJaccard(question, saved.question);
    if (score > bestScore) { best = saved; bestScore = score; }
  }
  return bestScore >= FUZZY_QUESTION_MATCH_THRESHOLD ? best : null;
}

/** For option questions the answer must be one of the options (case-insensitive). Returns the option's exact text. */
export function matchOption(answer: string, options: string[]): string | null {
  if (options.length === 0) return answer;
  return options.find((option) => option.trim().toLowerCase() === answer.trim().toLowerCase()) ?? null;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Unknown (undefined) stays unknown -> null, so the question goes to Gemini / Needs review instead of a guess. */
function formatOptional(value: number | undefined): string | null {
  return value === undefined ? null : formatNumber(value);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function yearsForSkillQuestion(question: string, profile: CandidateProfile, facts: Facts): string | null {
  const lower = question.toLowerCase();
  // "Do you have experience in Java?" is a yes/no question, not a number: leave it to Gemini.
  if (!/\byears?\b|\byrs?\b|how (many|much|long)/.test(lower)) return null;
  const cleanQuestion = ` ${lower.replace(/[^a-z0-9.#+/ ]+/g, ' ').replace(/\s+/g, ' ')} `;
  // Longest names first, so "React Native" wins over "React"; whole words only, so "Go" doesn't match "good".
  const skills = [...profile.skills].sort((left, right) => right.name.length - left.name.length);
  for (const skill of skills) {
    const skillName = normalizeSkill(skill.name);
    if (skillName.length < 2) continue;
    const spellings = [skillName, skill.name.toLowerCase(), ...Object.keys(SKILL_SYNONYMS).filter((variant) => SKILL_SYNONYMS[variant] === skillName)];
    if (!spellings.some((spelling) => new RegExp(`[^a-z0-9+#]${escapeRegex(spelling)}[^a-z0-9+#]`).test(cleanQuestion))) continue;
    // Without a per-skill number we can't be sure, so we fall through to Gemini / needs_review.
    return skill.years !== undefined ? formatNumber(skill.years) : null;
  }
  if (/total|overall|relevant experience|how many years of experience/.test(lower)) return formatOptional(facts.totalExperienceYears);
  return null;
}

// "Are you willing to relocate / comfortable with night shifts / ok to work from office / able to travel?"
const PREFERENCE_QUESTION = /(willing|comfortable|ready|open|okay|ok|fine|able|agree|available)\b.{0,40}\b(relocat|shift|night|rotational|office|onsite|on-site|hybrid|travel|commute|weekend|bond|background|join|contract)/;

const INFINITY_YEARS = 1_000;

/** "0-1 Years" -> {0,1}; "Less than 6 months" -> {0,0.49}; "More than 1 year" / "5+" -> {1.01,inf}; "Fresher" -> {0,0}. */
export function optionRange(option: string): { min: number; max: number } | null {
  const lower = option.toLowerCase();
  const inMonths = /month/.test(lower) && !/year/.test(lower);
  const scale = (value: number) => (inMonths ? value / 12 : value);
  if (/fresher|no experience/.test(lower)) return { min: 0, max: 0 };
  // "0-1 Years", "1 to 3 years", and Naukri's "6 12 months" (no dash).
  const range = lower.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to|\s)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: scale(Number(range[1])), max: scale(Number(range[2])) };
  const below = lower.match(/(?:less than|under|below|<)\s*(\d+(?:\.\d+)?)/);
  if (below) return { min: 0, max: scale(Number(below[1])) - 0.01 };
  const above = lower.match(/(?:more than|above|over|>)\s*(\d+(?:\.\d+)?)/) ?? lower.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (above) return { min: scale(Number(above[1])) + (lower.includes('+') ? 0 : 0.01), max: INFINITY_YEARS };
  const single = lower.match(/^\s*(\d+(?:\.\d+)?)/);
  if (single) return { min: scale(Number(single[1])), max: scale(Number(single[1])) };
  return null;
}

/**
 * Finds the option an answer means: exact text, then "Yes"/"No", then a number inside a range option
 * ("1" -> "0-1 Years", "3" -> "More than 2 years"), then one text containing the other. null = no sensible match.
 */
export function bestOptionMatch(answer: string, options: string[]): string | null {
  if (options.length === 0) return answer;
  const clean = answer.trim().toLowerCase();
  const exact = options.find((option) => option.trim().toLowerCase() === clean);
  if (exact) return exact;
  if (/^(yes|no)\b/.test(clean)) {
    const yesNo = options.find((option) => option.trim().toLowerCase().startsWith(clean.slice(0, clean.startsWith('yes') ? 3 : 2)));
    if (yesNo) return yesNo;
  }
  const number = clean.match(/^(\d+(?:\.\d+)?)\s*(years?|yrs?)?$/)?.[1];
  if (number !== undefined) {
    const value = Number(number);
    const inRange = options.find((option) => {
      const range = optionRange(option);
      return range !== null && value >= range.min && value <= range.max;
    });
    if (inRange) return inRange;
  }
  const containing = options.filter((option) => clean.includes(option.trim().toLowerCase()) || option.trim().toLowerCase().includes(clean));
  return containing.length === 1 ? (containing[0] ?? null) : null;
}

/** Yes for willingness questions when the user allowed it - but only if "Yes" is a valid answer. */
export function answerPreferenceQuestion(question: string, options: string[], autoAnswerPreferences: boolean): string | null {
  if (!autoAnswerPreferences || !PREFERENCE_QUESTION.test(question.toLowerCase())) return null;
  return matchOption('Yes', options);
}

/** Rule answers for very common questions. Returns null when the rule doesn't apply or isn't sure. */
export function answerFromRules(question: string, options: string[], facts: Facts, profile: CandidateProfile, autoAnswerPreferences = false): string | null {
  const lower = question.toLowerCase();
  if (facts.willingToRelocate === undefined || !/relocat/.test(lower)) {
    const preference = answerPreferenceQuestion(question, options, autoAnswerPreferences);
    if (preference) return preference;
  }
  let answer: string | null = null;
  // Units we don't store (rupees, months) are left to Gemini, which sees the full facts.
  if (/rupee|inr|\bper month\b|monthly/.test(lower)) return null;
  if (/expected\s*(ctc|salary|compensation)/.test(lower)) answer = formatOptional(facts.expectedCtcLpa);
  else if (/current\s*(ctc|salary|compensation)/.test(lower)) answer = formatOptional(facts.currentCtcLpa);
  else if (/notice\s*period/.test(lower)) {
    const days = facts.noticePeriodDays;
    answer = days === undefined ? null : formatNumber(/month/.test(lower) ? days / 30 : days);
  } else if (/relocat/.test(lower)) answer = facts.willingToRelocate === undefined ? null : facts.willingToRelocate ? 'Yes' : 'No';
  else if (/current\s*(location|city)|where.*(located|based)/.test(lower)) answer = facts.currentLocation || null;
  else if (/years?|experience/.test(lower)) answer = yearsForSkillQuestion(question, profile, facts);
  if (answer === null) return null;
  return bestOptionMatch(answer, options);
}

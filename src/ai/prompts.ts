/**
 * FILE: ai/prompts.ts
 * WHAT: The three Gemini prompts from BUILD_PROMPT §7 as plain functions. Each returns the text,
 *       Gemini's responseSchema, and the matching Zod schema.
 *       P2 = job match scorer (batched), P3 = screening-question answerer. (P1 lives in ai/profilePrompts.ts.)
 * CALLED BY: steps/2-buildProfile.ts, steps/6-scoreJobs.ts, steps/8-applyToJob.ts
 * IF IT BREAKS: wrong scores -> tune P2's scoring guide; made-up answers -> tighten P3's rules.
 */
import { z } from 'zod';
import { JOB_DESCRIPTION_CHARS_FOR_SCORING, PROFILE_CHARS_FOR_RECHECK, RESUME_CHARS_FOR_ANSWERS } from '../config';
import type { CandidateProfile, Facts, Job } from '../db/types';
import { workHistoryText } from '../matching/workHistory';
import type { GeminiPrompt } from './gemini';

// ---------------- P2: job match scorer ----------------
const scoreItemSchema = z.object({
  jobId: z.string(),
  score: z.number().min(0).max(100),
  dealBreaker: z.boolean(),
  reason: z.string(),
  missingSkills: z.array(z.string()),
  matchedSkills: z.array(z.string()).default([]),
});
const scoreListSchema = z.array(scoreItemSchema);
export type JobScore = z.infer<typeof scoreItemSchema>;

function profileSkillsText(profile: CandidateProfile): string {
  return profile.skills.map((skill) => (skill.years !== undefined ? `${skill.name} (${skill.years}y)` : skill.name)).join(', ');
}

/** The candidate block shared by the scorer and the answerer. */
function candidateText(profile: CandidateProfile): string {
  return `${profile.summary}
Current title: ${profile.currentTitle} | Total experience: ${profile.totalExperienceYears} yrs
Skills (years of use where known): ${profileSkillsText(profile)}
Work history (newest first):
${workHistoryText(profile.workHistory)}
Domains: ${(profile.domains ?? []).join(', ') || 'not stated'}
Target titles: ${profile.targetTitles.join(', ')}`;
}

export function jobScorerPrompt(profile: CandidateProfile, jobs: Job[]): GeminiPrompt<JobScore[]> {
  const jobsJson = jobs.map((job) => ({
    jobId: job.jobId, title: job.title, company: job.company, experienceText: job.experienceText, location: job.location,
    skills: job.skills, preferredSkills: job.preferredSkills ?? [], naukriMatchScore: job.naukriMatch ?? {},
    description: job.description.slice(0, JOB_DESCRIPTION_CHARS_FOR_SCORING),
  }));
  return {
    promptName: 'P2-score',
    system: `You are a strict technical recruiter. You score how well a candidate fits each job, using ONLY evidence
in the candidate's profile. Score honestly; a wrong application wastes the candidate's daily limit and reputation.

Work through each job in this order (silently):
1. ROLE: is this the same kind of role as the candidate's work history / target titles? (e.g. frontend vs backend,
   developer vs tester vs sales vs support). A different role family scores 0-40 even if a few keywords overlap.
2. MUST-HAVES: the skills the job requires - words like "must", "required", "mandatory", "strong", "hands-on",
   the first skills listed, and "preferredSkills" (Naukri's own must-have tags). Nice-to-haves are "good to have",
   "plus", "bonus", "preferred but not required".
3. EVIDENCE for each must-have: strong = used in a job in the work history (years shown); weak = only listed in
   skills; none = absent. Treat close equivalents as a match (React/React.js, Postgres/PostgreSQL, AWS/cloud
   when the job says "any cloud"), but NOT different tools (Angular is not React, Java is not JavaScript).
4. SENIORITY: compare the job's experience range with the candidate's total years and the level of the title
   (lead / architect / manager roles need that level in the work history).

Scoring guide:
90-100 = same role, every must-have with strong evidence, seniority fits - would surely be shortlisted
75-89  = same role, must-haves covered (at most one weak), only nice-to-haves missing
60-74  = same role, one must-have missing or several only weak
40-59  = related role or two+ must-haves missing
0-39   = different role / domain, or most must-haves missing
"naukriMatchScore" is Naukri's own check of this candidate (true = match, false = no match) - weigh it.
Set dealBreaker=true if the job hard-requires something the candidate clearly lacks (mandatory degree or
certification, a core must-have skill with no evidence at all, a different role family, seniority off by > 3 years,
a specific clearance / language / visa).

"matchedSkills": the job's important skills the candidate HAS (job's wording, max 8).
"missingSkills": the job's must-haves the candidate does NOT have (max 6). Never list a skill that appears in the
candidate's skills or work history under any spelling.
"reason": <= 20 words, concrete, e.g. "Frontend role; React 3y and TypeScript match; lacks GraphQL (must-have)".`,
    user: `CANDIDATE:
${candidateText(profile)}

JOBS (JSON):
${JSON.stringify(jobsJson)}

Return JSON: [{ "jobId": string, "score": int, "dealBreaker": boolean, "reason": string,
               "matchedSkills": string[], "missingSkills": string[] }]`,
    responseSchema: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          jobId: { type: 'STRING' }, score: { type: 'INTEGER' }, dealBreaker: { type: 'BOOLEAN' },
          reason: { type: 'STRING' }, matchedSkills: { type: 'ARRAY', items: { type: 'STRING' } },
          missingSkills: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['jobId', 'score', 'dealBreaker', 'reason', 'matchedSkills', 'missingSkills'],
      },
    },
    zodSchema: scoreListSchema,
  };
}

// ---------------- P3: screening-question answerer ----------------
const answerSchema = z.object({
  answer: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  basis: z.string(),
});
export type GeminiAnswer = z.infer<typeof answerSchema>;

export interface AnswerPromptInput {
  facts: Facts;
  profile: CandidateProfile;
  jobTitle: string;
  company: string;
  question: string;
  inputType: string;
  options: string[];
  autoAnswerPreferences: boolean;
  profileText?: string;  // the site's own profile text (Naukri or LinkedIn)
  profileSite?: string;
  otherProfileText?: string;  // the other site's profile (re-check pass)
  otherProfileSite?: string;
  fullDetail?: boolean;       // re-check pass: send the WHOLE resume and profiles, not excerpts
}

export function screeningAnswerPrompt(input: AnswerPromptInput): GeminiPrompt<GeminiAnswer> {
  const chars = input.fullDetail ? PROFILE_CHARS_FOR_RECHECK : RESUME_CHARS_FOR_ANSWERS;
  const otherProfile = input.fullDetail && input.otherProfileText
    ? `\n${input.otherProfileSite ?? 'OTHER'} PROFILE (full): ${input.otherProfileText.slice(0, chars)}`
    : '';
  return {
    promptName: 'P3-answer',
    system: `You fill job application screening questions on behalf of a candidate, fully automatically - nobody
will review your answer, so ALWAYS give the best possible answer based on the facts, resume and Naukri profile
(facts win if they disagree). Never invent employers, degrees, certifications or skills the candidate does not have.

Formatting rules:
- Numeric questions (years, LPA, days): digits only, e.g. "4" or "12.5".
- Option questions: return one option EXACTLY as written in OPTIONS (several only for checkbox).
- Yes/No questions: "Yes" or "No".
- Free text: write like a real person filling a form - plain, professional, on the point.
  * Simple questions (which / what / do you / how many / list): a few words, max 12, one line.
    "Which of these are you familiar with: A, B, C?" -> just the ones in the resume: "A, B, C".
  * Questions that need an explanation (describe / explain / why / tell us about / how did you):
    1-2 short sentences, max 35 words. Concrete, no fluff.
  * Every skill, tool, company, project and number you mention MUST appear in the resume or Naukri profile.
  * No brackets, no buzzwords ("passionate", "proficient", "leverage"), no exaggeration.
- "answer" is always a list: one item, or several only for checkbox questions.

How to answer common question types (confidence >= 0.8 when you follow these):
- "Do you have experience in X?" -> "Yes" if X (or a close synonym) is in the skills or resume, else "No".
- "Years of experience in X?" -> use X's years in PROFILE SKILLS when shown; otherwise add up the WORK HISTORY
  jobs where X was used (round to whole or .5 years). If X is not in the resume or skills at all, answer "0".
- Total experience, CTC, notice period, location, phone, email -> from CANDIDATE FACTS.
- Degree / graduation year / college questions -> from the resume's education section (or the profile's
  education section if the resume has none).
- Personal details (date of birth, gender, marital status, category, languages, address, disability, passport,
  work permit, military service) -> look in EVERY profile's personal-details section; copy the value as written
  (dates of birth in the format the question asks, else DD/MM/YYYY).
- Combined skills ("Java Selenium", "React with TypeScript") -> years of the jobs where those were used together;
  if only one part was used, the years of that part. Never "0" when any part is in the work history.
- OPTION questions (chips / radio / dropdown): ALWAYS pick the option that best matches the candidate's resume,
  e.g. "In which domain have you worked?" with options [BPM, IT Services, Technology] -> the one closest to their
  employers / projects. Never refuse an option question; confidence = how well the option fits.
  If the question asks for several ("which of the following... are you familiar with", "select all"), return
  EVERY option that matches the resume, each exactly as written.
- Open text questions ("Tell us about yourself", "Why should we hire you?", "Describe a project") -> 1-2 short
  sentences from the resume, max 35 words. Never a paragraph.
${input.autoAnswerPreferences ? '- Willingness / preference questions (relocate, shifts, work from office, travel, immediate joining, bond, background check) -> "Yes" unless the facts say otherwise.\n' : ''}- Only a PERSONAL NUMBER that is absent everywhere (e.g. exact current salary, notice days) gets confidence 0 -
  never invent those. Everything else must be answered.`,
    user: `CANDIDATE FACTS:
${JSON.stringify(input.facts)}
PROFILE SKILLS (years of use where known): ${profileSkillsText(input.profile)}
WORK HISTORY (newest first):
${workHistoryText(input.profile.workHistory)}
RESUME${input.fullDetail ? ' (full)' : ' (excerpt)'}: ${input.profile.resumeText.slice(0, chars)}
${input.profileSite ?? 'NAUKRI'} PROFILE${input.fullDetail ? ' (full)' : ' (excerpt)'}: ${(input.profileText ?? input.profile.naukriProfileText).slice(0, chars)}${otherProfile}
JOB: ${input.jobTitle} at ${input.company}

QUESTION: ${input.question}
INPUT TYPE: ${input.inputType}
OPTIONS: ${input.options.length > 0 ? JSON.stringify(input.options) : 'none'}

Return JSON: { "answer": string[], "confidence": number (0-1), "basis": "which fact you used" }`,
    responseSchema: {
      type: 'OBJECT',
      properties: { answer: { type: 'ARRAY', items: { type: 'STRING' } }, confidence: { type: 'NUMBER' }, basis: { type: 'STRING' } },
      required: ['answer', 'confidence', 'basis'],
    },
    zodSchema: answerSchema,
  };
}

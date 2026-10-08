/**
 * FILE: ai/prompts.ts
 * WHAT: The three Gemini prompts from BUILD_PROMPT §7 as plain functions. Each returns the text,
 *       Gemini's responseSchema, and the matching Zod schema.
 *       P2 = job match scorer (batched), P3 = screening-question answerer. (P1 lives in ai/profilePrompts.ts.)
 * CALLED BY: steps/2-buildProfile.ts, steps/6-scoreJobs.ts, steps/8-applyToJob.ts
 * IF IT BREAKS: wrong scores -> tune P2's scoring guide; made-up answers -> tighten P3's rules.
 */
import { z } from 'zod';
import { JOB_DESCRIPTION_CHARS_FOR_SCORING, RESUME_CHARS_FOR_ANSWERS } from '../config';
import type { CandidateProfile, Facts, Job } from '../db/types';
import type { GeminiPrompt } from './gemini';

// ---------------- P2: job match scorer ----------------
const scoreItemSchema = z.object({
  jobId: z.string(),
  score: z.number().min(0).max(100),
  dealBreaker: z.boolean(),
  reason: z.string(),
  missingSkills: z.array(z.string()),
});
const scoreListSchema = z.array(scoreItemSchema);
export type JobScore = z.infer<typeof scoreItemSchema>;

function profileSkillsText(profile: CandidateProfile): string {
  return profile.skills.map((skill) => (skill.years !== undefined ? `${skill.name} (${skill.years})` : skill.name)).join(', ');
}

export function jobScorerPrompt(profile: CandidateProfile, jobs: Job[]): GeminiPrompt<JobScore[]> {
  const jobsJson = jobs.map((job) => ({
    jobId: job.jobId, title: job.title, company: job.company, experienceText: job.experienceText, location: job.location,
    skills: job.skills, preferredSkills: job.preferredSkills ?? [], naukriMatchScore: job.naukriMatch ?? {},
    description: job.description.slice(0, JOB_DESCRIPTION_CHARS_FOR_SCORING),
  }));
  return {
    promptName: 'P2-score',
    system: `You are a strict technical recruiter. You score how well a candidate fits each job.
Score honestly; a wrong application wastes the candidate's daily limit.

Scoring guide:
90-100 = core skills and seniority match, candidate would be shortlisted
70-89  = strong match, 1-2 minor gaps
50-69  = partial match, notable gaps
0-49   = poor fit or different role/domain
"preferredSkills" are the job's must-have skills; missing several of them is a notable gap.
"naukriMatchScore" is Naukri's own check of this candidate (true = match, false = no match) - weigh it.
Set dealBreaker=true if the job hard-requires something the candidate clearly lacks
(mandatory degree/certification, very different domain, seniority off by > 3 years, specific clearance).`,
    user: `CANDIDATE PROFILE:
${profile.summary}
Title: ${profile.currentTitle} | Experience: ${profile.totalExperienceYears} yrs
Skills: ${profileSkillsText(profile)}
Target titles: ${profile.targetTitles.join(', ')}

JOBS (JSON):
${JSON.stringify(jobsJson)}

Return JSON: [{ "jobId": string, "score": int, "dealBreaker": boolean,
               "reason": "<= 20 words, concrete", "missingSkills": string[] }]`,
    responseSchema: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          jobId: { type: 'STRING' }, score: { type: 'INTEGER' }, dealBreaker: { type: 'BOOLEAN' },
          reason: { type: 'STRING' }, missingSkills: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['jobId', 'score', 'dealBreaker', 'reason', 'missingSkills'],
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
}

export function screeningAnswerPrompt(input: AnswerPromptInput): GeminiPrompt<GeminiAnswer> {
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
- "Years of experience in X?" -> estimate from the resume's employment dates in the jobs where X was used
  (round to whole or .5 years). If X is not in the resume or skills at all, answer "0".
- Total experience, CTC, notice period, location, phone, email -> from CANDIDATE FACTS.
- Degree / graduation year / college questions -> from the resume's education section only.
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
PROFILE SKILLS: ${profileSkillsText(input.profile)}
RESUME (excerpt): ${input.profile.resumeText.slice(0, RESUME_CHARS_FOR_ANSWERS)}
${input.profileSite ?? 'NAUKRI'} PROFILE (excerpt): ${(input.profileText ?? input.profile.naukriProfileText).slice(0, RESUME_CHARS_FOR_ANSWERS)}
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

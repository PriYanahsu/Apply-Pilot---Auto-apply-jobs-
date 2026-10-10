/**
 * FILE: ai/profilePrompts.ts
 * WHAT: The two "read the candidate" prompts:
 *       P1  = resume parser (the PRIMARY source of everything about you)
 *       P1b = profile page parser for Naukri or LinkedIn (fills what the resume doesn't say)
 *       Both only extract - never guess. Missing values come back as null.
 * CALLED BY: steps/2-buildProfile.ts
 */
import { z } from 'zod';
import type { GeminiPrompt } from './gemini';

const NO_GUESSING = 'Use only information present in the text. If something is missing, return null. Do not infer or embellish.';
const CTC_RULES = 'CTC values are yearly, in lakhs per annum (LPA): "8,50,000" -> 8.5, "12 Lacs" -> 12. Notice period in days: "1 month" -> 30, "Immediate" / "15 days or less" -> 15 only if stated.';

const skillListSchema = z.array(z.object({ name: z.string(), years: z.number().nullable() }));
const skillListResponse = { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, years: { type: 'NUMBER', nullable: true } }, required: ['name', 'years'] } };
const nullableString = { type: 'STRING', nullable: true };
const nullableNumber = { type: 'NUMBER', nullable: true };

// Personal details both prompts can return (all nullable).
const personalSchema = {
  phone: z.string().nullable(),
  currentLocation: z.string().nullable(),
  totalExperienceYears: z.number().nullable(),
  currentCtcLpa: z.number().nullable(),
  expectedCtcLpa: z.number().nullable(),
  noticePeriodDays: z.number().nullable(),
};
const personalResponse = {
  phone: nullableString, currentLocation: nullableString, totalExperienceYears: nullableNumber,
  currentCtcLpa: nullableNumber, expectedCtcLpa: nullableNumber, noticePeriodDays: nullableNumber,
};

// ---------------- P1: resume parser ----------------
const resumeSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  currentTitle: z.string().nullable(),
  ...personalSchema,
  skills: skillListSchema,
  targetTitles: z.array(z.string()),
  searchKeywords: z.array(z.string()),
  education: z.array(z.object({ degree: z.string(), field: z.string().nullable(), year: z.number().nullable() })),
  // Optional so an older / smaller model that leaves them out still works.
  workHistory: z.array(z.object({
    title: z.string(), company: z.string(), start: z.string().nullable(), end: z.string().nullable(), skills: z.array(z.string()),
  })).default([]),
  domains: z.array(z.string()).default([]),
  summary: z.string(),
});
export type ParsedResume = z.infer<typeof resumeSchema>;

export function resumeParserPrompt(resumeText: string): GeminiPrompt<ParsedResume> {
  return {
    promptName: 'P1-resume',
    system: `You extract structured data from resumes. ${NO_GUESSING}`,
    user: `Extract from the resume below:
- name, email, phone, currentLocation (city), currentTitle
- totalExperienceYears (number, computed from employment dates if not stated)
- currentCtcLpa, expectedCtcLpa, noticePeriodDays (usually NOT in a resume - then null). ${CTC_RULES}
- skills: list of {name, years|null} - technical and domain skills only, most important first, max 40.
  years only when the resume states it ("5 years of Java"); otherwise null (it is computed from workHistory).
  Use the common name ("React", not "React.js Library"); one entry per skill.
- workHistory: every job, newest first: {title, company, start "YYYY-MM"|null, end "YYYY-MM"|"present"|null,
  skills: the skills/tools the resume says were used IN THAT JOB (from its bullets / tech stack)}.
  Internships count. A month that is not written -> use "-01" (e.g. "2021" -> "2021-01").
- domains: industries / business domains worked in (e.g. "Fintech", "E-commerce", "Healthcare"), max 5
- targetTitles: 3-5 job titles this person is realistically qualified for today, matching their seniority
  (e.g. 1 yr experience -> no "Senior" / "Lead" titles)
- searchKeywords: 3-5 job-board search phrases (2-3 words each), the role names recruiters actually post
- education: list of {degree, field, year|null}
- summary: 3 factual sentences

RESUME:
"""${resumeText}"""`,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        name: nullableString, email: nullableString, currentTitle: nullableString, ...personalResponse,
        skills: skillListResponse,
        targetTitles: { type: 'ARRAY', items: { type: 'STRING' } },
        searchKeywords: { type: 'ARRAY', items: { type: 'STRING' } },
        education: { type: 'ARRAY', items: { type: 'OBJECT', properties: { degree: { type: 'STRING' }, field: nullableString, year: nullableNumber }, required: ['degree', 'field', 'year'] } },
        workHistory: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { title: { type: 'STRING' }, company: { type: 'STRING' }, start: nullableString, end: nullableString, skills: { type: 'ARRAY', items: { type: 'STRING' } } },
            required: ['title', 'company', 'start', 'end', 'skills'],
          },
        },
        domains: { type: 'ARRAY', items: { type: 'STRING' } },
        summary: { type: 'STRING' },
      },
      required: ['name', 'email', 'currentTitle', ...Object.keys(personalResponse), 'skills', 'workHistory', 'domains', 'targetTitles', 'searchKeywords', 'education', 'summary'],
    },
    zodSchema: resumeSchema,
  };
}

// ---------------- P1b: Naukri profile parser ----------------
const naukriProfileDetailsSchema = z.object({
  headline: z.string().nullable(),
  ...personalSchema,
  preferredLocations: z.array(z.string()),
  skills: skillListSchema,
});
export type ParsedNaukriProfile = z.infer<typeof naukriProfileDetailsSchema>;

export function naukriProfileParserPrompt(profilePageText: string, site: 'Naukri.com' | 'LinkedIn' = 'Naukri.com'): GeminiPrompt<ParsedNaukriProfile> {
  return {
    promptName: site === 'LinkedIn' ? 'P1b-linkedin-profile' : 'P1b-naukri-profile',
    system: `You extract structured data from the text of a candidate's own ${site} profile page. ${NO_GUESSING} Ignore ads, menus, suggested people and job recommendations.`,
    user: `Extract:
- headline (resume headline), phone, currentLocation, preferredLocations
- totalExperienceYears ("4 Years 6 Months" -> 4.5)
- currentCtcLpa, expectedCtcLpa, noticePeriodDays. ${CTC_RULES}
- skills: key skills and IT skills, as {name, years|null} (years from the IT skills table if shown)

NAUKRI PROFILE PAGE TEXT:
"""${profilePageText}"""`,
    responseSchema: {
      type: 'OBJECT',
      properties: { headline: nullableString, ...personalResponse, preferredLocations: { type: 'ARRAY', items: { type: 'STRING' } }, skills: skillListResponse },
      required: ['headline', ...Object.keys(personalResponse), 'preferredLocations', 'skills'],
    },
    zodSchema: naukriProfileDetailsSchema,
  };
}

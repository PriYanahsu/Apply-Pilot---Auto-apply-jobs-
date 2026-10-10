/**
 * FILE: steps/2-buildProfile.ts
 * WHAT: Reads everything about you, automatically - no form to fill:
 *         1. your RESUME (Gemini P1)            -> the primary source
 *         2. your NAUKRI PROFILE page (Gemini P1b on the page text, plus scraped skills) -> fills the gaps
 *       Merge rule: resume value first; if the resume doesn't say it (CTC, notice period...), use Naukri.
 *       Skills are unioned and tagged resume / naukri / both. Number conflicts are shown in the UI.
 * CALLED BY: orchestrator/runPipeline.ts (step BUILD_PROFILE, runs first when the profile is missing or > 1 day old),
 *            background (REFRESH_PROFILE)
 * READS: settings.resumeText    WRITES: db.profile (incl. autoFacts), empty keywords / experience get pre-filled
 */
import { askGemini } from '../ai/gemini';
import { naukriProfileParserPrompt, resumeParserPrompt, type ParsedNaukriProfile, type ParsedResume } from '../ai/profilePrompts';
import { NAUKRI_PROFILE_URL } from '../config';
import { db, getSettings, saveSettings } from '../db/database';
import type { CandidateProfile, FactSource, Facts, ProfileConflict, Skill, WorkEntry } from '../db/types';
import { normalizeSkill } from '../matching/skillSynonyms';
import { fillSkillYears } from '../matching/workHistory';
import { isLoginUrl, navigateWorkerTab, sendToContent } from '../orchestrator/workerTab';
import { makeError } from '../shared/errors';
import { log } from '../shared/log';
import { naukriProfileSchema, type NaukriProfile } from '../shared/messages';

export async function buildProfile(): Promise<CandidateProfile> {
  const settings = await getSettings();
  if (!settings.resumeText) throw makeError('SETUP_MISSING', 'Upload your resume in the Setup tab first.');

  await log('2-profile', 'Reading your resume (Gemini P1)');
  const resume = await askGemini(resumeParserPrompt(settings.resumeText));

  await log('2-profile', 'Opening your Naukri profile to fill in what the resume does not say');
  const finalUrl = await navigateWorkerTab(NAUKRI_PROFILE_URL);
  if (isLoginUrl(finalUrl)) throw makeError('NOT_LOGGED_IN', 'Please log in to Naukri in this Chrome window, then try again.');
  const scraped = await sendToContent({ type: 'SCRAPE_PROFILE' }, naukriProfileSchema, { step: '2-profile' });
  const naukri = await askGemini(naukriProfileParserPrompt(scraped.fullText));

  const profile = mergeProfile(resume, naukri, scraped, settings.resumeText);
  await db.profile.put(profile);
  await prefillSearchSettings(profile);
  const known = Object.keys(profile.autoFacts).length;
  await log('2-profile', `Profile saved: ${profile.skills.length} skills, ${known} details known, ${profile.conflicts.length} conflicts`, { data: profile.factSources });
  return profile;
}

export function mergeSkills(resumeSkills: ParsedResume['skills'], naukriSkills: { name: string; years?: number | null }[]): Skill[] {
  const merged = new Map<string, Skill>();
  for (const skill of resumeSkills) {
    const key = normalizeSkill(skill.name);
    const existing = merged.get(key);
    // First mention keeps its name and order; a later one only fills a missing number.
    if (existing) existing.years ??= skill.years ?? undefined;
    else if (key) merged.set(key, { name: skill.name, years: skill.years ?? undefined, source: 'resume' });
  }
  for (const skill of naukriSkills) {
    const key = normalizeSkill(skill.name);
    const existing = merged.get(key);
    if (!existing) merged.set(key, { name: skill.name, years: skill.years ?? undefined, source: 'naukri' });
    // Resume years first; Naukri only fills a missing number.
    else merged.set(key, { ...existing, years: existing.years ?? skill.years ?? undefined, source: existing.source === 'resume' ? 'both' : existing.source });
  }
  return Array.from(merged.values());
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/** Resume first, Naukri for the gaps. Records where each value came from. */
export function mergeFacts(resume: ParsedResume, naukri: ParsedNaukriProfile, scraped: NaukriProfile) {
  const autoFacts: Facts = {};
  const factSources: Partial<Record<keyof Facts, FactSource>> = {};
  function pick<K extends keyof Facts>(key: K, fromResume: Facts[K] | null | undefined, fromNaukri: Facts[K] | null | undefined) {
    if (hasValue(fromResume)) {
      autoFacts[key] = fromResume as Facts[K];
      factSources[key] = 'resume';
    } else if (hasValue(fromNaukri)) {
      autoFacts[key] = fromNaukri as Facts[K];
      factSources[key] = 'naukri';
    }
  }
  pick('fullName', resume.name, scraped.name);
  pick('email', resume.email, null);
  pick('phone', resume.phone, naukri.phone ?? scraped.phone);
  pick('currentLocation', resume.currentLocation, naukri.currentLocation);
  pick('preferredLocations', null, naukri.preferredLocations.length > 0 ? naukri.preferredLocations : null);
  pick('totalExperienceYears', resume.totalExperienceYears, naukri.totalExperienceYears ?? scraped.totalExperienceYears);
  pick('currentCtcLpa', resume.currentCtcLpa, naukri.currentCtcLpa ?? scraped.currentCtcLpa);
  pick('expectedCtcLpa', resume.expectedCtcLpa, naukri.expectedCtcLpa ?? scraped.expectedCtcLpa);
  pick('noticePeriodDays', resume.noticePeriodDays, naukri.noticePeriodDays ?? scraped.noticePeriodDays);
  pick('dateOfBirth', resume.dateOfBirth, naukri.dateOfBirth);
  pick('gender', resume.gender, naukri.gender);
  return { autoFacts, factSources };
}

function findConflicts(resume: ParsedResume, naukri: ParsedNaukriProfile): ProfileConflict[] {
  const conflicts: ProfileConflict[] = [];
  const resumeYears = resume.totalExperienceYears;
  const naukriYears = naukri.totalExperienceYears;
  if (resumeYears !== null && naukriYears !== null && Math.abs(resumeYears - naukriYears) >= 1) {
    conflicts.push({ field: 'Total experience (years)', resumeValue: String(resumeYears), naukriValue: String(naukriYears) });
  }
  return conflicts;
}

/** The parser's work history without nulls; skills used in a job are also added to the skill list. */
export function toWorkHistory(resume: ParsedResume): WorkEntry[] {
  return resume.workHistory.map((entry) => ({
    title: entry.title, company: entry.company, start: entry.start ?? undefined, end: entry.end ?? undefined, skills: entry.skills,
  }));
}

export function mergeProfile(resume: ParsedResume, naukri: ParsedNaukriProfile, scraped: NaukriProfile, resumeText: string): CandidateProfile {
  const currentTitle = resume.currentTitle ?? naukri.headline ?? scraped.headline;
  const naukriSkills = [...naukri.skills, ...scraped.itSkills, ...scraped.keySkills.map((name) => ({ name, years: undefined }))];
  const { autoFacts, factSources } = mergeFacts(resume, naukri, scraped);
  const workHistory = toWorkHistory(resume);
  // Skills named only inside a job's bullets still count as resume skills.
  const skillsFromJobs = workHistory.flatMap((entry) => entry.skills).map((name) => ({ name, years: null }));
  return {
    id: 'main',
    name: autoFacts.fullName ?? '',
    summary: resume.summary,
    currentTitle,
    totalExperienceYears: autoFacts.totalExperienceYears ?? 0,
    skills: fillSkillYears(mergeSkills([...resume.skills, ...skillsFromJobs], naukriSkills), workHistory),
    preferredLocations: naukri.preferredLocations,
    targetTitles: Array.from(new Set([...resume.targetTitles, currentTitle].filter(Boolean))),
    searchKeywords: resume.searchKeywords,
    workHistory,
    domains: resume.domains,
    resumeText,
    naukriProfileText: scraped.fullText,
    conflicts: findConflicts(resume, naukri),
    autoFacts,
    factSources,
    naukriSyncedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Only fills EMPTY search settings (keywords, experience). Never overwrites what you set. */
async function prefillSearchSettings(profile: CandidateProfile): Promise<void> {
  const settings = await getSettings();
  await saveSettings({
    keywords: settings.keywords.length > 0 ? settings.keywords : profile.searchKeywords,
    experienceYears: settings.experienceYears || Math.floor(profile.totalExperienceYears),
  });
}

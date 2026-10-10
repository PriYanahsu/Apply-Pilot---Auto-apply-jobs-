/**
 * FILE: steps/linkedin/li-2-buildProfile.ts
 * WHAT: "Read my LinkedIn profile": same idea as Naukri - your RESUME first (Gemini P1), then your own LinkedIn
 *       profile page (linkedin.com/in/me, read by Gemini P1b) for anything the resume doesn't say.
 *       Saved as profile.linkedin and used for LinkedIn runs. If you have no profile yet, this creates it.
 * CALLED BY: orchestrator/runPipeline.ts (step LI_BUILD_PROFILE: Setup button, or the first LinkedIn run)
 */
import { askGemini } from '../../ai/gemini';
import { naukriProfileParserPrompt, resumeParserPrompt } from '../../ai/profilePrompts';
import { LINKEDIN_LOGIN_URL_MARKERS, LINKEDIN_MY_PROFILE_URL } from '../../config';
import { db, getSettings, saveSettings } from '../../db/database';
import type { CandidateProfile, FactSource, Facts, LinkedInProfileData, Skill } from '../../db/types';
import { normalizeSkill } from '../../matching/skillSynonyms';
import { navigateWorkerTab, sendToContent } from '../../orchestrator/workerTab';
import { makeError } from '../../shared/errors';
import { log } from '../../shared/log';
import { linkedInProfilePageSchema, type NaukriProfile } from '../../shared/messages';
import { mergeFacts, mergeProfile, toWorkHistory } from '../2-buildProfile';
import { fillSkillYears } from '../../matching/workHistory';

/** Adds LinkedIn skills you don't already have (from resume / Naukri) to the skill list. */
function addLinkedInSkills(skills: Skill[], linkedInSkills: { name: string; years: number | null }[]): Skill[] {
  const known = new Set(skills.map((skill) => normalizeSkill(skill.name)));
  const added = linkedInSkills.filter((skill) => !known.has(normalizeSkill(skill.name))).map((skill) => ({ name: skill.name, years: skill.years ?? undefined, source: 'linkedin' as const }));
  return [...skills, ...added];
}

/** mergeFacts labels the non-resume source 'naukri'; here that source is LinkedIn. */
function asLinkedInSources(sources: Partial<Record<keyof Facts, FactSource>>): Partial<Record<keyof Facts, FactSource>> {
  return Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source === 'naukri' ? 'linkedin' : source]));
}

export async function buildLinkedInProfile(): Promise<CandidateProfile> {
  const settings = await getSettings();
  if (!settings.resumeText) throw makeError('SETUP_MISSING', 'Upload your resume in the Setup tab first.');

  await log('li-2-profile', 'Reading your resume (Gemini P1)');
  const resume = await askGemini(resumeParserPrompt(settings.resumeText));

  await log('li-2-profile', 'Opening your LinkedIn profile to fill in what the resume does not say');
  const finalUrl = await navigateWorkerTab(LINKEDIN_MY_PROFILE_URL);
  if (LINKEDIN_LOGIN_URL_MARKERS.some((marker) => finalUrl.includes(marker))) throw makeError('NOT_LOGGED_IN', 'Please log in to LinkedIn in this Chrome window, then try again.');
  const page = await sendToContent({ type: 'LI_SCRAPE_PROFILE' }, linkedInProfilePageSchema, { step: 'li-2-profile' });

  await log('li-2-profile', 'AI is reading your LinkedIn profile');
  const parsed = await askGemini(naukriProfileParserPrompt(page.fullText, 'LinkedIn'));
  const pageStub: NaukriProfile = { name: page.name, headline: page.headline, keySkills: [], itSkills: [], employmentText: '', currentLocation: '', preferredLocations: [], phone: '', fullText: page.fullText };
  const { autoFacts, factSources } = mergeFacts(resume, parsed, pageStub);
  const linkedin: LinkedInProfileData = {
    profileText: page.fullText, autoFacts, factSources: asLinkedInSources(factSources),
    headline: parsed.headline ?? page.headline, syncedAt: new Date().toISOString(),
  };

  const existing = await db.profile.get('main'); // raw: your Setup edits stay separate (see getProfile)
  const base = existing ?? { ...mergeProfile(resume, parsed, pageStub, settings.resumeText), naukriProfileText: '', naukriSyncedAt: undefined, autoFacts, factSources: asLinkedInSources(factSources) };
  // The resume was just re-read: keep its newest work history (and the per-skill years it gives).
  const workHistory = toWorkHistory(resume);
  const skills = fillSkillYears(addLinkedInSkills(base.skills, parsed.skills), workHistory);
  const profile: CandidateProfile = { ...base, skills, workHistory, domains: resume.domains, linkedin, updatedAt: new Date().toISOString() };
  await db.profile.put(profile);
  if (settings.keywords.length === 0) await saveSettings({ keywords: resume.searchKeywords });
  await log('li-2-profile', `LinkedIn profile saved: ${Object.keys(autoFacts).length} details known, ${parsed.skills.length} skills on LinkedIn`, { data: linkedin.factSources });
  return profile;
}

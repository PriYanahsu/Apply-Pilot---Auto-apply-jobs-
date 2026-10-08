/**
 * FILE: steps/4-filterJobs.ts
 * WHAT: Applies the cheap hard filters (no AI) to every 'found' job -> 'passed_filters' or 'filtered_out'.
 * CALLED BY: orchestrator/runPipeline.ts (step FILTERING)
 * READS: db.jobs (status 'found'), db.profile, settings     WRITES: job.status, job.filterReason
 * IF IT BREAKS: look at the Jobs tab "reason" column; rules are in matching/hardFilters.ts.
 */
import { db, getEffectiveFacts, getProfile, getSettings, jobPlatform, updateJob } from '../db/database';
import type { CandidateProfile, Job, Settings } from '../db/types';
import { checkHardFilters } from '../matching/hardFilters';
import { bumpCounter } from '../orchestrator/runState';
import { makeError } from '../shared/errors';
import { log } from '../shared/log';

export function filterJob(job: Job, settings: Settings, profile: CandidateProfile): string | null {
  return checkHardFilters(job, {
    excludeTitleWords: settings.excludeTitleWords,
    excludeCompanies: settings.excludeCompanies,
    locations: settings.locations,
    candidateYears: getEffectiveFacts(settings, profile, jobPlatform(job)).totalExperienceYears ?? profile.totalExperienceYears,
  }, {
    skillNames: profile.skills.map((skill) => skill.name),
    targetTitles: profile.targetTitles,
  });
}

export async function filterJobs(runId: number): Promise<void> {
  const settings = await getSettings();
  const profile = await getProfile();
  if (!profile) throw makeError('SETUP_MISSING', 'No profile yet. Click "Refresh profile" in the Setup tab.');

  const jobs = await db.jobs.where('status').equals('found').toArray();
  let passed = 0;
  for (const job of jobs) {
    const reason = filterJob(job, settings, profile);
    if (reason) {
      await updateJob(job.jobId, { status: 'filtered_out', filterReason: reason });
      await bumpCounter(runId, 'filtered');
      await log('4-filter', `Filtered out: ${reason}`, { jobId: job.jobId });
    } else {
      await updateJob(job.jobId, { status: 'passed_filters' });
      passed += 1;
    }
  }
  await log('4-filter', `${passed} of ${jobs.length} jobs passed the hard filters`);
}

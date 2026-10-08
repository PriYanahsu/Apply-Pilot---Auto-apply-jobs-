/**
 * FILE: steps/5-enrichJobs.ts
 * WHAT: Opens each job that passed the filters and reads the FULL description, skills, the detail page's
 *       posted date (freshness gate #2) and how to apply (Naukri / company site / already applied).
 * CALLED BY: orchestrator/runPipeline.ts (step ENRICHING)
 * READS: db.jobs (status 'passed_filters')
 * WRITES: description, skills, status -> 'enriched' | 'external' | 'already_applied' | 'stale' | 'failed'
 * IF IT BREAKS: Debug > Snapshots shows the page when a selector was missing.
 */
import { db, getSettings, jobPlatform, updateJob } from '../db/database';
import type { Job, Settings } from '../db/types';
import { isJobTooOld, parsePostedText } from '../matching/postedDate';
import { handleJobError, resetSelectorStreak } from '../orchestrator/jobFailures';
import { bumpCounter, checkpoint, waitWithCheckpoints } from '../orchestrator/runState';
import { DELAY_BETWEEN_JOB_PAGES_MS } from '../config';
import { randomBetween } from '../shared/sleep';
import { navigateWorkerTab, sendToContent } from '../orchestrator/workerTab';
import { log } from '../shared/log';
import { jobDetailSchema } from '../shared/messages';

export async function enrichJobs(runId: number): Promise<void> {
  const jobs = (await db.jobs.where('status').equals('passed_filters').toArray()).filter((job) => jobPlatform(job) === 'naukri');
  await log('5-enrich', `Opening ${jobs.length} job pages`);
  for (const job of jobs) {
    await checkpoint(runId);
    try {
      await enrichOneJob(runId, job);
      await resetSelectorStreak(runId);
    } catch (error) {
      await handleJobError(runId, job.jobId, '5-enrich', error);
    }
    await waitWithCheckpoints(runId, randomBetween(DELAY_BETWEEN_JOB_PAGES_MS.min, DELAY_BETWEEN_JOB_PAGES_MS.max));
  }
}

/** Which of Naukri's own match checks failed (only the ones the user chose to respect), or ''. */
export function naukriMismatch(naukriMatch: Record<string, boolean>, skip: Settings['skipWhenNaukriSaysNo']): string {
  const failed: string[] = [];
  if (skip.location && naukriMatch.location === false) failed.push('Location ✗');
  if (skip.workExperience && naukriMatch['work experience'] === false) failed.push('Work Experience ✗');
  if (skip.keyskills && naukriMatch.keyskills === false) failed.push('Keyskills ✗');
  return failed.join(', ');
}

async function enrichOneJob(runId: number, job: Job): Promise<void> {
  const settings = await getSettings();
  await navigateWorkerTab(job.url);
  const detail = await sendToContent({ type: 'SCRAPE_JOB_DETAIL' }, jobDetailSchema, { step: '5-enrich', jobId: job.jobId });

  // Freshness gate #2: the detail page date is more precise than the card. Fall back to the card date.
  const detailPostedAt = parsePostedText(detail.postedText);
  const postedAt = detailPostedAt ?? job.postedAt;
  if (isJobTooOld(postedAt, settings.maxJobAgeDays)) {
    await updateJob(job.jobId, { status: 'stale', postedAt, filterReason: `Detail page says posted "${detail.postedText}"` });
    await log('5-enrich', `Stale on detail page ("${detail.postedText}")`, { jobId: job.jobId });
    return;
  }

  const skills = Array.from(new Set([...job.skills, ...detail.skills]));
  const extraInfo = [detail.role && `Role: ${detail.role}`, detail.industry && `Industry: ${detail.industry}`, detail.education && `Education: ${detail.education}`]
    .filter(Boolean).join('\n');
  const changes: Partial<Job> = {
    description: [detail.description, extraInfo].filter(Boolean).join('\n\n'),
    skills, postedAt, experienceText: job.experienceText || detail.experienceText,
    location: job.location || detail.location, preferredSkills: detail.preferredSkills, naukriMatch: detail.naukriMatch,
  };

  const naukriSaysNo = naukriMismatch(detail.naukriMatch, settings.skipWhenNaukriSaysNo);
  if (naukriSaysNo && detail.applyType === 'naukri') {
    await updateJob(job.jobId, { ...changes, status: 'filtered_out', filterReason: `Naukri's match score says no: ${naukriSaysNo}` });
    await bumpCounter(runId, 'filtered');
    await log('5-enrich', `Filtered out - Naukri match score: ${naukriSaysNo}`, { jobId: job.jobId });
    return;
  }

  if (detail.applyType === 'external') {
    await updateJob(job.jobId, { ...changes, status: 'external' });
    await bumpCounter(runId, 'external');
    await log('5-enrich', 'Company-site apply: saved as external (apply by hand)', { jobId: job.jobId });
  } else if (detail.applyType === 'already_applied') {
    await updateJob(job.jobId, { ...changes, status: 'already_applied' });
    await log('5-enrich', 'Already applied on Naukri', { jobId: job.jobId });
  } else {
    await updateJob(job.jobId, { ...changes, status: 'enriched' });
    await log('5-enrich', `Enriched (${skills.length} skills, ${detail.description.length} chars JD)`, { jobId: job.jobId });
  }
}

/**
 * FILE: steps/linkedin/li-5-enrichJobs.ts
 * WHAT: Opens each LinkedIn job that passed the filters and reads the full "About the job" text and how to apply:
 *       Easy Apply -> 'enriched' (will be scored), company website -> 'external', applied -> 'already_applied',
 *       closed -> 'stale'. Freshness gate #2 uses the posted date on the job page.
 * CALLED BY: orchestrator/runPipeline.ts (step LI_ENRICHING)
 */
import { LINKEDIN_DELAY_BETWEEN_JOB_PAGES_MS } from '../../config';
import { db, getSettings, jobPlatform, updateJob } from '../../db/database';
import type { Job } from '../../db/types';
import { isJobTooOld, parsePostedText } from '../../matching/postedDate';
import { handleJobError, resetSelectorStreak } from '../../orchestrator/jobFailures';
import { bumpCounter, checkpoint, waitWithCheckpoints } from '../../orchestrator/runState';
import { navigateWorkerTab, sendToContent } from '../../orchestrator/workerTab';
import { log } from '../../shared/log';
import { linkedInJobDetailSchema } from '../../shared/messages';
import { randomBetween } from '../../shared/sleep';

export async function enrichLinkedInJobs(runId: number): Promise<void> {
  const jobs = (await db.jobs.where('status').equals('passed_filters').toArray()).filter((job) => jobPlatform(job) === 'linkedin');
  await log('li-5-enrich', `Opening ${jobs.length} LinkedIn job pages`);
  for (const job of jobs) {
    await checkpoint(runId);
    let openedPage = true;
    try {
      openedPage = await enrichOne(runId, job);
      await resetSelectorStreak(runId);
    } catch (error) {
      await handleJobError(runId, job.jobId, 'li-5-enrich', error);
    }
    if (openedPage) await waitWithCheckpoints(runId, randomBetween(LINKEDIN_DELAY_BETWEEN_JOB_PAGES_MS.min, LINKEDIN_DELAY_BETWEEN_JOB_PAGES_MS.max));
  }
}

// Every job is opened one by one (with a human pause in between) and judged by its OWN page - never by the
// search card alone - so a "Company site" label is always checked and the pace looks natural.
async function enrichOne(runId: number, job: Job): Promise<boolean> {
  const settings = await getSettings();
  await navigateWorkerTab(job.url);
  const detail = await sendToContent({ type: 'LI_SCRAPE_JOB' }, linkedInJobDetailSchema, { step: 'li-5-enrich', jobId: job.jobId });
  const postedAt = parsePostedText(detail.postedText) ?? job.postedAt;
  const changes: Partial<Job> = { description: detail.description, postedAt, location: job.location || detail.location, company: job.company || detail.company };

  if (detail.applyType === 'closed') {
    await updateJob(job.jobId, { ...changes, status: 'closed', filterReason: 'LinkedIn: not currently accepting applications' });
    await log('li-5-enrich', 'Closed - the employer is not accepting applications', { jobId: job.jobId });
  } else if (isJobTooOld(postedAt, settings.maxJobAgeDays)) {
    await updateJob(job.jobId, { ...changes, status: 'stale', filterReason: `Posted "${detail.postedText}"` });
  } else if (detail.applyType === 'external') {
    await updateJob(job.jobId, { ...changes, status: 'external' });
    await bumpCounter(runId, 'external');
    await log('li-5-enrich', `Checked on the job page: applies on the company website - saved under Company site (${job.title} @ ${job.company})`, { jobId: job.jobId });
  } else if (detail.applyType === 'already_applied') {
    await updateJob(job.jobId, { ...changes, status: 'already_applied' });
  } else {
    await updateJob(job.jobId, { ...changes, status: 'enriched' });
    await log('li-5-enrich', `Checked on the job page: Easy Apply - read ${detail.description.length} chars (${job.title} @ ${job.company})`, { jobId: job.jobId });
  }
  return true;
}

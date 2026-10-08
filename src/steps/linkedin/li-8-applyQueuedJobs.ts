/**
 * FILE: steps/linkedin/li-8-applyQueuedJobs.ts
 * WHAT: The LinkedIn APPLYING step: one job at a time (best first), human pace:
 *       6-12 s between job pages, 45-90 s after each real application, a 3-6 min break every 5,
 *       and it stops at LinkedIn's per-run / per-day caps or LinkedIn's own limit message.
 * CALLED BY: orchestrator/runPipeline.ts (step LI_APPLYING)
 */
import {
  LINKEDIN_DELAY_AFTER_APPLY_MS, LINKEDIN_DELAY_BETWEEN_JOB_PAGES_MS, LINKEDIN_LONG_BREAK_EVERY_N_APPLIES, LINKEDIN_LONG_BREAK_MS,
} from '../../config';
import { countAppliedToday, db, getProfile, getSettings, jobPlatform } from '../../db/database';
import type { Job, Run } from '../../db/types';
import { handleJobError, resetSelectorStreak } from '../../orchestrator/jobFailures';
import { bumpCounter, checkpoint, loadRun, WAIT_REASONS, waitWithCheckpoints } from '../../orchestrator/runState';
import { makeError } from '../../shared/errors';
import { log } from '../../shared/log';
import { randomBetween } from '../../shared/sleep';
import { compareForQueue } from '../7-queueJobs';
import type { ApplyOutcome } from '../8-applyToJob';
import { applyToLinkedInJob } from './li-8-applyToJob';
import { linkedInDailyCap } from './li-7-queueJobs';

async function nextJob(run: Run): Promise<Job | undefined> {
  const queued = (await db.jobs.where('status').equals('queued').toArray()).filter((job) => jobPlatform(job) === 'linkedin' && job.lastDryRunId !== run.id);
  if (run.targetJobId) return queued.find((job) => job.jobId === run.targetJobId);
  return queued.sort(compareForQueue)[0];
}

const COUNTERS: Partial<Record<ApplyOutcome, 'applied' | 'external' | 'needsReview' | 'failed'>> = {
  applied: 'applied', external: 'external', needs_review: 'needsReview', failed: 'failed',
};

export async function applyQueuedLinkedInJobs(runId: number): Promise<void> {
  const settings = await getSettings();
  const profile = await getProfile();
  if (!profile) throw makeError('SETUP_MISSING', 'No profile yet. Read your profile in the Setup tab.');
  await log('li-8-apply', settings.linkedin.dryRun ? 'TEST MODE (LinkedIn): forms are filled but never submitted' : 'LIVE (LinkedIn): applying for real, slowly, one job at a time');

  while (true) {
    await checkpoint(runId);
    const run = await loadRun(runId);
    const cap = linkedInDailyCap(settings.linkedin.dailyCap);
    if (run.counters.appliesThisRun >= (run.maxApplies ?? settings.linkedin.maxAppliesPerRun)) return log('li-8-apply', 'Reached this run\'s LinkedIn limit');
    if ((await countAppliedToday('linkedin')) >= cap) return log('li-8-apply', `LinkedIn daily cap reached (${cap})`);
    const job = await nextJob(run);
    if (!job) return log('li-8-apply', 'LinkedIn queue is empty');

    let outcome: ApplyOutcome | 'handled' = 'handled';
    try {
      outcome = await applyToLinkedInJob(runId, job, profile);
      await resetSelectorStreak(runId);
    } catch (error) {
      await handleJobError(runId, job.jobId, 'li-8-apply', error);
    }
    if (outcome === 'applied' || outcome === 'dry_run') await bumpCounter(runId, 'appliesThisRun');
    const counter = outcome === 'handled' ? undefined : COUNTERS[outcome];
    if (counter) await bumpCounter(runId, counter);
    await pauseAfterJob(runId, outcome === 'applied');
  }
}

/** LinkedIn watches pace: always a pause between jobs, a long one after real applications. */
async function pauseAfterJob(runId: number, applied: boolean): Promise<void> {
  const run = await loadRun(runId);
  const longBreak = applied && run.counters.applied > 0 && run.counters.applied % LINKEDIN_LONG_BREAK_EVERY_N_APPLIES === 0;
  const range = longBreak ? LINKEDIN_LONG_BREAK_MS : applied ? LINKEDIN_DELAY_AFTER_APPLY_MS : LINKEDIN_DELAY_BETWEEN_JOB_PAGES_MS;
  const waitMs = randomBetween(range.min, range.max);
  await log('li-8-apply', `Pausing ${Math.round(waitMs / 1000)} s${longBreak ? ' (break after 5 applications)' : ''}`);
  await waitWithCheckpoints(runId, waitMs, longBreak ? WAIT_REASONS.linkedInLongBreak : applied ? WAIT_REASONS.afterLinkedInApply : WAIT_REASONS.betweenJobPages);
}

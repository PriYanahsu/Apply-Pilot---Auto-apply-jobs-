/**
 * FILE: steps/8-applyQueuedJobs.ts
 * WHAT: The APPLYING step: takes queued jobs one at a time (best first), applies, optionally pauses after a REAL
 *       application (config.ts DELAY_BETWEEN_APPLIES_MS, 0 by default), and stops at the per-run limit or the daily cap.
 * CALLED BY: orchestrator/runPipeline.ts (step APPLYING)
 * READS: db.jobs (status 'queued')     WRITES: run counters (applied, external, needsReview, failed)
 * IF IT BREAKS: Run tab log shows each job; filter Debug > Logs by jobId to trace one job end to end.
 */
import {
  DELAY_BETWEEN_APPLIES_MS, LONG_BREAK_EVERY_N_APPLIES, LONG_BREAK_MS,
} from '../config';
import { countAppliedToday, db, getProfile, getSettings, jobPlatform } from '../db/database';
import type { Job, Run } from '../db/types';
import { handleJobError, resetSelectorStreak } from '../orchestrator/jobFailures';
import { bumpCounter, checkpoint, loadRun, WAIT_REASONS, waitWithCheckpoints } from '../orchestrator/runState';
import { makeError } from '../shared/errors';
import { log } from '../shared/log';
import { randomBetween } from '../shared/sleep';
import { compareForQueue, effectiveDailyCap } from './7-queueJobs';
import { applyToJob, type ApplyOutcome } from './8-applyToJob';

async function nextJob(run: Run): Promise<Job | undefined> {
  const queued = (await db.jobs.where('status').equals('queued').toArray()).filter((job) => jobPlatform(job) === 'naukri');
  const notYetTried = queued.filter((job) => job.lastDryRunId !== run.id);
  if (run.targetJobId) return notYetTried.find((job) => job.jobId === run.targetJobId);
  return notYetTried.sort(compareForQueue)[0];
}

async function countOutcome(runId: number, outcome: ApplyOutcome): Promise<void> {
  if (outcome === 'applied' || outcome === 'dry_run') await bumpCounter(runId, 'appliesThisRun');
  if (outcome === 'applied') await bumpCounter(runId, 'applied');
  if (outcome === 'external') await bumpCounter(runId, 'external');
  if (outcome === 'needs_review') await bumpCounter(runId, 'needsReview');
  if (outcome === 'failed') await bumpCounter(runId, 'failed');
}

/** Returns a reason to stop applying, or null to keep going. */
async function reasonToStop(run: Run, maxApplies: number, dailyCap: number): Promise<string | null> {
  if (run.counters.appliesThisRun >= maxApplies) return `Reached this run's limit of ${maxApplies} applies`;
  const appliedToday = await countAppliedToday();
  if (appliedToday >= dailyCap) return `Daily cap reached (${appliedToday}/${dailyCap})`;
  return null;
}

export async function applyQueuedJobs(runId: number): Promise<void> {
  const settings = await getSettings();
  const profile = await getProfile();
  if (!profile) throw makeError('SETUP_MISSING', 'No profile yet. Click "Refresh profile" in the Setup tab.');
  await log('8-apply', settings.dryRun ? 'TEST MODE: nothing will be submitted (switch to Live on the Run tab to apply for real)' : 'LIVE: applying for real, one job at a time');

  while (true) {
    await checkpoint(runId);
    const run = await loadRun(runId);
    const stopReason = await reasonToStop(run, run.maxApplies ?? settings.maxAppliesPerRun, effectiveDailyCap(settings.dailyCap));
    if (stopReason) return log('8-apply', stopReason);
    const job = await nextJob(run);
    if (!job) return log('8-apply', 'Queue is empty');

    // 'handled' = handleJobError already marked the job failed and counted it.
    let outcome: ApplyOutcome | 'handled' = 'handled';
    try {
      outcome = await applyToJob(runId, job, profile);
      await resetSelectorStreak(runId);
    } catch (error) {
      await handleJobError(runId, job.jobId, '8-apply', error);
    }
    if (outcome !== 'handled') await countOutcome(runId, outcome);
    // Only a REAL application needs a pause before the next one. Skipped / failed / external / test-mode
    // jobs go straight to the next job (opening its page already includes a short settle delay).
    if (outcome === 'applied') await pauseAfterApplying(runId);
  }
}

/** 8-15 s after each real application (acceptance #7: always >= 8 s), a longer break after every 10th. */
async function pauseAfterApplying(runId: number): Promise<void> {
  const run = await loadRun(runId);
  const takeLongBreak = LONG_BREAK_EVERY_N_APPLIES > 0 && run.counters.applied > 0 && run.counters.applied % LONG_BREAK_EVERY_N_APPLIES === 0;
  if (!takeLongBreak && DELAY_BETWEEN_APPLIES_MS.max === 0) return; // no pause configured
  const range = takeLongBreak ? LONG_BREAK_MS : DELAY_BETWEEN_APPLIES_MS;
  const waitMs = randomBetween(range.min, range.max);
  await log('8-apply', `Applied - short ${Math.round(waitMs / 1000)} s pause before the next job${takeLongBreak ? ' (break after 10 applies)' : ''}`);
  await waitWithCheckpoints(runId, waitMs, WAIT_REASONS.afterNaukriApply);
}

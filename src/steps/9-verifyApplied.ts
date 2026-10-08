/**
 * FILE: steps/9-verifyApplied.ts
 * WHAT: Asks Naukri about every job whose apply state is uncertain:
 *       - jobs marked 'applied': if Naukri still shows "Apply", it was NOT applied -> back to 'scored';
 *       - 'failed' / 'needs_review' jobs where we already clicked Apply: if Naukri shows "Applied" -> 'applied'.
 * CALLED BY: orchestrator/runPipeline.ts (step VERIFY_APPLIED) - "Re-check applied jobs" button in Jobs / Debug tabs.
 * READS: db.jobs (status 'applied')     WRITES: status -> 'scored' (with an explanation) when not really applied
 */
import { DELAY_BETWEEN_JOB_PAGES_MS } from '../config';
import { db, jobPlatform, updateJob } from '../db/database';
import type { Job } from '../db/types';
import { handleJobError } from '../orchestrator/jobFailures';
import { checkpoint, waitWithCheckpoints } from '../orchestrator/runState';
import { log } from '../shared/log';
import { randomBetween } from '../shared/sleep';
import { isAppliedOnNaukri } from './8-applyToJob';

export async function verifyAppliedJobs(runId: number): Promise<void> {
  const naukriOnly = (job: Job) => jobPlatform(job) === 'naukri';
  const markedApplied = (await db.jobs.where('status').equals('applied').toArray()).filter(naukriOnly);
  const clickedButUnsure = (await db.jobs.where('status').anyOf('failed', 'needs_review').toArray()).filter((job) => naukriOnly(job) && job.applyStartedRunId !== undefined);
  await log('9-verify', `Asking Naukri about ${markedApplied.length} applied + ${clickedButUnsure.length} unsure jobs`);
  let reset = 0;
  let recovered = 0;
  for (const job of [...markedApplied, ...clickedButUnsure]) {
    await checkpoint(runId);
    try {
      const reallyApplied = await isAppliedOnNaukri(job.jobId, job.url);
      if (job.status === 'applied' && !reallyApplied) {
        reset += 1;
        await updateJob(job.jobId, {
          status: 'scored', appliedAt: undefined, applyStartedRunId: undefined,
          error: 'Was marked applied, but Naukri still shows "Apply" - reset so it can be applied for real.',
        });
        await log('9-verify', 'NOT really applied - reset to scored', { jobId: job.jobId, level: 'warn' });
      } else if (job.status !== 'applied' && reallyApplied) {
        recovered += 1;
        await updateJob(job.jobId, { status: 'applied', appliedAt: job.appliedAt ?? new Date().toISOString(), error: undefined, pendingQuestion: undefined });
        await log('9-verify', 'Naukri shows Applied - marked applied', { jobId: job.jobId });
      }
    } catch (error) {
      await handleJobError(runId, job.jobId, '9-verify', error);
    }
    await waitWithCheckpoints(runId, randomBetween(DELAY_BETWEEN_JOB_PAGES_MS.min, DELAY_BETWEEN_JOB_PAGES_MS.max));
  }
  await log('9-verify', `Done: ${recovered} failed jobs were actually applied, ${reset} "applied" jobs were not`);
}

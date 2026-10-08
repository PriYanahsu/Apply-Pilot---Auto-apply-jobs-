/**
 * FILE: steps/7-queueJobs.ts
 * WHAT: Picks what to apply to: scored jobs with finalScore >= minScore that are still fresh,
 *       best score first, newest first, limited to min(maxAppliesPerRun, dailyCap - appliedToday).
 * CALLED BY: orchestrator/runPipeline.ts (step QUEUEING)
 * READS: db.jobs (status 'scored' / 'queued')     WRITES: status -> 'queued' (or 'stale' if it aged out)
 */
import { HARD_MAX_DAILY_CAP } from '../config';
import { countAppliedToday, db, getSettings, jobPlatform, todayDateString, updateJob } from '../db/database';
import type { Job } from '../db/types';
import { isJobTooOld } from '../matching/postedDate';
import { bumpCounter, loadRun } from '../orchestrator/runState';
import { log } from '../shared/log';

export function effectiveDailyCap(dailyCap: number): number {
  return Math.min(dailyCap, HARD_MAX_DAILY_CAP);
}

/** Best score first, then newest first. */
export function compareForQueue(left: Job, right: Job): number {
  const scoreDifference = (right.finalScore ?? 0) - (left.finalScore ?? 0);
  if (scoreDifference !== 0) return scoreDifference;
  return right.postedAt.localeCompare(left.postedAt);
}

/**
 * Jobs that stopped at a screening question get one automatic retry per day: answers improve (saved answers,
 * better chatbot reading, the AI choosing options), so the user doesn't have to step in.
 */
async function requeueReviewJobs(): Promise<number> {
  const today = todayDateString();
  const waiting = (await db.jobs.where('status').equals('needs_review').toArray()).filter((job) => jobPlatform(job) === 'naukri' && job.autoRetryDate !== today);
  for (const job of waiting) {
    await updateJob(job.jobId, { status: 'queued', autoRetryDate: today, lastDryRunId: undefined, pendingQuestion: undefined });
    await log('7-queue', 'Retrying a job that stopped at a screening question', { jobId: job.jobId });
  }
  return waiting.length;
}

export async function queueJobs(runId: number): Promise<void> {
  const settings = await getSettings();
  const run = await loadRun(runId);
  if (run.targetJobId) {
    await log('7-queue', 'Single-job apply: skipping normal queueing', { jobId: run.targetJobId });
    return;
  }

  const appliedToday = await countAppliedToday();
  const maxApplies = run.maxApplies ?? settings.maxAppliesPerRun;
  const room = Math.max(0, Math.min(maxApplies, effectiveDailyCap(settings.dailyCap) - appliedToday));
  const alreadyQueued = (await db.jobs.where('status').equals('queued').toArray()).filter((job) => jobPlatform(job) === 'naukri').length;

  const scored = (await db.jobs.where('status').equals('scored').toArray()).filter((job) => jobPlatform(job) === 'naukri');
  const candidates: Job[] = [];
  for (const job of scored) {
    if (isJobTooOld(job.postedAt, settings.maxJobAgeDays)) {
      await updateJob(job.jobId, { status: 'stale', filterReason: 'Became too old while waiting in the queue' });
    } else if ((job.finalScore ?? 0) >= settings.minScore && job.matchReason) {
      candidates.push(job);
    }
  }

  const retried = await requeueReviewJobs();
  const toQueue = candidates.sort(compareForQueue).slice(0, Math.max(0, room - alreadyQueued - retried));
  for (const job of toQueue) await updateJob(job.jobId, { status: 'queued' });
  await bumpCounter(runId, 'queued', toQueue.length);
  await log('7-queue', `Queued ${toQueue.length} new jobs (${alreadyQueued} already queued). Applied today: ${appliedToday}/${effectiveDailyCap(settings.dailyCap)}, room this run: ${room}`);
}

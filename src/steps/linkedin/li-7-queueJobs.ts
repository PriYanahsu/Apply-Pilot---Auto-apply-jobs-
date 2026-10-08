/**
 * FILE: steps/linkedin/li-7-queueJobs.ts
 * WHAT: Picks which LinkedIn jobs to apply to: scored, match >= LinkedIn "Apply if match", still fresh,
 *       best first, limited by LinkedIn's own per-run and per-day caps (default 10 / 25, hard max 50).
 *       Jobs that stopped at a question you have since answered get one retry a day.
 * CALLED BY: orchestrator/runPipeline.ts (step LI_QUEUEING)
 */
import { LINKEDIN_HARD_MAX_DAILY_CAP } from '../../config';
import { countAppliedToday, db, getSettings, jobPlatform, todayDateString, updateJob } from '../../db/database';
import type { Job } from '../../db/types';
import { isJobTooOld } from '../../matching/postedDate';
import { bumpCounter, loadRun } from '../../orchestrator/runState';
import { log } from '../../shared/log';
import { compareForQueue } from '../7-queueJobs';

const isLinkedIn = (job: Job) => jobPlatform(job) === 'linkedin';

export function linkedInDailyCap(dailyCap: number): number {
  return Math.min(dailyCap, LINKEDIN_HARD_MAX_DAILY_CAP);
}

export async function queueLinkedInJobs(runId: number): Promise<void> {
  const settings = await getSettings();
  const limits = settings.linkedin;
  const run = await loadRun(runId);
  if (run.targetJobId) return;

  const today = todayDateString();
  const waiting = (await db.jobs.where('status').equals('needs_review').toArray()).filter((job) => isLinkedIn(job) && job.autoRetryDate !== today);
  for (const job of waiting) await updateJob(job.jobId, { status: 'queued', autoRetryDate: today, lastDryRunId: undefined, pendingQuestion: undefined });

  const appliedToday = await countAppliedToday('linkedin');
  const room = Math.max(0, Math.min(run.maxApplies ?? limits.maxAppliesPerRun, linkedInDailyCap(limits.dailyCap) - appliedToday));
  const alreadyQueued = (await db.jobs.where('status').equals('queued').toArray()).filter(isLinkedIn).length;
  const scored = (await db.jobs.where('status').equals('scored').toArray()).filter(isLinkedIn);
  const candidates: Job[] = [];
  for (const job of scored) {
    if (isJobTooOld(job.postedAt, settings.maxJobAgeDays)) await updateJob(job.jobId, { status: 'stale', filterReason: 'Became too old while waiting' });
    else if ((job.finalScore ?? 0) >= limits.minScore && job.matchReason) candidates.push(job);
  }
  const toQueue = candidates.sort(compareForQueue).slice(0, Math.max(0, room - alreadyQueued));
  for (const job of toQueue) await updateJob(job.jobId, { status: 'queued' });
  await bumpCounter(runId, 'queued', toQueue.length);
  await log('li-7-queue', `Queued ${toQueue.length} LinkedIn jobs (${alreadyQueued} already queued, ${waiting.length} retried). Applied today: ${appliedToday}/${linkedInDailyCap(limits.dailyCap)}`);
}

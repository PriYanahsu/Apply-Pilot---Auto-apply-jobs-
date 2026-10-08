/**
 * FILE: orchestrator/jobFailures.ts
 * WHAT: Decides what an error inside one job means:
 *   - run-level problems (captcha, logged out, stop/pause, Gemini quota) are re-thrown so the whole run reacts;
 *   - anything else marks just THIS job `failed` with a readable message (rule D7) and the run continues.
 *   After 3 selector failures in a row the run stops - Naukri's layout has probably changed.
 * CALLED BY: steps/5-enrichJobs.ts, steps/6-scoreJobs.ts, steps/8-applyQueuedJobs.ts
 */
import { SELECTOR_FAILURES_BEFORE_STOP } from '../config';
import { updateJob } from '../db/database';
import { errorCode, errorMessage, makeError, type AppErrorCode, type CodedError } from '../shared/errors';
import { log } from '../shared/log';
import { bumpCounter, loadRun, setCounter } from './runState';

const RUN_LEVEL_ERRORS: AppErrorCode[] = [
  'CAPTCHA', 'NOT_LOGGED_IN', 'STOP_REQUESTED', 'PAUSE_REQUESTED', 'DAILY_LIMIT',
  'GEMINI_QUOTA', 'GEMINI_NO_KEY', 'TOO_MANY_SELECTOR_FAILURES', 'SETUP_MISSING',
];

export function isRunLevelError(error: unknown): boolean {
  return RUN_LEVEL_ERRORS.includes(errorCode(error));
}

function readableMessage(error: unknown, jobId: string): string {
  const selectorKey = (error as Partial<CodedError>).selectorKey;
  if (errorCode(error) === 'SELECTOR_MISSING' && selectorKey) {
    const site = jobId.startsWith('li-') ? 'LinkedIn' : 'Naukri';
    return `${errorMessage(error)} (job ${jobId}, selector "${selectorKey}"). ${site}'s page looked different than expected - see More > Debug > Snapshots.`;
  }
  return `${errorMessage(error)} (job ${jobId})`;
}

/** Re-throws run-level errors; otherwise marks the job failed and keeps going. */
export async function handleJobError(runId: number, jobId: string, step: string, error: unknown): Promise<void> {
  if (isRunLevelError(error)) throw error;
  const message = readableMessage(error, jobId);
  await updateJob(jobId, { status: 'failed', error: message });
  await bumpCounter(runId, 'failed');
  await log(step, `FAILED: ${message}`, { jobId, level: 'error' });

  if (errorCode(error) !== 'SELECTOR_MISSING') return;
  const run = await loadRun(runId);
  const streak = run.counters.selectorFailStreak + 1;
  await setCounter(runId, 'selectorFailStreak', streak);
  if (streak >= SELECTOR_FAILURES_BEFORE_STOP) {
    const site = jobId.startsWith('li-') ? 'LinkedIn' : 'Naukri';
    throw makeError('TOO_MANY_SELECTOR_FAILURES', `${streak} pages in a row could not be read - ${site}'s layout probably changed. Check More > Debug > Snapshots.`);
  }
}

export async function resetSelectorStreak(runId: number): Promise<void> {
  await setCounter(runId, 'selectorFailStreak', 0);
}

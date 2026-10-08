/**
 * FILE: orchestrator/runPipeline.ts
 * WHAT: Runs the steps of a run in order - a plain for-loop, no state-machine library (§6).
 *       After every step the stepIndex is saved, so if Chrome kills the service worker the run
 *       continues from the same step (each step itself only works on jobs not yet processed).
 * CALLED BY: entrypoints/background.ts (start, resume, keep-alive alarm, service-worker startup)
 * IF IT BREAKS: Debug > Logs filtered by step "pipeline" shows every start / pause / stop / error.
 */
import { KEEP_ALIVE_ALARM_NAME, KEEP_ALIVE_PERIOD_MINUTES } from '../config';
import type { Run, StepName } from '../db/types';
import { errorCode, errorMessage } from '../shared/errors';
import { log, setLogRunId } from '../shared/log';
import { checkLogin } from '../steps/1-checkLogin';
import { buildProfile } from '../steps/2-buildProfile';
import { searchJobs } from '../steps/3-searchJobs';
import { filterJobs } from '../steps/4-filterJobs';
import { enrichJobs } from '../steps/5-enrichJobs';
import { scoreJobs } from '../steps/6-scoreJobs';
import { queueJobs } from '../steps/7-queueJobs';
import { applyQueuedJobs } from '../steps/8-applyQueuedJobs';
import { verifyAppliedJobs } from '../steps/9-verifyApplied';
import { checkLinkedInLogin } from '../steps/linkedin/li-1-checkLogin';
import { buildLinkedInProfile } from '../steps/linkedin/li-2-buildProfile';
import { searchLinkedInJobs } from '../steps/linkedin/li-3-searchJobs';
import { enrichLinkedInJobs } from '../steps/linkedin/li-5-enrichJobs';
import { queueLinkedInJobs } from '../steps/linkedin/li-7-queueJobs';
import { applyQueuedLinkedInJobs } from '../steps/linkedin/li-8-applyQueuedJobs';
import { finishRun, getActiveRun, loadRun, updateRun } from './runState';
import { getWorkerTabId } from './workerTab';

const STEP_FUNCTIONS: Record<StepName, (runId: number) => Promise<unknown>> = {
  CHECK_LOGIN: () => checkLogin(),
  BUILD_PROFILE: () => buildProfile(),
  SEARCHING: searchJobs,
  FILTERING: filterJobs,
  ENRICHING: enrichJobs,
  SCORING: scoreJobs,
  QUEUEING: queueJobs,
  APPLYING: applyQueuedJobs,
  VERIFY_APPLIED: verifyAppliedJobs,
  LI_CHECK_LOGIN: () => checkLinkedInLogin(),
  LI_BUILD_PROFILE: () => buildLinkedInProfile(),
  LI_SEARCHING: searchLinkedInJobs,
  LI_ENRICHING: enrichLinkedInJobs,
  LI_QUEUEING: queueLinkedInJobs,
  LI_APPLYING: applyQueuedLinkedInJobs,
};

// Only guards against running the same run twice inside ONE service-worker lifetime.
let executingRunId: number | undefined;

export function isExecuting(): boolean {
  return executingRunId !== undefined;
}

// "Run both": the background registers what to do when a run ends (start the next site's run).
let afterRunFinished: ((run: Run) => Promise<void>) | undefined;

export function onRunFinished(callback: (run: Run) => Promise<void>): void {
  afterRunFinished = callback;
}

export async function runPipeline(runId: number): Promise<void> {
  if (executingRunId !== undefined) return;
  executingRunId = runId;
  setLogRunId(runId);
  await chrome.alarms.create(KEEP_ALIVE_ALARM_NAME, { periodInMinutes: KEEP_ALIVE_PERIOD_MINUTES });
  try {
    await runStepsFromSavedIndex(runId);
  } catch (error) {
    await handleRunError(runId, error);
  } finally {
    executingRunId = undefined;
    const finished = await loadRun(runId);
    if (finished.state !== 'running' && finished.state !== 'paused') await afterRunFinished?.(finished);
    if (!(await getActiveRun())) await chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME);
  }
}

async function runStepsFromSavedIndex(runId: number): Promise<void> {
  while (true) {
    const run = await loadRun(runId);
    if (run.state !== 'running') return;
    if (run.stopRequested) {
      await finishRun(runId, 'stopped');
      await log('pipeline', 'Run stopped by user');
      return;
    }
    if (run.stepIndex >= run.steps.length) {
      await finishRun(runId, 'done');
      const counts = run.counters;
      await log('pipeline', `Run finished: ${counts.applied} applied, ${counts.queued} queued, ${counts.found} found, ${counts.filtered} filtered out, ${counts.external} on company sites (see Jobs > Company site), ${counts.needsReview} need an answer, ${counts.failed} failed`);
      return;
    }
    const step = run.steps[run.stepIndex] as StepName; // safe: stepIndex < steps.length checked above
    await log('pipeline', `Step ${run.stepIndex + 1}/${run.steps.length}: ${step}`);
    await STEP_FUNCTIONS[step](runId);
    await updateRun(runId, { stepIndex: run.stepIndex + 1 });
  }
}

/** Turns an error into the right run state (§11). */
async function handleRunError(runId: number, error: unknown): Promise<void> {
  const code = errorCode(error);
  const message = errorMessage(error);
  if (code === 'STOP_REQUESTED') {
    await finishRun(runId, 'stopped');
    await log('pipeline', 'Run stopped by user');
  } else if (code === 'PAUSE_REQUESTED') {
    await log('pipeline', message);
  } else if (code === 'CAPTCHA' || code === 'GEMINI_QUOTA') {
    const reason = code === 'CAPTCHA' ? 'captcha' : 'Gemini quota reached';
    await updateRun(runId, { state: 'paused', pauseReason: reason });
    await log('pipeline', `PAUSED (${reason}): ${message}`, { level: 'warn' });
    await notifyUser(code === 'CAPTCHA' ? 'Naukri is asking for a captcha. Solve it in the Naukri tab, then press Resume.' : 'Gemini quota reached. Press Resume later.');
    if (code === 'CAPTCHA') await showWorkerTab();
  } else if (code === 'DAILY_LIMIT') {
    await finishRun(runId, 'done', message);
    await log('pipeline', message, { level: 'warn' });
  } else {
    await finishRun(runId, 'error', message);
    await log('pipeline', `Run ended with error: ${message}`, { level: 'error', data: { code } });
  }
}

async function notifyUser(message: string): Promise<void> {
  await chrome.notifications.create({
    type: 'basic', iconUrl: chrome.runtime.getURL('/icon/128.png'), title: 'ApplyPilot', message,
  });
}

async function showWorkerTab(): Promise<void> {
  const tabId = await getWorkerTabId();
  await chrome.tabs.update(tabId, { active: true });
}

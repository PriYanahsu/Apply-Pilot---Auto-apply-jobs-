/**
 * FILE: entrypoints/background.ts
 * WHAT: The background service worker. Listens for side-panel commands (start/stop/pause/resume...),
 *       alarms (keep-alive + optional daily run), and resumes an unfinished run when Chrome restarts it.
 * CALLED BY: Chrome.
 * IF IT BREAKS: chrome://extensions -> ApplyPilot -> "service worker" link opens its console.
 */
import { defineBackground } from 'wxt/utils/define-background';
import { testGeminiModels } from '../ai/gemini';
import { DAILY_RUN_ALARM_NAME, KEEP_ALIVE_ALARM_NAME, PROFILE_MAX_AGE_HOURS } from '../config';
import { db, getProfile, getSettings, jobPlatform, updateJob } from '../db/database';
import type { Platform, Run, StepName } from '../db/types';
import { isExecuting, onRunFinished, runPipeline } from '../orchestrator/runPipeline';
import { createRun, getActiveRun, updateRun } from '../orchestrator/runState';
import { clearUnfinishedWork } from '../db/exportImport';
import { errorMessage, makeError } from '../shared/errors';
import { log } from '../shared/log';
import type { CommandResult, PanelCommand, RunMode } from '../shared/messages';

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error('[background] side panel setup failed', error));

  chrome.runtime.onMessage.addListener((command: PanelCommand, _sender, sendResponse) => {
    handlePanelCommand(command).then(sendResponse);
    return true;
  });

  onRunFinished(startChainedRun);

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM_NAME) resumeActiveRun('keep-alive tick');
    if (alarm.name === DAILY_RUN_ALARM_NAME) startDailyRun();
  });

  // Service worker just (re)started: continue any run that was interrupted (rule R8).
  resumeActiveRun('service worker started');
});

async function handlePanelCommand(command: PanelCommand): Promise<CommandResult<unknown>> {
  try {
    return { ok: true, data: await runPanelCommand(command) };
  } catch (error) {
    await log('background', `${command.type} failed: ${errorMessage(error)}`, { level: 'error' });
    return { ok: false, error: { code: 'UNKNOWN', message: errorMessage(error) } };
  }
}

async function runPanelCommand(command: PanelCommand): Promise<unknown> {
  switch (command.type) {
    case 'START_RUN': return startRun(command.mode);
    case 'START_BOTH': return startBoth();
    case 'RUN_STEP': return runOneStep(command.step);
    case 'APPLY_ONE_JOB': return applyOneJob(command.jobId);
    case 'STOP_RUN': return stopRun();
    case 'PAUSE_RUN': return pauseRun();
    case 'RESUME_RUN': return resumeRun();
    case 'REFRESH_PROFILE': return refreshProfile(command.platform ?? 'naukri');
    case 'TEST_GEMINI': return testGeminiModels(command.apiKey, command.models);
    case 'UPDATE_DAILY_ALARM': return updateDailyAlarm();
    case 'START_FRESH': return startFresh(command.platform);
  }
}

/** Read resume + Naukri profile first when we have none, or it is older than PROFILE_MAX_AGE_HOURS. */
async function profileNeedsReading(): Promise<boolean> {
  const profile = await getProfile();
  if (!profile?.naukriSyncedAt || !profile.autoFacts) return true;
  return Date.now() - new Date(profile.naukriSyncedAt).getTime() > PROFILE_MAX_AGE_HOURS * 60 * 60 * 1000;
}

// Debug-tab step buttons are named after Naukri's steps; on LinkedIn they run the LinkedIn version.
const LINKEDIN_VERSION_OF_STEP: Partial<Record<StepName, StepName>> = {
  CHECK_LOGIN: 'LI_CHECK_LOGIN', SEARCHING: 'LI_SEARCHING', ENRICHING: 'LI_ENRICHING', QUEUEING: 'LI_QUEUEING', APPLYING: 'LI_APPLYING',
};

async function runOneStep(step: StepName): Promise<number> {
  const linkedIn = (await getSettings()).platform === 'linkedin';
  const actualStep = linkedIn ? LINKEDIN_VERSION_OF_STEP[step] ?? step : step;
  return startNewRun(`step:${actualStep}`, [actualStep], { platform: linkedIn ? 'linkedin' : 'naukri' });
}

/** LinkedIn runs use the profile you already read (resume + Naukri); they never open Naukri themselves. */
async function linkedInStepsForMode(mode: RunMode): Promise<StepName[]> {
  const linkedin = (await getProfile())?.linkedin;
  const stale = !linkedin || Date.now() - new Date(linkedin.syncedAt).getTime() > PROFILE_MAX_AGE_HOURS * 60 * 60 * 1000;
  const readProfile: StepName[] = stale ? ['LI_BUILD_PROFILE'] : [];
  const findSteps: StepName[] = ['LI_CHECK_LOGIN', ...readProfile, 'LI_SEARCHING', 'FILTERING', 'LI_ENRICHING', 'SCORING'];
  if (mode === 'find') return findSteps;
  if (mode === 'apply') return ['LI_CHECK_LOGIN', ...readProfile, 'LI_QUEUEING', 'LI_APPLYING'];
  return [...findSteps, 'LI_QUEUEING', 'LI_APPLYING'];
}

async function stepsForMode(mode: RunMode, platform?: Platform): Promise<StepName[]> {
  if ((platform ?? (await getSettings()).platform) === 'linkedin') return linkedInStepsForMode(mode);
  const needsProfile = await profileNeedsReading();
  const findSteps: StepName[] = ['CHECK_LOGIN', ...(needsProfile ? ['BUILD_PROFILE' as const] : []), 'SEARCHING', 'FILTERING', 'ENRICHING', 'SCORING'];
  if (mode === 'find') return findSteps;
  if (mode === 'apply') return ['CHECK_LOGIN', ...(needsProfile ? ['BUILD_PROFILE' as const] : []), 'QUEUEING', 'APPLYING'];
  return [...findSteps, 'QUEUEING', 'APPLYING'];
}

async function startRun(mode: RunMode): Promise<number> {
  return startNewRun(mode, await stepsForMode(mode));
}

/** "Run both": Naukri's full run now; LinkedIn's full run starts by itself when Naukri ends (unless you stop it). */
async function startBoth(): Promise<number> {
  return startNewRun('both', await stepsForMode('full', 'naukri'), { platform: 'naukri', chainNext: 'linkedin' });
}

async function startChainedRun(finished: Run): Promise<void> {
  if (!finished.id || !finished.chainNext || finished.chainStarted) return;
  await updateRun(finished.id, { chainStarted: true });
  if (finished.state === 'stopped') {
    await log('background', `Run both: ${finished.chainNext} not started because the run was stopped`);
    return;
  }
  try {
    await log('background', `Run both: ${finished.platform ?? 'naukri'} finished - starting ${finished.chainNext} now`);
    await startNewRun('both', await stepsForMode('full', finished.chainNext), { platform: finished.chainNext });
  } catch (error) {
    await log('background', `Run both: could not start ${finished.chainNext}: ${errorMessage(error)}`, { level: 'error' });
  }
}

async function startNewRun(mode: string, steps: StepName[], extra: { maxApplies?: number; targetJobId?: string; platform?: Platform; chainNext?: Platform } = {}): Promise<number> {
  const platform = extra.platform ?? (steps.some((step) => step.startsWith('LI_')) ? 'linkedin' : 'naukri');
  const runId = await createRun({ mode, steps, ...extra, platform });
  await log('background', `Started run #${runId} (${mode}): ${steps.join(' -> ')}`);
  runPipeline(runId); // not awaited: the side panel gets the run id right away and watches progress in the DB
  return runId;
}

/** Debug "Apply 1 job", or Jobs tab "Apply now" on one job (still subject to every safety check). */
async function applyOneJob(jobId?: string): Promise<number> {
  if (jobId) {
    const job = await db.jobs.get(jobId);
    const settings = await getSettings();
    if (!job) throw makeError('UNKNOWN', `Job ${jobId} not found`);
    const minScore = jobPlatform(job) === 'linkedin' ? settings.linkedin.minScore : settings.minScore;
    if ((job.finalScore ?? 0) < minScore) throw makeError('UNKNOWN', `Job score ${job.finalScore ?? 'none'} is below your minimum ${minScore}; it was not scored as a match.`);
    await updateJob(jobId, { status: 'queued', lastDryRunId: undefined });
  }
  const job = jobId ? await db.jobs.get(jobId) : undefined;
  const linkedIn = job ? jobPlatform(job) === 'linkedin' : (await getSettings()).platform === 'linkedin';
  const steps: StepName[] = linkedIn ? ['LI_CHECK_LOGIN', 'LI_APPLYING'] : ['CHECK_LOGIN', 'APPLYING'];
  return startNewRun(jobId ? 'apply-now' : 'apply-one', steps, { maxApplies: 1, targetJobId: jobId });
}

async function stopRun(): Promise<void> {
  const run = await getActiveRun();
  if (!run?.id) return;
  // A paused run has no loop to notice the flag, so finish it directly.
  if (run.state === 'paused') await updateRun(run.id, { state: 'stopped', stopRequested: true, finishedAt: new Date().toISOString() });
  else await updateRun(run.id, { stopRequested: true });
  await log('background', `Stop requested for run #${run.id}`);
}

/** Stops this site's run (if any) and clears its unfinished work; applied jobs are kept. */
async function startFresh(platform: Platform): Promise<string> {
  const run = await getActiveRun();
  if (run?.id && (run.platform ?? 'naukri') === platform) {
    await updateRun(run.id, { state: 'stopped', stopRequested: true, finishedAt: new Date().toISOString(), error: 'Stopped by "Start fresh"' });
  }
  const cleared = await clearUnfinishedWork(platform);
  await log('background', `Start fresh (${platform}): stopped the run, cleared ${cleared} unfinished jobs and today's searches`);
  return `Cleared ${cleared} unfinished jobs. The next run starts from zero.`;
}

async function pauseRun(): Promise<void> {
  const run = await getActiveRun();
  if (run?.id && run.state === 'running') await updateRun(run.id, { state: 'paused', pauseReason: 'paused by user' });
}

async function resumeRun(): Promise<void> {
  const run = await getActiveRun();
  if (!run?.id || run.state !== 'paused') throw makeError('UNKNOWN', 'There is no paused run to resume');
  await updateRun(run.id, { state: 'running', pauseReason: undefined });
  await log('background', `Resumed run #${run.id}`);
  runPipeline(run.id);
}

/** Goes through the normal run queue, so it never shares the Naukri tab with a running job. */
async function refreshProfile(platform: Platform): Promise<number> {
  if (await getActiveRun()) throw makeError('UNKNOWN', 'Wait for the current run to finish (or stop it) before reading the profile.');
  return platform === 'linkedin'
    ? startNewRun('profile', ['LI_CHECK_LOGIN', 'LI_BUILD_PROFILE'], { platform: 'linkedin' })
    : startNewRun('profile', ['CHECK_LOGIN', 'BUILD_PROFILE'], { platform: 'naukri' });
}

async function resumeActiveRun(why: string): Promise<void> {
  const run = await getActiveRun();
  if (!run?.id) {
    // Chrome may have stopped the worker right after a "Run both" first half finished: start the second half now.
    const last = await db.runs.orderBy('id').last();
    if (last?.chainNext && !last.chainStarted) await startChainedRun(last);
    else await chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME);
    return;
  }
  if (run.state !== 'running' || isExecuting()) return;
  await log('background', `Resuming run #${run.id} (${why}) at step ${run.steps[run.stepIndex] ?? 'end'}`);
  runPipeline(run.id);
}

async function startDailyRun(): Promise<void> {
  if (await getActiveRun()) return log('background', 'Daily run skipped: a run is already active');
  await startRun('full');
}

/** Creates or removes the optional daily alarm at settings.autoRunDailyAt ('HH:mm', local time). */
async function updateDailyAlarm(): Promise<string> {
  const { autoRunDailyAt } = await getSettings();
  await chrome.alarms.clear(DAILY_RUN_ALARM_NAME);
  if (!autoRunDailyAt) return 'Daily run off';
  const [hours = 9, minutes = 0] = autoRunDailyAt.split(':').map(Number);
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  await chrome.alarms.create(DAILY_RUN_ALARM_NAME, { when: next.getTime(), periodInMinutes: 24 * 60 });
  return `Daily run at ${autoRunDailyAt} (next: ${next.toLocaleString()})`;
}

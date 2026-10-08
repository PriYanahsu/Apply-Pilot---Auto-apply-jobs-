/**
 * FILE: orchestrator/runState.ts
 * WHAT: Load / save / pause / stop the current run. ALL run state lives in the `runs` table (rule R8),
 *       so a killed service worker can pick up exactly where it stopped.
 * CALLED BY: orchestrator/runPipeline.ts, entrypoints/background.ts, steps/*
 * IF IT BREAKS: "A run is already active" but nothing is running? Press Stop in the Run tab.
 */
import { db } from '../db/database';
import type { Platform, Run, RunCounters, StepName } from '../db/types';
import { makeError } from '../shared/errors';
import { sleep } from '../shared/sleep';

export const EMPTY_COUNTERS: RunCounters = {
  found: 0, filtered: 0, scored: 0, queued: 0, applied: 0, external: 0,
  needsReview: 0, failed: 0, appliesThisRun: 0, selectorFailStreak: 0,
};

export async function getActiveRun(): Promise<Run | undefined> {
  const activeRuns = await db.runs.where('state').anyOf('running', 'paused').toArray();
  return activeRuns.sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0];
}

export interface NewRunOptions {
  mode: string;
  steps: StepName[];
  maxApplies?: number;
  targetJobId?: string;
  platform?: Platform;
  chainNext?: Platform;
}

/** Creates a run row. Only one run at a time. */
export async function createRun(options: NewRunOptions): Promise<number> {
  const active = await getActiveRun();
  if (active) throw makeError('UNKNOWN', `Run #${active.id} is already ${active.state}. Stop it first.`);
  return db.runs.add({
    startedAt: new Date().toISOString(), mode: options.mode, platform: options.platform ?? 'naukri', chainNext: options.chainNext, steps: options.steps, stepIndex: 0,
    state: 'running', searchCursor: 0, maxApplies: options.maxApplies, targetJobId: options.targetJobId,
    stopRequested: false, counters: { ...EMPTY_COUNTERS },
  });
}

export async function loadRun(runId: number): Promise<Run> {
  const run = await db.runs.get(runId);
  if (!run) throw makeError('UNKNOWN', `Run #${runId} not found`);
  return run;
}

export async function updateRun(runId: number, changes: Partial<Run>): Promise<void> {
  await db.runs.update(runId, changes);
}

/** Adds to one counter inside a transaction so two quick updates can't overwrite each other. */
export async function bumpCounter(runId: number, counter: keyof RunCounters, amount = 1): Promise<void> {
  await db.transaction('rw', db.runs, async () => {
    const run = await loadRun(runId);
    await db.runs.update(runId, { counters: { ...run.counters, [counter]: run.counters[counter] + amount } });
  });
}

export async function setCounter(runId: number, counter: keyof RunCounters, value: number): Promise<void> {
  await db.transaction('rw', db.runs, async () => {
    const run = await loadRun(runId);
    await db.runs.update(runId, { counters: { ...run.counters, [counter]: value } });
  });
}

/** Steps call this between items. Throws STOP_REQUESTED / PAUSE_REQUESTED so the pipeline can unwind cleanly. */
export async function checkpoint(runId: number): Promise<void> {
  const run = await loadRun(runId);
  if (run.stopRequested) throw makeError('STOP_REQUESTED', 'Stopped by user');
  if (run.state === 'paused') throw makeError('PAUSE_REQUESTED', `Paused: ${run.pauseReason ?? 'by user'}`);
}

const CHECKPOINT_INTERVAL_MS = 1_000;

/** Reasons shown under the countdown in the Run tab. */
export const WAIT_REASONS = {
  afterLinkedInApply: 'Applied! Waiting like a person would before the next application - LinkedIn limits how fast accounts can apply.',
  linkedInLongBreak: 'Taking a longer break after 5 applications - this keeps your LinkedIn account safe.',
  betweenJobPages: 'Natural pace between job pages, like reading one job and then opening the next.',
  betweenSearchPages: 'Short pause between search pages, like scrolling the results at a normal pace.',
  afterNaukriApply: 'Short pause after applying before the next job.',
} as const;

/**
 * Waits `milliseconds`, checking for Stop / Pause every second so long breaks never delay a Stop.
 * The pause (end time + reason) is saved on the run so the side panel can show a live countdown.
 */
export async function waitWithCheckpoints(runId: number, milliseconds: number, reason: string = WAIT_REASONS.betweenJobPages): Promise<void> {
  const endTime = Date.now() + milliseconds;
  await updateRun(runId, { waitingUntil: new Date(endTime).toISOString(), waitingTotalMs: milliseconds, waitingReason: reason });
  try {
    while (Date.now() < endTime) {
      await checkpoint(runId);
      await sleep(Math.min(CHECKPOINT_INTERVAL_MS, endTime - Date.now()));
    }
  } finally {
    await updateRun(runId, { waitingUntil: undefined, waitingTotalMs: undefined, waitingReason: undefined });
  }
}

export async function finishRun(runId: number, state: 'done' | 'stopped' | 'error', error?: string): Promise<void> {
  await updateRun(runId, { state, error, finishedAt: new Date().toISOString() });
}

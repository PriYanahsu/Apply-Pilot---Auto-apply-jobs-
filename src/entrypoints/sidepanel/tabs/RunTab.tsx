/**
 * FILE: tabs/RunTab.tsx
 * WHAT: The home screen for the site picked in the header (Naukri / LinkedIn): setup checklist, Test/Live switch,
 *       the start buttons and limits,
 *       and the current run (progress steps, counters, controls, activity log) - all live from IndexedDB.
 * CALLED BY: sidepanel/App.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { MAX_NEW_JOBS_PER_RUN_LIMIT } from '../../../config';
import { db, getSettings, todayDateString } from '../../../db/database';
import type { Settings } from '../../../db/types';
import { todaysSearchProgress } from '../../../steps/3-searchJobs';
import { todaysLinkedInSearchProgress } from '../../../steps/linkedin/li-3-searchJobs';
import { PLATFORM_NAMES, platformLimits, savePlatformLimits } from '../platform';
import { sendToBackground, type PanelCommand } from '../../../shared/messages';
import { Icon } from '../icons';
import type { TabProps } from '../navigation';
import { Button, Card, Message, Toggle } from '../ui';
import { useSetupStatus } from '../useSetupStatus';
import ActivityLog from './run/ActivityLog';
import { AnswerModeSwitch, LinkedInNotice, OtherSiteRunning } from './run/RunCards';
import RunProgress from './run/RunProgress';
import SetupChecklist from './run/SetupChecklist';

/** The three numbers you change most, for the selected site: jobs to find, match score to apply, applies per run. */
function RunLimits({ settings }: { settings: Settings }) {
  const limits = platformLimits(settings);
  const [jobsText, setJobsText] = useState(String(limits.maxNewJobsPerRun));
  const [scoreText, setScoreText] = useState(String(limits.minScore));
  const [appliesText, setAppliesText] = useState(String(Math.min(limits.maxAppliesPerRun, limits.dailyCap)));

  function save(text: string, setText: (value: string) => void, min: number, max: number, key: 'maxNewJobsPerRun' | 'minScore' | 'maxAppliesPerRun') {
    const value = Math.min(Math.max(Number(text) || min, min), max);
    setText(String(value));
    savePlatformLimits(settings, { [key]: value });
  }

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      <label className="block">
        <span className="mb-1 block text-[11px] leading-tight font-medium text-slate-600">Jobs to find<br />(max {MAX_NEW_JOBS_PER_RUN_LIMIT})</span>
        <input type="number" min={1} max={MAX_NEW_JOBS_PER_RUN_LIMIT} step={10} value={jobsText}
          onChange={(event) => setJobsText(event.target.value)} onBlur={() => save(jobsText, setJobsText, 1, MAX_NEW_JOBS_PER_RUN_LIMIT, 'maxNewJobsPerRun')} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] leading-tight font-medium text-slate-600">Apply if match<br />≥ (0-100)</span>
        <input type="number" min={0} max={100} step={5} value={scoreText}
          onChange={(event) => setScoreText(event.target.value)} onBlur={() => save(scoreText, setScoreText, 0, 100, 'minScore')} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] leading-tight font-medium text-slate-600">Max applies<br />per run (≤ {limits.dailyCap})</span>
        <input type="number" min={1} max={limits.dailyCap} value={appliesText}
          onChange={(event) => setAppliesText(event.target.value)} onBlur={() => save(appliesText, setAppliesText, 1, limits.dailyCap, 'maxAppliesPerRun')} />
      </label>
    </div>
  );
}

/** "Today's searches: 3 of 8 done" for the selected site - later runs today continue; tomorrow (or Start fresh) starts over. */
function TodaysSearches({ settings }: { settings: Settings }) {
  const linkedIn = settings.platform === 'linkedin';
  const progress = useLiveQuery(() => (linkedIn ? todaysLinkedInSearchProgress(settings) : todaysSearchProgress(settings)), [linkedIn, settings.keywords.join(), settings.locations.join()]);
  if (!progress || progress.total === 0) return null;
  const allDone = progress.done >= progress.total;

  return (
    <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
      <span>
        Today's searches: <b className="text-slate-800">{progress.done} of {progress.total}</b> done
        {allDone ? ' - add keywords or cities, or press Start fresh' : ''}
      </span>
    </div>
  );
}

export default function RunTab({ goTo }: TabProps) {
  const settings = useLiveQuery(() => getSettings());
  const platform = settings?.platform ?? 'naukri';
  // The latest run for the site picked in the header (runs from before LinkedIn support count as Naukri).
  const lastRun = useLiveQuery(async () => (await db.runs.orderBy('id').reverse().toArray()).find((run) => (run.platform ?? 'naukri') === platform), [platform]);
  const setup = useSetupStatus();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function send(command: PanelCommand) {
    setError('');
    try {
      await sendToBackground(command);
    } catch (commandError) {
      setError(String(commandError).replace(/^Error: /, ''));
    }
  }

  const isActive = lastRun?.state === 'running' || lastRun?.state === 'paused';

  async function startFresh() {
    const site = PLATFORM_NAMES[platform];
    const ok = confirm(`Start fresh on ${site}?\n\n- Stops the current ${site} run\n- Clears jobs that are found / read / scored / queued / waiting / failed\n- Clears today's searches\n\nApplied jobs are kept, so nothing is applied to twice.`);
    if (!ok) return;
    setError('');
    try {
      setNotice(await sendToBackground<string>({ type: 'START_FRESH', platform }));
    } catch (resetError) {
      setError(String(resetError).replace(/^Error: /, ''));
    }
  }
  // A run on the OTHER site keeps going in the background; only one run at a time.
  const activeRun = useLiveQuery(async () => (await db.runs.where('state').anyOf('running', 'paused').toArray()).pop());
  const otherSiteRun = activeRun && (activeRun.platform ?? 'naukri') !== platform ? activeRun : undefined;
  const limits = settings ? platformLimits(settings) : null;
  const siteName = PLATFORM_NAMES[settings?.platform ?? 'naukri'];
  const canStart = setup.complete && !isActive && !otherSiteRun;

  return (
    <div className="space-y-3">
      {setup.loaded && !setup.complete && <SetupChecklist setup={setup} goTo={goTo} />}

      {otherSiteRun && <OtherSiteRunning run={otherSiteRun} send={send} />}
      {settings?.platform === 'linkedin' && <LinkedInNotice />}

      {limits && settings && (
        <Card className={limits.dryRun ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60'}>
          <Toggle
            checked={!limits.dryRun}
            onChange={(live) => savePlatformLimits(settings, { dryRun: !live })}
            label={limits.dryRun ? `Test mode (${siteName})` : `Live mode - applying on ${siteName} for real`}
            description={limits.dryRun
              ? 'Everything runs, but nothing is submitted. The log shows "WOULD APPLY". Switch on to apply for real.'
              : `Applications are submitted to ${siteName}, one job at a time, each one confirmed.`}
          />
        </Card>
      )}

      <Card>
        <Button kind="primary" size="lg" icon="play" className="w-full" disabled={!canStart} onClick={() => send({ type: 'START_RUN', mode: 'full' })}>
          Find & Apply
        </Button>
        {settings && <RunLimits key={settings.platform} settings={settings} />}
        {limits && <p className="mt-2 text-center text-[11px] text-slate-500">Finds up to {limits.maxNewJobsPerRun} new {siteName} jobs, reads and scores each one, then applies to every job matching {limits.minScore}% or more (up to {limits.maxAppliesPerRun} per run, {limits.dailyCap} per day). Tip: 65-75 suits most people. After "Find only", open a job's "Why?" in the Jobs tab to check the scores.</p>}
        <button
          disabled={!canStart}
          onClick={() => send({ type: 'START_BOTH' })}
          title="Runs Naukri's Find & Apply, then LinkedIn's automatically - one after the other"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#275df5] text-[10px] font-black text-white">N</span>
          Run both
          <Icon name="play" className="h-3 w-3 text-slate-400" />
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0a66c2] text-[10px] font-black text-white">in</span>
          <span className="text-[11px] font-normal text-slate-500">Naukri, then LinkedIn</span>
        </button>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button icon="search" disabled={!canStart} onClick={() => send({ type: 'START_RUN', mode: 'find' })} title="Search, read and score jobs without applying">Find only</Button>
          <Button icon="briefcase" disabled={!canStart} onClick={() => send({ type: 'START_RUN', mode: 'apply' })} title="Apply to jobs already scored as good matches">Apply queued</Button>
        </div>
        <div className="mt-2 flex justify-center">
          <Button size="sm" kind="ghost" icon="refresh" title="Stop this site's run and clear unfinished jobs and today's searches. Applied jobs are kept."
            onClick={() => startFresh()}>Start fresh</Button>
        </div>
        {settings && <AnswerModeSwitch settings={settings} />}
        {settings && <TodaysSearches settings={settings} />}
        <Message kind="success" text={notice} />
        <Message kind="error" text={error} />
      </Card>

      {lastRun ? (
        <>
          <RunProgress run={lastRun} send={send} />
          {lastRun.id !== undefined && <ActivityLog runId={lastRun.id} />}
        </>
      ) : (
        <p className="flex items-center justify-center gap-1.5 py-4 text-xs text-slate-500"><Icon name="info" className="h-3.5 w-3.5" />No runs yet. Start with "Find only" to see what it finds.</p>
      )}
    </div>
  );
}

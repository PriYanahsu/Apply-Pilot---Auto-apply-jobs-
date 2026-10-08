/**
 * FILE: tabs/run/RunProgress.tsx
 * WHAT: The current run: state pill, step-by-step progress, counters, and Pause / Resume / Stop.
 * CALLED BY: tabs/RunTab.tsx
 */
import { NAUKRI_LOGIN_URL } from '../../../../config';
import type { Run, RunCounters } from '../../../../db/types';
import type { PanelCommand } from '../../../../shared/messages';
import { Icon } from '../../icons';
import { runModeLabel, STEP_LABELS } from '../../labels';
import { Button, Card, Message } from '../../ui';
import WaitingCountdown from './WaitingCountdown';

const COUNTERS: { key: keyof RunCounters; label: string; color: string }[] = [
  { key: 'found', label: 'Found', color: 'text-slate-800' },
  { key: 'filtered', label: 'Filtered', color: 'text-slate-500' },
  { key: 'scored', label: 'Scored', color: 'text-indigo-700' },
  { key: 'queued', label: 'Queued', color: 'text-brand-700' },
  { key: 'applied', label: 'Applied', color: 'text-emerald-600' },
  { key: 'external', label: 'Company site', color: 'text-purple-700' },
  { key: 'needsReview', label: 'Need answer', color: 'text-amber-600' },
  { key: 'failed', label: 'Failed', color: 'text-red-600' },
];

const STATE_PILL: Record<Run['state'], { label: string; style: string }> = {
  running: { label: 'Running', style: 'bg-brand-100 text-brand-800' },
  paused: { label: 'Paused', style: 'bg-amber-100 text-amber-800' },
  done: { label: 'Finished', style: 'bg-emerald-100 text-emerald-800' },
  stopped: { label: 'Stopped', style: 'bg-slate-200 text-slate-700' },
  error: { label: 'Error', style: 'bg-red-100 text-red-700' },
};

function stepIcon(index: number, run: Run) {
  const finished = run.state === 'done' || index < run.stepIndex;
  if (finished) return <Icon name="checkCircle" className="h-4 w-4 text-emerald-500" />;
  if (index === run.stepIndex && run.state === 'running') return <Icon name="spinner" className="h-4 w-4 text-brand-600" />;
  if (index === run.stepIndex && run.state === 'paused') return <Icon name="pause" className="h-4 w-4 text-amber-500" />;
  if (index === run.stepIndex && run.state === 'error') return <Icon name="alert" className="h-4 w-4 text-red-500" />;
  return <Icon name="circle" className="h-4 w-4 text-slate-300" />;
}

export default function RunProgress({ run, send }: { run: Run; send: (command: PanelCommand) => void }) {
  const pill = STATE_PILL[run.state];
  const needsLogin = run.state === 'error' && /log in/i.test(run.error ?? '');
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{runModeLabel(run.mode)}</h2>
          <p className="text-[11px] text-slate-500">Run #{run.id} · started {new Date(run.startedAt).toLocaleTimeString()}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${pill.style}`}>
          {run.state === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-600" />}
          {pill.label}
        </span>
      </div>

      {run.chainNext && !run.chainStarted && (run.state === 'running' || run.state === 'paused') && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
          <Icon name="info" className="h-3.5 w-3.5 text-brand-600" />
          Run both: <b className="text-slate-800">{run.chainNext === 'linkedin' ? 'LinkedIn' : 'Naukri'}</b> starts automatically when this finishes.
        </p>
      )}
      <WaitingCountdown run={run} />

      <ol className="mb-3 space-y-1.5">
        {run.steps.map((step, index) => (
          <li key={step} className={`flex items-center gap-2 text-xs ${index === run.stepIndex && run.state !== 'done' ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
            {stepIcon(index, run)}
            {STEP_LABELS[step]}
          </li>
        ))}
      </ol>

      {run.pauseReason && run.state === 'paused' && <Message kind="warning" text={`Paused: ${run.pauseReason}. Press Resume when ready.`} />}
      {run.error && <Message kind={run.state === 'error' ? 'error' : 'info'} text={run.error} />}
      {needsLogin && <Button kind="primary" size="sm" icon="external" className="mb-2" onClick={() => chrome.tabs.create({ url: NAUKRI_LOGIN_URL })}>Log in to Naukri</Button>}

      <div className="grid grid-cols-4 gap-1.5">
        {COUNTERS.map((counter) => (
          <div key={counter.key} className="rounded-lg bg-slate-50 px-1 py-2 text-center">
            <div className={`text-lg leading-none font-bold ${counter.color}`}>{run.counters[counter.key]}</div>
            <div className="mt-1 text-[10px] leading-tight text-slate-500">{counter.label}</div>
          </div>
        ))}
      </div>

      {(run.state === 'running' || run.state === 'paused') && (
        <div className="mt-3 flex gap-2">
          {run.state === 'running' && <Button icon="pause" className="flex-1" onClick={() => send({ type: 'PAUSE_RUN' })}>Pause</Button>}
          {run.state === 'paused' && <Button kind="primary" icon="play" className="flex-1" onClick={() => send({ type: 'RESUME_RUN' })}>Resume</Button>}
          <Button kind="danger" icon="stop" className="flex-1" onClick={() => send({ type: 'STOP_RUN' })}>Stop</Button>
        </div>
      )}
    </Card>
  );
}

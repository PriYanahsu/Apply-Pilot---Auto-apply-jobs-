/**
 * FILE: tabs/setup/ProfileProgress.tsx
 * WHAT: Live loader while your profile is being read (resume -> Naukri / LinkedIn profile): each step with a
 *       spinner or check, what is happening right now, and the result (ready / error). Disappears shortly after.
 * CALLED BY: tabs/setup/ResumeProfileSection.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../../db/database';
import type { Platform, Run } from '../../../../db/types';
import { Icon } from '../../icons';
import { STEP_LABELS } from '../../labels';

const SHOW_DONE_FOR_MS = 15_000;
const SHOW_ERROR_FOR_MS = 10 * 60_000;

/** The latest "read profile" run for this site, or undefined. */
export function useProfileRun(platform: Platform): Run | undefined {
  return useLiveQuery(async () => (await db.runs.orderBy('id').reverse().toArray()).find((run) => run.mode === 'profile' && (run.platform ?? 'naukri') === platform), [platform]);
}

export function isRunActive(run: Run | undefined): boolean {
  return run?.state === 'running' || run?.state === 'paused';
}

export default function ProfileProgress({ run }: { run: Run | undefined }) {
  const lastLog = useLiveQuery(async () => (run?.id !== undefined ? db.logs.where('runId').equals(run.id).last() : undefined), [run?.id, run?.stepIndex, run?.state]);
  if (!run) return null;
  const finishedAgo = run.finishedAt ? Date.now() - new Date(run.finishedAt).getTime() : 0;
  const active = isRunActive(run);
  if (!active && run.state === 'done' && finishedAgo > SHOW_DONE_FOR_MS) return null;
  if (!active && run.state !== 'done' && finishedAgo > SHOW_ERROR_FOR_MS) return null;

  const tone = active ? 'border-brand-200 bg-brand-50/70' : run.state === 'done' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50';
  const title = active ? 'Reading your profile…' : run.state === 'done' ? 'Profile ready' : run.state === 'stopped' ? 'Stopped' : 'Could not read your profile';
  return (
    <div className={`mt-3 rounded-xl border p-3 ${tone}`} role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
        <Icon name={active ? 'spinner' : run.state === 'done' ? 'checkCircle' : 'alert'} className={`h-4 w-4 ${active ? 'text-brand-600' : run.state === 'done' ? 'text-emerald-600' : 'text-red-600'}`} />
        {title}
      </p>
      <ol className="mt-2 space-y-1">
        {run.steps.map((step, index) => {
          const done = run.state === 'done' || index < run.stepIndex;
          const current = index === run.stepIndex && active;
          return (
            <li key={step} className={`flex items-center gap-2 text-xs ${current ? 'font-semibold text-slate-900' : done ? 'text-slate-600' : 'text-slate-400'}`}>
              <Icon name={done ? 'checkCircle' : current ? 'spinner' : 'circle'} className={`h-3.5 w-3.5 ${done ? 'text-emerald-500' : current ? 'text-brand-600' : 'text-slate-300'}`} />
              {STEP_LABELS[step]}
            </li>
          );
        })}
      </ol>
      {active && lastLog && <p className="mt-2 text-[11px] text-slate-600"><b className="text-slate-700">Now: </b>{lastLog.message}</p>}
      {!active && run.state !== 'done' && run.error && <p className="mt-2 text-[11px] text-red-700">{run.error}</p>}
      {active && <p className="mt-1 text-[10px] text-slate-400">This takes about 20-40 seconds. A background tab opens your profile - you can keep using Chrome.</p>}
    </div>
  );
}

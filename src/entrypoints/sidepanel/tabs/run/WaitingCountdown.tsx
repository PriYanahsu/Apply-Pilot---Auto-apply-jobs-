/**
 * FILE: tabs/run/WaitingCountdown.tsx
 * WHAT: When a LinkedIn run is pausing on purpose (e.g. after an application), shows a live countdown,
 *       a progress bar and the plain-English reason - so a pause never looks like the extension is stuck.
 * CALLED BY: tabs/run/RunProgress.tsx
 */
import { useEffect, useState } from 'react';
import type { Run } from '../../../../db/types';
import { Icon } from '../../icons';

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function WaitingCountdown({ run }: { run: Run }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  // LinkedIn only: its pauses are long on purpose. Naukri has no pause after applying, just 2-4 s page loads.
  if ((run.platform ?? 'naukri') !== 'linkedin' || run.state !== 'running' || !run.waitingUntil) return null;
  const remainingMs = new Date(run.waitingUntil).getTime() - now;
  if (remainingMs <= 0) return null;
  const totalMs = run.waitingTotalMs ?? remainingMs;
  const donePercent = Math.min(100, Math.max(0, Math.round(((totalMs - remainingMs) / totalMs) * 100)));

  return (
    <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50/70 p-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-800">
          <Icon name="clock" className="h-3.5 w-3.5" />Next step in
        </span>
        <span className="font-mono text-lg leading-none font-bold text-brand-700 tabular-nums">{formatSeconds(Math.ceil(remainingMs / 1000))}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-brand-500 transition-[width] duration-1000 ease-linear" style={{ width: `${donePercent}%` }} />
      </div>
      {run.waitingReason && <p className="mt-2 text-[11px] leading-snug text-slate-600"><b className="text-slate-700">Why: </b>{run.waitingReason}</p>}
    </div>
  );
}

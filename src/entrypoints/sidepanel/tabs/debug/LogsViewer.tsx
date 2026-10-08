/**
 * FILE: tabs/debug/LogsViewer.tsx
 * WHAT: The selected site's log lines (plus shared ones), filterable by step and jobId - trace one job from search to apply (rule D2).
 * CALLED BY: tabs/DebugTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../../../db/database';
import { inScope, logScope, runPlatforms } from '../../../../db/platformScope';
import type { Platform } from '../../../../db/types';
import { Section } from '../../ui';

const MAX_LOG_ROWS = 1000;

export default function LogsViewer({ platform }: { platform: Platform }) {
  const [stepFilter, setStepFilter] = useState('');
  const [jobIdFilter, setJobIdFilter] = useState('');
  const logs = useLiveQuery(async () => {
    const runs = await runPlatforms();
    const rows = jobIdFilter.trim()
      ? await db.logs.where('jobId').equals(jobIdFilter.trim()).toArray()
      : await db.logs.orderBy('id').reverse().limit(MAX_LOG_ROWS).toArray();
    return rows
      .filter((row) => inScope(logScope(row, runs), platform))
      .filter((row) => !stepFilter || row.step.includes(stepFilter))
      .sort((left, right) => (right.id ?? 0) - (left.id ?? 0));
  }, [stepFilter, jobIdFilter, platform]) ?? [];

  return (
    <Section title="Logs" right={<button className="text-[11px] text-red-600 underline" onClick={() => db.logs.clear()}>clear</button>}>
      <div className="mb-2 flex gap-2">
        <input placeholder="step (e.g. 6-score)" value={stepFilter} onChange={(event) => setStepFilter(event.target.value)} />
        <input placeholder="jobId" value={jobIdFilter} onChange={(event) => setJobIdFilter(event.target.value)} />
      </div>
      <div className="max-h-96 overflow-y-auto font-mono text-[10px] leading-4">
        {logs.map((row) => (
          <div key={row.id} className={row.level === 'error' ? 'text-red-600' : row.level === 'warn' ? 'text-amber-600' : ''}>
            [{new Date(row.ts).toLocaleTimeString()}] [{row.step}] {row.message}
            {row.jobId && <button className="ml-1 text-brand-600 underline" onClick={() => setJobIdFilter(row.jobId ?? '')}>{row.jobId}</button>}
            {row.data && <span className="text-slate-400"> {row.data.slice(0, 300)}</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

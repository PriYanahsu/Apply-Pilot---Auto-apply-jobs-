/**
 * FILE: tabs/run/ActivityLog.tsx
 * WHAT: Live, readable activity feed for one run (newest first). Warnings amber, errors red.
 * CALLED BY: tabs/RunTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../../../db/database';
import { Card } from '../../ui';

const COLLAPSED_ROWS = 12;
const MAX_ROWS = 200;

export default function ActivityLog({ runId }: { runId: number }) {
  const [expanded, setExpanded] = useState(false);
  const logs = useLiveQuery(() => db.logs.where('runId').equals(runId).reverse().limit(MAX_ROWS).toArray(), [runId]) ?? [];
  const visible = expanded ? logs : logs.slice(0, COLLAPSED_ROWS);
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
        {logs.length > COLLAPSED_ROWS && (
          <button className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show all (${logs.length})`}
          </button>
        )}
      </div>
      <ul className={`divide-y divide-slate-50 ${expanded ? 'max-h-96 overflow-y-auto' : ''}`}>
        {visible.length === 0 && <li className="px-3.5 py-3 text-xs text-slate-400">Waiting for the first step…</li>}
        {visible.map((row) => (
          <li key={row.id} className="flex gap-2 px-3.5 py-1.5 text-[11.5px] leading-snug">
            <span className="w-[52px] shrink-0 pt-px font-mono text-[10px] whitespace-nowrap text-slate-400 tabular-nums">{new Date(row.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
            <span className={row.level === 'error' ? 'text-red-600' : row.level === 'warn' ? 'text-amber-700' : 'text-slate-700'}>{row.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

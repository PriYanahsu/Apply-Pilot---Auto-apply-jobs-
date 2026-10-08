/**
 * FILE: tabs/debug/EvidenceLists.tsx
 * WHAT: Failure snapshots (download the page HTML to fix a selector) and Gemini calls (prompt -> raw -> parsed).
 * CALLED BY: tabs/DebugTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../../db/database';
import { aiCallScope, inScope, snapshotScope } from '../../../../db/platformScope';
import type { Platform } from '../../../../db/types';
import { Section, downloadFile } from '../../ui';

export function SnapshotsList({ platform }: { platform: Platform }) {
  const snapshots = useLiveQuery(async () => (await db.debugSnapshots.orderBy('id').reverse().limit(200).toArray()).filter((snapshot) => inScope(snapshotScope(snapshot), platform)).slice(0, 50), [platform]) ?? [];
  return (
    <Section title={`Failure snapshots (${snapshots.length})`} right={<button className="text-[11px] text-red-600 underline" onClick={() => db.debugSnapshots.clear()}>clear</button>}>
      {snapshots.length === 0 && <p className="text-xs text-slate-500">None - good news.</p>}
      {snapshots.map((snapshot) => (
        <div key={snapshot.id} className="mb-1 border-b border-slate-100 pb-1 text-[11px]">
          <b>{snapshot.selectorKey}</b> · {snapshot.step} · {new Date(snapshot.ts).toLocaleString()} {snapshot.jobId && `· job ${snapshot.jobId}`}
          <div className="truncate text-slate-500">{snapshot.url}</div>
          <button className="text-brand-700 underline"
            onClick={() => downloadFile(`snapshot-${snapshot.selectorKey}-${snapshot.id}.html`, `<!-- ${snapshot.url} | missing: ${snapshot.selectorKey} -->\n${snapshot.html}`, 'text/html')}>
            Download HTML
          </button>
        </div>
      ))}
    </Section>
  );
}

export function AiCallsList({ platform }: { platform: Platform }) {
  const calls = useLiveQuery(async () => (await db.aiCalls.orderBy('id').reverse().limit(150).toArray()).filter((call) => inScope(aiCallScope(call), platform)).slice(0, 30), [platform]) ?? [];
  return (
    <Section title={`Gemini calls (${calls.length})`} right={<button className="text-[11px] text-red-600 underline" onClick={() => db.aiCalls.clear()}>clear</button>}>
      {calls.length === 0 && <p className="text-xs text-slate-500">Turn on debug mode to record Gemini calls.</p>}
      {calls.map((call) => (
        <details key={call.id} className="mb-1 text-[11px]">
          <summary>{call.promptName} · {call.model ?? ''} · {new Date(call.ts).toLocaleTimeString()} {call.jobId && `· job ${call.jobId}`}</summary>
          <p className="mt-1 font-semibold">Prompt</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-slate-50 p-1">{call.prompt}</pre>
          <p className="font-semibold">Raw response</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-slate-50 p-1">{call.rawResponse}</pre>
          <p className="font-semibold">Parsed</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-slate-50 p-1">{call.parsed}</pre>
        </details>
      ))}
    </Section>
  );
}

/**
 * FILE: tabs/DataTab.tsx
 * WHAT: Backup (export JSON / CSV), restore (import JSON), and clearing data.
 * CALLED BY: sidepanel/App.tsx
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '../../../db/database';
import { PLATFORM_NAMES } from '../platform';
import { clearAllData, clearJobHistoryData, exportAll, importAll, jobsToCsv } from '../../../db/exportImport';
import { Button, Message, Section, Toggle, downloadFile } from '../ui';

export default function DataTab() {
  const platform = useLiveQuery(async () => (await getSettings()).platform) ?? 'naukri';
  const [includeKey, setIncludeKey] = useState(false);
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' | 'success' });
  const stamp = new Date().toISOString().slice(0, 10);

  async function run(action: () => Promise<string>) {
    try {
      setMessage({ text: await action(), kind: 'success' });
    } catch (error) {
      setMessage({ text: String(error), kind: 'error' });
    }
  }

  async function exportJson() {
    downloadFile(`applypilot-backup-${stamp}.json`, await exportAll(includeKey), 'application/json');
    return 'Backup downloaded';
  }

  async function exportCsv() {
    downloadFile(`naukri-jobs-${stamp}.csv`, jobsToCsv(await db.jobs.toArray()), 'text/csv');
    return 'Jobs spreadsheet downloaded';
  }

  async function clearJobHistory() {
    const site = PLATFORM_NAMES[platform];
    if (!confirm(`Delete all ${site} jobs, runs and logs? The other site, your settings, profile and saved answers are kept.`)) return;
    await run(async () => { await clearJobHistoryData(platform); return `${site} job history cleared`; });
  }

  async function clearEverything() {
    if (!confirm('Delete EVERYTHING (settings, API key, profile, jobs, answers, logs)? Download a backup first if you want one.')) return;
    await run(async () => { await clearAllData(); return 'All data cleared'; });
  }

  return (
    <div>
      <Section title="Back up" description="Everything is stored only in this browser. Download a copy any time.">
        <Toggle checked={includeKey} onChange={setIncludeKey} label="Include my Gemini API key" description="Off = the key is left out of the file." />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button icon="download" onClick={() => run(exportJson)}>Backup (JSON)</Button>
          <Button icon="download" onClick={() => run(exportCsv)}>Jobs (CSV)</Button>
        </div>
      </Section>
      <Section title="Restore" description="Load a backup file you downloaded earlier.">
        <input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) run(async () => importAll(await file.text())); }} />
      </Section>
      <Section title="Clear data">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600">{PLATFORM_NAMES[platform]} jobs, runs and logs only. Keeps the other site, settings, profile and answers.</p>
            <Button kind="danger" size="sm" icon="trash" onClick={clearJobHistory}>Clear {PLATFORM_NAMES[platform]} jobs</Button>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
            <p className="text-xs text-slate-600">Everything, like a fresh install.</p>
            <Button kind="danger" size="sm" icon="trash" onClick={clearEverything}>Clear all</Button>
          </div>
        </div>
      </Section>
      <Message text={message.text} kind={message.kind} />
    </div>
  );
}

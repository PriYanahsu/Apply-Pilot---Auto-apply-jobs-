/**
 * FILE: tabs/DebugTab.tsx
 * WHAT: Dry-run / debug-mode toggles, one button per pipeline step (rule D4), "Copy debug report" (D8),
 *       plus the logs viewer, failure snapshots and Gemini calls.
 * CALLED BY: sidepanel/App.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getSettings, saveSettings } from '../../../db/database';
import { buildDebugReport } from '../../../db/exportImport';
import type { StepName } from '../../../db/types';
import { sendToBackground, type PanelCommand } from '../../../shared/messages';
import { Button, Message, Section, Toggle } from '../ui';
import LogsViewer from './debug/LogsViewer';
import { AiCallsList, SnapshotsList } from './debug/EvidenceLists';

const STEP_BUTTONS: { label: string; step: StepName }[] = [
  { label: 'Check login', step: 'CHECK_LOGIN' },
  { label: 'Search', step: 'SEARCHING' },
  { label: 'Filter', step: 'FILTERING' },
  { label: 'Enrich', step: 'ENRICHING' },
  { label: 'Score', step: 'SCORING' },
  { label: 'Queue', step: 'QUEUEING' },
  { label: 'Re-check applied jobs', step: 'VERIFY_APPLIED' },
];

export default function DebugTab() {
  const settings = useLiveQuery(() => getSettings());
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' | 'success' });

  async function send(command: PanelCommand) {
    try {
      await sendToBackground(command);
      setMessage({ text: 'Started - watch the Run tab or the logs below.', kind: 'success' });
    } catch (error) {
      setMessage({ text: String(error), kind: 'error' });
    }
  }

  async function copyReport() {
    await navigator.clipboard.writeText(await buildDebugReport(settings?.platform ?? 'naukri'));
    setMessage({ text: 'Debug report copied. Paste it to your AI assistant.', kind: 'success' });
  }

  if (!settings) return <p className="py-6 text-center text-xs text-slate-500">Loading…</p>;
  return (
    <div>
      <Section title="Something wrong?" description="Copy a report (no API key, no resume) and paste it to your AI assistant.">
        <Button kind="primary" icon="copy" onClick={copyReport}>Copy debug report</Button>
      </Section>
      <Section title="Modes">
        <Toggle checked={settings.dryRun} onChange={(dryRun) => saveSettings({ dryRun })} label="Test mode" description='Do everything except the final Apply click (logs "WOULD APPLY").' />
        <Toggle checked={settings.debugMode} onChange={(debugMode) => saveSettings({ debugMode })} label="Record AI calls" description="Save every Gemini prompt and response below." />
      </Section>
      <Section title="Run one step" description="Test a single step without running everything.">
        <div className="grid grid-cols-2 gap-1.5">
          {STEP_BUTTONS.map((item) => <Button key={item.step} size="sm" onClick={() => send({ type: 'RUN_STEP', step: item.step })}>{item.label}</Button>)}
          <Button size="sm" onClick={() => send({ type: 'APPLY_ONE_JOB' })}>Apply 1 job</Button>
        </div>
      </Section>
      <Message text={message.text} kind={message.kind} />
      <LogsViewer platform={settings.platform} />
      <SnapshotsList platform={settings.platform} />
      <AiCallsList platform={settings.platform} />
    </div>
  );
}

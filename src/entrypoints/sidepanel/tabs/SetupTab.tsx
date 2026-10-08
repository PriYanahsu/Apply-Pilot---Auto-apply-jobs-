/**
 * FILE: tabs/SetupTab.tsx
 * WHAT: Setup tab = Gemini key, resume + merged profile, search settings, and the facts form.
 *       Settings are edited as a local draft and written to the DB when you press Save.
 * CALLED BY: sidepanel/App.tsx
 */
import { useEffect, useState } from 'react';
import { HARD_MAX_DAILY_CAP } from '../../../config';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, saveSettings } from '../../../db/database';
import type { Settings } from '../../../db/types';
import { sendToBackground } from '../../../shared/messages';
import { Button, Message } from '../ui';
import GeminiSection from './setup/GeminiSection';
import ResumeProfileSection from './setup/ResumeProfileSection';
import SearchSettingsSection from './setup/SearchSettingsSection';
import FactsSection from './setup/FactsSection';

export type ChangeSettings = (changes: Partial<Settings>) => void;

export default function SetupTab() {
  const [draft, setDraft] = useState<Settings | null>(null);
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' | 'success' });

  useEffect(() => {
    getSettings().then(setDraft).catch((error) => setMessage({ text: `Could not load settings: ${error}`, kind: 'error' }));
  }, []);

  // Reading the profile (in the background) may pre-fill keywords / experience; pull those into the draft.
  const profileUpdatedAt = useLiveQuery(async () => (await db.profile.get('main'))?.updatedAt);
  useEffect(() => {
    if (!profileUpdatedAt) return;
    getSettings().then((saved) => setDraft((current) => (current ? { ...current, keywords: saved.keywords, experienceYears: saved.experienceYears } : saved)));
  }, [profileUpdatedAt]);

  if (!draft) return <p className="py-6 text-center text-xs text-slate-500">Loading…</p>;
  const change: ChangeSettings = (changes) => setDraft({ ...draft, ...changes });

  async function save() {
    if (!draft) return;
    try {
      // Settings changed on the Run / Debug tabs are NOT part of this form: saving an old copy would undo them.
      const { dryRun: _dryRun, debugMode: _debugMode, minScore: _minScore, maxNewJobsPerRun: _maxNewJobs, maxAppliesPerRun: _maxApplies, platform: _platform, linkedin: _linkedin, answerMode: _answerMode, ...formSettings } = draft;
      await saveSettings({ ...formSettings, dailyCap: Math.min(draft.dailyCap, HARD_MAX_DAILY_CAP) });
      await sendToBackground({ type: 'UPDATE_DAILY_ALARM' });
      setMessage({ text: 'Saved', kind: 'success' });
    } catch (error) {
      setMessage({ text: `Save failed: ${String(error)}`, kind: 'error' });
    }
  }

  /** Profile reading runs in the background; the effect above picks up its results. */
  function reloadFromDb() {
    setMessage({ text: '', kind: 'info' });
  }

  return (
    <div>
      <GeminiSection draft={draft} change={change} />
      <ResumeProfileSection onProfileBuilt={reloadFromDb} />
      <SearchSettingsSection draft={draft} change={change} />
      <FactsSection draft={draft} change={change} />
      <div className="sticky bottom-0 -mx-3 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur">
        <Button kind="primary" icon="check" onClick={save} className="w-full">Save settings</Button>
        <Message text={message.text} kind={message.kind} />
      </div>
    </div>
  );
}

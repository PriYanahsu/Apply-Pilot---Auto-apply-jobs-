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
import { useSetupStatus, type SetupStatus } from '../useSetupStatus';
import GeminiSection from './setup/GeminiSection';
import ResumeProfileSection from './setup/ResumeProfileSection';
import SearchSettingsSection from './setup/SearchSettingsSection';
import FactsSection from './setup/FactsSection';

export type ChangeSettings = (changes: Partial<Settings>) => void;

/**
 * The part of the settings this form saves. Settings changed elsewhere (Run / Debug tabs, the header switch,
 * profile corrections that save instantly) are left out: saving an old copy of them would undo those changes.
 */
function formSettings(settings: Settings): Partial<Settings> {
  const {
    dryRun: _dryRun, debugMode: _debugMode, minScore: _minScore, maxNewJobsPerRun: _maxNewJobs, maxAppliesPerRun: _maxApplies,
    platform: _platform, linkedin: _linkedin, answerMode: _answerMode, profileEdits: _profileEdits, resumeText: _resumeText, resumeFileName: _resumeFileName,
    ...form
  } = settings;
  return form;
}

/** One line telling a new user exactly what to do next. */
function NextStep({ setup }: { setup: SetupStatus }) {
  if (!setup.loaded) return null;
  const steps = [
    { done: setup.hasApiKey, text: 'Step 1: paste your free Gemini API key below (get it at aistudio.google.com/apikey).' },
    { done: setup.hasResume, text: 'Step 2: upload your resume PDF in "Resume & profile".' },
    { done: setup.hasProfile, text: 'Step 2: log in to the job site in this Chrome, then click "Read my profile".' },
    { done: setup.hasKeywords, text: 'Step 3: add the job titles to search for under "Jobs to look for", then Save.' },
  ];
  const next = steps.find((step) => !step.done);
  if (!next) {
    return <Message kind="success" text="Setup is complete. Check your target roles and skills below, then go to Run and press Find only." />;
  }
  return <Message kind="info" text={`Next: ${next.text}`} />;
}

export default function SetupTab() {
  const [draft, setDraft] = useState<Settings | null>(null);
  const [savedForm, setSavedForm] = useState('');
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' | 'success' });
  const setup = useSetupStatus();

  useEffect(() => {
    getSettings().then((saved) => {
      setDraft(saved);
      setSavedForm(JSON.stringify(formSettings(saved)));
    }).catch((error) => setMessage({ text: `Could not load settings: ${error}`, kind: 'error' }));
  }, []);

  // Reading the profile (in the background) may pre-fill keywords / experience; pull those into the draft.
  const profileUpdatedAt = useLiveQuery(async () => (await db.profile.get('main'))?.updatedAt);
  useEffect(() => {
    if (!profileUpdatedAt) return;
    getSettings().then((saved) => {
      setDraft((current) => (current ? { ...current, keywords: saved.keywords, experienceYears: saved.experienceYears } : saved));
      setSavedForm((form) => (form ? JSON.stringify({ ...JSON.parse(form), keywords: saved.keywords, experienceYears: saved.experienceYears }) : form));
    });
  }, [profileUpdatedAt]);

  if (!draft) return <p className="py-6 text-center text-xs text-slate-500">Loading…</p>;
  const change: ChangeSettings = (changes) => setDraft({ ...draft, ...changes });
  const unsaved = savedForm !== '' && JSON.stringify(formSettings(draft)) !== savedForm;

  async function save() {
    if (!draft) return;
    try {
      const form = { ...formSettings(draft), dailyCap: Math.min(draft.dailyCap, HARD_MAX_DAILY_CAP) };
      await saveSettings(form);
      await sendToBackground({ type: 'UPDATE_DAILY_ALARM' });
      setDraft({ ...draft, ...form });
      setSavedForm(JSON.stringify(formSettings({ ...draft, ...form })));
      setMessage({ text: 'Saved. The next run uses these settings.', kind: 'success' });
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
      <NextStep setup={setup} />
      <GeminiSection draft={draft} change={change} />
      <ResumeProfileSection onProfileBuilt={reloadFromDb} />
      <SearchSettingsSection draft={draft} change={change} />
      <FactsSection draft={draft} change={change} />
      <div className="sticky bottom-0 -mx-3 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur">
        {unsaved && <p className="mb-1.5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />You have unsaved changes</p>}
        <Button kind="primary" icon="check" onClick={save} className="w-full">{unsaved ? 'Save changes' : 'Save settings'}</Button>
        <Message text={message.text} kind={message.kind} />
      </div>
    </div>
  );
}

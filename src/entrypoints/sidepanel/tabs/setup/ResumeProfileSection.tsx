/**
 * FILE: tabs/setup/ResumeProfileSection.tsx
 * WHAT: Resume upload (PDF -> text, or paste for scanned PDFs) - shared by Naukri and LinkedIn - and
 *       "Read my <site> profile" for the site selected in the header (resume first, that profile for the gaps),
 *       with a live loader while it works and the merged profile view (skills tagged by source).
 * CALLED BY: tabs/SetupTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { MIN_RESUME_TEXT_CHARS } from '../../../../config';
import { db, getSettings, saveSettings } from '../../../../db/database';
import type { CandidateProfile } from '../../../../db/types';
import { sendToBackground } from '../../../../shared/messages';
import { Icon } from '../../icons';
import { PLATFORM_NAMES } from '../../platform';
import { readResumePdf } from '../../readResumePdf';
import { Button, Message, Section } from '../../ui';
import ProfileProgress, { isRunActive, useProfileRun } from './ProfileProgress';

const SOURCE_COLORS = {
  resume: 'bg-sky-100 text-sky-800', naukri: 'bg-orange-100 text-orange-800', linkedin: 'bg-indigo-100 text-indigo-800', both: 'bg-green-100 text-green-800',
};

export default function ResumeProfileSection(props: { onProfileBuilt: () => void }) {
  const settings = useLiveQuery(() => getSettings());
  const profile = useLiveQuery(() => db.profile.get('main'));
  const platform = settings?.platform ?? 'naukri';
  const site = PLATFORM_NAMES[platform];
  const profileRun = useProfileRun(platform);
  const reading = isRunActive(profileRun);
  const [pdfReading, setPdfReading] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [needsPaste, setNeedsPaste] = useState(false);
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' | 'success' });
  const syncedAt = platform === 'linkedin' ? profile?.linkedin?.syncedAt : profile?.naukriSyncedAt;

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    setPdfReading(true);
    setMessage({ text: '', kind: 'info' });
    try {
      const text = await readResumePdf(file);
      if (text.length < MIN_RESUME_TEXT_CHARS) {
        setNeedsPaste(true);
        setMessage({ text: 'This PDF has almost no text (probably scanned). Paste your resume text below.', kind: 'error' });
        return;
      }
      await saveSettings({ resumeText: text, resumeFileName: file.name });
      setMessage({ text: `Read ${text.length} characters from ${file.name}.`, kind: 'success' });
      await readProfile(); // no extra click: read resume + this site's profile right away
    } catch (error) {
      setMessage({ text: `Could not read PDF: ${String(error)}`, kind: 'error' });
    } finally {
      setPdfReading(false);
    }
  }

  async function savePasted() {
    await saveSettings({ resumeText: pastedText.trim(), resumeFileName: 'pasted text' });
    setNeedsPaste(false);
    await readProfile();
  }

  async function readProfile() {
    try {
      await sendToBackground({ type: 'REFRESH_PROFILE', platform });
      props.onProfileBuilt();
    } catch (error) {
      setMessage({ text: String(error).replace(/^Error: /, ''), kind: 'error' });
    }
  }

  return (
    <Section step={2} done={Boolean(syncedAt)} title={`Resume & ${site} profile`} description={`Your resume is read first; your ${site} profile fills anything missing. The resume and Gemini key are shared by Naukri and LinkedIn.`}>
      <input type="file" accept="application/pdf" disabled={pdfReading || reading} onChange={(event) => onFileChosen(event.target.files?.[0])} />
      {pdfReading && <p className="mt-2 flex items-center gap-2 text-xs text-brand-700"><Icon name="spinner" className="h-3.5 w-3.5" />Reading your PDF…</p>}
      <p className="mt-1 text-[11px] text-slate-500">
        Current resume: {settings?.resumeFileName ?? 'none'} {settings?.resumeText ? `(${settings.resumeText.length} chars)` : ''}
        {' · '}<button className="underline" onClick={() => setNeedsPaste(!needsPaste)}>paste text instead</button>
      </p>
      {needsPaste && (
        <div className="mt-2">
          <textarea rows={6} value={pastedText} onChange={(event) => setPastedText(event.target.value)} placeholder="Paste your full resume text" />
          <Button size="sm" className="mt-2" onClick={savePasted} disabled={pastedText.trim().length < MIN_RESUME_TEXT_CHARS}>Save pasted resume</Button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button kind="primary" size="sm" icon="refresh" loading={reading} onClick={readProfile} disabled={!settings?.resumeText || pdfReading}>
          {reading ? `Reading ${site} profile…` : syncedAt ? `Re-read ${site} profile` : `Read my ${site} profile`}
        </Button>
        <span className="text-[11px] text-slate-500">{site} synced: {syncedAt ? new Date(syncedAt).toLocaleString() : 'never'}</span>
      </div>
      <ProfileProgress run={profileRun} />
      <Message text={message.text} kind={message.kind} />
      {profile && <ProfileView profile={profile} />}
    </Section>
  );
}

function ProfileView({ profile }: { profile: CandidateProfile }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
      <div>
        <p className="text-[13px] font-semibold text-slate-900">{profile.name || 'You'}</p>
        <p className="text-slate-600">{profile.currentTitle} · {profile.totalExperienceYears} yrs experience</p>
      </div>
      <p className="leading-snug text-slate-600">{profile.summary}</p>
      <p><span className="text-slate-500">Target roles:</span> {profile.targetTitles.join(', ')}</p>
      {profile.conflicts.map((conflict) => (
        <Message key={conflict.field} kind="warning" text={`${conflict.field}: resume says ${conflict.resumeValue}, Naukri says ${conflict.naukriValue}. The resume value is used.`} />
      ))}
      <div>
        <p className="mb-1 text-slate-500">Skills ({profile.skills.length})</p>
        <div className="flex flex-wrap gap-1">
          {profile.skills.map((skill) => (
            <span key={skill.name} className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_COLORS[skill.source]}`} title={`From: ${skill.source}`}>
              {skill.name}{skill.years !== undefined ? ` · ${skill.years}y` : ''}
            </span>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-slate-400">Blue = resume · Orange = Naukri · Indigo = LinkedIn · Green = both</p>
      </div>
    </div>
  );
}

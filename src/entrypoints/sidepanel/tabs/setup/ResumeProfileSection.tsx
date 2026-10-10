/**
 * FILE: tabs/setup/ResumeProfileSection.tsx
 * WHAT: Resume upload (PDF -> text, or paste for scanned PDFs) - shared by Naukri and LinkedIn - and
 *       "Read my <site> profile" for the site selected in the header (resume first, that profile for the gaps),
 *       with a live loader while it works and the merged profile view (skills tagged by source), where you can
 *       fix the target roles and skills the AI read (saved as settings.profileEdits).
 * CALLED BY: tabs/SetupTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { MIN_RESUME_TEXT_CHARS } from '../../../../config';
import { applyProfileEdits, db, getSettings, saveSettings } from '../../../../db/database';
import type { CandidateProfile, ProfileEdits, Skill } from '../../../../db/types';
import { normalizeSkill } from '../../../../matching/skillSynonyms';
import { sendToBackground } from '../../../../shared/messages';
import { Icon } from '../../icons';
import { PLATFORM_NAMES } from '../../platform';
import { readResumePdf } from '../../readResumePdf';
import { Button, Message, Section, splitList } from '../../ui';
import ListInput from './ListInput';
import ProfileProgress, { isRunActive, useProfileRun } from './ProfileProgress';

const SOURCE_COLORS: Record<Skill['source'], string> = {
  resume: 'bg-sky-100 text-sky-800', naukri: 'bg-orange-100 text-orange-800', linkedin: 'bg-indigo-100 text-indigo-800', both: 'bg-green-100 text-green-800', you: 'bg-purple-100 text-purple-800',
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
      <p className="mb-1 text-xs font-medium text-slate-700">a) Upload your resume (PDF)</p>
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
      <p className="mt-3 mb-1 text-xs font-medium text-slate-700">b) Log in to {platform === 'linkedin' ? 'linkedin.com' : 'naukri.com'} in this Chrome, then:</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button kind="primary" size="sm" icon="refresh" loading={reading} onClick={readProfile} disabled={!settings?.resumeText || pdfReading}>
          {reading ? `Reading ${site} profile…` : syncedAt ? `Re-read ${site} profile` : `Read my ${site} profile`}
        </Button>
        <span className="text-[11px] text-slate-500">{site} synced: {syncedAt ? new Date(syncedAt).toLocaleString() : 'never'}</span>
      </div>
      <ProfileProgress run={profileRun} />
      <Message text={message.text} kind={message.kind} />
      {profile && settings && <ProfileView profile={profile} edits={settings.profileEdits} />}
    </Section>
  );
}

/** What the AI read from your resume, with your corrections. Every change is saved at once and used by the next run. */
function ProfileView({ profile, edits }: { profile: CandidateProfile; edits: ProfileEdits }) {
  const shown = applyProfileEdits(profile, edits);
  const [newSkill, setNewSkill] = useState('');
  const changed = edits.addedSkills.length > 0 || edits.removedSkills.length > 0 || Boolean(edits.targetTitles?.length);

  function saveEdits(changes: Partial<ProfileEdits>) {
    return saveSettings({ profileEdits: { ...edits, ...changes } });
  }

  function removeSkill(name: string) {
    const key = normalizeSkill(name);
    const wasAdded = edits.addedSkills.some((skill) => normalizeSkill(skill) === key);
    if (wasAdded) return saveEdits({ addedSkills: edits.addedSkills.filter((skill) => normalizeSkill(skill) !== key) });
    return saveEdits({ removedSkills: [...edits.removedSkills, key] });
  }

  function addSkills() {
    const names = splitList(newSkill);
    if (names.length === 0) return;
    const keys = new Set(names.map(normalizeSkill));
    // Adding a skill you removed earlier simply brings it back.
    saveEdits({
      addedSkills: [...edits.addedSkills, ...names],
      removedSkills: edits.removedSkills.filter((skill) => !keys.has(normalizeSkill(skill))),
    });
    setNewSkill('');
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3 text-xs">
      <div>
        <p className="text-[13px] font-semibold text-slate-900">{shown.name || 'You'}</p>
        <p className="text-slate-600">{shown.currentTitle} · {shown.totalExperienceYears} yrs experience</p>
      </div>
      <p className="leading-snug text-slate-600">{shown.summary}</p>
      {shown.conflicts.map((conflict) => (
        <Message key={conflict.field} kind="warning" text={`${conflict.field}: resume says ${conflict.resumeValue}, Naukri says ${conflict.naukriValue}. The resume value is used. Fix it under "Your details" below if it's wrong.`} />
      ))}

      <div className="rounded-md border border-brand-200 bg-white p-2">
        <p className="mb-1 flex items-center gap-1 font-medium text-slate-800"><Icon name="info" className="h-3.5 w-3.5 text-brand-600" />Check these two - they decide which jobs match you</p>
        <p className="text-[11px] text-slate-500">Changes save instantly and are kept when your profile is re-read.</p>
      </div>

      <label className="block">
        <span className="mb-1 block font-medium text-slate-700">Target roles <span className="font-normal text-slate-500">(the jobs you want)</span></span>
        <ListInput value={shown.targetTitles} onChange={(targetTitles) => saveEdits({ targetTitles })} placeholder="Frontend Developer, React Developer" />
        <span className="mt-1 block text-[11px] text-slate-500">Comma separated. Job titles are compared with these.</span>
      </label>

      <div>
        <p className="mb-1 font-medium text-slate-700">Your skills ({shown.skills.length}) <span className="font-normal text-slate-500">- click × to remove a wrong one</span></p>
        <div className="flex flex-wrap gap-1">
          {shown.skills.map((skill) => (
            <span key={skill.name} className={`inline-flex items-center gap-1 rounded-md py-0.5 pr-0.5 pl-1.5 text-[10px] font-medium ${SOURCE_COLORS[skill.source]}`} title={`From: ${skill.source}${skill.years !== undefined ? ` · used for ${skill.years} years` : ''}`}>
              {skill.name}{skill.years !== undefined ? ` · ${skill.years}y` : ''}
              <button aria-label={`Remove ${skill.name}`} className="rounded px-0.5 opacity-60 hover:bg-black/10 hover:opacity-100" onClick={() => removeSkill(skill.name)}>×</button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input value={newSkill} placeholder="Add a skill you have, e.g. Next.js, Docker" onChange={(event) => setNewSkill(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') addSkills(); }} />
          <Button size="sm" icon="check" onClick={addSkills} disabled={!newSkill.trim()}>Add</Button>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">Blue = resume · Orange = Naukri · Indigo = LinkedIn · Green = both · Purple = added by you · "3y" = years used</p>
      </div>

      {(shown.workHistory?.length ?? 0) > 0 && (
        <details>
          <summary className="cursor-pointer font-medium text-slate-700">Work history read from your resume ({shown.workHistory?.length})</summary>
          <ul className="mt-1.5 space-y-1.5">
            {shown.workHistory?.map((entry, index) => (
              <li key={`${entry.company}-${index}`} className="border-l-2 border-slate-200 pl-2">
                <p className="font-medium text-slate-800">{entry.title} · {entry.company}</p>
                <p className="text-[11px] text-slate-500">{entry.start ?? '?'} → {entry.end ?? '?'}{entry.skills.length > 0 ? ` · ${entry.skills.join(', ')}` : ''}</p>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-slate-400">Years per skill are worked out from these dates. Wrong? Fix your resume and upload it again.</p>
        </details>
      )}

      {changed && (
        <button className="text-[11px] text-slate-500 underline hover:text-slate-800" onClick={() => saveSettings({ profileEdits: { addedSkills: [], removedSkills: [] } })}>
          Undo my changes (use only what the AI read)
        </button>
      )}
    </div>
  );
}

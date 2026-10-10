/**
 * FILE: tabs/setup/SearchSettingsSection.tsx
 * WHAT: Keywords, locations, freshness, filters, score threshold and limits.
 * CALLED BY: tabs/SetupTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { HARD_MAX_DAILY_CAP } from '../../../../config';
import { applyProfileEdits, db } from '../../../../db/database';
import type { Settings } from '../../../../db/types';
import { Field, Section } from '../../ui';
import type { ChangeSettings } from '../SetupTab';
import ListInput from './ListInput';

function NumberInput(props: { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
      onChange={(event) => props.onChange(Number(event.target.value))}
    />
  );
}

export default function SearchSettingsSection({ draft, change }: { draft: Settings; change: ChangeSettings }) {
  const rawProfile = useLiveQuery(() => db.profile.get('main'));
  const profile = rawProfile ? applyProfileEdits(rawProfile, draft.profileEdits) : undefined;
  const lowerKeywords = new Set(draft.keywords.map((keyword) => keyword.toLowerCase()));
  const suggestions = Array.from(new Set([...(profile?.targetTitles ?? []), ...(profile?.searchKeywords ?? [])]))
    .filter((keyword) => !lowerKeywords.has(keyword.toLowerCase()))
    .slice(0, 8);

  return (
    <Section step={3} done={draft.keywords.length > 0} title="Jobs to look for" description="What to search, where, and how strict to be. Press Save at the bottom when done.">
      <Field label="Job titles to search for (comma separated)" hint="Use the titles recruiters post, 2-3 words each. 3-5 titles work best; each one is searched in every city.">
        <ListInput value={draft.keywords} onChange={(keywords) => change({ keywords })} placeholder="React Developer, Frontend Developer" />
      </Field>
      {suggestions.length > 0 && (
        <div className="-mt-1 mb-3 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          <span>From your resume - click to add:</span>
          {suggestions.map((keyword) => (
            <button key={keyword} className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-medium text-brand-700 hover:bg-brand-100" onClick={() => change({ keywords: [...draft.keywords, keyword] })}>+ {keyword}</button>
          ))}
        </div>
      )}
      {draft.keywords.length > 6 && <p className="-mt-2 mb-3 text-[11px] text-amber-700">Many titles spread each run thin. Keep the 3-5 that fit you best for more accurate results.</p>}
      <Field label="Cities (comma separated, empty = anywhere in India)" hint="e.g. Bangalore, Pune, Hyderabad. Remote / work-from-home jobs are always allowed.">
        <ListInput value={draft.locations} onChange={(locations) => change({ locations })} placeholder="Bangalore, Pune" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Your experience (years)" hint="Jobs far outside this are skipped."><NumberInput value={draft.experienceYears} min={0} onChange={(experienceYears) => change({ experienceYears })} /></Field>
        <Field label="Posted within" hint="Newer posts have fewer applicants.">
          <select value={draft.maxJobAgeDays} onChange={(event) => change({ maxJobAgeDays: Number(event.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7].map((days) => <option key={days} value={days}>{days === 1 ? '1 day' : `${days} days`}</option>)}
          </select>
        </Field>
        <Field label={`Daily cap (max ${HARD_MAX_DAILY_CAP})`}><NumberInput value={draft.dailyCap} min={1} max={HARD_MAX_DAILY_CAP} onChange={(dailyCap) => change({ dailyCap })} /></Field>
      </div>
      <Field label="Skip a job when Naukri's own match score shows ✗ for…">
        <div className="flex flex-wrap gap-3 text-xs">
          {(['location', 'workExperience', 'keyskills'] as const).map((key) => (
            <label key={key} className="flex items-center gap-1">
              <input type="checkbox" checked={draft.skipWhenNaukriSaysNo[key]}
                onChange={(event) => change({ skipWhenNaukriSaysNo: { ...draft.skipWhenNaukriSaysNo, [key]: event.target.checked } })} />
              {key === 'workExperience' ? 'Work experience' : key === 'keyskills' ? 'Key skills' : 'Location'}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Skip jobs whose title has these words" hint="Whole words, e.g. intern, sales, php, manager">
        <ListInput value={draft.excludeTitleWords} onChange={(excludeTitleWords) => change({ excludeTitleWords })} />
      </Field>
      <Field label="Skip these companies" hint="e.g. your current employer">
        <ListInput value={draft.excludeCompanies} onChange={(excludeCompanies) => change({ excludeCompanies })} />
      </Field>
      <Field label="Auto-run daily at (optional)" hint="Chrome must be open. Leave empty to turn off.">
        <input type="time" value={draft.autoRunDailyAt} onChange={(event) => change({ autoRunDailyAt: event.target.value })} />
      </Field>
    </Section>
  );
}

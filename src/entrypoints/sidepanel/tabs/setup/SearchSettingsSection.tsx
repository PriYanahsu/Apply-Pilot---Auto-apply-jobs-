/**
 * FILE: tabs/setup/SearchSettingsSection.tsx
 * WHAT: Keywords, locations, freshness, filters, score threshold and limits.
 * CALLED BY: tabs/SetupTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { HARD_MAX_DAILY_CAP } from '../../../../config';
import { db } from '../../../../db/database';
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
  const profile = useLiveQuery(() => db.profile.get('main'));
  const suggestions = (profile?.searchKeywords ?? []).filter((keyword) => !draft.keywords.includes(keyword));

  return (
    <Section step={3} done={draft.keywords.length > 0} title="Jobs to look for" description="What to search, where, and how strict to be.">
      <Field label="Keywords (comma separated)">
        <ListInput value={draft.keywords} onChange={(keywords) => change({ keywords })} placeholder="react developer, frontend engineer" />
      </Field>
      {suggestions.length > 0 && (
        <p className="-mt-1 mb-2 text-[11px] text-slate-500">
          Suggestions:{' '}
          {suggestions.map((keyword) => (
            <button key={keyword} className="mr-1 rounded bg-slate-100 px-1 hover:bg-slate-200" onClick={() => change({ keywords: [...draft.keywords, keyword] })}>+ {keyword}</button>
          ))}
        </p>
      )}
      <Field label="Locations (comma separated, empty = anywhere)" hint="Remote / work-from-home jobs are always allowed.">
        <ListInput value={draft.locations} onChange={(locations) => change({ locations })} placeholder="Bangalore, Pune" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Your experience (years)"><NumberInput value={draft.experienceYears} min={0} onChange={(experienceYears) => change({ experienceYears })} /></Field>
        <Field label="Posted within">
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
      <Field label="Exclude title words" hint="Whole words, e.g. intern, sales, php">
        <ListInput value={draft.excludeTitleWords} onChange={(excludeTitleWords) => change({ excludeTitleWords })} />
      </Field>
      <Field label="Exclude companies">
        <ListInput value={draft.excludeCompanies} onChange={(excludeCompanies) => change({ excludeCompanies })} />
      </Field>
      <Field label="Auto-run daily at (optional)" hint="Chrome must be open. Leave empty to turn off.">
        <input type="time" value={draft.autoRunDailyAt} onChange={(event) => change({ autoRunDailyAt: event.target.value })} />
      </Field>
    </Section>
  );
}

/**
 * FILE: tabs/setup/FactsSection.tsx
 * WHAT: Shows the details used for screening questions - read AUTOMATICALLY from your resume first,
 *       then your Naukri profile for the gaps. Nothing to fill in. If a value is wrong or missing you can
 *       correct it under "Correct a detail" (only corrections are stored in settings.factOverrides).
 * CALLED BY: tabs/SetupTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getEffectiveFacts, getFactSources, getSettings } from '../../../../db/database';
import type { Facts, Settings } from '../../../../db/types';
import { Section, Toggle } from '../../ui';
import type { ChangeSettings } from '../SetupTab';

type FactKey = keyof Facts;

const ROWS: { key: FactKey; label: string; kind: 'text' | 'number' | 'yesno' | 'list' }[] = [
  { key: 'fullName', label: 'Name', kind: 'text' },
  { key: 'email', label: 'Email', kind: 'text' },
  { key: 'phone', label: 'Phone', kind: 'text' },
  { key: 'currentLocation', label: 'Current location', kind: 'text' },
  { key: 'preferredLocations', label: 'Preferred locations', kind: 'list' },
  { key: 'totalExperienceYears', label: 'Total experience (years)', kind: 'number' },
  { key: 'currentCtcLpa', label: 'Current CTC (LPA)', kind: 'number' },
  { key: 'expectedCtcLpa', label: 'Expected CTC (LPA)', kind: 'number' },
  { key: 'noticePeriodDays', label: 'Notice period (days)', kind: 'number' },
  { key: 'willingToRelocate', label: 'Willing to relocate', kind: 'yesno' },
  { key: 'notes', label: 'Other notes', kind: 'text' },
];

function show(value: Facts[FactKey]): string {
  if (value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ') || '—';
  return String(value);
}

export default function FactsSection({ draft, change }: { draft: Settings; change: ChangeSettings }) {
  const profile = useLiveQuery(() => db.profile.get('main'));
  const platform = useLiveQuery(async () => (await getSettings()).platform) ?? 'naukri';
  const effective = getEffectiveFacts(draft, profile, platform);
  const sources = getFactSources(profile, platform);
  const overrides = draft.factOverrides;

  function setOverride(key: FactKey, raw: string, kind: string) {
    const next: Facts = { ...overrides };
    if (raw === '') delete next[key];
    else if (kind === 'number') (next as Record<string, unknown>)[key] = Number(raw);
    else if (kind === 'yesno') (next as Record<string, unknown>)[key] = raw === 'yes';
    else if (kind === 'list') (next as Record<string, unknown>)[key] = raw.split(',').map((item) => item.trim()).filter(Boolean);
    else (next as Record<string, unknown>)[key] = raw;
    change({ factOverrides: next });
  }

  function sourceOf(key: FactKey): string {
    if (overrides[key] !== undefined) return 'you';
    return sources?.[key] ?? '';
  }

  return (
    <Section step={4} done={Boolean(profile?.autoFacts)} title="Your details" description="Read automatically - used to answer screening questions.">
      <p className="mb-2 text-[11px] text-slate-500">
        Read from your <b>resume first</b>, then your <b>{platform === 'linkedin' ? 'LinkedIn' : 'Naukri'} profile</b>, then the other site's profile for anything still missing. Click "Refresh profile" above to re-read.
        Unknown details are never guessed: such questions go to the Review tab once, and your answer is remembered.
      </p>
      <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
        <Toggle
          checked={draft.autoAnswerPreferences}
          onChange={(autoAnswerPreferences) => change({ autoAnswerPreferences })}
          label='Answer "willing to…" questions with Yes'
          description="Relocation, shifts, work from office, travel, immediate joining - so applications don't stop for them."
        />
      </div>
      <table className="w-full text-xs">
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.key} className="border-b border-slate-100">
              <td className="py-1 pr-2 text-slate-500">{row.label}</td>
              <td className="py-1 font-medium">{show(effective[row.key])}</td>
              <td className="py-1 text-right text-[10px] text-slate-400">{sourceOf(row.key)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-brand-700">Correct a detail (optional)</summary>
        <p className="my-1 text-[11px] text-slate-500">Leave a box empty to use the value from your resume / Naukri.</p>
        {ROWS.map((row) => (
          <label key={row.key} className="mb-1 grid grid-cols-2 items-center gap-2">
            <span className="text-slate-600">{row.label}</span>
            {row.kind === 'yesno' ? (
              <select value={overrides[row.key] === undefined ? '' : overrides[row.key] ? 'yes' : 'no'} onChange={(event) => setOverride(row.key, event.target.value, row.kind)}>
                <option value="">(automatic)</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : (
              <input
                type={row.kind === 'number' ? 'number' : 'text'}
                value={overrides[row.key] === undefined ? '' : Array.isArray(overrides[row.key]) ? (overrides[row.key] as string[]).join(', ') : String(overrides[row.key])}
                placeholder={show(profile?.autoFacts?.[row.key])}
                onChange={(event) => setOverride(row.key, event.target.value, row.kind)}
              />
            )}
          </label>
        ))}
      </details>
    </Section>
  );
}

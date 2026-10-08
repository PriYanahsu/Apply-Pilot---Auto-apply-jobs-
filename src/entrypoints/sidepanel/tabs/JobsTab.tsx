/**
 * FILE: tabs/JobsTab.tsx
 * WHAT: Every job we've seen. Search, filter chips by status group, sort, and a card per job
 *       (score, status, reason, missing skills, actions: open / apply now / skip / mark applied).
 * CALLED BY: sidepanel/App.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, getSettings, jobPlatform } from '../../../db/database';
import type { Job, JobStatus } from '../../../db/types';
import { sendToBackground } from '../../../shared/messages';
import { Icon } from '../icons';
import type { TabProps } from '../navigation';
import { Button, EmptyState, Message } from '../ui';
import JobCard from './jobs/JobCard';

const FILTERS: { label: string; statuses: JobStatus[] | 'all' }[] = [
  { label: 'All', statuses: 'all' },
  { label: 'Applied', statuses: ['applied', 'already_applied'] },
  { label: 'Queued', statuses: ['queued'] },
  { label: 'Good matches', statuses: ['scored'] },
  { label: 'Need answer', statuses: ['needs_review'] },
  { label: 'Company site', statuses: ['external'] },
  { label: 'In progress', statuses: ['found', 'passed_filters', 'enriched'] },
  { label: 'Skipped', statuses: ['filtered_out', 'stale', 'closed'] },
  { label: 'Failed', statuses: ['failed'] },
];
const PAGE_SIZE = 40;

function matchesFilter(job: Job, statuses: JobStatus[] | 'all'): boolean {
  return statuses === 'all' || statuses.includes(job.status);
}

export default function JobsTab({ goTo }: TabProps) {
  const platform = useLiveQuery(async () => (await getSettings()).platform) ?? 'naukri';
  const jobs = useLiveQuery(async () => (await db.jobs.toArray()).filter((job) => jobPlatform(job) === platform), [platform]) ?? [];
  const [filterLabel, setFilterLabel] = useState('All');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'newest'>('score');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' });

  const filter = FILTERS.find((item) => item.label === filterLabel) ?? FILTERS[0]!;
  const searchText = search.trim().toLowerCase();
  const visible = jobs
    .filter((job) => matchesFilter(job, filter.statuses))
    .filter((job) => !searchText || `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(searchText))
    .sort((left, right) => sortBy === 'newest'
      ? right.fetchedAt.localeCompare(left.fetchedAt)
      : (right.finalScore ?? -1) - (left.finalScore ?? -1) || right.fetchedAt.localeCompare(left.fetchedAt));

  async function send(command: Parameters<typeof sendToBackground>[0], successText: string) {
    setMessage({ text: '', kind: 'info' });
    try {
      await sendToBackground(command);
      setMessage({ text: successText, kind: 'info' });
    } catch (error) {
      setMessage({ text: String(error).replace(/^Error: /, ''), kind: 'error' });
    }
  }

  if (jobs.length === 0) {
    return <EmptyState icon="briefcase" title="No jobs yet" text='Run "Find only" or "Find & Apply" from the Run tab and jobs will appear here.'
      action={<Button kind="primary" size="sm" icon="play" onClick={() => goTo('Run')}>Go to Run</Button>} />;
  }

  return (
    <div>
      <div className="relative mb-2">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input className="!pl-8" placeholder="Search title, company or city" value={search} onChange={(event) => { setSearch(event.target.value); setShown(PAGE_SIZE); }} />
      </div>
      <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 pb-1">
        {FILTERS.map((item) => {
          const count = jobs.filter((job) => matchesFilter(job, item.statuses)).length;
          const active = item.label === filterLabel;
          return (
            <button key={item.label} onClick={() => { setFilterLabel(item.label); setShown(PAGE_SIZE); }}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
              {item.label} <span className={active ? 'text-brand-100' : 'text-slate-400'}>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>{visible.length} job{visible.length === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-3">
          {platform === 'naukri' && <button className="flex items-center gap-1 font-medium text-brand-700 hover:underline" title="Ask Naukri about applied and failed jobs: fixes jobs that were applied but show Failed, and resets ones that were not really applied"
            onClick={() => send({ type: 'RUN_STEP', step: 'VERIFY_APPLIED' }, 'Re-checking applied jobs one by one - progress is on the Run tab.')}>
            <Icon name="refresh" className="h-3 w-3" />Re-check on Naukri
          </button>}
          <select className="!w-auto !py-0.5 !text-[11px]" value={sortBy} onChange={(event) => setSortBy(event.target.value as 'score' | 'newest')}>
            <option value="score">Best match</option>
            <option value="newest">Newest</option>
          </select>
        </div>
      </div>
      <Message text={message.text} kind={message.kind} />
      <div className="space-y-2">
        {visible.slice(0, shown).map((job) => (
          <JobCard key={job.jobId} job={job}
            onApplyNow={() => send({ type: 'APPLY_ONE_JOB', jobId: job.jobId }, `Applying to "${job.title}" - progress is on the Run tab.`)} />
        ))}
        {visible.length === 0 && <p className="py-6 text-center text-xs text-slate-500">No jobs match this filter.</p>}
        {visible.length > shown && <Button className="w-full" onClick={() => setShown(shown + PAGE_SIZE)}>Show more ({visible.length - shown} left)</Button>}
      </div>
    </div>
  );
}

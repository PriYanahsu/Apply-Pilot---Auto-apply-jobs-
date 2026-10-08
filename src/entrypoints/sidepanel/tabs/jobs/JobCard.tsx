/**
 * FILE: tabs/jobs/JobCard.tsx
 * WHAT: One job as a card: match score, title, company, location, age, status, why, missing skills, actions.
 * CALLED BY: tabs/JobsTab.tsx
 */
import { updateJob } from '../../../../db/database';
import type { Job } from '../../../../db/types';
import { Icon } from '../../icons';
import { ScoreBadge, StatusBadge } from '../../ui';

const CAN_APPLY_NOW = ['scored', 'queued', 'failed', 'needs_review'];

function reasonFor(job: Job): { text: string; tone: string } | null {
  if (job.status === 'failed' && job.error) return { text: job.error, tone: 'text-red-600' };
  if (job.status === 'needs_review' && job.error) return { text: job.error, tone: 'text-amber-700' };
  if (job.matchReason) return { text: job.matchReason, tone: 'text-slate-600' };
  if (job.filterReason) return { text: job.filterReason, tone: 'text-slate-500' };
  return null;
}

export default function JobCard({ job, onApplyNow }: { job: Job; onApplyNow: () => void }) {
  const reason = reasonFor(job);
  const actionClass = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900';
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs transition hover:border-slate-300">
      <div className="flex gap-3">
        <ScoreBadge score={job.finalScore} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <a href={job.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[13px] leading-snug font-semibold text-slate-900 hover:text-brand-700">{job.title}</a>
            <StatusBadge status={job.status} />
          </div>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-600"><Icon name="building" className="h-3 w-3 text-slate-400" />{job.company}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            {job.location && <span className="flex items-center gap-1"><Icon name="mapPin" className="h-3 w-3" /><span className="max-w-[150px] truncate">{job.location}</span></span>}
            {job.experienceText && <span className="flex items-center gap-1"><Icon name="briefcase" className="h-3 w-3" />{job.experienceText}</span>}
            {job.postedText && <span className="flex items-center gap-1"><Icon name="clock" className="h-3 w-3" />{job.postedText}</span>}
          </p>
        </div>
      </div>

      {reason && <p className={`mt-2 text-xs leading-snug ${reason.tone}`}>{reason.text}</p>}
      {job.missingSkills && job.missingSkills.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="text-[10px] text-slate-500">Missing:</span>
          {job.missingSkills.slice(0, 6).map((skill) => <span key={skill} className="rounded bg-amber-50 px-1.5 py-px text-[10px] text-amber-800">{skill}</span>)}
        </div>
      )}
      {job.appliedAt && job.status === 'applied' && <p className="mt-1.5 text-[11px] text-emerald-700">Applied {new Date(job.appliedAt).toLocaleString()}</p>}

      {job.status === 'external' && (
        <p className="mt-2 rounded-lg bg-purple-50 px-2.5 py-1.5 text-[11px] text-purple-800">
          This company takes applications only on its own website. Open the job, click <b>"Apply on company site"</b>, then come back and click <b>Mark applied</b>.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-0.5 border-t border-slate-100 pt-1.5">
        {job.status === 'external' ? (
          <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-purple-100 hover:text-black">
            <Icon name="external" className="h-3 w-3" />Apply on company site
          </a>
        ) : (
          <a href={job.url} target="_blank" rel="noreferrer" className={actionClass}><Icon name="external" className="h-3 w-3" />Open</a>
        )}
        {CAN_APPLY_NOW.includes(job.status) && <button className={`${actionClass} text-brand-700`} onClick={onApplyNow}><Icon name="play" className="h-3 w-3" />Apply now</button>}
        {job.status !== 'filtered_out' && job.status !== 'applied' && (
          <button className={actionClass} onClick={() => updateJob(job.jobId, { status: 'filtered_out', filterReason: 'Skipped by you' })}><Icon name="x" className="h-3 w-3" />Skip</button>
        )}
        {job.status !== 'applied' && (
          <button className={actionClass} title="I applied to this myself" onClick={() => updateJob(job.jobId, { status: 'applied', appliedAt: new Date().toISOString() })}><Icon name="check" className="h-3 w-3" />Mark applied</button>
        )}
      </div>
    </article>
  );
}

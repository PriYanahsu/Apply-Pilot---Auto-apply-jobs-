/**
 * FILE: tabs/NeedsReviewTab.tsx
 * WHAT: Jobs that stopped at a screening question we couldn't answer from your resume / profile.
 *       Answer once -> it's remembered (Answers tab) -> the job goes back in the queue and is answered automatically.
 * CALLED BY: sidepanel/App.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, getSettings, jobPlatform, updateJob } from '../../../db/database';
import type { Job } from '../../../db/types';
import { normalizeQuestion } from '../../../matching/answerRules';
import { Icon } from '../icons';
import { isClosingMessage } from '../../../naukri/selectors';
import { Button, Card, EmptyState } from '../ui';

export default function NeedsReviewTab() {
  const platform = useLiveQuery(async () => (await getSettings()).platform) ?? 'naukri';
  const jobs = useLiveQuery(async () => (await db.jobs.where('status').equals('needs_review').toArray()).filter((job) => jobPlatform(job) === platform), [platform]) ?? [];
  if (jobs.length === 0) {
    return <EmptyState icon="checkCircle" title="Nothing needs your answer" text="When a job asks a screening question the extension can't answer from your resume or Naukri profile, it shows up here." />;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        <b>{jobs.length}</b> job{jobs.length === 1 ? '' : 's'} asked something we couldn't answer safely. Answer once - it's remembered and every future job asking the same thing is answered automatically.
      </p>
      {jobs.map((job) => <ReviewCard key={job.jobId} job={job} />)}
    </div>
  );
}

function ReviewCard({ job }: { job: Job }) {
  const pending = job.pendingQuestion;
  const [answer, setAnswer] = useState('');

  async function saveAndRequeue() {
    if (!pending) return;
    await db.answers.put({
      qKey: normalizeQuestion(pending.question), question: pending.question, answer: answer.trim(),
      source: 'user', updatedAt: new Date().toISOString(),
    });
    await updateJob(job.jobId, { status: 'queued', pendingQuestion: undefined, error: undefined, lastDryRunId: undefined });
  }

  return (
    <Card>
      <a href={job.url} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-slate-900 hover:text-brand-700">{job.title}</a>
      <p className="text-xs text-slate-500">{job.company}</p>

      {pending && isClosingMessage(pending.question) ? (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <p>The chatbot said <i>"{pending.question}"</i> - that is its goodbye, not a question. The application was most likely sent.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button kind="primary" size="sm" icon="check" onClick={() => updateJob(job.jobId, { status: 'applied', appliedAt: new Date().toISOString(), pendingQuestion: undefined, error: undefined })}>Mark applied</Button>
            <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"><Icon name="external" className="h-3 w-3" />Check on the job page</a>
          </div>
        </div>
      ) : pending ? (
        <>
          <div className="my-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold tracking-wide text-amber-700 uppercase"><Icon name="help" className="h-3 w-3" />Recruiter asks</p>
            <p className="text-[13px] text-slate-800">{pending.question}</p>
            {job.error && <p className="mt-1 text-[11px] text-amber-800">Why it stopped: {job.error}</p>}
          </div>
          {pending.options.length > 0 ? (
            <div className="space-y-1.5">
              {pending.options.map((option) => (
                <label key={option} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${answer === option ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name={`answer-${job.jobId}`} checked={answer === option} onChange={() => setAnswer(option)} />
                  {option}
                </label>
              ))}
            </div>
          ) : (
            <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your answer" />
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button kind="primary" size="sm" icon="check" disabled={!answer.trim()} onClick={saveAndRequeue}>Save & apply again</Button>
          </div>
        </>
      ) : (
        <div className="mt-2">
          <p className="mb-2 text-xs text-slate-600">{job.error}</p>
          <Button size="sm" icon="refresh" onClick={() => updateJob(job.jobId, { status: 'queued', error: undefined })}>Try again</Button>
        </div>
      )}

      {job.qa && job.qa.length > 0 && (
        <details className="mt-3 text-[11px] text-slate-600">
          <summary className="cursor-pointer text-slate-500">Already answered for this job ({job.qa.length})</summary>
          <ul className="mt-1 space-y-1">
            {job.qa.map((item, index) => <li key={index}><span className="text-slate-500">{item.question}</span> → <b>{item.answer}</b></li>)}
          </ul>
        </details>
      )}
    </Card>
  );
}

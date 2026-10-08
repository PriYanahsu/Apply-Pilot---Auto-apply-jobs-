/**
 * FILE: steps/linkedin/li-8-applyToJob.ts
 * WHAT: Applies to ONE LinkedIn job with Easy Apply:
 *   1. safety checks (score, reason, fresh, not applied) and re-check the job page (Applied / company site / closed)
 *   2. open Easy Apply, then page by page: fill (li-8-fillForm.ts) -> Next / Review -> ... -> Submit application
 *   3. Test mode: stop before Submit and DISCARD (nothing sent), log "WOULD APPLY"
 *   4. applied only when LinkedIn shows "Application sent" (or the job page says Applied)
 *   Any problem inside the form -> the form is discarded so nothing half-filled is left behind.
 * CALLED BY: steps/linkedin/li-8-applyQueuedJobs.ts
 */
import { LINKEDIN_DELAY_BETWEEN_FORM_PAGES_MS, LINKEDIN_FORM_TIMEOUT_MS, LINKEDIN_MAX_FORM_PAGES } from '../../config';
import { getSettings, saveSettings, todayDateString, updateJob } from '../../db/database';
import type { CandidateProfile, Job, QaItem, Settings } from '../../db/types';
import { isJobTooOld } from '../../matching/postedDate';
import { navigateWorkerTab, sendToContent } from '../../orchestrator/workerTab';
import { makeError } from '../../shared/errors';
import { log } from '../../shared/log';
import { easyApplyFormSchema, emptySchema, linkedInJobDetailSchema, primaryClickSchema, type EasyApplyForm } from '../../shared/messages';
import { randomDelay } from '../../shared/sleep';
import { filterJob } from '../4-filterJobs';
import type { ApplyOutcome } from '../8-applyToJob';
import { fillFormPage } from './li-8-fillForm';

const context = (job: Job) => ({ step: 'li-8-apply', jobId: job.jobId });

function safetyProblem(job: Job, settings: Settings, profile: CandidateProfile): string | null {
  if ((job.finalScore ?? -1) < settings.linkedin.minScore) return `Score ${job.finalScore ?? 'none'} is below ${settings.linkedin.minScore}`;
  if (!job.matchReason) return 'No match reason stored';
  if (isJobTooOld(job.postedAt, settings.maxJobAgeDays)) return `Posted more than ${settings.maxJobAgeDays} days ago`;
  return filterJob(job, settings, profile);
}

export async function applyToLinkedInJob(runId: number, job: Job, profile: CandidateProfile): Promise<ApplyOutcome> {
  const settings = await getSettings();
  const problem = safetyProblem(job, settings, profile);
  if (problem) {
    await updateJob(job.jobId, { status: 'failed', error: `Safety check: ${problem}` });
    return 'failed';
  }
  await navigateWorkerTab(job.url);
  const detail = await sendToContent({ type: 'LI_SCRAPE_JOB' }, linkedInJobDetailSchema, context(job));
  if (detail.applyType !== 'easy_apply') {
    const status = detail.applyType === 'already_applied' ? 'already_applied' : detail.applyType === 'external' ? 'external' : 'closed';
    await updateJob(job.jobId, { status });
    await log('li-8-apply', `Not Easy Apply any more (${detail.applyType})`, { jobId: job.jobId });
    return status === 'external' ? 'external' : status === 'already_applied' ? 'already_applied' : 'failed';
  }
  await updateJob(job.jobId, { applyStartedRunId: runId });
  try {
    return await walkThroughForm(runId, job, settings, profile);
  } catch (error) {
    await sendToContent({ type: 'LI_DISCARD' }, emptySchema, context(job)).catch((discardError) => log('li-8-apply', `Could not discard the form: ${String(discardError)}`, { jobId: job.jobId, level: 'warn' }));
    throw error;
  }
}

async function walkThroughForm(runId: number, job: Job, settings: Settings, profile: CandidateProfile): Promise<ApplyOutcome> {
  const dryRun = settings.linkedin.dryRun;
  const qa: QaItem[] = [];
  let form: EasyApplyForm = await sendToContent({ type: 'LI_OPEN_EASY_APPLY' }, easyApplyFormSchema, context(job));
  let retriedErrors = false;
  for (let page = 1; page <= LINKEDIN_MAX_FORM_PAGES; page += 1) {
    if (form.limitReached) {
      await saveSettings({ linkedin: { ...settings.linkedin, limitHitDate: todayDateString() } });
      throw makeError('DAILY_LIMIT', "LinkedIn says today's Easy Apply limit is reached. Try again tomorrow.");
    }
    if (form.done || !form.open) return finishApplied(job, qa, form);
    await log('li-8-apply', `Form page ${form.progress || page}: ${form.fields.length} questions`, { jobId: job.jobId });

    const unanswered = await fillFormPage(form, job, settings, profile, qa);
    if (unanswered) return stopForReview(job, qa, unanswered);

    const click = await sendToContent({ type: 'LI_CLICK_PRIMARY', allowSubmit: !dryRun }, primaryClickSchema, context(job));
    if (click.action === 'submit' && !click.clicked) {
      await sendToContent({ type: 'LI_DISCARD' }, emptySchema, context(job));
      await updateJob(job.jobId, { lastDryRunId: runId, qa });
      await log('li-8-apply', `WOULD APPLY: ${job.title} @ ${job.company} (score ${job.finalScore}) - form filled, discarded (Test mode)`, { jobId: job.jobId });
      return 'dry_run';
    }
    if (click.action === 'none') throw makeError('SELECTOR_MISSING', 'No Next / Review / Submit button in the Easy Apply form', 'dialog');

    const previous = form.signature;
    form = await sendToContent({ type: 'LI_WAIT_FORM_CHANGE', previousSignature: previous, timeoutMs: LINKEDIN_FORM_TIMEOUT_MS }, easyApplyFormSchema, context(job));
    if (form.open && !form.done && form.errors.length > 0 && form.signature === previous) {
      // LinkedIn rejected an answer: one more try with its error message, then give up on this job.
      if (retriedErrors) return stopForReview(job, qa, { question: form.fields.find((field) => field.error)?.label ?? 'Form error', inputType: 'text', options: [], reason: `LinkedIn did not accept: ${form.errors.join('; ')}` });
      retriedErrors = true;
      await log('li-8-apply', `LinkedIn rejected an answer (${form.errors.join('; ')}) - answering again`, { jobId: job.jobId, level: 'warn' });
    }
    await randomDelay(LINKEDIN_DELAY_BETWEEN_FORM_PAGES_MS);
  }
  throw makeError('UNKNOWN', `Easy Apply form had more than ${LINKEDIN_MAX_FORM_PAGES} pages`);
}

async function finishApplied(job: Job, qa: QaItem[], form: EasyApplyForm): Promise<ApplyOutcome> {
  if (form.done) await sendToContent({ type: 'LI_CLOSE_DONE' }, emptySchema, context(job));
  // "Application sent" is LinkedIn's own confirmation; otherwise reload the job page and look for "Applied".
  let confirmed = form.done;
  if (!confirmed) {
    await navigateWorkerTab(job.url);
    confirmed = (await sendToContent({ type: 'LI_SCRAPE_JOB' }, linkedInJobDetailSchema, context(job))).applyType === 'already_applied';
  }
  if (!confirmed) {
    await updateJob(job.jobId, { status: 'failed', qa, error: 'The form closed but LinkedIn did not confirm the application.' });
    return 'failed';
  }
  await updateJob(job.jobId, { status: 'applied', appliedAt: new Date().toISOString(), qa, error: undefined, pendingQuestion: undefined });
  await log('li-8-apply', 'APPLIED - LinkedIn confirmed "Application sent"', { jobId: job.jobId });
  return 'applied';
}

async function stopForReview(job: Job, qa: QaItem[], unanswered: { question: string; inputType: string; options: string[]; reason: string }): Promise<ApplyOutcome> {
  await sendToContent({ type: 'LI_DISCARD' }, emptySchema, context(job));
  await updateJob(job.jobId, { status: 'needs_review', qa, error: unanswered.reason, pendingQuestion: { question: unanswered.question, inputType: unanswered.inputType, options: unanswered.options } });
  await log('li-8-apply', `Needs your answer: "${unanswered.question}" (${unanswered.reason}) - form discarded`, { jobId: job.jobId, level: 'warn' });
  return 'needs_review';
}

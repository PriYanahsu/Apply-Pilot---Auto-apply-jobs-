/**
 * FILE: steps/8-applyToJob.ts
 * WHAT: Applies to ONE queued job:
 *   1. safety checks (score >= minScore, has a reason, passes hard filters, still fresh, not applied before)
 *   2. opens the job page and re-checks Applied / company-site state
 *   3. dry run -> logs "WOULD APPLY" and stops here; otherwise clicks Apply and reads the result
 *   4. if the screening chatbot opens -> steps/8-answerScreening.ts
 *   5. reloads the job page: ONLY if Naukri now shows "Applied" is the job marked applied
 * CALLED BY: steps/8-applyQueuedJobs.ts
 * RETURNS: the outcome; the caller updates counters. Throws DAILY_LIMIT / CAPTCHA (run-level).
 * IF IT BREAKS: "Apply button not found" -> naukri/selectors.ts (applyButton) and naukri/clickApply.ts
 */
import { APPLY_RESULT_TIMEOUT_MS, CONFIRM_APPLY_WAIT_MS, CONFIRMATION_PAGE_WAIT_MS } from '../config';
import { db, getSettings, saveSettings, todayDateString, updateJob } from '../db/database';
import type { CandidateProfile, Job, Settings } from '../db/types';
import { isJobTooOld } from '../matching/postedDate';
import { getWorkerTabUrl, navigateWorkerTab, sendToContent } from '../orchestrator/workerTab';
import { errorCode, errorMessage, makeError } from '../shared/errors';
import { isRunLevelError } from '../orchestrator/jobFailures';
import { readApplyConfirmation } from '../naukri/applyConfirmation';
import { log } from '../shared/log';
import { sleep } from '../shared/sleep';
import { applyResultSchema, emptySchema, jobDetailSchema, type ApplyResult } from '../shared/messages';
import { filterJob } from './4-filterJobs';
import { answerScreening } from './8-answerScreening';

export type ApplyOutcome = 'applied' | 'already_applied' | 'external' | 'needs_review' | 'failed' | 'dry_run';

/** Acceptance criterion #2: returns why it is NOT safe to apply, or null. */
export async function safetyProblem(job: Job, settings: Settings, profile: CandidateProfile): Promise<string | null> {
  if (job.finalScore === undefined || job.finalScore < settings.minScore) return `Score ${job.finalScore ?? 'none'} is below minScore ${settings.minScore}`;
  if (!job.matchReason) return 'No match reason stored';
  if (isJobTooOld(job.postedAt, settings.maxJobAgeDays)) return `Posted more than ${settings.maxJobAgeDays} days ago`;
  const filterReason = filterJob(job, settings, profile);
  if (filterReason) return `Fails hard filter: ${filterReason}`;
  const fresh = await db.jobs.get(job.jobId);
  if (fresh?.status === 'applied' || fresh?.appliedAt) return 'Already applied (local DB)';
  return null;
}

export async function applyToJob(runId: number, job: Job, profile: CandidateProfile): Promise<ApplyOutcome> {
  const settings = await getSettings();
  const problem = await safetyProblem(job, settings, profile);
  if (problem) {
    await updateJob(job.jobId, { status: isJobTooOld(job.postedAt, settings.maxJobAgeDays) ? 'stale' : 'failed', error: `Safety check: ${problem}` });
    await log('8-apply', `NOT applying - ${problem}`, { jobId: job.jobId, level: 'warn' });
    return 'failed';
  }

  await navigateWorkerTab(job.url);
  const detail = await sendToContent({ type: 'SCRAPE_JOB_DETAIL' }, jobDetailSchema, { step: '8-apply', jobId: job.jobId });
  if (detail.applyType === 'already_applied') {
    // If WE clicked Apply in this run before the service worker restarted, this is our own application.
    const ourApplication = job.applyStartedRunId === runId;
    await updateJob(job.jobId, ourApplication ? { status: 'applied', appliedAt: new Date().toISOString() } : { status: 'already_applied' });
    await log('8-apply', ourApplication ? 'Applied (confirmed after restart)' : 'Already applied on Naukri - skipping', { jobId: job.jobId });
    return ourApplication ? 'applied' : 'already_applied';
  }
  if (detail.applyType === 'external') {
    await updateJob(job.jobId, { status: 'external' });
    await log('8-apply', 'Company-site apply - saved as external', { jobId: job.jobId });
    return 'external';
  }

  if (settings.dryRun) {
    await updateJob(job.jobId, { lastDryRunId: runId });
    await log('8-apply', `WOULD APPLY: ${job.title} @ ${job.company} (score ${job.finalScore})`, { jobId: job.jobId });
    return 'dry_run';
  }
  return clickApplyAndFinish(runId, job, settings, profile);
}

async function clickApplyAndFinish(runId: number, job: Job, settings: Settings, profile: CandidateProfile): Promise<ApplyOutcome> {
  await updateJob(job.jobId, { applyStartedRunId: runId });
  try {
    return await clickAndHandleResult(job, settings, profile);
  } catch (error) {
    // After the click, a broken page / closed connection / chatbot hiccup does NOT mean "not applied".
    // Ask Naukri first; only if it still shows "Apply" is the original error real.
    if (isRunLevelError(error)) throw error;
    await log('8-apply', `Problem after clicking Apply (${errorMessage(error)}) - checking Naukri before deciding`, { jobId: job.jobId, level: 'warn' });
    // Answering the LAST screening question submits the application and Naukri jumps to its confirmation
    // page - that page change is what interrupted us. Look there first, before reloading anything.
    const { pageNow, confirmation } = await waitForConfirmationPage(job.jobId);
    if (confirmation?.result === 'applied') return markApplied(job.jobId, job.qa ?? [], `confirmed by Naukri (code ${confirmation.code}) after the last answer`);
    if (confirmation?.result === 'rejected') return markRejectedByNaukri(job.jobId, confirmation.code, pageNow);
    await log('8-apply', `The page is now: ${pageNow}`, { jobId: job.jobId, level: 'warn' });
    if (await isAppliedOnNaukri(job.jobId, job.url)) return markApplied(job.jobId, job.qa ?? [], 'confirmed on Naukri after a page change');
    throw error;
  }
}

async function clickAndHandleResult(job: Job, settings: Settings, profile: CandidateProfile): Promise<ApplyOutcome> {
  await clickApplySafely(job.jobId);
  const result = await detectResultSafely(job.jobId);
  await log('8-apply', `After clicking Apply: ${result.result} (${result.detail})`, { jobId: job.jobId });

  if (result.result === 'daily_limit') {
    await saveSettings({ naukriLimitHitDate: todayDateString() });
    throw makeError('DAILY_LIMIT', "Naukri says today's apply limit is reached. Try again tomorrow.");
  }
  if (result.result === 'external') {
    await updateJob(job.jobId, { status: 'external' });
    return 'external';
  }
  let qa: Job['qa'] = job.qa ?? [];
  if (result.result === 'chatbot') {
    const screening = await answerScreening(job, settings, profile);
    qa = screening.qa;
    if (screening.status !== 'applied') {
      await updateJob(job.jobId, { status: screening.status, error: screening.reason, qa, pendingQuestion: screening.pendingQuestion });
      await log('8-apply', `${screening.status}: ${screening.reason}`, { jobId: job.jobId, level: 'warn' });
      return screening.status;
    }
  }
  // Naukri's own confirmation page (code 200) is proof. Anything else: reload the job page and ask Naukri.
  const { pageNow, confirmation } = await waitForConfirmationPage(job.jobId);
  if (confirmation?.result === 'applied') return markApplied(job.jobId, qa, `confirmed by Naukri (code ${confirmation.code})`);
  if (confirmation?.result === 'rejected') return markRejectedByNaukri(job.jobId, confirmation.code, pageNow);
  return confirmAppliedOnNaukri(job.jobId, job.url, qa);
}

/**
 * Naukri received the application and REFUSED it (its confirmation page shows a code other than 200,
 * e.g. 406 = not acceptable). Clicking worked; usually a screening answer or the recruiter's criteria did not match.
 * Marked failed with a clear reason and NOT retried automatically.
 */
async function markRejectedByNaukri(jobId: string, code: number, pageUrl: string): Promise<ApplyOutcome> {
  const reason = `Naukri refused this application (code ${code}). Usually a screening answer was not accepted or the recruiter's criteria did not match. Check Debug > Snapshots ("chatbot before answering") and the Q/A lines in the log.`;
  await updateJob(jobId, { status: 'failed', error: reason });
  await log('8-apply', `REFUSED by Naukri (code ${code}): ${pageUrl}`, { jobId, level: 'warn' });
  return 'failed';
}

async function markApplied(jobId: string, qa: Job['qa'], how: string): Promise<ApplyOutcome> {
  await updateJob(jobId, { status: 'applied', appliedAt: new Date().toISOString(), qa, error: undefined, pendingQuestion: undefined });
  await log('8-apply', `APPLIED - ${how}`, { jobId });
  return 'applied';
}

/** The click "probably" worked; reload the job page and only count it if Naukri shows "Applied". */
async function confirmAppliedOnNaukri(jobId: string, url: string, qa: Job['qa']): Promise<ApplyOutcome> {
  await sleep(CONFIRM_APPLY_WAIT_MS);
  if (await isAppliedOnNaukri(jobId, url)) return markApplied(jobId, qa, 'confirmed: Naukri shows "Applied" after reload');
  await updateJob(jobId, { status: 'failed', qa, error: 'Clicked Apply, but after reloading Naukri still shows "Apply" - NOT applied. Try "Apply now" again or apply by hand.' });
  await log('8-apply', 'NOT applied: after reload the page still shows the Apply button', { jobId, level: 'error' });
  return 'failed';
}

/** Opens the job page fresh and reads Naukri's own button. Used after applying and by step 9 (re-check). */
export async function isAppliedOnNaukri(jobId: string, url: string): Promise<boolean> {
  await navigateWorkerTab(url);
  const detail = await sendToContent({ type: 'SCRAPE_JOB_DETAIL' }, jobDetailSchema, { step: '8-confirm', jobId });
  return detail.applyType === 'already_applied';
}

/**
 * Naukri needs a few seconds to submit and open /myapply/saveApply?...multiApplyResp={"<jobId>":200}.
 * Reloading the job page earlier could interrupt that, so poll the tab address first (up to 15 s).
 */
async function waitForConfirmationPage(jobId: string) {
  const deadline = Date.now() + CONFIRMATION_PAGE_WAIT_MS;
  let pageNow = await getWorkerTabUrl();
  let confirmation = readApplyConfirmation(pageNow, jobId);
  while (!confirmation && Date.now() < deadline) {
    await sleep(1_000);
    pageNow = await getWorkerTabUrl();
    confirmation = readApplyConfirmation(pageNow, jobId);
  }
  return { pageNow, confirmation };
}

/** Clicking Apply can make Naukri open a new page before the click command replies - that is fine. */
async function clickApplySafely(jobId: string): Promise<void> {
  try {
    await sendToContent({ type: 'CLICK_APPLY' }, emptySchema, { step: '8-apply', jobId });
  } catch (error) {
    if (errorCode(error) !== 'PAGE_CHANGED') throw error;
    await log('8-apply', 'Naukri opened a new page after the click', { jobId });
  }
}

/** The page may navigate away while we wait; that ends the content script, so look at where the tab went. */
async function detectResultSafely(jobId: string): Promise<ApplyResult> {
  try {
    return await sendToContent({ type: 'DETECT_APPLY_RESULT', timeoutMs: APPLY_RESULT_TIMEOUT_MS }, applyResultSchema, { step: '8-apply', jobId });
  } catch (error) {
    if (errorCode(error) !== 'PAGE_CHANGED' && errorCode(error) !== 'TIMEOUT') throw error;
    await sleep(CONFIRM_APPLY_WAIT_MS);
    const url = await getWorkerTabUrl();
    const confirmation = readApplyConfirmation(url, jobId);
    if (confirmation?.result === 'applied') return { result: 'applied', detail: `Naukri confirmation page: code ${confirmation.code} (accepted)` };
    if (confirmation?.result === 'rejected') return { result: 'unknown', detail: `Naukri confirmation page returned code ${confirmation.code} (not accepted)` };
    if (url && !new URL(url).hostname.endsWith('naukri.com')) return { result: 'external', detail: `Redirected to ${url}` };
    return { result: 'unknown', detail: `Page changed after clicking Apply (now ${url}) - will confirm by reloading` };
  }
}

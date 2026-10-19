/**
 * FILE: steps/company/applyCompanySites.ts
 * WHAT: The COMPANY_APPLYING step. Runs only after in-platform apply queues are empty.
 *       Opens Greenhouse, Lever, and Ashby links saved on company-site jobs and walks each form
 *       the same way Easy Apply does: fill, click the button under the form, stop on Submit in Test mode.
 *       A job is applied only when that site shows its own success heading. Anything else stays
 *       Company site, Needs answer, or Failed. Workday and unknown sites are not opened.
 * CALLED BY: orchestrator/runPipeline.ts (step COMPANY_APPLYING)
 */
import { COMPANY_DELAY_BETWEEN_APPLIES_MS, COMPANY_FORM_TIMEOUT_MS, COMPANY_MAX_FORM_PAGES } from '../../config';
import { countAppliedToday, db, getProfile, getSettings, jobPlatform, todayDateString, updateJob } from '../../db/database';
import type { CandidateProfile, Job, QaItem, Settings } from '../../db/types';
import { isJobTooOld } from '../../matching/postedDate';
import { isRunLevelError } from '../../orchestrator/jobFailures';
import { bumpCounter, checkpoint, loadRun, WAIT_REASONS, waitWithCheckpoints } from '../../orchestrator/runState';
import { getWorkerTabId, getWorkerTabUrl, navigateWorkerTab, sendToContent } from '../../orchestrator/workerTab';
import { errorCode, errorMessage } from '../../shared/errors';
import { log } from '../../shared/log';
import { clickedSchema, companyFormSchema, jobDetailSchema, linkedInJobDetailSchema, primaryClickSchema, type CompanyForm } from '../../shared/messages';
import { randomBetween, sleep } from '../../shared/sleep';
import { applyFormUrl, detectAts, isOffsiteUrl, type AtsName } from '../../company/hosts';
import { filterJob } from '../4-filterJobs';
import { effectiveDailyCap, compareForQueue } from '../7-queueJobs';
import type { ApplyOutcome } from '../8-applyToJob';
import { linkedInDailyCap } from '../linkedin/li-7-queueJobs';
import { fillCompanyPage, type UnansweredQuestion } from './fillCompanyPage';

const CLICK_REDIRECT_WAIT_MS = 8_000;
const NEW_PAGE_SETTLE_MS = 3_000;

function context(job: Job) {
  return { step: 'company-apply', jobId: job.jobId };
}

function dryRunFor(settings: Settings, job: Job): boolean {
  return jobPlatform(job) === 'linkedin' ? settings.linkedin.dryRun : settings.dryRun;
}

function dailyCapFor(settings: Settings, job: Job): number {
  return jobPlatform(job) === 'linkedin' ? linkedInDailyCap(settings.linkedin.dailyCap) : effectiveDailyCap(settings.dailyCap);
}

function minScoreFor(settings: Settings, job: Job): number {
  return jobPlatform(job) === 'linkedin' ? settings.linkedin.minScore : settings.minScore;
}

function safetyProblem(job: Job, settings: Settings, profile: CandidateProfile): string | null {
  const minScore = minScoreFor(settings, job);
  if ((job.finalScore ?? -1) < minScore) return `Score ${job.finalScore ?? 'none'} is below ${minScore}`;
  if (!job.matchReason) return 'No match reason stored';
  if (isJobTooOld(job.postedAt, settings.maxJobAgeDays)) return `Posted more than ${settings.maxJobAgeDays} days ago`;
  const filterReason = filterJob(job, settings, profile);
  if (filterReason) return filterReason;
  return null;
}

async function rememberUrl(job: Job, url: string): Promise<void> {
  if (!url || url === job.companyUrl) return;
  await updateJob(job.jobId, { companyUrl: url, companySite: true });
  job.companyUrl = url;
}

/** Re-read the Naukri or LinkedIn job page, and click the company-site button if the URL is not in the page. */
async function resolveCompanyUrl(job: Job): Promise<string> {
  if (job.companyUrl && detectAts(job.companyUrl)) return job.companyUrl;
  await navigateWorkerTab(job.url);
  if (jobPlatform(job) === 'linkedin') {
    const detail = await sendToContent({ type: 'LI_SCRAPE_JOB' }, linkedInJobDetailSchema, context(job));
    if (detail.companyUrl) await rememberUrl(job, detail.companyUrl);
    if (job.companyUrl && detectAts(job.companyUrl)) return job.companyUrl;
    return clickThrough(job, 'LI_CLICK_EXTERNAL');
  }
  const detail = await sendToContent({ type: 'SCRAPE_JOB_DETAIL' }, jobDetailSchema, context(job));
  if (detail.companyUrl) await rememberUrl(job, detail.companyUrl);
  if (job.companyUrl && detectAts(job.companyUrl)) return job.companyUrl;
  return clickThrough(job, 'CLICK_COMPANY_SITE');
}

async function clickThrough(job: Job, command: 'CLICK_COMPANY_SITE' | 'LI_CLICK_EXTERNAL'): Promise<string> {
  const before = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
  const workerId = await getWorkerTabId();
  const beforeUrl = await getWorkerTabUrl();
  try {
    const click = await sendToContent({ type: command }, clickedSchema, context(job));
    if (!click.clicked) return job.companyUrl ?? '';
  } catch (error) {
    if (errorCode(error) !== 'PAGE_CHANGED') throw error;
    await log('company-apply', 'Company site opened in this tab after the click', { jobId: job.jobId });
  }
  const landed = await waitForOffsiteUrl(before, workerId, beforeUrl);
  if (landed) await rememberUrl(job, landed);
  return job.companyUrl ?? '';
}

async function waitForOffsiteUrl(tabsBefore: Set<number | undefined>, workerId: number, beforeUrl: string): Promise<string> {
  const deadline = Date.now() + CLICK_REDIRECT_WAIT_MS;
  while (Date.now() < deadline) {
    const here = await getWorkerTabUrl();
    if (here && here !== beforeUrl && isOffsiteUrl(here)) return here;
    // Any company page the click opened in a new tab: keep its URL (even a non-ATS one, so we never click again) and close it.
    const tabs = (await chrome.tabs.query({})).filter((tab) => tab.id !== undefined && tab.id !== workerId && !tabsBefore.has(tab.id));
    const opened = tabs.find((tab) => isOffsiteUrl(tab.url || tab.pendingUrl || ''));
    if (opened?.id !== undefined) {
      await chrome.tabs.remove(opened.id);
      return opened.url || opened.pendingUrl || '';
    }
    await sleep(500);
  }
  return '';
}

async function markNeedsReview(job: Job, qa: QaItem[], unanswered: UnansweredQuestion): Promise<ApplyOutcome> {
  await updateJob(job.jobId, {
    status: 'needs_review', companySite: true, qa, error: unanswered.reason, autoRetryDate: todayDateString(),
    pendingQuestion: { question: unanswered.question, inputType: unanswered.inputType, options: unanswered.options },
  });
  await log('company-apply', `Needs your answer: "${unanswered.question}" (${unanswered.reason})`, { jobId: job.jobId, level: 'warn' });
  return 'needs_review';
}

/** Submit on Greenhouse and Lever loads a new page, which ends the old content script. Read the new page instead. */
async function readAfterClick(job: Job, previousSignature: string): Promise<CompanyForm | 'left_site'> {
  try {
    return await sendToContent({ type: 'CO_WAIT_FORM_CHANGE', previousSignature, timeoutMs: COMPANY_FORM_TIMEOUT_MS }, companyFormSchema, context(job));
  } catch (error) {
    if (errorCode(error) !== 'PAGE_CHANGED') throw error;
  }
  await sleep(NEW_PAGE_SETTLE_MS);
  if (!detectAts(await getWorkerTabUrl())) return 'left_site';
  return sendToContent({ type: 'CO_READ_FORM' }, companyFormSchema, context(job));
}

async function clickPrimary(job: Job, allowSubmit: boolean, form: CompanyForm): Promise<{ action: 'submit' | 'review' | 'next' | 'none'; clicked: boolean }> {
  try {
    return await sendToContent({ type: 'CO_CLICK_PRIMARY', allowSubmit }, primaryClickSchema, context(job));
  } catch (error) {
    // The click went through and the page navigated before the reply came back.
    if (errorCode(error) !== 'PAGE_CHANGED' || !form.primaryButton) throw error;
    return { action: form.primaryButton, clicked: true };
  }
}

async function markFailed(job: Job, qa: QaItem[], error: string): Promise<ApplyOutcome> {
  await updateJob(job.jobId, { status: 'failed', qa, error });
  await log('company-apply', `FAILED: ${error}`, { jobId: job.jobId, level: 'error' });
  return 'failed';
}

async function walkForm(runId: number, job: Job, settings: Settings, profile: CandidateProfile, ats: AtsName): Promise<ApplyOutcome> {
  const qa: QaItem[] = job.qa ?? [];
  const dryRun = dryRunFor(settings, job);
  let form: CompanyForm = await sendToContent({ type: 'CO_READ_FORM' }, companyFormSchema, context(job));
  let retriedErrors = false;
  for (let page = 1; page <= COMPANY_MAX_FORM_PAGES; page += 1) {
    if (form.done) return markApplied(job, qa, ats);
    if (form.blocked === 'captcha') return markNeedsReview(job, qa, { question: 'Captcha', inputType: 'text', options: [], reason: 'The company site is showing a captcha.' });
    if (form.blocked === 'login') return markNeedsReview(job, qa, { question: 'Sign in', inputType: 'text', options: [], reason: 'The company site asks you to sign in or create an account.' });
    if (!form.open) {
      await log('company-apply', `No application form on ${ats} - left under Company site`, { jobId: job.jobId, level: 'warn' });
      await updateJob(job.jobId, { error: `No application form on ${ats}` });
      return 'external';
    }
    await log('company-apply', `${ats} page ${page}: ${form.fields.length} questions`, { jobId: job.jobId });
    const unanswered = await fillCompanyPage(form, job, settings, profile, qa);
    if (unanswered) return markNeedsReview(job, qa, unanswered);

    const click = await clickPrimary(job, !dryRun, form);
    if (click.action === 'submit' && !click.clicked) {
      await updateJob(job.jobId, { lastDryRunId: runId, qa, error: undefined });
      await log('company-apply', `WOULD APPLY: ${job.title} @ ${job.company} (score ${job.finalScore}) - form filled, not submitted (Test mode)`, { jobId: job.jobId });
      return 'dry_run';
    }
    if (click.action === 'none') {
      await updateJob(job.jobId, { error: 'No Next or Submit button under the form' });
      await log('company-apply', 'No Next or Submit button under the form - left under Company site', { jobId: job.jobId, level: 'warn' });
      return 'external';
    }
    const previous = form.signature;
    const next = await readAfterClick(job, previous);
    if (next === 'left_site') return markFailed(job, qa, `After ${click.action} the site moved off ${ats} - check this application by hand`);
    form = next;
    if (form.done || form.blocked) continue;
    if (form.errors.length > 0) {
      if (retriedErrors) return markNeedsReview(job, qa, { question: form.fields.find((field) => field.error)?.label ?? 'Form error', inputType: 'text', options: [], reason: `The site did not accept: ${form.errors.join('; ')}` });
      retriedErrors = true;
      await log('company-apply', `Site rejected an answer (${form.errors.join('; ')}) - answering again`, { jobId: job.jobId, level: 'warn' });
      continue;
    }
    // Never click Submit a second time on a page that gave no answer: it could send the application twice.
    if (click.action === 'submit') return markFailed(job, qa, `Clicked Submit on ${ats} but the site showed no confirmation (maybe a captcha) - check it by hand`);
    if (form.signature === previous) return markFailed(job, qa, `Clicked ${click.action} on ${ats} but the form did not move on`);
  }
  return markFailed(job, qa, `The form had more than ${COMPANY_MAX_FORM_PAGES} pages`);
}

async function markApplied(job: Job, qa: QaItem[], ats: AtsName): Promise<ApplyOutcome> {
  await updateJob(job.jobId, { status: 'applied', appliedAt: new Date().toISOString(), qa, error: undefined, pendingQuestion: undefined, companySite: true });
  await log('company-apply', `APPLIED on ${ats} - the site confirmed the application`, { jobId: job.jobId });
  return 'applied';
}

async function applyOne(runId: number, job: Job, settings: Settings, profile: CandidateProfile): Promise<ApplyOutcome> {
  const problem = safetyProblem(job, settings, profile);
  if (problem) {
    if (isJobTooOld(job.postedAt, settings.maxJobAgeDays)) await updateJob(job.jobId, { status: 'stale', error: problem });
    await log('company-apply', `Not applying on the company site - ${problem}`, { jobId: job.jobId, level: 'warn' });
    return 'external';
  }
  await updateJob(job.jobId, { applyStartedRunId: runId, companySite: true });
  const url = await resolveCompanyUrl(job);
  const ats = detectAts(url);
  if (!ats) {
    await updateJob(job.jobId, { status: 'external', companySite: true, pendingQuestion: undefined });
    await log('company-apply', url ? `Left for you - ${new URL(url).hostname} is not Greenhouse, Lever, or Ashby` : 'No company application link on the job page - left for you', { jobId: job.jobId });
    return 'external';
  }
  const landed = await navigateWorkerTab(applyFormUrl(url));
  if (!detectAts(landed)) {
    await updateJob(job.jobId, { status: 'external', companySite: true, error: `${ats} sent us to ${landed}` });
    await log('company-apply', `Left for you - the ${ats} link redirects to ${landed}`, { jobId: job.jobId });
    return 'external';
  }
  return walkForm(runId, job, settings, profile, ats);
}

export async function applyCompanySites(runId: number): Promise<void> {
  const run = await loadRun(runId);
  if (run.targetJobId) {
    await log('company-apply', 'Single-job apply does not continue onto company sites');
    return;
  }
  // Only this run's in-platform queues count; a job left queued on the other site must not block this step.
  const platforms = [run.steps.includes('APPLYING') && 'naukri', run.steps.includes('LI_APPLYING') && 'linkedin'].filter(Boolean);
  const stillQueued = (await db.jobs.where('status').equals('queued').toArray()).filter((job) => platforms.includes(jobPlatform(job))).length;
  if (stillQueued > 0) {
    await log('company-apply', `Not opening company sites - ${stillQueued} jobs are still queued for Naukri or LinkedIn`);
    return;
  }

  const settings = await getSettings();
  const profile = await getProfile();
  if (!profile) return log('company-apply', 'No profile yet - company sites left for you', { level: 'warn' });

  const today = todayDateString();
  const review = (await db.jobs.where('status').equals('needs_review').toArray()).filter((job) => job.companySite && job.autoRetryDate !== today);
  const parked = await db.jobs.where('status').equals('external').toArray();
  const jobs = [...parked, ...review].filter((job) => job.lastDryRunId !== runId).sort(compareForQueue);
  const budget = (run.platform ?? 'naukri') === 'linkedin' ? settings.linkedin.maxAppliesPerRun : settings.maxAppliesPerRun;
  await log('company-apply', `In-platform queue is empty. ${jobs.length} company-site jobs. This step applies on Greenhouse, Lever, and Ashby only, up to ${budget}.`);

  const leftForYou = jobs.filter((job) => job.companyUrl && !detectAts(job.companyUrl)).length;
  if (leftForYou > 0) await log('company-apply', `${leftForYou} company sites are not Greenhouse, Lever, or Ashby - left for you to apply`);

  let started = 0;
  for (const job of jobs) {
    await checkpoint(runId);
    if (job.companyUrl && !detectAts(job.companyUrl)) continue;
    if (started >= budget) {
      await log('company-apply', `Reached this run's company-site limit of ${budget}`);
      return;
    }
    const appliedToday = await countAppliedToday(jobPlatform(job));
    const cap = dailyCapFor(settings, job);
    if (appliedToday >= cap) {
      await log('company-apply', `Daily cap reached for ${jobPlatform(job)} (${appliedToday}/${cap}) - leaving the rest`, { jobId: job.jobId });
      continue;
    }
    let outcome: ApplyOutcome = 'external';
    try {
      outcome = await applyOne(runId, job, settings, profile);
    } catch (error) {
      if (isRunLevelError(error)) throw error;
      await updateJob(job.jobId, { status: 'failed', error: `${errorMessage(error)} (job ${job.jobId})` });
      outcome = 'failed';
      await log('company-apply', `FAILED: ${errorMessage(error)}`, { jobId: job.jobId, level: 'error' });
    }
    if (outcome === 'applied' || outcome === 'dry_run' || outcome === 'needs_review' || outcome === 'failed') started += 1;
    if (outcome === 'applied') await bumpCounter(runId, 'applied');
    if (outcome === 'needs_review') await bumpCounter(runId, 'needsReview');
    if (outcome === 'failed') await bumpCounter(runId, 'failed');
    if (outcome === 'applied') await waitWithCheckpoints(runId, randomBetween(COMPANY_DELAY_BETWEEN_APPLIES_MS.min, COMPANY_DELAY_BETWEEN_APPLIES_MS.max), WAIT_REASONS.afterCompanyApply);
  }
}

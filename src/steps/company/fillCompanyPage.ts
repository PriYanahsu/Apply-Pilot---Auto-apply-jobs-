/**
 * FILE: steps/company/fillCompanyPage.ts
 * WHAT: Fills ONE page of a Greenhouse / Lever / Ashby form. Prefilled answers stay.
 *       Empty questions use the same path as Naukri and Easy Apply: saved answers, then rules, then Gemini.
 *       The resume file goes in first (the sites prefill from it). A required file we do not have stops the application.
 * CALLED BY: steps/company/applyCompanySites.ts
 */
import { LINKEDIN_DELAY_BETWEEN_FIELDS_MS } from '../../config';
import { updateJob } from '../../db/database';
import type { CandidateProfile, Job, QaItem, Settings } from '../../db/types';
import { sendToContent } from '../../orchestrator/workerTab';
import { log } from '../../shared/log';
import { companyFormSchema, emptySchema, type ChatInputType, type ChatbotState, type CompanyForm, type EasyApplyField } from '../../shared/messages';
import { randomDelay } from '../../shared/sleep';
import { resolveAnswer } from '../8-answerScreening';

const INPUT_TYPE_FOR_KIND: Record<EasyApplyField['kind'], ChatInputType> = {
  text: 'text', number: 'text', textarea: 'text', typeahead: 'text', select: 'dropdown', radio: 'radio', checkbox: 'checkbox', resume: 'text',
};

export interface UnansweredQuestion {
  question: string;
  inputType: string;
  options: string[];
  reason: string;
}

function needsAnswer(field: EasyApplyField): boolean {
  return field.kind !== 'resume' && (field.error !== '' || field.value.length === 0);
}

const RESUME_LABEL = /resume|cv\b|curriculum/i;

async function fillFile(field: EasyApplyField, job: Job, settings: Settings): Promise<UnansweredQuestion | 'uploaded' | null> {
  if (field.value.length > 0 && field.error === '') return null;
  const isResume = RESUME_LABEL.test(field.label) || field.label === '';
  if (isResume && settings.resumeFileData) {
    const fileName = settings.resumeFileName && settings.resumeFileName !== 'pasted text' ? settings.resumeFileName : 'resume.pdf';
    await sendToContent({ type: 'CO_UPLOAD_RESUME', key: field.key, fileName, dataUrl: settings.resumeFileData }, emptySchema, { step: 'company-apply', jobId: job.jobId });
    await log('company-apply', `Uploaded ${fileName} to "${field.label || 'Resume'}"`, { jobId: job.jobId });
    return 'uploaded';
  }
  if (!field.required) return null;
  const reason = isResume
    ? 'This form requires a resume file. Upload your resume PDF again in Setup so ApplyPilot keeps a copy of the file.'
    : `This form requires a file ("${field.label}") that ApplyPilot does not have.`;
  return { question: field.label || 'Resume', inputType: 'file', options: [], reason };
}

export async function fillCompanyPage(page: CompanyForm, job: Job, settings: Settings, profile: CandidateProfile, qa: QaItem[]): Promise<UnansweredQuestion | null> {
  let form = page;
  let uploaded = false;
  for (const field of form.fields.filter((item) => item.kind === 'resume')) {
    const result = await fillFile(field, job, settings);
    if (result === 'uploaded') uploaded = true;
    else if (result) return result;
  }
  // Read again: the site may have filled name / email from the resume, and those answers stay.
  if (uploaded) form = await sendToContent({ type: 'CO_READ_FORM' }, companyFormSchema, { step: 'company-apply', jobId: job.jobId });
  for (const field of form.fields) {
    if (field.kind === 'resume' || !needsAnswer(field)) continue;
    const inputType = INPUT_TYPE_FOR_KIND[field.kind];
    const question = field.error && field.error !== 'invalid' ? `${field.label} (form says: ${field.error})` : field.label;
    const state: ChatbotState = { state: 'question', question, inputType, options: field.options };
    const resolved = await resolveAnswer(state, job, settings, profile);
    if ('problem' in resolved) {
      if (!field.required) continue;
      return { question: field.label, inputType, options: field.options, reason: resolved.problem };
    }
    const answer = field.kind === 'checkbox' ? resolved.answer : [resolved.answer[0] ?? ''];
    await sendToContent({ type: 'CO_FILL_FIELD', key: field.key, kind: field.kind, answer }, emptySchema, { step: 'company-apply', jobId: job.jobId });
    qa.push({ question: field.label, answer: answer.join(' | '), source: resolved.source });
    await updateJob(job.jobId, { qa });
    await log('company-apply', `Q (${field.kind}): ${field.label} -> A: ${answer.join(' | ')} [${resolved.source}]`, { jobId: job.jobId });
    await randomDelay(LINKEDIN_DELAY_BETWEEN_FIELDS_MS);
  }
  return null;
}

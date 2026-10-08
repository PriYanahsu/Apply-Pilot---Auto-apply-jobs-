/**
 * FILE: steps/linkedin/li-8-fillForm.ts
 * WHAT: Fills ONE page of the Easy Apply form. Prefilled answers (name, email, phone...) are kept;
 *       the resume page picks your NEWEST resume; every empty or rejected question is answered like Naukri's
 *       chatbot: your saved answers -> simple rules -> Gemini (short, real, from your resume / profile).
 * CALLED BY: steps/linkedin/li-8-applyToJob.ts
 * RETURNS: null when the page is filled, or the question we could not answer (-> Needs review).
 */
import { LINKEDIN_DELAY_BETWEEN_FIELDS_MS } from '../../config';
import { updateJob } from '../../db/database';
import type { CandidateProfile, Job, QaItem, Settings } from '../../db/types';
import { sendToContent } from '../../orchestrator/workerTab';
import { log } from '../../shared/log';
import { emptySchema, resumeChoiceSchema, type ChatInputType, type ChatbotState, type EasyApplyField, type EasyApplyForm } from '../../shared/messages';
import { randomDelay } from '../../shared/sleep';
import { resolveAnswer } from '../8-answerScreening';

const INPUT_TYPE_FOR_KIND: Record<EasyApplyField['kind'], ChatInputType> = {
  text: 'text', number: 'text', textarea: 'text', typeahead: 'text', select: 'dropdown', radio: 'radio', checkbox: 'checkbox', resume: 'radio',
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

export async function fillFormPage(form: EasyApplyForm, job: Job, settings: Settings, profile: CandidateProfile, qa: QaItem[]): Promise<UnansweredQuestion | null> {
  for (const field of form.fields) {
    if (field.kind === 'resume') {
      const { chosen } = await sendToContent({ type: 'LI_SELECT_NEWEST_RESUME' }, resumeChoiceSchema, { step: 'li-8-form', jobId: job.jobId });
      await log('li-8-form', `Resume: newest selected (${chosen.slice(0, 60)})`, { jobId: job.jobId });
      continue;
    }
    if (!needsAnswer(field)) continue;
    const inputType = INPUT_TYPE_FOR_KIND[field.kind];
    // When LinkedIn rejected the previous answer, its message ("Enter a whole number between 0 and 99") guides the AI.
    const question = field.error && field.error !== 'invalid' ? `${field.label} (form says: ${field.error})` : field.label;
    const state: ChatbotState = { state: 'question', question, inputType, options: field.options };
    const resolved = await resolveAnswer(state, job, settings, profile);
    if ('problem' in resolved) {
      if (!field.required) continue; // optional question: leave it empty
      return { question: field.label, inputType, options: field.options, reason: resolved.problem };
    }
    const answer = field.kind === 'checkbox' ? resolved.answer : [resolved.answer[0] ?? ''];
    await sendToContent({ type: 'LI_FILL_FIELD', key: field.key, kind: field.kind, answer }, emptySchema, { step: 'li-8-form', jobId: job.jobId });
    qa.push({ question: field.label, answer: answer.join(' | '), source: resolved.source });
    await updateJob(job.jobId, { qa });
    await log('li-8-form', `Q (${field.kind}${field.options.length ? `: ${field.options.slice(0, 6).join(' / ')}` : ''}): ${field.label} -> A: ${answer.join(' | ')} [${resolved.source}]`, { jobId: job.jobId });
    await randomDelay(LINKEDIN_DELAY_BETWEEN_FIELDS_MS);
  }
  return null;
}

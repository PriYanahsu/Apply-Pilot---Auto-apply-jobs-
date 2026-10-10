/**
 * FILE: steps/8-answerScreening.ts
 * WHAT: Drives Naukri's screening-question chatbot for one job. For each question the answer comes from
 *       (1) saved answers, (2) simple rules, (3) Gemini P3. If none is confident or valid -> needs_review.
 *       A "not found" AI answer is re-checked once with the full resume + Naukri + LinkedIn profiles.
 *       NEVER guesses (rule R5). Max 15 questions / 5 minutes.
 * CALLED BY: steps/8-applyToJob.ts
 * RETURNS: { status: 'applied' | 'needs_review' | 'failed', reason, qa, pendingQuestion? }
 * IF IT BREAKS: wrong answers -> fix them in the Answers tab; stuck questions -> naukri/chatbot.ts selectors.
 */
import { askGemini } from '../ai/gemini';
import { screeningAnswerPrompt } from '../ai/prompts';
import {
  CHATBOT_MAX_QUESTIONS, CHATBOT_NEXT_QUESTION_TIMEOUT_MS, CHATBOT_TOTAL_TIMEOUT_MS, MAX_EXPLAIN_ANSWER_CHARS, MAX_TEXT_ANSWER_CHARS, MIN_ANSWER_CONFIDENCE,
} from '../config';
import { db, getEffectiveFacts, jobPlatform, updateJob } from '../db/database';
import type { CandidateProfile, Job, QaItem, Settings } from '../db/types';
import { answerFromRules, bestOptionMatch, findSavedAnswer } from '../matching/answerRules';
import { CHATBOT_INTRO_TEXTS, isClosingMessage } from '../naukri/selectors';
import { sendToContent } from '../orchestrator/workerTab';
import { errorCode } from '../shared/errors';
import { log } from '../shared/log';
import { applyResultSchema, chatbotStateSchema, emptySchema, type ChatbotState } from '../shared/messages';

export interface ScreeningResult {
  status: 'applied' | 'needs_review' | 'failed';
  reason: string;
  qa: QaItem[];
  pendingQuestion?: Job['pendingQuestion'];
}

export type ResolvedAnswer = { answer: string[]; source: QaItem['source'] } | { problem: string };

/** "Describe / explain / why / tell us about / how did you..." questions get 1-2 sentences; everything else a few words. */
export function needsExplanation(question: string): boolean {
  return /\b(describe|explain|elaborate|why|tell us about|tell me about|walk us through|how (did|do|would|have) you|share (an|a|your)|briefly)\b/i.test(question);
}

/** Hard cap for typed answers: cut at a word boundary, drop a trailing comma / "and". */
export function shortenAnswer(answer: string, maxChars: number = MAX_TEXT_ANSWER_CHARS): string {
  const clean = answer.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:-]+(and|or|with)?$/i, '').trim();
}

/** Every option answer must be one of the shown options; returns the exact option texts or null. */
function validateAgainstOptions(answers: string[], options: string[]): string[] | null {
  const matched = answers.map((answer) => bestOptionMatch(answer, options));
  return matched.every((answer): answer is string => answer !== null && answer !== '') ? matched : null;
}

export async function resolveAnswer(state: ChatbotState, job: Job, settings: Settings, profile: CandidateProfile): Promise<ResolvedAnswer> {
  // Only answers YOU gave (Review / Answers tab) are reused. AI answers are written fresh for every job,
  // so an old, long or off-topic AI answer can never come back.
  const yourAnswers = (await db.answers.toArray()).filter((answer) => answer.source === 'user');
  const saved = findSavedAnswer(state.question, yourAnswers);
  const savedValid = saved ? validateAgainstOptions(saved.answer.split(' | '), state.options) : null;
  if (savedValid) return { answer: savedValid, source: 'memory' };
  // "I'll answer" mode: nothing is answered automatically - the question goes to the Review tab for you.
  if (settings.answerMode === 'manual') return { problem: 'Manual mode: waiting for your answer in the Review tab' };

  const platform = jobPlatform(job);
  const facts = getEffectiveFacts(settings, profile, platform);
  const profileText = platform === 'linkedin' ? profile.linkedin?.profileText ?? profile.naukriProfileText : profile.naukriProfileText;
  // The other site's profile, used when re-checking a "not found" answer (e.g. date of birth only on Naukri).
  const otherProfileText = platform === 'linkedin' ? profile.naukriProfileText : profile.linkedin?.profileText;
  const ruleAnswer = answerFromRules(state.question, state.options, facts, profile, settings.autoAnswerPreferences);
  if (ruleAnswer) return { answer: [ruleAnswer], source: 'rules' };

  const ask = (question: string, fullDetail = false) => askGemini(screeningAnswerPrompt({
    facts, profile, jobTitle: job.title, company: job.company,
    question, inputType: state.inputType, options: state.options,
    autoAnswerPreferences: settings.autoAnswerPreferences, profileText, profileSite: platform === 'linkedin' ? 'LINKEDIN' : 'NAUKRI',
    otherProfileText, otherProfileSite: platform === 'linkedin' ? 'NAUKRI' : 'LINKEDIN', fullDetail,
  }), job.jobId);
  let gemini = await ask(state.question);
  const notFound = state.options.length > 0 ? gemini.confidence <= 0 : gemini.confidence < MIN_ANSWER_CONFIDENCE;
  if (notFound) {
    // Don't give up on the excerpt: re-check the WHOLE resume and BOTH site profiles once.
    await log('8-chatbot', `Not found in the excerpt - re-checking your full resume, Naukri and LinkedIn profiles: "${state.question}"`, { jobId: job.jobId });
    gemini = await ask(state.question, true);
  }
  const isOptionQuestion = state.options.length > 0;
  let geminiValid = validateAgainstOptions(gemini.answer, state.options);
  if (isOptionQuestion && (!geminiValid || geminiValid.length === 0)) {
    // e.g. the AI said "1" but the options are ranges: ask once more, this time it must copy an option exactly.
    gemini = await ask(`${state.question}\nIMPORTANT: your answer "${gemini.answer.join(', ')}" is not one of the OPTIONS. Reply with the closest option, copied exactly from OPTIONS.`, notFound);
    geminiValid = validateAgainstOptions(gemini.answer, state.options);
  }
  // Choosing one of the listed options can't invent a fact, so any real choice is accepted there.
  const tooUnsure = isOptionQuestion ? gemini.confidence <= 0 : gemini.confidence < MIN_ANSWER_CONFIDENCE;
  if (tooUnsure) return { problem: `Not found in your resume, Naukri or LinkedIn profile (checked all three): ${gemini.basis}` };
  if (!geminiValid || geminiValid.length === 0) return { problem: `Gemini answer "${gemini.answer.join(', ')}" is not one of the options` };

  const maxChars = needsExplanation(state.question) ? MAX_EXPLAIN_ANSWER_CHARS : MAX_TEXT_ANSWER_CHARS;
  const answer = isOptionQuestion ? geminiValid : geminiValid.map((text) => shortenAnswer(text, maxChars));
  return { answer, source: 'gemini' };
}

async function readChatbot(jobId: string): Promise<ChatbotState> {
  return sendToContent({ type: 'READ_CHATBOT' }, chatbotStateSchema, { step: '8-chatbot', jobId });
}

async function waitForNextState(previousQuestion: string, jobId: string): Promise<ChatbotState> {
  try {
    return await sendToContent({ type: 'WAIT_CHATBOT_CHANGE', previousQuestion, timeoutMs: CHATBOT_NEXT_QUESTION_TIMEOUT_MS }, chatbotStateSchema, { step: '8-chatbot', jobId });
  } catch (error) {
    if (errorCode(error) !== 'TIMEOUT') throw error;
    return readChatbot(jobId); // same question still showing -> the repeat check below handles it
  }
}

/** Checkbox questions, and chip questions worded like "which of the following... / select all", take several answers. */
function allowsSeveralAnswers(state: ChatbotState): boolean {
  if (state.inputType === 'checkbox') return true;
  return state.inputType === 'chips' && /which of the following|select all|all that apply|familiar with|multiple/i.test(state.question);
}

/** The chatbot exactly as it looked before the failed answer -> Debug > Snapshots (download and share it to fix selectors). */
async function saveChatbotEvidence(job: Job, state: ChatbotState): Promise<void> {
  if (!state.drawerHtml) return;
  await db.debugSnapshots.add({
    ts: new Date().toISOString(), jobId: job.jobId, step: '8-chatbot', url: job.url,
    selectorKey: `chatbot before answering (${state.inputType})`, title: state.question, html: state.drawerHtml,
  });
}

export { isClosingMessage };

/** "Hi <name>, thank you for showing interest. Kindly answer all the recruiter's questions..." is an intro, not a question. */
export function isIntroMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return !lower.includes('?') && CHATBOT_INTRO_TEXTS.some((intro) => lower.includes(intro));
}

export async function answerScreening(job: Job, settings: Settings, profile: CandidateProfile): Promise<ScreeningResult> {
  const deadline = Date.now() + CHATBOT_TOTAL_TIMEOUT_MS;
  const qa: QaItem[] = [...(job.qa ?? [])];
  // Naukri opens the drawer first and types the first question 1-2 s later: wait for real text.
  let state = await waitForNextState('', job.jobId);
  let previousQuestion = '';
  let repeatCount = 0;

  for (let questionNumber = 1; questionNumber <= CHATBOT_MAX_QUESTIONS; questionNumber += 1) {
    if (state.state === 'success') return { status: 'applied', reason: 'Chatbot finished', qa };
    if (state.state === 'closed') {
      const result = await sendToContent({ type: 'DETECT_APPLY_RESULT', timeoutMs: 3_000 }, applyResultSchema, { step: '8-chatbot', jobId: job.jobId });
      return result.result === 'applied' ? { status: 'applied', reason: 'Chatbot closed after success', qa } : { status: 'failed', reason: 'Chatbot closed without a success message', qa };
    }
    const pendingQuestion = { question: state.question, inputType: state.inputType, options: state.options };
    // The goodbye message is checked FIRST: a chatbot that finished right at the time limit is still applied.
    // Old chips from the last question can still be on screen, so options don't matter here.
    if (isClosingMessage(state.question)) {
      await log('8-chatbot', `Chatbot finished ("${state.question}") - not answering; Naukri submits by itself`, { jobId: job.jobId });
      return { status: 'applied', reason: 'Chatbot said it is finished', qa };
    }
    if (Date.now() > deadline) return { status: 'needs_review', reason: `Chatbot took longer than ${CHATBOT_TOTAL_TIMEOUT_MS / 1000} s`, qa, pendingQuestion };
    if (!state.question) return { status: 'needs_review', reason: 'Could not read the chatbot question', qa, pendingQuestion };
    if (isIntroMessage(state.question) && state.options.length === 0) {
      await log('8-chatbot', `Intro message - not answering, waiting for the first question ("${state.question.slice(0, 80)}")`, { jobId: job.jobId });
      previousQuestion = state.question;
      state = await waitForNextState(previousQuestion, job.jobId);
      continue;
    }
    repeatCount = state.question === previousQuestion ? repeatCount + 1 : 0;
    if (repeatCount >= 2) return { status: 'needs_review', reason: `Question repeated: "${state.question}"`, qa, pendingQuestion };

    // Re-read with "Load more" expanded so the AI sees every option, not just the first few chips.
    const withAllOptions = await readChatbot(job.jobId);
    if (withAllOptions.state === 'question' && withAllOptions.question === state.question) state = withAllOptions;
    const resolved = await resolveAnswer(state, job, settings, profile);
    if ('problem' in resolved) return { status: 'needs_review', reason: resolved.problem, qa, pendingQuestion };

    const answerValue = allowsSeveralAnswers(state) ? resolved.answer : resolved.answer[0] ?? '';
    const typeText = state.options.length > 0 ? `${state.inputType}: ${state.options.join(' / ')}` : state.inputType;
    await log('8-chatbot', `Q (${typeText}): ${state.question} -> A: ${resolved.answer.join(' | ')} [${resolved.source}]`, { jobId: job.jobId });
    try {
      await sendToContent({ type: 'ANSWER_CHATBOT', answer: answerValue, inputType: state.inputType, send: true }, emptySchema, { step: '8-chatbot', jobId: job.jobId });
    } catch (error) {
      await saveChatbotEvidence(job, state);
      throw error;
    }
    qa.push({ question: state.question, answer: resolved.answer.join(' | '), source: resolved.source });
    await updateJob(job.jobId, { qa });

    previousQuestion = state.question;
    state = await waitForNextState(previousQuestion, job.jobId);
  }
  return { status: 'needs_review', reason: `More than ${CHATBOT_MAX_QUESTIONS} questions`, qa };
}

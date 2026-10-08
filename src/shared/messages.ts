/**
 * FILE: shared/messages.ts
 * WHAT: Every message sent between side panel <-> background <-> content script, with Zod schemas
 *       for the data the content script sends back (it reads a website, so we never trust it blindly).
 * CALLED BY: entrypoints/*, orchestrator/contentClient.ts, sidepanel tabs.
 * IF IT BREAKS: a "Bad reply" error means the content script returned a shape that doesn't match below.
 */
import { z } from 'zod';
import type { Platform, StepName } from '../db/types';
import type { AppErrorCode } from './errors';

// ---------- Errors ----------
export type ErrorCode = AppErrorCode;

export interface PageSnapshot {
  url: string;
  title: string;
  html: string;
}

export interface CommandError {
  code: ErrorCode;
  message: string;
  selectorKey?: string;
  snapshot?: PageSnapshot;
}

export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: CommandError };

// ---------- Background -> content script ----------
export type ContentCommand =
  | { type: 'PING' }
  | { type: 'SCRAPE_SEARCH_PAGE' }
  | { type: 'SCRAPE_JOB_DETAIL' }
  | { type: 'SCRAPE_PROFILE' }
  | { type: 'CLICK_APPLY' }
  | { type: 'DETECT_APPLY_RESULT'; timeoutMs: number }
  | { type: 'READ_CHATBOT' }
  | { type: 'ANSWER_CHATBOT'; answer: string | string[]; inputType: ChatInputType; send: boolean }
  | { type: 'WAIT_CHATBOT_CHANGE'; previousQuestion: string; timeoutMs: number };

export const searchCardSchema = z.object({
  jobId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  experienceText: z.string(),
  salaryText: z.string(),
  skills: z.array(z.string()),
  description: z.string(),
  postedText: z.string(),
  easyApply: z.boolean().optional(), // LinkedIn only: the card says "Easy Apply"
});
export type SearchCard = z.infer<typeof searchCardSchema>;

export const searchPageSchema = z.object({ cards: z.array(searchCardSchema) });

export const applyTypeSchema = z.enum(['naukri', 'external', 'already_applied']);

export const jobDetailSchema = z.object({
  title: z.string(),
  company: z.string(),
  description: z.string(),
  skills: z.array(z.string()),
  postedText: z.string(),
  experienceText: z.string(),
  role: z.string(),
  industry: z.string(),
  education: z.string(),
  location: z.string(),
  preferredSkills: z.array(z.string()),
  // Naukri's own "Job match score" (logged in only), e.g. { 'keyskills': false, 'location': true, 'work experience': true }
  naukriMatch: z.record(z.string(), z.boolean()),
  applyType: applyTypeSchema,
});
export type JobDetail = z.infer<typeof jobDetailSchema>;

export const naukriProfileSchema = z.object({
  name: z.string(),
  headline: z.string(),
  keySkills: z.array(z.string()),
  itSkills: z.array(z.object({ name: z.string(), years: z.number().optional() })),
  employmentText: z.string(),
  totalExperienceYears: z.number().optional(),
  currentLocation: z.string(),
  preferredLocations: z.array(z.string()),
  currentCtcLpa: z.number().optional(),
  expectedCtcLpa: z.number().optional(),
  noticePeriodDays: z.number().optional(),
  phone: z.string(),
  fullText: z.string(),
});
export type NaukriProfile = z.infer<typeof naukriProfileSchema>;

export const applyResultSchema = z.object({
  result: z.enum(['applied', 'chatbot', 'external', 'daily_limit', 'unknown']),
  detail: z.string(),
});
export type ApplyResult = z.infer<typeof applyResultSchema>;

export const chatInputTypeSchema = z.enum(['text', 'radio', 'checkbox', 'chips', 'dropdown']);
export type ChatInputType = z.infer<typeof chatInputTypeSchema>;

export const chatbotStateSchema = z.object({
  state: z.enum(['question', 'success', 'closed']),
  question: z.string(),
  inputType: chatInputTypeSchema,
  options: z.array(z.string()),
  drawerHtml: z.string().optional(), // only from READ_CHATBOT: saved to Debug > Snapshots if answering fails
});
export type ChatbotState = z.infer<typeof chatbotStateSchema>;

export const emptySchema = z.object({}).passthrough();

// ---------- Background -> LinkedIn content script ----------
export type LinkedInCommand =
  | { type: 'LI_PING' }
  | { type: 'LI_SCRAPE_SEARCH_PAGE' }
  | { type: 'LI_SCRAPE_JOB' }
  | { type: 'LI_SCRAPE_PROFILE' }
  | { type: 'LI_OPEN_EASY_APPLY' }
  | { type: 'LI_READ_FORM' }
  | { type: 'LI_FILL_FIELD'; key: string; kind: EasyApplyField['kind']; answer: string[] }
  | { type: 'LI_SELECT_NEWEST_RESUME' }
  | { type: 'LI_CLICK_PRIMARY'; allowSubmit: boolean }
  | { type: 'LI_WAIT_FORM_CHANGE'; previousSignature: string; timeoutMs: number }
  | { type: 'LI_DISCARD' }
  | { type: 'LI_CLOSE_DONE' };

export type AnyContentCommand = ContentCommand | LinkedInCommand;

export const linkedInJobDetailSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  postedText: z.string(),
  description: z.string(),
  applyType: z.enum(['easy_apply', 'external', 'already_applied', 'closed']),
});
export type LinkedInJobDetail = z.infer<typeof linkedInJobDetailSchema>;

export const easyApplyFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['text', 'number', 'textarea', 'select', 'radio', 'checkbox', 'typeahead', 'resume']),
  options: z.array(z.string()),
  value: z.array(z.string()),
  required: z.boolean(),
  error: z.string(),
});
export type EasyApplyField = z.infer<typeof easyApplyFieldSchema>;

export const easyApplyFormSchema = z.object({
  open: z.boolean(),
  done: z.boolean(),           // LinkedIn says "Application sent"
  limitReached: z.boolean(),   // LinkedIn says the daily Easy Apply limit is reached
  progress: z.string(),        // "2/7 pages"
  fields: z.array(easyApplyFieldSchema),
  primaryButton: z.enum(['submit', 'review', 'next']).nullable(),
  errors: z.array(z.string()),
  signature: z.string(),       // changes when the form moves to another page
});
export type EasyApplyForm = z.infer<typeof easyApplyFormSchema>;

export const primaryClickSchema = z.object({ action: z.enum(['submit', 'review', 'next', 'none']), clicked: z.boolean() });
export const resumeChoiceSchema = z.object({ chosen: z.string() });
export const linkedInProfilePageSchema = z.object({ name: z.string(), headline: z.string(), fullText: z.string() });

// ---------- Side panel -> background ----------
export type RunMode = 'full' | 'find' | 'apply';

export type PanelCommand =
  | { type: 'START_RUN'; mode: RunMode }
  | { type: 'START_BOTH' }
  | { type: 'RUN_STEP'; step: StepName }
  | { type: 'APPLY_ONE_JOB'; jobId?: string }
  | { type: 'STOP_RUN' }
  | { type: 'PAUSE_RUN' }
  | { type: 'RESUME_RUN' }
  | { type: 'REFRESH_PROFILE'; platform?: Platform }
  | { type: 'TEST_GEMINI'; apiKey: string; models: string[] }
  | { type: 'UPDATE_DAILY_ALARM' }
  | { type: 'START_FRESH'; platform: Platform };

/** Side panel helper: send a command to the background and unwrap the result. */
export async function sendToBackground<T = unknown>(command: PanelCommand): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(command)) as CommandResult<T> | undefined;
  if (!reply) throw new Error(`Background did not reply to ${command.type}`);
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}

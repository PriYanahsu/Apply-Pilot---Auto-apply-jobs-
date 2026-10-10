/**
 * FILE: config.ts
 * WHAT: Every number, delay, limit, URL and default setting in one place (rule S8).
 * CALLED BY: almost every file.
 * IF IT BREAKS: change a value here instead of hunting for it in the code.
 */
import type { Settings } from './db/types';

export const NAUKRI_BASE_URL = 'https://www.naukri.com';
export const NAUKRI_HOMEPAGE_URL = 'https://www.naukri.com/mnjuser/homepage';
export const NAUKRI_PROFILE_URL = 'https://www.naukri.com/mnjuser/profile';
export const NAUKRI_LOGIN_URL = 'https://www.naukri.com/nlogin/login';
// If the worker tab lands on a URL containing one of these, the user is not logged in.
export const NAUKRI_LOGIN_URL_MARKERS = ['/nlogin', '/login', 'login.naukri'];

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_TEMPERATURE = 0.2;
export const GEMINI_TIMEOUT_MS = 30_000;
// Fallback order: when a model hits its rate limit (or is down) the next one is used (ai/gemini.ts).
// Highest free daily quota first (500/day), then the smarter 20/day models, then Gemma (14,400/day).
// Check your limits at aistudio.google.com -> Rate limits; edit the list in the Setup tab.
export const DEFAULT_GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-flash-latest',
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it',
];
export const GEMINI_BUSY_RETRY_DELAY_MS = 2_000;          // one quick retry on 5xx / network error
export const GEMINI_PER_MINUTE_COOLDOWN_MS = 60_000;      // 429 per-minute limit (if Google sends no retryDelay)
export const GEMINI_BUSY_COOLDOWN_MS = 60_000;            // model still overloaded after the retry
export const GEMINI_BAD_REQUEST_COOLDOWN_MS = 10 * 60_000; // model rejected our request format
export const GEMINI_MISSING_MODEL_COOLDOWN_MS = 24 * 60 * 60_000; // 404: model not available for this key
export const GEMINI_MAX_WAIT_FOR_MODEL_MS = 70_000;       // all models resting? wait this long at most, then pause the run
export const GEMINI_MAX_WAIT_ROUNDS = 3;
export const GEMINI_SCORE_BATCH_SIZE = 8;
export const JOB_DESCRIPTION_CHARS_FOR_SCORING = 2_500;
export const RESUME_CHARS_FOR_ANSWERS = 6_000;

export const HARD_MAX_DAILY_CAP = 50;
export const MAX_NEW_JOBS_PER_RUN_LIMIT = 200; // the "jobs to find per run" input can't go above this
export const MAX_PAGES_PER_SEARCH = 25;        // safety stop per keyword + location (25 pages x 20 = 500 results)
export const PROFILE_MAX_AGE_HOURS = 24; // runs re-read resume + Naukri profile when older than this
// Naukri's own freshness filter only offers these values; we ask for the next one up and then
// enforce YOUR exact limit ourselves (freshness gates #1 and #2).
export const NAUKRI_JOB_AGE_FILTER_DAYS = [1, 3, 7, 15, 30];
export const MIN_RESUME_TEXT_CHARS = 300;
export const CONTENT_COMMAND_TIMEOUT_MS = 20_000;
export const PAGE_LOAD_TIMEOUT_MS = 30_000;
// ---- Pacing: short, human-like pauses. We only wait after a REAL application (see 8-applyQueuedJobs.ts). ----
export const PAGE_SETTLE_DELAY_MS = { min: 2_000, max: 4_000 };       // after every page load (lets Naukri render)
export const DELAY_BETWEEN_PAGES_MS = { min: 3_000, max: 6_000 };      // between search-result pages
export const DELAY_BETWEEN_JOB_PAGES_MS = { min: 2_000, max: 4_000 };  // between job pages while reading JDs / re-checking
// No pause after applying (the user's choice): opening the next job page already takes a few seconds.
// If Naukri ever starts limiting you, set e.g. { min: 8_000, max: 15_000 } and a long break every 10.
export const DELAY_BETWEEN_APPLIES_MS = { min: 0, max: 0 };
export const LONG_BREAK_EVERY_N_APPLIES = 0;                           // 0 = no long breaks
export const LONG_BREAK_MS = { min: 30_000, max: 60_000 };
export const CONFIRM_APPLY_WAIT_MS = 4_000;
export const CONFIRMATION_PAGE_WAIT_MS = 15_000; // how long to wait for Naukri's own "application saved" page                            // after applying, before reloading to confirm
export const APPLY_RESULT_TIMEOUT_MS = 12_000;
export const CHATBOT_MAX_QUESTIONS = 15;
export const CHATBOT_TOTAL_TIMEOUT_MS = 120_000;
export const CHATBOT_NEXT_QUESTION_TIMEOUT_MS = 8_000;
export const HUMAN_CLICK_DELAY_MS = { min: 600, max: 1_500 };
export const HUMAN_TYPE_DELAY_MS = { min: 400, max: 900 };  // short pause after filling an answer, before Send
export const CHATBOT_ANSWER_TIMEOUT_MS = 45_000;            // ANSWER_CHATBOT may click "Load more" and wait for Send

export const MAX_TEXT_ANSWER_CHARS = 100;          // short questions: a few words (Naukri refused long typed answers, code 406)
export const MAX_EXPLAIN_ANSWER_CHARS = 220;       // "describe / why / tell us about" questions: 1-2 sentences, never a paragraph
export const MIN_ANSWER_CONFIDENCE = 0.5;            // free-text answers below this go to Review
// Option questions (chips / radio / dropdown) accept the AI's best valid option at any confidence above 0:
// picking the closest listed option can't invent anything.
export const FUZZY_QUESTION_MATCH_THRESHOLD = 0.85;
export const DEAL_BREAKER_MAX_SCORE = 40;
export const RULE_SCORE_WEIGHT = 0.35;
export const AI_SCORE_WEIGHT = 0.65;
export const SELECTOR_FAILURES_BEFORE_STOP = 3;
export const SNAPSHOT_HTML_MAX_CHARS = 50_000;
export const DEBUG_REPORT_LOG_LINES = 200;
export const KEEP_ALIVE_ALARM_NAME = 'keepAlive';
export const KEEP_ALIVE_PERIOD_MINUTES = 0.5;
export const DAILY_RUN_ALARM_NAME = 'dailyRun';

// ---------------- LinkedIn ----------------
export const LINKEDIN_BASE_URL = 'https://www.linkedin.com';
export const LINKEDIN_FEED_URL = 'https://www.linkedin.com/feed/';
export const LINKEDIN_MY_PROFILE_URL = 'https://www.linkedin.com/in/me/'; // LinkedIn redirects this to your own profile
export const LINKEDIN_LOGIN_URL = 'https://www.linkedin.com/login';
export const LINKEDIN_LOGIN_URL_MARKERS = ['/login', '/authwall', '/uas/login', '/signup'];
export const LINKEDIN_SECURITY_URL_MARKERS = ['/checkpoint/'];
export const LINKEDIN_HARD_MAX_DAILY_CAP = 50;      // LinkedIn's unofficial Easy Apply limit is ~50/day
export const LINKEDIN_RESULTS_PER_PAGE = 25;
export const LINKEDIN_MAX_PAGES_PER_SEARCH = 10;
// Deliberately slow and human-like: LinkedIn watches for automation.
export const LINKEDIN_PAGE_SETTLE_MS = { min: 3_000, max: 6_000 };
export const LINKEDIN_DELAY_BETWEEN_PAGES_MS = { min: 6_000, max: 12_000 };
export const LINKEDIN_DELAY_BETWEEN_JOB_PAGES_MS = { min: 6_000, max: 12_000 };
export const LINKEDIN_DELAY_BETWEEN_FIELDS_MS = { min: 700, max: 1_800 };
export const LINKEDIN_DELAY_BETWEEN_FORM_PAGES_MS = { min: 2_500, max: 5_000 };
export const LINKEDIN_DELAY_AFTER_APPLY_MS = { min: 45_000, max: 90_000 };
export const LINKEDIN_LONG_BREAK_EVERY_N_APPLIES = 5;
export const LINKEDIN_LONG_BREAK_MS = { min: 180_000, max: 360_000 };
export const LINKEDIN_MAX_FORM_PAGES = 12;
export const LINKEDIN_FORM_TIMEOUT_MS = 15_000;

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  // Your key from .env.local is used ONLY in `npm run dev`. The shareable `npm run build` contains no key:
  // every user adds their own in Setup.
  geminiApiKey: import.meta.env.DEV ? ((import.meta.env.WXT_GEMINI_API_KEY as string | undefined) ?? '') : '',
  geminiModels: DEFAULT_GEMINI_MODELS,
  keywords: [],
  locations: [],
  experienceYears: 0,
  maxJobAgeDays: 3,
  pagesPerSearch: 2,
  maxNewJobsPerRun: 100,
  minScore: 60,
  maxAppliesPerRun: 20,
  dailyCap: 40,
  excludeCompanies: [],
  excludeTitleWords: [],
  autoRunDailyAt: '',
  dryRun: true,
  debugMode: false,
  skipWhenNaukriSaysNo: { location: true, workExperience: true, keyskills: false },
  autoAnswerPreferences: true,
  answerMode: 'ai',
  platform: 'naukri',
  // LinkedIn restricts accounts that look automated: Test mode on, small caps, slow pacing (see LINKEDIN_* below).
  linkedin: { dryRun: true, minScore: 60, maxNewJobsPerRun: 50, maxAppliesPerRun: 10, dailyCap: 25, easyApplyOnly: false },
  factOverrides: {},
  profileEdits: { addedSkills: [], removedSkills: [] },
};

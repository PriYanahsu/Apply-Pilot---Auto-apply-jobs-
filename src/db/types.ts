/**
 * FILE: db/types.ts
 * WHAT: The shape of every row stored in IndexedDB (settings, profile, jobs, answers, runs, logs, debug).
 * CALLED BY: every file that reads or writes the database.
 * IF IT BREAKS: if you add a field, also add it to DEFAULT_SETTINGS (config.ts) when it is a setting.
 */

/**
 * Details used to answer screening questions. Read AUTOMATICALLY: resume first, Naukri profile for the gaps.
 * Every field is optional: unknown stays unknown, and a question about it goes to "Needs review" (never guessed).
 */
export interface Facts {
  fullName?: string;
  email?: string;
  phone?: string;
  currentLocation?: string;
  preferredLocations?: string[];
  totalExperienceYears?: number;
  currentCtcLpa?: number;
  expectedCtcLpa?: number;
  noticePeriodDays?: number;
  willingToRelocate?: boolean;
  dateOfBirth?: string;  // as written on the resume / profile, e.g. "12 Mar 2001"
  gender?: string;
  notes?: string;
}

export type FactSource = 'resume' | 'naukri' | 'linkedin' | 'you';

export type Platform = 'naukri' | 'linkedin';

/** LinkedIn has its own limits and Test/Live switch (safer defaults than Naukri). Keywords, resume etc. are shared. */
export interface LinkedInSettings {
  dryRun: boolean;
  minScore: number;
  maxNewJobsPerRun: number;
  maxAppliesPerRun: number;
  dailyCap: number;
  easyApplyOnly: boolean; // false = company-website jobs are found too (saved under Company site, never auto-applied)
  limitHitDate?: string; // 'YYYY-MM-DD' when LinkedIn said "Easy Apply limit reached"
}

export interface Settings {
  id: 'main';
  platform: Platform;   // which site the side panel and the Run buttons work on
  linkedin: LinkedInSettings;
  geminiApiKey: string;
  geminiModels: string[]; // tried in order; on rate limit / outage the next one is used
  keywords: string[];
  locations: string[];
  experienceYears: number;
  maxJobAgeDays: number; // 1-7
  pagesPerSearch: number; // no longer used: searches now page until the "jobs to find" goal is reached
  maxNewJobsPerRun: number; // stop searching after this many NEW jobs, then read / score / apply them
  minScore: number;
  maxAppliesPerRun: number;
  dailyCap: number;
  excludeCompanies: string[];
  excludeTitleWords: string[];
  autoRunDailyAt: string; // 'HH:mm' or '' for off
  dryRun: boolean;
  debugMode: boolean;
  // Skip a job when Naukri's own "Job match score" shows a cross for this item (logged-in job pages only).
  skipWhenNaukriSaysNo: { location: boolean; workExperience: boolean; keyskills: boolean };
  // Answer "willingness" questions (relocate, shifts, work from office, travel, immediate joining) with Yes,
  // so applications don't stop for them. Facts like CTC, degrees and employers are still never guessed.
  autoAnswerPreferences: boolean;
  answerMode: 'ai' | 'manual'; // 'ai': the AI answers every screening question; 'manual': you answer them in Review
  factOverrides: Facts; // ONLY corrections you typed; everything else comes from profile.autoFacts
  naukriLimitHitDate?: string; // 'YYYY-MM-DD' when Naukri said "daily apply limit reached"
  resumeText?: string;
  resumeFileName?: string;
  // Your corrections to what the AI read from your resume. They survive every profile re-read.
  profileEdits: ProfileEdits;
}

/** Skills / target roles you added or removed in Setup. Applied on top of the AI-read profile (db/database.ts). */
export interface ProfileEdits {
  targetTitles?: string[];  // set = replaces the AI's list
  addedSkills: string[];
  removedSkills: string[];  // normalized skill names
}

export interface Skill {
  name: string;
  years?: number;
  source: 'resume' | 'naukri' | 'linkedin' | 'both' | 'you';
}

/** One job from the resume's work history. Dates are 'YYYY-MM'; end 'present' = current job. */
export interface WorkEntry {
  title: string;
  company: string;
  start?: string;
  end?: string;
  skills: string[];  // skills the resume says were used in this job
}

export interface ProfileConflict {
  field: string;
  resumeValue: string;
  naukriValue: string;
}

export interface CandidateProfile {
  id: 'main';
  name: string;
  summary: string;
  currentTitle: string;
  totalExperienceYears: number;
  skills: Skill[];
  preferredLocations: string[];
  targetTitles: string[];
  searchKeywords: string[];
  workHistory?: WorkEntry[];  // from the resume; gives per-skill years and context for scoring / answers
  domains?: string[];         // industries / domains worked in (e.g. fintech, e-commerce)
  resumeText: string;
  naukriProfileText: string;
  conflicts: ProfileConflict[];
  autoFacts: Facts;                                         // read from resume, then Naukri for the gaps
  factSources: Partial<Record<keyof Facts, FactSource>>;    // where each auto fact came from
  naukriSyncedAt?: string;
  linkedin?: LinkedInProfileData; // filled by "Read my LinkedIn profile"; used for LinkedIn runs
  updatedAt: string;
}

/** What was read from your own LinkedIn profile (resume first, LinkedIn for the gaps - same rule as Naukri). */
export interface LinkedInProfileData {
  profileText: string;
  autoFacts: Facts;
  factSources: Partial<Record<keyof Facts, FactSource>>;
  headline: string;
  syncedAt: string;
}

export type JobStatus =
  | 'found' | 'filtered_out' | 'passed_filters' | 'enriched' | 'scored' | 'queued'
  | 'applied' | 'already_applied' | 'external'
  | 'needs_review' | 'failed' | 'stale' | 'closed';

export type ApplyType = 'naukri' | 'external' | 'already_applied';

export interface QaItem {
  question: string;
  answer: string;
  source: 'memory' | 'rules' | 'gemini' | 'user';
}

export interface Job {
  jobId: string;          // Naukri: the numeric id; LinkedIn: 'li-<id>'
  platform?: Platform;    // missing = 'naukri' (jobs saved before LinkedIn support)
  easyApply?: boolean;    // LinkedIn: false = applies on the company website
  url: string;
  title: string;
  company: string;
  location: string;
  experienceText: string;
  expMin?: number;
  expMax?: number;
  salaryText?: string;
  skills: string[];
  description: string;
  postedText: string;
  postedAt: string;
  keyword: string;
  fetchedAt: string;
  filterReason?: string;
  ruleScore?: number;
  aiScore?: number;
  finalScore?: number;
  dealBreaker?: boolean;
  matchReason?: string;
  missingSkills?: string[];
  matchedSkills?: string[];              // job skills you have (shown under "Why this score")
  experienceFit?: number;                // 0..1, how well your years fit the job's range (undefined = unknown)
  preferredSkills?: string[];            // key skills Naukri marks as preferred
  naukriMatch?: Record<string, boolean>; // Naukri's own match check: keyskills / location / work experience
  status: JobStatus;
  error?: string;
  appliedAt?: string;
  qa?: QaItem[];
  pendingQuestion?: { question: string; inputType: string; options: string[] };
  applyStartedRunId?: number; // set just before clicking Apply, so a resumed run knows it clicked
  lastDryRunId?: number;      // dry-run already "applied" this job in this run
  autoRetryDate?: string;     // 'YYYY-MM-DD' a needs_review job was automatically retried
}

export interface SavedAnswer {
  qKey: string;      // normalized question text
  question: string;  // original wording
  answer: string;
  source: 'gemini' | 'user' | 'rules';
  updatedAt: string;
}

export type StepName =
  | 'CHECK_LOGIN' | 'BUILD_PROFILE' | 'SEARCHING' | 'FILTERING'
  | 'ENRICHING' | 'SCORING' | 'QUEUEING' | 'APPLYING' | 'VERIFY_APPLIED'
  | 'LI_CHECK_LOGIN' | 'LI_BUILD_PROFILE' | 'LI_SEARCHING' | 'LI_ENRICHING' | 'LI_QUEUEING' | 'LI_APPLYING';

export type RunStatus = 'running' | 'paused' | 'done' | 'stopped' | 'error';

export interface RunCounters {
  found: number;
  filtered: number;
  scored: number;
  queued: number;
  applied: number;
  external: number;
  needsReview: number;
  failed: number;
  appliesThisRun: number;
  selectorFailStreak: number;
}

export interface Run {
  id?: number;
  startedAt: string;
  finishedAt?: string;
  mode: string;          // 'full' | 'find' | 'apply' | 'step:<NAME>' (shown in UI)
  platform?: Platform;   // missing = 'naukri'
  chainNext?: Platform;  // "Run both": start this site's full run when this one ends (unless stopped)
  chainStarted?: boolean;
  steps: StepName[];     // the steps this run will execute, in order
  stepIndex: number;     // which step we are on (resume point)
  state: RunStatus;
  searchCursor: number;  // index into the keyword x location x page list
  maxApplies?: number;   // overrides settings.maxAppliesPerRun (e.g. "Apply 1 job")
  targetJobId?: string;  // "Apply now" on one job: only this job is applied to
  stopRequested: boolean;
  waitingUntil?: string;    // ISO time the current pause ends (shown as a live countdown)
  waitingTotalMs?: number;  // length of the current pause (for the progress bar)
  waitingReason?: string;   // plain-English reason for the pause
  pauseReason?: string;
  error?: string;
  counters: RunCounters;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRow {
  id?: number;
  runId?: number;
  ts: string;
  level: LogLevel;
  step: string;
  jobId?: string;
  message: string;
  data?: string;
}

/** One search results page done on a given day (key = 'YYYY-MM-DD|keyword|location|page'). */
export interface SearchLogEntry {
  key: string;
  date: string;
  keyword: string;
  location: string;
  page: number;
  newJobs: number;
  note: string;          // 'searched' or why it was skipped
  searchedAt: string;
}

export interface DebugSnapshot {
  id?: number;
  ts: string;
  jobId?: string;
  step: string;
  url: string;
  selectorKey: string;
  title: string;
  html: string;
}

export interface AiCall {
  id?: number;
  ts: string;
  jobId?: string;
  promptName: string;
  model?: string;
  prompt: string;
  rawResponse: string;
  parsed: string;
}

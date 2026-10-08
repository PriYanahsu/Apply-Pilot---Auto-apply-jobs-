/**
 * FILE: db/database.ts
 * WHAT: Creates the Dexie (IndexedDB) database and a few tiny read/write helpers used everywhere.
 * CALLED BY: background, side panel, steps. (NOT the content script - it runs on naukri.com's origin.)
 * IF IT BREAKS: changing a table's indexes needs a new db.version(N) block; never edit an old version after release.
 */
import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS } from '../config';
import type {
  AiCall, CandidateProfile, DebugSnapshot, Facts, Job, LogRow, Platform, Run, SavedAnswer, SearchLogEntry, Settings,
} from './types';

// The database keeps its original name so existing data survives the rename to ApplyPilot.
export const db = new Dexie('naukriAutoApply') as Dexie & {
  settings: Table<Settings, string>;
  profile: Table<CandidateProfile, string>;
  jobs: Table<Job, string>;
  answers: Table<SavedAnswer, string>;
  runs: Table<Run, number>;
  logs: Table<LogRow, number>;
  debugSnapshots: Table<DebugSnapshot, number>;
  aiCalls: Table<AiCall, number>;
  searchLog: Table<SearchLogEntry, string>;
};

db.version(1).stores({
  settings: 'id',
  profile: 'id',
  jobs: 'jobId, status, finalScore, postedAt, fetchedAt, appliedAt, keyword',
  answers: 'qKey, updatedAt',
  runs: '++id, startedAt, state',
  logs: '++id, runId, ts, level, step, jobId',
  debugSnapshots: '++id, ts, jobId, step',
  aiCalls: '++id, ts, jobId, promptName',
});

// v2 (Oct 2026): ONE-TIME RESET. Older versions marked jobs "applied" without Naukri confirming it,
// so every job, run and log from before is untrustworthy. Settings (API key, keywords) and saved answers are kept.
db.version(2).stores({}).upgrade(async (transaction) => {
  const tablesToClear = ['jobs', 'runs', 'logs', 'debugSnapshots', 'aiCalls', 'profile'];
  await Promise.all(tablesToClear.map((name) => transaction.table(name).clear()));
  console.warn('[database] v2 upgrade: cleared old jobs/runs/logs/profile (old "applied" data was not verified)');
});

// v3: intentionally empty. (A short-lived build used it to switch settings to Live mode; that was reverted.
// The block must stay: a browser that already opened v3 cannot open a database that only declares v2.)
db.version(3).stores({});

// v4: remembers which searches (keyword + location + page) were already done TODAY, so later runs on the
// same day continue with new searches instead of repeating them. Tomorrow starts from the first search again.
db.version(4).stores({ searchLog: 'key, date' });

/** Settings merged over defaults, so new fields always have a value. */
export async function getSettings(): Promise<Settings> {
  const saved = await db.settings.get('main');
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    // An empty saved model list falls back to the default list.
    geminiApiKey: saved?.geminiApiKey || DEFAULT_SETTINGS.geminiApiKey,
    geminiModels: saved?.geminiModels?.length ? saved.geminiModels : DEFAULT_SETTINGS.geminiModels,
    factOverrides: saved?.factOverrides ?? {},
    skipWhenNaukriSaysNo: { ...DEFAULT_SETTINGS.skipWhenNaukriSaysNo, ...saved?.skipWhenNaukriSaysNo },
    linkedin: { ...DEFAULT_SETTINGS.linkedin, ...saved?.linkedin },
  };
}

export async function saveSettings(changes: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...changes, id: 'main' });
}

/**
 * Your details for one site: resume first, then that site's profile, then the other site's profile for anything
 * still missing (e.g. CTC from Naukri on LinkedIn), with your typed corrections on top. Empty corrections are ignored.
 */
export function getEffectiveFacts(settings: Settings, profile: CandidateProfile | undefined, platform: Platform = 'naukri'): Facts {
  const corrections = Object.fromEntries(
    Object.entries(settings.factOverrides).filter(([, value]) => value !== undefined && value !== '' && !(typeof value === 'number' && Number.isNaN(value))),
  );
  const fromSites = platform === 'linkedin' ? { ...profile?.autoFacts, ...profile?.linkedin?.autoFacts } : { ...profile?.linkedin?.autoFacts, ...profile?.autoFacts };
  return { ...fromSites, ...corrections };
}

/** Where each detail comes from for one site (for the Setup tab). */
export function getFactSources(profile: CandidateProfile | undefined, platform: Platform): CandidateProfile['factSources'] {
  return platform === 'linkedin' ? { ...profile?.factSources, ...profile?.linkedin?.factSources } : { ...profile?.linkedin?.factSources, ...profile?.factSources };
}

export async function getProfile(): Promise<CandidateProfile | undefined> {
  return db.profile.get('main');
}

export async function updateJob(jobId: string, changes: Partial<Job>): Promise<void> {
  await db.jobs.update(jobId, changes);
}

/** Local calendar date as 'YYYY-MM-DD' (the daily cap resets at local midnight). */
export function todayDateString(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function jobPlatform(job: Pick<Job, 'platform'>): Platform {
  return job.platform ?? 'naukri';
}

/** How many real applications happened today (local time) on one platform. */
export async function countAppliedToday(platform: Platform = 'naukri'): Promise<number> {
  const settings = await getSettings();
  if (platform === 'naukri' && settings.naukriLimitHitDate === todayDateString()) return settings.dailyCap;
  if (platform === 'linkedin' && settings.linkedin.limitHitDate === todayDateString()) return settings.linkedin.dailyCap;
  const appliedJobs = await db.jobs.where('status').equals('applied').toArray();
  return appliedJobs.filter((job) => jobPlatform(job) === platform && job.appliedAt && todayDateString(new Date(job.appliedAt)) === todayDateString()).length;
}

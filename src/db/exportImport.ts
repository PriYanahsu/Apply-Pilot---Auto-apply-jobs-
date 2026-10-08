/**
 * FILE: db/exportImport.ts
 * WHAT: Export all data to JSON, import it back, export jobs as CSV, clear everything,
 *       and build the "Copy debug report" markdown (rule D8 - never includes the API key).
 * CALLED BY: sidepanel tabs DataTab.tsx and DebugTab.tsx
 */
import { z } from 'zod';
import { DEBUG_REPORT_LOG_LINES } from '../config';
import { db, getSettings, jobPlatform } from './database';
import { inScope, logScope, runPlatforms } from './platformScope';
import type { Job, Platform } from './types';

const EXPORT_VERSION = 1;

export async function exportAll(includeApiKey: boolean): Promise<string> {
  const settings = await getSettings();
  return JSON.stringify({
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: includeApiKey ? settings : { ...settings, geminiApiKey: '' },
    profile: await db.profile.toArray(),
    jobs: await db.jobs.toArray(),
    answers: await db.answers.toArray(),
  }, null, 2);
}

// Loose check: we trust our own export format, but refuse files that clearly aren't one.
const importSchema = z.object({
  version: z.number(),
  settings: z.object({ id: z.literal('main') }).passthrough(),
  profile: z.array(z.object({ id: z.literal('main') }).passthrough()),
  jobs: z.array(z.object({ jobId: z.string(), status: z.string() }).passthrough()),
  answers: z.array(z.object({ qKey: z.string() }).passthrough()),
});

export async function importAll(jsonText: string): Promise<string> {
  const data = importSchema.parse(JSON.parse(jsonText));
  const currentKey = (await getSettings()).geminiApiKey;
  await db.transaction('rw', [db.settings, db.profile, db.jobs, db.answers], async () => {
    const settings = data.settings as unknown as Awaited<ReturnType<typeof getSettings>>;
    // An export without the key keeps the key you already have.
    await db.settings.put({ ...settings, geminiApiKey: settings.geminiApiKey || currentKey });
    await db.profile.bulkPut(data.profile as never[]);
    await db.jobs.bulkPut(data.jobs as never[]);
    await db.answers.bulkPut(data.answers as never[]);
  });
  return `Imported ${data.jobs.length} jobs and ${data.answers.length} answers`;
}

// Finished outcomes are kept: they are your history and stop the same job being applied to twice.
const KEEP_ON_START_FRESH = new Set(['applied', 'already_applied', 'external']);

/** "Start fresh": drops one site's unfinished jobs and today's search memory, so the next run starts from zero. */
export async function clearUnfinishedWork(platform: Platform): Promise<number> {
  const unfinished = (await db.jobs.toArray()).filter((job) => jobPlatform(job) === platform && !KEEP_ON_START_FRESH.has(job.status));
  const searchKeys = (await db.searchLog.toArray()).filter((entry) => entry.keyword.startsWith('li:') === (platform === 'linkedin')).map((entry) => entry.key);
  await db.jobs.bulkDelete(unfinished.map((job) => job.jobId));
  await db.searchLog.bulkDelete(searchKeys);
  return unfinished.length;
}

/** Deletes ONE site's jobs, runs, logs, snapshots and today's search memory. The other site is untouched. */
export async function clearJobHistoryData(platform: Platform): Promise<void> {
  const runs = await runPlatforms();
  const jobIds = (await db.jobs.toArray()).filter((job) => jobPlatform(job) === platform).map((job) => job.jobId);
  const runIds = [...runs.entries()].filter(([, runPlatform]) => runPlatform === platform).map(([runId]) => runId);
  const logIds = (await db.logs.toArray()).filter((row) => logScope(row, runs) === platform).map((row) => row.id ?? -1);
  const snapshotIds = (await db.debugSnapshots.toArray()).filter((snapshot) => (snapshot.jobId?.startsWith('li-') || snapshot.url.includes('linkedin.com')) === (platform === 'linkedin')).map((snapshot) => snapshot.id ?? -1);
  const searchKeys = (await db.searchLog.toArray()).filter((entry) => entry.keyword.startsWith('li:') === (platform === 'linkedin')).map((entry) => entry.key);
  await db.jobs.bulkDelete(jobIds);
  await db.runs.bulkDelete(runIds);
  await db.logs.bulkDelete(logIds);
  await db.debugSnapshots.bulkDelete(snapshotIds);
  await db.searchLog.bulkDelete(searchKeys);
}

export async function clearAllData(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function jobsToCsv(jobs: Job[]): string {
  const columns: (keyof Job)[] = ['jobId', 'status', 'finalScore', 'ruleScore', 'aiScore', 'title', 'company', 'location', 'experienceText', 'postedText', 'postedAt', 'appliedAt', 'matchReason', 'missingSkills', 'filterReason', 'error', 'url'];
  const rows = jobs.map((job) => columns.map((column) => csvCell(job[column])).join(','));
  return [columns.join(','), ...rows].join('\n');
}

export async function buildDebugReport(platform: Platform): Promise<string> {
  const settings = await getSettings();
  const runs = await runPlatforms();
  const lastRun = (await db.runs.orderBy('id').reverse().toArray()).find((run) => (run.platform ?? 'naukri') === platform);
  const logs = (await db.logs.orderBy('id').reverse().limit(DEBUG_REPORT_LOG_LINES * 3).toArray()).filter((row) => inScope(logScope(row, runs), platform)).slice(0, DEBUG_REPORT_LOG_LINES);
  const failures = (await db.jobs.where('status').anyOf('failed', 'needs_review').toArray()).filter((job) => jobPlatform(job) === platform).slice(-20);
  const { geminiApiKey: _hidden, resumeText: _resume, ...safeSettings } = settings;
  const logLines = logs.reverse().map((row) => `[${row.ts.slice(11, 19)}] [${row.step}] ${row.level === 'info' ? '' : row.level.toUpperCase() + ' '}${row.message}${row.jobId ? ` (jobId=${row.jobId})` : ''}`);
  return [
    `# ApplyPilot debug report (${platform === 'linkedin' ? 'LinkedIn' : 'Naukri'})`,
    `Generated: ${new Date().toISOString()}`,
    '## Settings (API key and resume removed)', '```json', JSON.stringify(safeSettings, null, 2), '```',
    '## Last run', '```json', JSON.stringify(lastRun ?? null, null, 2), '```',
    `## Last ${logLines.length} log lines`, '```', ...logLines, '```',
    '## Recent failures / needs review', '```json',
    JSON.stringify(failures.map((job) => ({ jobId: job.jobId, title: job.title, status: job.status, error: job.error, pendingQuestion: job.pendingQuestion })), null, 2), '```',
  ].join('\n');
}

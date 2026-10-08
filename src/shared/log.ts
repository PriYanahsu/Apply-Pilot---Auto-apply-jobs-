/**
 * FILE: shared/log.ts
 * WHAT: The ONE logger (rule D1). Writes to the console AND the `logs` table.
 *       Format: [14:02:11] [6-score] Scored 8 jobs (jobId=123)
 * CALLED BY: everything except the content script (which only uses console - it can't reach our DB).
 * IF IT BREAKS: logs never throw; if the DB write fails it is reported in the console.
 */
import { db } from '../db/database';
import type { LogLevel } from '../db/types';

let currentRunId: number | undefined;

/** The orchestrator calls this so every log line is tagged with the run it belongs to. */
export function setLogRunId(runId: number | undefined): void {
  currentRunId = runId;
}

export interface LogOptions {
  jobId?: string;
  level?: LogLevel;
  data?: unknown;
}

export async function log(step: string, message: string, options: LogOptions = {}): Promise<void> {
  const level = options.level ?? 'info';
  const time = new Date().toTimeString().slice(0, 8);
  const jobPart = options.jobId ? ` (jobId=${options.jobId})` : '';
  const line = `[${time}] [${step}] ${message}${jobPart}`;
  // Plain console.log for every level: failed jobs are normal events shown in the extension's own log,
  // and console.error would flood chrome://extensions > Errors with things that are not crashes.
  console.log(level === 'info' ? line : `${level.toUpperCase()} ${line}`, options.data ?? '');

  const dataText = options.data === undefined ? undefined : safeStringify(options.data);
  try {
    await db.logs.add({
      runId: currentRunId, ts: new Date().toISOString(), level, step,
      jobId: options.jobId, message, data: dataText,
    });
  } catch (error) {
    console.error('[log] Could not save log line to IndexedDB:', line, error);
  }
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value).slice(0, 5_000);
  } catch (error) {
    return `<<could not stringify: ${String(error)}>>`;
  }
}

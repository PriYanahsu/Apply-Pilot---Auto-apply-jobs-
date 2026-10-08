/**
 * FILE: db/platformScope.ts
 * WHAT: Decides which site (Naukri / LinkedIn) a log line, debug snapshot or AI call belongs to, so the side panel
 *       and the debug report show only the selected site. Things that belong to both (e.g. reading your resume)
 *       are 'shared' and shown on both.
 * CALLED BY: sidepanel Debug views, db/exportImport.ts (debug report)
 */
import { db } from './database';
import type { AiCall, DebugSnapshot, LogRow, Platform } from './types';

export type Scope = Platform | 'shared';

function platformOfJobId(jobId: string | undefined): Platform | null {
  if (!jobId) return null;
  return jobId.startsWith('li-') ? 'linkedin' : 'naukri';
}

/** runId -> platform (runs from before LinkedIn support are Naukri). */
export async function runPlatforms(): Promise<Map<number, Platform>> {
  const runs = await db.runs.toArray();
  return new Map(runs.map((run) => [run.id ?? -1, run.platform ?? 'naukri']));
}

export function logScope(row: LogRow, runs: Map<number, Platform>): Scope {
  return platformOfJobId(row.jobId) ?? (row.runId !== undefined ? runs.get(row.runId) : undefined) ?? (row.step.startsWith('li-') ? 'linkedin' : 'shared');
}

export function snapshotScope(snapshot: DebugSnapshot): Scope {
  return platformOfJobId(snapshot.jobId) ?? (snapshot.url.includes('linkedin.com') ? 'linkedin' : snapshot.url.includes('naukri.com') ? 'naukri' : 'shared');
}

export function aiCallScope(call: AiCall): Scope {
  return platformOfJobId(call.jobId) ?? 'shared';
}

export function inScope(scope: Scope, platform: Platform): boolean {
  return scope === 'shared' || scope === platform;
}

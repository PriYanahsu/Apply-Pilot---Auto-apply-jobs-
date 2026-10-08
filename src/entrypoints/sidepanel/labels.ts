/**
 * FILE: entrypoints/sidepanel/labels.ts
 * WHAT: Plain-English names and colors for job statuses and pipeline steps, so the UI never shows raw codes.
 * CALLED BY: sidepanel tabs and ui.tsx
 */
import type { JobStatus, StepName } from '../../db/types';

export const STATUS_INFO: Record<JobStatus, { label: string; color: string; hint: string }> = {
  found: { label: 'Found', color: 'bg-slate-100 text-slate-700', hint: 'Found in search, not checked yet' },
  passed_filters: { label: 'Passed filters', color: 'bg-slate-100 text-slate-700', hint: 'Fits your filters, waiting to be read' },
  enriched: { label: 'Read', color: 'bg-sky-100 text-sky-800', hint: 'Full job page read, waiting for AI score' },
  scored: { label: 'Scored', color: 'bg-indigo-100 text-indigo-800', hint: 'AI match score ready' },
  queued: { label: 'Queued', color: 'bg-brand-100 text-brand-800', hint: 'Will be applied to next' },
  applied: { label: 'Applied', color: 'bg-emerald-100 text-emerald-800', hint: 'Confirmed applied on Naukri' },
  already_applied: { label: 'Already applied', color: 'bg-emerald-50 text-emerald-700', hint: 'You had applied before' },
  external: { label: 'Company site', color: 'bg-purple-100 text-purple-800', hint: 'Apply yourself on the company website (Jobs > Company site), then click Mark applied' },
  needs_review: { label: 'Needs answer', color: 'bg-amber-100 text-amber-800', hint: 'A screening question needs your answer' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700', hint: 'Something went wrong - see the reason' },
  filtered_out: { label: 'Filtered out', color: 'bg-slate-100 text-slate-500', hint: 'Skipped: does not fit your filters' },
  stale: { label: 'Too old', color: 'bg-slate-100 text-slate-500', hint: 'Posted too long ago' },
  closed: { label: 'Closed', color: 'bg-slate-100 text-slate-500', hint: 'The employer is not accepting applications any more' },
};

export const STEP_LABELS: Record<StepName, string> = {
  CHECK_LOGIN: 'Check Naukri login',
  BUILD_PROFILE: 'Read your resume & Naukri profile',
  SEARCHING: 'Search fresh jobs',
  FILTERING: 'Filter by your preferences',
  ENRICHING: 'Read each job page',
  SCORING: 'AI match scoring',
  QUEUEING: 'Pick the best matches',
  APPLYING: 'Apply one by one',
  VERIFY_APPLIED: 'Re-check applied / failed jobs on Naukri',
  LI_CHECK_LOGIN: 'Check LinkedIn login',
  LI_BUILD_PROFILE: 'Read your resume & LinkedIn profile',
  LI_SEARCHING: 'Search fresh Easy Apply jobs',
  LI_ENRICHING: 'Read each LinkedIn job',
  LI_QUEUEING: 'Pick the best matches',
  LI_APPLYING: 'Easy Apply one by one (slowly)',
};

export const RUN_MODE_LABELS: Record<string, string> = {
  full: 'Find & Apply',
  both: 'Run both (Naukri → LinkedIn)',
  find: 'Find only',
  apply: 'Apply queued',
  profile: 'Read profile',
  'apply-one': 'Apply 1 job',
  'apply-now': 'Apply now',
};

export function runModeLabel(mode: string): string {
  if (mode.startsWith('step:')) return STEP_LABELS[mode.slice(5) as StepName] ?? mode;
  return RUN_MODE_LABELS[mode] ?? mode;
}

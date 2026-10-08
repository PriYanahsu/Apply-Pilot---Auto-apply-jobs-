/**
 * FILE: entrypoints/sidepanel/platform.ts
 * WHAT: The settings that differ per site (Test/Live, match score, jobs to find, applies per run, per day),
 *       read and saved for whichever platform is selected in the header. Naukri keeps its original fields;
 *       LinkedIn's live in settings.linkedin.
 * CALLED BY: App.tsx (header), tabs/RunTab.tsx
 */
import { HARD_MAX_DAILY_CAP, LINKEDIN_HARD_MAX_DAILY_CAP } from '../../config';
import { saveSettings } from '../../db/database';
import type { Platform, Settings } from '../../db/types';

export interface PlatformLimits {
  dryRun: boolean;
  minScore: number;
  maxNewJobsPerRun: number;
  maxAppliesPerRun: number;
  dailyCap: number;
}

export const PLATFORM_NAMES: Record<Platform, string> = { naukri: 'Naukri', linkedin: 'LinkedIn' };

export function hardDailyCap(platform: Platform): number {
  return platform === 'linkedin' ? LINKEDIN_HARD_MAX_DAILY_CAP : HARD_MAX_DAILY_CAP;
}

export function platformLimits(settings: Settings): PlatformLimits {
  if (settings.platform === 'linkedin') {
    const limits = settings.linkedin;
    return { ...limits, dailyCap: Math.min(limits.dailyCap, hardDailyCap('linkedin')) };
  }
  return {
    dryRun: settings.dryRun, minScore: settings.minScore, maxNewJobsPerRun: settings.maxNewJobsPerRun,
    maxAppliesPerRun: settings.maxAppliesPerRun, dailyCap: Math.min(settings.dailyCap, hardDailyCap('naukri')),
  };
}

export async function savePlatformLimits(settings: Settings, changes: Partial<PlatformLimits>): Promise<void> {
  if (settings.platform === 'linkedin') await saveSettings({ linkedin: { ...settings.linkedin, ...changes } });
  else await saveSettings(changes);
}

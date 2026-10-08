/**
 * FILE: entrypoints/sidepanel/useSetupStatus.ts
 * WHAT: One hook that says which setup steps are done (key, resume, profile, keywords).
 *       Used for the Setup tab checkmarks, the Run tab checklist and the nav dot.
 * CALLED BY: App.tsx, tabs/RunTab.tsx, tabs/SetupTab.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '../../db/database';

export interface SetupStatus {
  loaded: boolean;
  hasApiKey: boolean;
  hasResume: boolean;
  hasProfile: boolean;
  hasKeywords: boolean;
  complete: boolean;
}

export function useSetupStatus(): SetupStatus {
  const settings = useLiveQuery(() => getSettings());
  const profile = useLiveQuery(() => db.profile.get('main'), [], null);
  const hasApiKey = Boolean(settings?.geminiApiKey);
  const hasResume = Boolean(settings?.resumeText);
  // Each site needs its own profile read (resume + that site's profile).
  const hasProfile = settings?.platform === 'linkedin' ? Boolean(profile?.linkedin) : Boolean(profile?.naukriSyncedAt ?? profile?.autoFacts);
  const hasKeywords = (settings?.keywords.length ?? 0) > 0;
  return {
    loaded: settings !== undefined && profile !== null,
    hasApiKey, hasResume, hasProfile, hasKeywords,
    complete: hasApiKey && hasResume && hasProfile && hasKeywords,
  };
}

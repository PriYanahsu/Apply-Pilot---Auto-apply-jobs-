/**
 * FILE: entrypoints/sidepanel/navigation.ts
 * WHAT: Tab names and the `goTo` prop every tab receives, so a tab can send you to another one
 *       (e.g. Run tab's "Open Setup" button).
 * CALLED BY: App.tsx and every tab.
 */
export type TabName = 'Run' | 'Jobs' | 'Review' | 'Setup' | 'Answers' | 'Data' | 'Debug';

export interface TabProps {
  goTo: (tab: TabName) => void;
}

/**
 * FILE: entrypoints/sidepanel/App.tsx
 * WHAT: The side panel frame: header (ApplyPilot, Naukri | LinkedIn switch that also switches the colour theme,
 *       applied-today bar, Test/Live badge), the main tabs
 *       (Run, Jobs, Review, Setup) and a "More" menu (Answers, Data, Debug). Each tab is its own file in ./tabs/.
 * CALLED BY: sidepanel/main.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ComponentType } from 'react';
import { countAppliedToday, db, getSettings, jobPlatform, saveSettings } from '../../db/database';
import type { Platform } from '../../db/types';
import { PLATFORM_NAMES, platformLimits } from './platform';
import { Icon, type IconName } from './icons';
import type { TabName, TabProps } from './navigation';
import { useSetupStatus } from './useSetupStatus';
import SetupTab from './tabs/SetupTab';
import RunTab from './tabs/RunTab';
import JobsTab from './tabs/JobsTab';
import NeedsReviewTab from './tabs/NeedsReviewTab';
import AnswersTab from './tabs/AnswersTab';
import DataTab from './tabs/DataTab';
import DebugTab from './tabs/DebugTab';

const TABS: { name: TabName; icon: IconName; component: ComponentType<TabProps>; main: boolean }[] = [
  { name: 'Run', icon: 'play', component: RunTab, main: true },
  { name: 'Jobs', icon: 'briefcase', component: JobsTab, main: true },
  { name: 'Review', icon: 'help', component: NeedsReviewTab, main: true },
  { name: 'Setup', icon: 'sliders', component: SetupTab, main: true },
  { name: 'Answers', icon: 'chat', component: AnswersTab, main: false },
  { name: 'Data', icon: 'database', component: DataTab, main: false },
  { name: 'Debug', icon: 'terminal', component: DebugTab, main: false },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('Run');
  const [moreOpen, setMoreOpen] = useState(false);
  const setup = useSetupStatus();
  const platform = useLiveQuery(async () => (await getSettings()).platform) ?? 'naukri';
  const reviewCount = useLiveQuery(async () => (await db.jobs.where('status').equals('needs_review').toArray()).filter((job) => jobPlatform(job) === platform).length, [platform]) ?? 0;
  const ActiveComponent = TABS.find((tab) => tab.name === activeTab)?.component ?? RunTab;

  function goTo(tab: TabName) {
    setActiveTab(tab);
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  }

  function badgeFor(tab: TabName) {
    if (tab === 'Review' && reviewCount > 0) return <span className="absolute top-0.5 left-1/2 ml-1 min-w-4 rounded-full bg-amber-500 px-1 text-[9px] leading-4 font-bold text-white">{reviewCount}</span>;
    if (tab === 'Setup' && setup.loaded && !setup.complete) return <span className="absolute top-1 left-1/2 ml-1.5 h-2 w-2 rounded-full bg-red-500" />;
    return null;
  }

  const moreActive = TABS.some((tab) => !tab.main && tab.name === activeTab);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <AppHeader />
        <nav className="relative flex px-2">
          {TABS.filter((tab) => tab.main).map((tab) => (
            <button key={tab.name} onClick={() => goTo(tab.name)}
              className={`relative flex flex-1 flex-col items-center gap-0.5 border-b-2 pt-1.5 pb-2 text-[11px] font-medium transition ${activeTab === tab.name ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              <Icon name={tab.icon} className="h-4 w-4" />
              {tab.name}
              {badgeFor(tab.name)}
            </button>
          ))}
          <button onClick={() => setMoreOpen(!moreOpen)}
            className={`flex flex-1 flex-col items-center gap-0.5 border-b-2 pt-1.5 pb-2 text-[11px] font-medium ${moreActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <Icon name="more" className="h-4 w-4" />
            {moreActive ? activeTab : 'More'}
          </button>
          {moreOpen && (
            <div className="absolute top-full right-2 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {TABS.filter((tab) => !tab.main).map((tab) => (
                <button key={tab.name} onClick={() => goTo(tab.name)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                  <Icon name={tab.icon} className="h-4 w-4 text-slate-500" />{tab.name}
                </button>
              ))}
            </div>
          )}
        </nav>
      </header>
      <main className="p-3" onClick={() => moreOpen && setMoreOpen(false)}>
        <ActiveComponent goTo={goTo} />
      </main>
    </div>
  );
}

/** Small brand marks for the switch (letters only - no logos are copied). */
const SITE_MARK: Record<Platform, { mark: string; active: string }> = {
  naukri: { mark: 'N', active: 'bg-[#275df5] text-white shadow-sm' },
  linkedin: { mark: 'in', active: 'bg-[#0a66c2] text-white shadow-sm' },
};

function PlatformSwitch({ platform }: { platform: Platform }) {
  const runningOn = useLiveQuery(async () => {
    const active = (await db.runs.where('state').anyOf('running', 'paused').toArray()).pop();
    return active ? active.platform ?? 'naukri' : null;
  });
  return (
    <div role="tablist" aria-label="Job site" className="inline-flex rounded-full bg-slate-100 p-0.5 ring-1 ring-slate-200">
      {(Object.keys(PLATFORM_NAMES) as Platform[]).map((name) => {
        const selected = name === platform;
        return (
          <button key={name} role="tab" aria-selected={selected} onClick={() => saveSettings({ platform: name })}
            className={`flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[12px] font-semibold ${selected ? SITE_MARK[name].active : 'text-slate-500 hover:text-slate-800'}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${selected ? 'bg-white/20' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{SITE_MARK[name].mark}</span>
            {PLATFORM_NAMES[name]}
            {runningOn === name && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" title="Running" />}
          </button>
        );
      })}
    </div>
  );
}

function AppHeader() {
  const settings = useLiveQuery(() => getSettings());
  const platform = settings?.platform ?? 'naukri';
  const appliedToday = useLiveQuery(() => countAppliedToday(platform), [platform], 0);
  const limits = settings ? platformLimits(settings) : null;
  const cap = limits?.dailyCap ?? 0;
  const percent = cap > 0 ? Math.min(100, Math.round((appliedToday / cap) * 100)) : 0;

  // The whole side panel takes the selected site's colours (see style.css).
  useEffect(() => {
    document.documentElement.dataset.platform = platform;
  }, [platform]);

  return (
    <div className="px-3.5 pt-3 pb-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-md shadow-brand-500/30">
            <Icon name="sparkles" className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-[15px] leading-tight font-extrabold tracking-tight text-slate-900">Apply<span className="text-brand-600">Pilot</span></h1>
            <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">Smart job applications</p>
          </div>
        </div>
        {limits && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${limits.dryRun ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}
            title={limits.dryRun ? 'Test mode: nothing is submitted' : 'Live: applications are submitted'}>
            <span className={`h-1.5 w-1.5 rounded-full ${limits.dryRun ? 'bg-amber-500' : 'animate-pulse bg-emerald-500'}`} />
            {limits.dryRun ? 'Test mode' : 'Live'}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <PlatformSwitch platform={platform} />
        <div className="min-w-0 flex-1" title={`${appliedToday} of ${cap} applications today`}>
          <div className="flex justify-between text-[10px] font-medium text-slate-500">
            <span>Today</span><span><b className="text-slate-800">{appliedToday}</b>/{cap}</span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

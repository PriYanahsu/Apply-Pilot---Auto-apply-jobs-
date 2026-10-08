/**
 * FILE: tabs/run/SetupChecklist.tsx
 * WHAT: "Finish setup" card shown on the Run tab until the key, resume, profile and keywords are ready.
 * CALLED BY: tabs/RunTab.tsx
 */
import { Icon } from '../../icons';
import type { TabProps } from '../../navigation';
import { Button, Card } from '../../ui';
import type { SetupStatus } from '../../useSetupStatus';

export default function SetupChecklist({ setup, goTo }: { setup: SetupStatus } & TabProps) {
  const items = [
    { done: setup.hasApiKey, text: 'Add your Gemini API key' },
    { done: setup.hasResume, text: 'Upload your resume' },
    { done: setup.hasProfile, text: 'Read your resume & profile for this site' },
    { done: setup.hasKeywords, text: 'Choose what jobs to search for' },
  ];
  const doneCount = items.filter((item) => item.done).length;
  return (
    <Card className="border-brand-200 bg-brand-50/50">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Finish setup to start</h2>
        <span className="text-[11px] font-medium text-brand-700">{doneCount} of {items.length} done</span>
      </div>
      <ul className="mb-3 space-y-1.5">
        {items.map((item) => (
          <li key={item.text} className={`flex items-center gap-2 text-xs ${item.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
            <Icon name={item.done ? 'checkCircle' : 'circle'} className={`h-4 w-4 ${item.done ? 'text-emerald-500' : 'text-slate-300'}`} />
            {item.text}
          </li>
        ))}
      </ul>
      <Button kind="primary" size="sm" icon="sliders" onClick={() => goTo('Setup')}>Open Setup</Button>
    </Card>
  );
}

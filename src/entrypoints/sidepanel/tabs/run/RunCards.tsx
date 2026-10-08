/**
 * FILE: tabs/run/RunCards.tsx
 * WHAT: Small Run-tab cards: "other site is running" (one run at a time), the AI / manual answer switch,
 *       and the LinkedIn safety note.
 * CALLED BY: tabs/RunTab.tsx
 */
import { saveSettings } from '../../../../db/database';
import type { Run, Settings } from '../../../../db/types';
import type { PanelCommand } from '../../../../shared/messages';
import { Icon } from '../../icons';
import { STEP_LABELS } from '../../labels';
import { PLATFORM_NAMES } from '../../platform';
import { Button, Card, Message } from '../../ui';

/** Only one run at a time: while the OTHER site runs in the background, this site waits. */
export function OtherSiteRunning({ run, send }: { run: Run; send: (command: PanelCommand) => void }) {
  const otherPlatform = run.platform ?? 'naukri';
  const step = run.steps[run.stepIndex];
  return (
    <Card className="border-brand-200 bg-brand-50/70">
      <div className="flex items-start gap-2.5">
        <Icon name="spinner" className="mt-0.5 h-4 w-4 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-900">{PLATFORM_NAMES[otherPlatform]} run {run.state === 'paused' ? 'paused' : 'in progress'} in the background</p>
          <p className="mt-0.5 text-[11px] text-slate-600">{step ? `Now: ${STEP_LABELS[step]}. ` : ''}{run.chainNext && !run.chainStarted ? `Run both: ${PLATFORM_NAMES[run.chainNext]} starts automatically after it.` : 'Only one run at a time - you can start here when it finishes.'}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" kind="primary" icon="external" onClick={() => saveSettings({ platform: otherPlatform })}>View {PLATFORM_NAMES[otherPlatform]}</Button>
            <Button size="sm" kind="danger" icon="stop" onClick={() => send({ type: 'STOP_RUN' })}>Stop it</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Who answers screening questions: the AI (default, fully automatic) or you (questions wait in Review). */
export function AnswerModeSwitch({ settings }: { settings: Settings }) {
  const modes = [
    { value: 'ai' as const, label: 'AI answers', hint: 'Every screening question is answered from your resume & profile. Nothing waits for you.' },
    { value: 'manual' as const, label: "I'll answer", hint: 'Questions without a saved answer wait in the Review tab for you.' },
  ];
  const current = modes.find((mode) => mode.value === settings.answerMode) ?? modes[0]!;
  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">Screening questions</span>
        <div role="radiogroup" aria-label="Who answers screening questions" className="inline-flex rounded-full bg-white p-0.5 ring-1 ring-slate-200">
          {modes.map((mode) => (
            <button key={mode.value} role="radio" aria-checked={mode.value === current.value} onClick={() => saveSettings({ answerMode: mode.value })}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${mode.value === current.value ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">{current.hint}</p>
    </div>
  );
}

/** LinkedIn watches for automation: a short, honest reminder of what the extension does to stay safe. */
export function LinkedInNotice() {
  return (
    <Message kind="warning" text="LinkedIn may restrict accounts that look automated. This mode is slow on purpose (45-90 s between applications, a long break every 5), Easy Apply only, max 50 a day. Start in Test mode and keep the daily number low." />
  );
}


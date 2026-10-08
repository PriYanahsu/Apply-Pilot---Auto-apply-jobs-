/**
 * FILE: entrypoints/sidepanel/ui.tsx
 * WHAT: The shared UI kit (Button, Card, Section, Field, Message, Toggle, badges, empty state) so every tab
 *       looks consistent. Change the look of the whole side panel here.
 * CALLED BY: sidepanel tabs.
 */
import type { ReactNode } from 'react';
import type { JobStatus } from '../../db/types';
import { Icon, type IconName } from './icons';
import { STATUS_INFO } from './labels';

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_KINDS: Record<ButtonKind, string> = {
  primary: 'bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/25 hover:from-brand-600 hover:to-brand-800 active:translate-y-px',
  secondary: 'bg-white text-slate-700 border border-slate-300 shadow-xs hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
};
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1',
  md: 'px-3.5 py-2 text-[13px] gap-1.5',
  lg: 'px-4 py-3 text-sm gap-2',
};

export function Button(props: {
  onClick: () => void; children: ReactNode; kind?: ButtonKind; size?: ButtonSize;
  icon?: IconName; disabled?: boolean; className?: string; title?: string; loading?: boolean;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled || props.loading}
      aria-busy={props.loading}
      title={props.title}
      className={`inline-flex items-center justify-center rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_KINDS[props.kind ?? 'secondary']} ${BUTTON_SIZES[props.size ?? 'md']} ${props.className ?? ''}`}
    >
      {(props.loading || props.icon) && <Icon name={props.loading ? 'spinner' : props.icon ?? 'spinner'} className={props.size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5'} />}
      {props.children}
    </button>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm shadow-slate-200/60 ${props.className ?? ''}`}>{props.children}</div>;
}

/** A titled card. `step` shows a numbered circle (turns into a check when `done`). */
export function Section(props: { title: string; children: ReactNode; right?: ReactNode; description?: string; step?: number; done?: boolean }) {
  return (
    <Card className="mb-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          {props.step !== undefined && (
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${props.done ? 'bg-emerald-500 text-white' : 'bg-brand-100 text-brand-700'}`}>
              {props.done ? <Icon name="check" className="h-3 w-3" /> : props.step}
            </span>
          )}
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{props.title}</h2>
            {props.description && <p className="mt-0.5 text-xs text-slate-500">{props.description}</p>}
          </div>
        </div>
        {props.right}
      </div>
      {props.children}
    </Card>
  );
}

export function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-slate-700">{props.label}</span>
      {props.children}
      {props.hint && <span className="mt-1 block text-[11px] leading-snug text-slate-500">{props.hint}</span>}
    </label>
  );
}

const MESSAGE_STYLES = {
  info: { box: 'border-brand-200 bg-brand-50 text-brand-800', icon: 'info' as IconName },
  error: { box: 'border-red-200 bg-red-50 text-red-700', icon: 'alert' as IconName },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: 'checkCircle' as IconName },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800', icon: 'alert' as IconName },
};

export function Message(props: { text: string; kind?: keyof typeof MESSAGE_STYLES }) {
  if (!props.text) return null;
  const style = MESSAGE_STYLES[props.kind ?? 'info'];
  return (
    <div className={`my-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug ${style.box}`}>
      <Icon name={style.icon} className="mt-px h-3.5 w-3.5" />
      <span>{props.text}</span>
    </div>
  );
}

/** iOS-style switch. */
export function Toggle(props: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; description?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span>
        <span className="block text-[13px] font-medium text-slate-800">{props.label}</span>
        {props.description && <span className="block text-[11px] text-slate-500">{props.description}</span>}
      </span>
      <button
        type="button" role="switch" aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${props.checked ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${props.checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

export function StatusBadge(props: { status: JobStatus }) {
  const info = STATUS_INFO[props.status];
  return <span title={info.hint} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${info.color}`}>{info.label}</span>;
}

/** Round match score: green >= 80, amber >= 60, grey below / none. */
export function ScoreBadge(props: { score?: number }) {
  const score = props.score;
  const color = score === undefined ? 'bg-slate-100 text-slate-400 ring-slate-200'
    : score >= 80 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : score >= 60 ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-50 text-slate-500 ring-slate-200';
  return (
    <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-full ring-2 ${color}`} title="AI match score (0-100)">
      <span className="text-sm leading-none font-bold">{score ?? '–'}</span>
      {score !== undefined && <span className="text-[8px] leading-none font-medium opacity-70">match</span>}
    </div>
  );
}

export function EmptyState(props: { icon: IconName; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Icon name={props.icon} className="h-5 w-5" /></span>
      <p className="text-sm font-semibold text-slate-800">{props.title}</p>
      <p className="mt-1 max-w-[260px] text-xs text-slate-500">{props.text}</p>
      {props.action && <div className="mt-4">{props.action}</div>}
    </div>
  );
}

/** "a, b , c" -> ['a','b','c'] */
export function splitList(text: string): string[] {
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

/** Triggers a browser download of `content` as a file. */
export function downloadFile(fileName: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * FILE: tabs/AnswersTab.tsx
 * WHAT: Every remembered screening answer (from you or Gemini). Edit or delete; they are used before asking Gemini.
 *       For checkbox questions, separate several answers with " | ".
 * CALLED BY: sidepanel/App.tsx
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../../db/database';
import type { SavedAnswer } from '../../../db/types';
import { Icon } from '../icons';
import { Button, EmptyState } from '../ui';

const SOURCE_STYLE: Record<SavedAnswer['source'], string> = {
  user: 'bg-brand-50 text-brand-700', gemini: 'bg-violet-50 text-violet-700', rules: 'bg-slate-100 text-slate-600',
};

export default function AnswersTab() {
  const answers = useLiveQuery(() => db.answers.orderBy('updatedAt').reverse().toArray()) ?? [];
  const [search, setSearch] = useState('');
  if (answers.length === 0) {
    return <EmptyState icon="chat" title="No saved answers yet" text="Answers to screening questions are remembered here, so the same question is answered automatically next time." />;
  }
  const visible = answers.filter((item) => `${item.question} ${item.answer}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <div className="relative mb-3">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input className="!pl-8" placeholder={`Search ${answers.length} saved answers`} value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="space-y-2">{visible.map((item) => <AnswerRow key={item.qKey} item={item} />)}</div>
    </div>
  );
}

function AnswerRow({ item }: { item: SavedAnswer }) {
  const [answer, setAnswer] = useState(item.answer);
  const changed = answer !== item.answer;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-800">{item.question}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${SOURCE_STYLE[item.source]}`}>{item.source === 'user' ? 'You' : item.source === 'gemini' ? 'AI' : 'Rule'}</span>
      </div>
      <div className="flex gap-1.5">
        <input value={answer} onChange={(event) => setAnswer(event.target.value)} />
        <Button size="sm" kind="primary" disabled={!changed} onClick={() => db.answers.put({ ...item, answer, source: 'user', updatedAt: new Date().toISOString() })}>Save</Button>
        <Button size="sm" kind="ghost" icon="trash" title="Delete" onClick={() => db.answers.delete(item.qKey)}>{''}</Button>
      </div>
    </div>
  );
}

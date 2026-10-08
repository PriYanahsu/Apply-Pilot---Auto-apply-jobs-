/**
 * FILE: tabs/setup/GeminiSection.tsx
 * WHAT: Gemini API key (masked) + the model fallback list (tried top to bottom when one hits its limit)
 *       + a Test button that checks every model in the list with one tiny call each.
 * CALLED BY: tabs/SetupTab.tsx
 */
import { useState } from 'react';
import { DEFAULT_GEMINI_MODELS } from '../../../../config';
import type { ModelTestResult } from '../../../../ai/gemini';
import type { Settings } from '../../../../db/types';
import { sendToBackground } from '../../../../shared/messages';
import { Button, Field, Message, Section } from '../../ui';
import type { ChangeSettings } from '../SetupTab';

export default function GeminiSection(props: { draft: Settings; change: ChangeSettings }) {
  const [modelsText, setModelsText] = useState(props.draft.geminiModels.join('\n'));
  const [results, setResults] = useState<ModelTestResult[]>([]);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' | 'success' });

  function updateModels(text: string) {
    setModelsText(text);
    props.change({ geminiModels: text.split('\n').map((line) => line.trim()).filter(Boolean) });
  }

  async function testModels() {
    setResults([]);
    setTesting(true);
    setMessage({ text: 'Testing each model (one tiny request each)…', kind: 'info' });
    try {
      const testResults = await sendToBackground<ModelTestResult[]>({ type: 'TEST_GEMINI', apiKey: props.draft.geminiApiKey, models: props.draft.geminiModels });
      setResults(testResults);
      const working = testResults.filter((result) => result.ok).length;
      setMessage({ text: `${working} of ${testResults.length} models work right now. Busy / rate-limited ones are skipped automatically.`, kind: working > 0 ? 'success' : 'error' });
    } catch (error) {
      setMessage({ text: String(error), kind: 'error' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section step={1} done={Boolean(props.draft.geminiApiKey)} title="AI connection (Gemini)" description="Used to read your resume, score jobs and answer screening questions.">
      <Field label="API key" hint="Use your own free key from aistudio.google.com/apikey. It is stored only in this browser and sent only to Google Gemini.">
        <input type="password" value={props.draft.geminiApiKey} onChange={(event) => props.change({ geminiApiKey: event.target.value.trim() })} />
      </Field>
      <details className="mb-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">Models ({props.draft.geminiModels.length}, tried in order when one hits its limit)</summary>
        <textarea rows={6} className="mt-2 font-mono text-[11px]" value={modelsText} onChange={(event) => updateModels(event.target.value)} />
      </details>
      <div className="flex gap-2">
        <Button size="sm" icon="sparkles" loading={testing} onClick={testModels} disabled={!props.draft.geminiApiKey}>{testing ? 'Testing…' : 'Test models'}</Button>
        <Button size="sm" kind="ghost" icon="refresh" onClick={() => updateModels(DEFAULT_GEMINI_MODELS.join('\n'))}>Reset list</Button>
      </div>
      <Message text={message.text} kind={message.kind} />
      {results.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-[11px]">
          {results.map((result) => (
            <li key={result.model} className="flex items-center justify-between px-2.5 py-1.5">
              <span className="font-mono text-slate-700">{result.model}</span>
              <span className={`font-semibold ${result.ok ? 'text-emerald-600' : 'text-slate-400'}`}>{result.ok ? 'Works' : result.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

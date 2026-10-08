# ApplyPilot

Smart, automatic job applications for **Naukri** and **LinkedIn Easy Apply**, running in your own Chrome.

A Chrome extension (Manifest V3) that finds **fresh** jobs on naukri.com and LinkedIn, keeps only those that **match your resume and Naukri profile**, and **applies** to them, answering the screening-question chatbot when it can. It runs entirely in your own Chrome with your existing Naukri login. There is no server.

The full specification is in [BUILD_PROMPT.md](BUILD_PROMPT.md).

---

## Install (developer mode)

```bash
npm install
npm run build          # output goes to .output/chrome-mv3
```

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `.output/chrome-mv3` folder.
3. Click the extension icon to open the **side panel**.

For development with auto-reload, use `npm run dev`.

## First run

1. **Log in to naukri.com** in this Chrome window.
2. **Setup tab:**
   1. Paste **your own** Gemini API key (free from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)) and press **Test models**.
   2. Upload your resume PDF. If it's a scanned PDF, use "paste text instead".
   3. Click **Refresh profile**. It reads your **resume first**, then opens your Naukri profile (read-only) to fill in what the resume doesn't say, such as CTC and notice period. There's no form to fill in; check the details it found under "Your details" and correct one only if it's wrong.
   4. Check the keywords and filters, then press **Save settings**.
3. **Run tab:** press **Find only** first and look at the results in the **Jobs** tab.
4. **Test mode is ON by default.** Press **Find & Apply** and check the "WOULD APPLY" lines in the log.
5. When the results look right, tick **"apply for real"** at the top of the **Run** tab. For your first real runs, set *Max applies per run* = 2 and *Minimum match score* = 85, and watch the worker tab.

## Gemini key and model fallback

- **Key:** every user adds their **own** Gemini API key in Setup (free from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). No key is built into the shareable build (`npm run build`); the key is stored only in that user's browser. For your own testing, a key in `.env.local` (`WXT_GEMINI_API_KEY=...`) is pre-filled **only** in `npm run dev`.
- **Fallback:** the free tier limits each model separately (for example 500 requests/day for Flash Lite, 20/day for Flash). The extension tries the models in **Setup → Models** from top to bottom. When a model fails, it rests and the next one answers instead:

  | What happened | How long that model rests |
  |---|---|
  | Per-minute rate limit (429) | the `retryDelay` Google sends back, or 60 s |
  | Daily rate limit (429) | until midnight Pacific time, when Google resets daily limits |
  | Busy / 5xx / timeout | after one quick retry: 60 s |
  | Model not available for your key (404) | 24 h |

  The run pauses with "Gemini quota reached" only when **every** model is resting for more than about a minute. Press **Resume** later. **Test models** in the Setup tab shows which models work for your key right now. Each fallback appears in the logs under step `gemini`.
- One key = one Google project quota. If another app (e.g. FoodCal) uses the same key, they share the same limits.


## LinkedIn (Easy Apply)

Pick **LinkedIn** in the header dropdown; the whole side panel switches to LinkedIn: its own Test/Live switch, limits, jobs and Review list. Your resume, profile, keywords and AI answers are shared with Naukri.

- **Same pipeline:** search fresh **Easy Apply** jobs → filter → read each job → AI score → apply to the best ones.
- **Easy Apply form, page by page:**
  - prefilled answers (name, email, phone) are kept;
  - the **newest resume** is picked;
  - every empty or rejected question is answered from your resume and profile;
  - then Next → Review → **Submit application**.
- **Counted as applied only** when LinkedIn shows "Application sent", or the job page shows "Applied".
- **Test mode:** fills the whole form, then **discards** it at Submit, so nothing is sent.
- **Safer by design:**
  - slow pacing: 6–12 s between pages, 45–90 s after each application, and a 3–6 min break every 5;
  - caps: 10 per run and 25 per day by default (max 50);
  - it stops immediately on LinkedIn's limit message or security check.
- ⚠️ LinkedIn may restrict accounts that look automated. Keep the numbers low.

LinkedIn's class names are scrambled, so the code only uses stable hooks (`aria-label`, `componentkey`, `data-testid`, `data-sdui-screen`, button text). These are all in [src/linkedin/selectors.ts](src/linkedin/selectors.ts). The LinkedIn code is in `src/linkedin/` (page reading) and `src/steps/linkedin/` (the steps).

## How it works

```
1 Check login → 2 Build profile → 3 Search (fresh only) → 4 Hard filters → 5 Enrich (full JD)
  → 6 Score (rules + Gemini) → 7 Queue → 8 Apply + screening Q&A
```

Each step is one file in [src/steps/](src/steps/), numbered in pipeline order. [src/orchestrator/runPipeline.ts](src/orchestrator/runPipeline.ts) runs them in a plain loop. It saves progress to IndexedDB after every step, so if Chrome stops the background worker, the run continues where it left off.

Safety rules that are always enforced:

- **Freshness:** a job is checked twice (search card, then detail page) and once more right before applying.
- **Score:** never applies below the minimum score. Every applied job has a stored score and reason.
- **No double applies:** checks the local DB and Naukri's "Applied" button before every apply.
- **Applied means really applied:** after clicking Apply (and any screening questions), the job page is **reloaded**. The job is counted as applied only if Naukri's button now says "Applied"; otherwise it's marked `failed` with an explanation. **Jobs → Re-check "applied" jobs** re-verifies older ones and resets any that weren't really applied.
- **Naukri's own match check:** on logged-in job pages Naukri shows ✓/✗ for Key skills, Location and Work experience. Jobs with ✗ for Location or Work experience are skipped by default (Setup tab), and Gemini sees the ✓/✗ when scoring.
- **No guessing:** screening answers come only from saved answers, your facts, or Gemini with confidence ≥ 0.7. Otherwise the job goes to the **Review** tab.
- **Pace (deliberately slow):** one tab, one job at a time, 3–6 s after each page load, 5–10 s between job pages, 25–50 s between applications, a 2–4 min break every 5 applies, and a daily cap (hard max 50). Change these in `src/config.ts`.
- **Captchas:** the run pauses and notifies you. Solve the captcha in the Naukri tab and press **Resume**.
- **Company-site jobs:** saved as `external` for you to apply by hand.

## When something breaks

| Symptom | Look in |
|---|---|
| No jobs found / jobs missing fields | `naukri/selectors.ts`, `naukri/readSearchPage.ts`, Debug → Snapshots |
| Old jobs getting through | `matching/postedDate.ts`, `steps/3-searchJobs.ts`, `steps/5-enrichJobs.ts` |
| Wrong jobs being applied to | `matching/hardFilters.ts`, `matching/ruleScore.ts`, `ai/prompts.ts` (P2), Debug → AI calls |
| Apply button not clicked | `naukri/selectors.ts`, `naukri/clickApply.ts` |
| Screening questions stuck or wrong | `naukri/chatbot.ts`, `matching/answerRules.ts`, `ai/prompts.ts` (P3), Answers tab |
| Run stopped halfway | `orchestrator/runState.ts`, Debug → Logs |
| Gemini errors / quota | `ai/gemini.ts`, `ai/modelCooldowns.ts`, `config.ts` (DEFAULT_GEMINI_MODELS), Debug → Logs (step `gemini`) |
| "Content script not responding" | Reload the extension in `chrome://extensions`, close the old Naukri worker tab |

**Fastest way to get help:** More → Debug → **Copy debug report**, then paste it to your AI assistant. The report never includes your API key or resume. For a selector problem, also download the matching HTML from **Debug → Snapshots**.

**Tracing one job:** click any jobId in the Debug logs to see every line for that job, from search to apply.

## Selectors: what is verified

The **search page** and **job page** selectors were checked against real Naukri pages, which are saved in `tests/fixtures/*-real.html` and covered by parser tests. The **Apply button** matches the HTML from the live, logged-in site. Still unverified: the **chatbot** (`chat*` keys) and the **"Applied" state after applying** (`alreadyApplied`). Every apply is confirmed by reloading the page anyway. For anything that breaks:

1. Open a real Naukri search page, job page, profile page and screening chatbot in DevTools.
2. Confirm or fix each selector key. Put new selectors **first** in the key's list.
3. Save sanitized HTML of each page type into `tests/fixtures/`. The current `search-page.html` is synthetic. Then extend the parser tests.

The least certain parts are the **profile page** (`profile*` keys) and the **chatbot** (`chat*` keys), including whether typing into its text box is noticed by Naukri's React code (`humanType` in `naukri/domHelpers.ts`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev build with hot reload |
| `npm run build` | Production build into `.output/chrome-mv3` |
| `npm run zip` | Zip for the Chrome Web Store |
| `npm run lint` | TypeScript strict type check (`tsc --noEmit`) |
| `npm test` | Unit tests (Vitest) |

## Libraries and why

The libraries allowed by the brief: WXT, React, Tailwind, Dexie, pdfjs-dist, Zod. These were added beyond them:

| Library | Why |
|---|---|
| `dexie-react-hooks` | Dexie's official `useLiveQuery` hook, so the UI updates live from the DB (named in the brief). |
| `@wxt-dev/module-react` | WXT's official React integration. |
| `@tailwindcss/vite` | How Tailwind v4 plugs into Vite. |
| `vitest`, `jsdom` | Unit tests. jsdom gives parser tests a DOM to read the HTML fixtures. |
| `@types/chrome`, `@types/node`, `@types/react*`, `typescript` | Types only. |

`package.json` pins `@vitejs/plugin-react` to 5.1.0 through `overrides`, because newer versions need Vite 8, which this WXT version doesn't use yet.

## Folder map

```
src/
  config.ts          every number, delay, URL, default setting
  entrypoints/       background.ts, naukri.content.ts, sidepanel/ (React UI, one file per tab)
  steps/             the pipeline, one numbered file per step
  orchestrator/      runPipeline (the loop), runState (resume/pause/stop), workerTab, jobFailures
  naukri/            the ONLY code that touches Naukri's DOM (selectors.ts first!)
  matching/          pure functions: dates, experience, filters, scores, rule answers
  ai/                gemini.ts (askGemini + model fallback), modelCooldowns.ts, prompts.ts (P1, P2, P3)
  db/                Dexie schema, types, export/import
  shared/            log, messages, errors, sleep
tests/               Vitest unit tests + HTML fixtures
```

## Privacy

Everything stays in your browser (IndexedDB). The only network calls go to `naukri.com`, as you, and to `generativelanguage.googleapis.com` for Gemini. There are no analytics. The extension never stores your Naukri password and never edits your Naukri profile.
# Apply-Pilot---Auto-apply-jobs-

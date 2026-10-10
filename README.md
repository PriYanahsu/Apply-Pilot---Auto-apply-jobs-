# ApplyPilot

Smart, automatic job applications for **Naukri** and **LinkedIn Easy Apply**, running in your own Chrome.

A Chrome extension (Manifest V3) that finds **fresh** jobs on naukri.com and LinkedIn, keeps only those that **match your resume and Naukri profile**, and **applies** to them, answering the screening-question chatbot when it can. It runs entirely in your own Chrome with your existing Naukri login. There is no server.

## In short (for everyone)

1. Download this project and add the `chrome-mv3` folder to Chrome as an extension.
2. Get a free Gemini key from Google and paste it into ApplyPilot.
3. Upload your resume and let ApplyPilot read your Naukri profile.
4. Press **Find only** to see matching jobs, then **Find & Apply** to apply.
5. ApplyPilot starts in **Test mode**, so it won't submit anything until you switch it to **Live**.

---

## Step 1: Download the project

**Option A: no coding needed**
1. Open this project's page on GitHub.
2. Click the green **Code** button.
3. Click **Download ZIP**.
4. Find the ZIP in your Downloads folder and unzip it (right-click → **Extract All**).

**Option B: with Git**
```bash
git clone https://github.com/PriYanahsu/Apply-Pilot---Auto-apply-jobs-.git
```

The ready-made extension is inside the project, in the folder **`.output/chrome-mv3`**.
> Can't see `.output`? Your computer hides folders that start with a dot.
> On Windows, open File Explorer → **View** → tick **Hidden items**. On Mac, press **Cmd + Shift + .**

## Step 2: Add the extension to Chrome

1. Open Chrome.
2. Type `chrome://extensions` in the address bar and press **Enter**.
3. Turn on **Developer mode** with the switch at the top right.
4. Click **Load unpacked** at the top left.
5. Select the **`chrome-mv3`** folder (inside `.output`) and click **Select Folder**.
6. **ApplyPilot** now shows up in your extensions list.
7. Click the puzzle icon 🧩 in Chrome's toolbar, then the pin 📌 next to ApplyPilot so it stays visible.
8. Click the ApplyPilot icon. A panel opens on the right side of Chrome.

## Step 3: Get your free Gemini key

ApplyPilot uses Google's Gemini AI to read your resume and pick good jobs. Each person needs their own key, and it's free.

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**.
2. Sign in with your Google (Gmail) account.
3. Click **Create API key**.
4. A long code appears. Click **Copy**.
5. Keep this key private, like a password.

## Step 4: Paste the key into ApplyPilot

1. In the ApplyPilot panel, open the **Setup** tab.
2. Find the **AI connection (Gemini)** section.
3. Click inside the **API key** box and paste the key (**Ctrl + V**, or **Cmd + V** on Mac).
4. Click **Test models**.
5. If you see "… models work right now", your key works. ✅
6. Scroll to the bottom and click **Save settings**.

Your key stays only in your own Chrome and is sent only to Google.

## Step 5: Set up your profile (resume + Naukri)

1. Open **naukri.com** in the same Chrome and **log in** to your account.
2. Back in ApplyPilot, in **Setup**, find **Resume & Naukri profile**.
3. Click **Choose file** and select your resume **PDF**.
   - If your resume is a scanned image, click **paste text instead** and paste your resume text.
4. Click **Read my Naukri profile**.
5. Wait about a minute. ApplyPilot reads your resume first, then fills in missing details (salary, notice period, and so on) from your Naukri profile. It **never changes** your Naukri profile.
6. **Check your target roles and skills** (they decide which jobs match you):
   - **Target roles:** the job titles you want, e.g. `Frontend Developer, React Developer`.
   - **Skills:** click **×** on a wrong skill, or type a missing one and click **Add**. The small "3y" shows how many years you used a skill, worked out from the dates in your resume.
   - These changes save instantly and are kept when your profile is re-read.
7. Look at the summary under **Your details**. Only change something if it's wrong.
8. Check **Job titles to search for** (e.g. `React Developer, Frontend Developer`; click a suggestion to add it) and **Cities** (e.g. `Bangalore, Pune`).
9. Click **Save settings**. A yellow "You have unsaved changes" note reminds you if you forget.

## Step 6: Find and apply to jobs

1. Open the **Run** tab.
2. Click **Find only**. ApplyPilot searches for fresh jobs and scores them against your resume. Nothing is applied yet.
3. Open the **Jobs** tab to see what it found and each job's match score. Each card shows the skills you **have** (green) and are **missing** (amber); click **Why?** to see how the score was made.
4. Back in **Run**, click **Find & Apply**.
   - You're still in **Test mode**, so it only *pretends* to apply. The log shows "WOULD APPLY" for each job it would have applied to.
5. When the results look right, turn on the **Test mode** switch at the top of **Run**. The badge changes to **Live**, and real applications start.
6. For your first real run, set **Max applies per run** to **2**.

## What each button does

| Button | What it does |
|---|---|
| **Test models** | Checks that your Gemini key works |
| **Read my Naukri profile** | Reads your resume and Naukri profile |
| **Save settings** | Saves everything on the Setup tab |
| **Find only** | Finds and scores jobs without applying |
| **Find & Apply** | Finds jobs and applies to the good matches |
| **Apply queued** | Applies to jobs already found and scored as good matches |
| **Pause / Resume / Stop** | Controls a run while it's going |
| **Start fresh** | Clears today's searches so you can search again |
| Header dropdown | Switches between **Naukri** and **LinkedIn** |

## How matching works

Each job gets a score from 0 to 100:

- **AI recruiter review (65%)**: Gemini checks the role type, the job's **must-have** skills against the evidence in your work history (where and how long you used each one), and your seniority. A missing core requirement is a **deal-breaker** and caps the score at 40.
- **Keyword check (35%)**: your skills vs the job's skills (read from the description when the job has no skill tags), the job title vs your target roles, and your years vs the job's experience range.
- Skills the AI calls "missing" but you actually have under another spelling (ReactJS / React) are removed automatically.

## Good to know

- **Keep Chrome open** while it runs. It works in a tab of its own, so don't close that tab.
- **Review tab:** if a recruiter asks a question ApplyPilot can't answer, the job goes here. Type the answer once, and ApplyPilot remembers it for next time.
- **Captcha:** if Naukri shows a captcha, the run pauses. Solve it in the Naukri tab and click **Resume**.
- **Company-website jobs** are saved for you to apply to yourself.
- **"Gemini quota reached":** the free daily limit is used up. Try again tomorrow, or click **Resume** later.
- **LinkedIn:** pick **LinkedIn** in the header dropdown and log in to linkedin.com. Keep the numbers low, because LinkedIn may restrict accounts that look automated.

---

## For developers

### Build from source

```bash
npm install
npm run build          # output goes to .output/chrome-mv3
```

Then load `.output/chrome-mv3` in Chrome as in Step 2. Run `npm run build` again before pushing, so the shared build stays up to date. For development with auto-reload, use `npm run dev`.

The full specification is in [BUILD_PROMPT.md](BUILD_PROMPT.md).

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

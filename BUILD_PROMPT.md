# Build Prompt: "Naukri AutoApply" Chrome Extension

> **How to use this file:** Give this whole document to an AI coding agent (Claude Code, Cursor, etc.) or a developer as the build brief. It is written to be followed top to bottom. Build in the milestone order in §13 and check each milestone against its acceptance criteria before moving on.

---

## 0. Role and Objective

You are a **senior Chrome-extension engineer** building a production-quality **Manifest V3** extension called **Naukri AutoApply**.

**Goal:** with one click, the extension:

1. finds **fresh** jobs on naukri.com (posted within the last **N days**, default **3**),
2. keeps only jobs that **genuinely match** the user's **resume and Naukri profile**,
3. **applies** to them automatically, including answering Naukri's screening-question chatbot,
4. **records** every step locally so the user can see what happened and why.

All of this runs **in the user's own Chrome**, using their existing Naukri login. There is no backend server.

---

## 1. Non-Negotiable Rules

Read these before writing any code. They override everything else in this document.

| # | Rule |
|---|------|
| R1 | **No backend.** All logic runs in the extension. The only network calls are to `naukri.com` (as the logged-in user) and the Gemini API. |
| R2 | **Freshness is enforced twice:** once with the search filter (`jobAge`) and again by checking the job's own posted date. A job older than `maxJobAgeDays` must **never** be applied to. |
| R3 | **Never apply below the match threshold.** Every applied job must have a stored `finalScore >= minScore` and a stored reason. |
| R4 | **Never apply twice.** Check the local DB **and** Naukri's "Applied" state on the job page before clicking Apply. |
| R5 | **Never invent facts.** Screening answers come only from the resume, the Naukri profile, and user-entered facts. If Gemini isn't confident, stop that application and mark it `needs_review`. Never guess salary, degrees, or employers. |
| R6 | **Behave like a human:** randomized delays, one tab, sequential applies, and a daily cap (default 40, hard max 50). |
| R7 | **Skip external applies** ("Apply on company site"). Save them with status `external` so the user can apply by hand. |
| R8 | **Resumable.** The MV3 service worker can be killed at any time. All run state lives in IndexedDB, and a run must continue from where it stopped. |
| R9 | **Selectors are config, not code.** Every Naukri DOM selector lives in one file (`src/naukri/selectors.ts`) with fallbacks, so a site redesign is a one-file fix. |
| R10 | **Privacy.** The Gemini key and all data stay in the user's browser. No analytics or telemetry. |

---

## 1.5 Keep It Simple: Code Rules (Very Important)

The owner of this project will debug it **with an AI assistant**, not as an expert extension developer. **Readable beats clever.** If two ways work, choose the one a beginner can follow.

### Simplicity rules

| # | Rule |
|---|------|
| S1 | **One file = one job.** Each file does one clearly named thing (`scoreJobs.ts`, `applyToJob.ts`). Keep files **under ~200 lines** and functions **under ~40 lines**. |
| S2 | **Plain functions only.** No classes, no inheritance, no dependency injection, no decorators, no generic "frameworks inside the app". |
| S3 | **No clever TypeScript.** Simple `interface`s and `type` unions only. No conditional types, mapped types, or deep generics. |
| S4 | **Use `async/await` everywhere**, top to bottom like a recipe. No callback chains or `.then()` pyramids. |
| S5 | **Few libraries.** Allowed: WXT, React, Tailwind, Dexie, pdfjs-dist, Zod. Anything else needs a written reason in the README. No Redux; use React `useState` + Dexie `useLiveQuery`. |
| S6 | **Descriptive names, no abbreviations.** `appliedTodayCount`, not `atc`. `isJobTooOld()`, not `chk()`. |
| S7 | **Every file starts with a header comment** explaining what it does, who calls it, and what it returns (template below). |
| S8 | **No magic numbers or strings.** All limits, delays and URLs live in `src/config.ts`. All Naukri selectors live in `src/naukri/selectors.ts`. |
| S9 | **Errors are never swallowed.** Every `catch` either logs with context and rethrows, or logs and marks the job `failed` with a readable message. An empty `catch {}` is forbidden. |
| S10 | **Each pipeline step is its own numbered file** (`steps/3-searchJobs.ts`), so the folder order matches the pipeline order in §5. |
| S11 | **No premature abstraction.** Write it plainly first. Only extract a shared helper when the same code appears three times. |
| S12 | **Comments explain *why*, not *what*.** Comment any Naukri-specific quirk, e.g. `// Naukri renders the chatbot 1-2s after clicking Apply`. |

### File header template (required at the top of every `.ts` / `.tsx` file)

```ts
/**
 * FILE: steps/6-scoreJobs.ts
 * WHAT: Gives each fresh job a match score (0-100) using skill overlap + Gemini.
 * CALLED BY: orchestrator/runPipeline.ts
 * READS: db.jobs (status = 'enriched'), db.profile
 * WRITES: db.jobs.ruleScore / aiScore / finalScore / matchReason, status -> 'scored'
 * IF IT BREAKS: check the "score" lines in the Debug tab; Gemini errors are logged with the jobId.
 */
```

### Debuggability rules

| # | Rule |
|---|------|
| D1 | **One logger, used everywhere:** `log(step, message, data?)` in `src/shared/log.ts`. It writes to the console **and** the `logs` table. Format: `[14:02:11] [6-score] Scored 8 jobs (jobId=123..., finalScore=82)`. |
| D2 | **Every log line includes the step name and the `jobId`** when there is one, so one job can be traced from search to apply by filtering the logs. |
| D3 | **Dry-run mode** (setting `dryRun: true`, on by default for the first run): does everything except the final click on Apply and the final chatbot Send. It logs `WOULD APPLY: <job>` instead. |
| D4 | **Run each step alone.** The Debug tab has one button per pipeline step (Search, Filter, Enrich, Score, Apply 1 job), so a broken step can be tested without running everything. |
| D5 | **Save evidence on failure.** When a Naukri step fails, save to the `debugSnapshots` table: page URL, the selector key that failed, `document.title`, and the first 50 KB of the relevant HTML. The Debug tab can download it so you can give it to an AI to fix the selector. |
| D6 | **Log every Gemini exchange** (prompt + raw response + parsed result) in the `aiCalls` table when `debugMode` is on. Never log the API key. |
| D7 | **Readable error messages.** Each one says what failed, for which job, and what to try: `"Apply button not found on job 1234 (selector: applyButton). Naukri layout may have changed - see Debug > Snapshots."` |
| D8 | **"Copy debug report" button:** copies the last run's settings (without the API key), counters, last 200 log lines, and recent failures as one markdown block, ready to paste to an AI. |

### Database additions for debugging

```ts
db.version(1).stores({
  // ...tables from §4...
  debugSnapshots: '++id, ts, jobId, step',
  aiCalls:        '++id, ts, jobId, promptName',
});
```

---

## 2. Tech Stack

| Concern | Choice |
|---|---|
| Extension framework | **WXT** (Vite-based, MV3) |
| Language | **TypeScript** (strict mode) |
| UI | **React 18** + **Tailwind CSS**, shown in the Chrome **Side Panel** |
| Local database | **IndexedDB via Dexie.js** |
| Resume parsing | **pdf.js** (`pdfjs-dist`), running in the side panel |
| AI | **Google Gemini REST API** (`gemini-2.5-flash` by default; model name is configurable), using `responseMimeType: application/json` + `responseSchema` |
| Validation | **Zod** for every Gemini response and every message between parts of the extension |
| Scheduling | `chrome.alarms` (optional daily auto-run) |
| Tests | **Vitest** (unit tests) + saved HTML fixtures of Naukri pages (parser tests) |

---

## 3. Architecture

```
┌──────────────────────────── Chrome (user already logged in to Naukri) ───────────────────────────┐
│                                                                                                   │
│  ┌──────────────────────┐   messages    ┌─────────────────────────────┐   messages   ┌─────────────────────────┐
│  │  Side Panel (React)  │ ◄───────────► │ Background Service Worker   │ ◄──────────► │ Content Script          │
│  │  - Setup/Onboarding  │               │ = ORCHESTRATOR              │              │ (naukri.com worker tab) │
│  │  - Run / progress    │               │ - Run state machine         │              │ - read job cards        │
│  │  - Jobs / History    │               │ - Gemini client             │              │ - read job detail / JD  │
│  │  - Answers editor    │               │ - Rate limiter / daily cap  │              │ - read Naukri profile   │
│  │  - Export / Import   │               │ - chrome.alarms             │              │ - click Apply           │
│  └─────────┬────────────┘               └──────────────┬──────────────┘              │ - drive chatbot Q&A     │
│            │                                           │                             └─────────────────────────┘
│            └──────────────► IndexedDB (Dexie) ◄────────┘        (side panel and worker share one DB)
│                                                                                                   │
└─────────────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                              │ HTTPS
                                   generativelanguage.googleapis.com (Gemini)
```

### Responsibilities

- **Side Panel:** UI only. It reads from the DB, sends commands (`START_RUN`, `STOP_RUN`, `REFRESH_PROFILE`), and shows live progress through a `chrome.runtime` port plus Dexie `liveQuery`.
- **Background (orchestrator):** owns the **run state machine** (§6). It opens and reuses **one dedicated Naukri worker tab** (`active: false`), sends one step at a time to the content script, calls Gemini, and saves progress after **every** step.
- **Content script:** does nothing on its own. It only answers typed commands from the background (`SCRAPE_SEARCH_PAGE`, `SCRAPE_JOB_DETAIL`, `SCRAPE_PROFILE`, `CLICK_APPLY`, `READ_CHATBOT`, `ANSWER_CHATBOT`, `DETECT_APPLY_RESULT`) and returns Zod-validated data.

### Messaging contract

Use one discriminated union per direction in `src/shared/messages.ts`. Every content-script command:

- has a timeout (default 20 s),
- returns `{ ok: true, data } | { ok: false, error: { code, message } }`.

Error codes: `NOT_LOGGED_IN`, `SELECTOR_MISSING`, `TIMEOUT`, `CAPTCHA`, `UNKNOWN`.

---

## 4. Data Model (Dexie)

```ts
// src/db/schema.ts
db.version(1).stores({
  settings:  'id',                       // single row, id = 'main'
  profile:   'id',                       // single row, id = 'main' (merged candidate profile)
  jobs:      'jobId, status, finalScore, postedAt, fetchedAt, appliedAt, keyword',
  answers:   'qKey, updatedAt',          // screening-question memory
  runs:      '++id, startedAt, state',   // run history + resumable state
  logs:      '++id, runId, ts, level',
});
```

```ts
interface Settings {
  geminiApiKey: string;
  geminiModel: string;                 // default 'gemini-2.5-flash'
  keywords: string[];                  // e.g. ['react developer', 'frontend engineer']
  locations: string[];                 // [] = anywhere
  experienceYears: number;
  maxJobAgeDays: 1 | 3 | 7;            // default 3
  pagesPerSearch: number;              // default 2
  minScore: number;                    // default 70
  maxAppliesPerRun: number;            // default 20
  dailyCap: number;                    // default 40, hard max 50
  excludeCompanies: string[];
  excludeTitleWords: string[];         // e.g. ['intern', 'sales', 'php']
  autoRunDailyAt?: string;             // 'HH:mm', optional
  dryRun: boolean;                     // default true: do everything except the final Apply/Send click
  debugMode: boolean;                  // default false: also log every Gemini prompt/response
  facts: {                             // used for screening questions
    fullName: string; phone: string; currentLocation: string;
    totalExperienceYears: number; currentCtcLpa: number; expectedCtcLpa: number;
    noticePeriodDays: number; willingToRelocate: boolean; notes: string;
  };
}

interface CandidateProfile {           // merge of resume + Naukri profile (§5.2)
  summary: string;
  currentTitle: string;
  totalExperienceYears: number;
  skills: { name: string; years?: number; source: 'resume' | 'naukri' | 'both' }[];
  preferredLocations: string[];
  targetTitles: string[];
  resumeText: string;
  naukriProfileText: string;
  updatedAt: string;
}

type JobStatus =
  | 'found' | 'filtered_out' | 'enriched' | 'scored' | 'queued'
  | 'applied' | 'already_applied' | 'external'
  | 'needs_review' | 'failed' | 'stale';

interface Job {
  jobId: string; url: string; title: string; company: string;
  location: string; experienceText: string; expMin?: number; expMax?: number;
  salaryText?: string; skills: string[]; description: string;
  postedText: string; postedAt: string;          // ISO, normalized (§5.3)
  keyword: string; fetchedAt: string;
  filterReason?: string;                          // why it was filtered out
  ruleScore?: number; aiScore?: number; finalScore?: number;
  matchReason?: string; missingSkills?: string[];
  status: JobStatus; error?: string; appliedAt?: string;
  qa?: { question: string; answer: string; source: 'memory' | 'gemini' | 'user' }[];
}
```

---

## 5. Pipeline: From Profile to Applied Job

```
[1 Onboard] → [2 Build Profile] → [3 Search (fresh)] → [4 Hard Filters] → [5 Enrich JD]
      → [6 Score (rules + Gemini)] → [7 Queue] → [8 Apply + Screening Q&A] → [9 Record]
```

### 5.1 Onboarding (first run)
1. Check the user is logged in: open `https://www.naukri.com/mnjuser/homepage`. If it redirects to a login page, show "Please log in to Naukri in this Chrome window" and stop.
2. Ask for the Gemini API key. Test it with a one-token call before saving.
3. Upload the resume PDF and extract its text with pdf.js. If the text is under 300 characters (a scanned PDF), ask the user to paste the resume text instead.
4. Collect the `facts` form. Fields Gemini can fill from the resume are pre-filled; the user confirms them.

### 5.2 Build the Candidate Profile (resume + Naukri profile)
1. **Scrape the Naukri profile** (`/mnjuser/profile`): headline, key skills, employment entries, total experience, preferred locations, current and expected CTC, notice period, and IT-skills table (skill + years).
2. **Parse the resume** with Gemini using **Prompt P1** (§7).
3. **Merge** them:
   - Use the union of skills, tagged `resume` / `naukri` / `both`.
   - On conflicting numbers (experience, CTC, notice), the Naukri profile wins, because that is what recruiters see. Show conflicts in the UI so the user can fix one source.
   - `targetTitles` = Gemini suggestions + current title. Use them to suggest keywords if the user has none.
4. Save to `profile`. Rebuild when the user clicks **Refresh profile** or uploads a new resume.

### 5.3 Search: Fresh Jobs Only
- **URL pattern** (check it in DevTools at build time and keep it in `selectors.ts`):
  `https://www.naukri.com/{kw-slug}-jobs[-in-{loc-slug}][-{page}]?k={kw}&l={loc}&experience={years}&jobAge={maxJobAgeDays}`
- Read each result card: `jobId` (`data-job-id`, falling back to the long number in the URL), title, company, location, experience, salary, skills tags, short description, posted label.
- **Normalize the posted date** into `postedAt`:
  - "Just now", "Few hours ago", "Today" → today
  - "1 day ago", "2 days ago", … → today − N
  - "30+ days ago" or anything unknown → mark `stale` and skip
- **Freshness gate #1:** reject if `postedAt` is older than `maxJobAgeDays`.
- Remove duplicates by `jobId` across keywords, locations and earlier runs. If a job is already in the DB with a final status, skip it.
- Stop paging when a page has no fresh jobs or when `pagesPerSearch` is reached.
- *(Optional, after DOM scraping works)* If Naukri's internal JSON search endpoint is visible in DevTools when the search page loads, you may call it from the content script with the user's session. It is faster and more precise, but keep DOM scraping as the fallback.

### 5.4 Hard Filters (cheap and certain; no AI)
Mark the job `filtered_out` with a `filterReason` if **any** of these is true:
- The title contains any `excludeTitleWords` (case-insensitive, whole word).
- The company is in `excludeCompanies`.
- The experience range doesn't fit: parse "2-5 Yrs" → `expMin=2, expMax=5`. Reject if `candidateYears < expMin − 1` or `candidateYears > expMax + 2`.
- `locations` is set and the job matches none of them (always allow "Remote" / "Work from home").
- Skill overlap is zero (see `ruleScore` below) **and** the title shares no word with `targetTitles`.

### 5.5 Enrich
For jobs that pass the hard filters, open the job detail page (worker tab) and read:
- the **full job description**, required skills, role, industry, education,
- the detail page's posted date. This is **freshness gate #2**: reject if it is too old.
- the apply type: `naukri` (Apply button), `external` (company site), or `already_applied`.

`external` and `already_applied` jobs are saved with that status and never scored or applied.

### 5.6 Score: Rules + Gemini
- **`ruleScore` (0–100), deterministic:**
  `skillOverlap = |jobSkills ∩ candidateSkills| / max(|jobSkills|, 1)` after normalizing skill names: lowercase, strip punctuation, and map synonyms (`js→javascript`, `reactjs→react`, `node→node.js`, `k8s→kubernetes`, …; keep the synonym map in `src/match/synonyms.ts`).
  `ruleScore = round(70·skillOverlap + 30·titleSimilarity)`.
- **`aiScore` (0–100):** Gemini **Prompt P2**, batched up to 8 jobs per call, using the full job descriptions.
- **`finalScore = round(0.35·ruleScore + 0.65·aiScore)`.**
- Hard override: if Gemini returns `"dealBreaker": true` (for example, a required degree or certification the candidate lacks, a different domain, or seniority far off), set `finalScore = min(finalScore, 40)`.
- Store `matchReason` and `missingSkills` for the UI.

### 5.7 Queue
Queue jobs with `finalScore >= minScore` and `status = 'scored'`, ordered by `finalScore` desc, then `postedAt` desc (newest first). Limit the queue to `min(maxAppliesPerRun, dailyCap − appliedToday)`.

### 5.8 Apply and Screening Q&A
For each queued job (one at a time):
1. Navigate the worker tab to `job.url` and wait for it to settle (selector + 1.5–3.5 s jitter).
2. **Recheck:** if the job shows Applied → `already_applied`. If it shows company-site apply → `external`. If a captcha appears → **pause the whole run**, notify the user, and wait for **Resume**.
3. Click **Apply**. Then wait up to 10 s for one of these:
   - a **success** signal (success banner / "Applied" state) → `applied`
   - the **chatbot drawer** → go to Q&A
   - a **redirect to another domain** → `external`
4. **Chatbot loop** (max 15 questions, 60 s total):
   1. Read the latest bot question and the input type: `text` | `radio` | `checkbox` | `chips` | `dropdown`, with its options.
   2. **Answer lookup order:**
      1. `answers` table: exact `qKey` (normalized question text), then fuzzy match (token Jaccard ≥ 0.85).
      2. **Rules** for common questions: years of experience in a skill (from the profile skills' `years`, else total experience), CTC, expected CTC, notice period, current location, relocation.
      3. Gemini **Prompt P3**. It must return `{ answer, confidence }`.
   3. If `confidence < 0.7`, or the answer isn't one of the given options, **stop** this job: status `needs_review`, save the question, and move on. Never guess.
   4. Fill in the answer (type text / pick option) and submit. Confirm the question advanced. If the same question repeats twice, mark `needs_review`.
   5. Save each Q&A to `job.qa`. Save new Gemini answers to the `answers` table with `source: 'gemini'` so the user can review and edit them.
5. On success: `applied`, `appliedAt = now`, and increase the daily counter.
6. Wait **8–20 s (random)** before the next job. Every 10 applications, take a 60–120 s break.

### 5.9 Record
- Every state change gets a `logs` row (runId, level, message, jobId).
- The run row stores counters: found, filtered, scored, queued, applied, external, needsReview, failed.
- The side panel shows these live.

---

## 6. Run State Machine (Background)

```
IDLE → CHECK_LOGIN → BUILD_PROFILE? → SEARCHING → FILTERING → ENRICHING → SCORING
     → APPLYING ⇄ PAUSED(captcha | user) → DONE
              ↘ ERROR (with reason; resumable)
```

- Keep it simple: `runPipeline.ts` is a plain `for` loop over the step files in order, with a `switch` on the saved state to know where to resume. No state-machine library.
- Save the current state, cursor (keyword/location/page index, or queue index), and counters to `runs` **after every step**.
- On service-worker startup, or on a `chrome.alarms` keep-alive tick every 30 s while a run is active, reload the active run and continue from its cursor.
- **Stop** must work immediately: check a `stopRequested` flag between every step.
- Only one run at a time.

---

## 7. Gemini Prompts

Every call: `temperature: 0.2`, `responseMimeType: 'application/json'`, a `responseSchema` that matches the Zod schema, a 30 s timeout, retry ×2 with backoff on 429/5xx. Validate with Zod. If validation fails, retry once, then mark the item `failed`.

### P1: Resume parser
```
SYSTEM: You extract structured data from resumes. Use only information present in the text.
If something is missing, return null. Do not infer or embellish.

USER:
Extract from the resume below:
- name, currentTitle, totalExperienceYears (number, computed from employment dates if not stated)
- skills: list of {name, years|null} – technical and domain skills only, most important first, max 30
- targetTitles: 3-5 job titles this person is realistically qualified for today
- searchKeywords: 3-5 Naukri search phrases (2-3 words each)
- education: list of {degree, field, year|null}
- summary: 3 factual sentences

RESUME:
"""{{resumeText}}"""
```

### P2: Job match scorer (batched)
```
SYSTEM: You are a strict technical recruiter. You score how well a candidate fits each job.
Score honestly; a wrong application wastes the candidate's daily limit.

Scoring guide:
90-100 = core skills and seniority match, candidate would be shortlisted
70-89  = strong match, 1-2 minor gaps
50-69  = partial match, notable gaps
0-49   = poor fit or different role/domain
Set dealBreaker=true if the job hard-requires something the candidate clearly lacks
(mandatory degree/certification, very different domain, seniority off by > 3 years, specific clearance).

USER:
CANDIDATE PROFILE:
{{profile.summary}}
Title: {{profile.currentTitle}} | Experience: {{profile.totalExperienceYears}} yrs
Skills: {{profile.skills as "name (years)"}}
Target titles: {{profile.targetTitles}}

JOBS (JSON):
{{[{jobId, title, company, experienceText, skills, description (first 2500 chars)}]}}

Return JSON: [{ "jobId": string, "score": int, "dealBreaker": boolean,
               "reason": "<= 20 words, concrete", "missingSkills": string[] }]
```

### P3: Screening-question answerer
```
SYSTEM: You fill job application screening questions on behalf of a candidate.
Answer ONLY from the facts given. Never invent employers, degrees, certifications, numbers or skills.
If the facts don't contain the answer, return confidence 0.

Formatting rules:
- Numeric questions (years, LPA, days): digits only, e.g. "4" or "12.5".
- Option questions: return one option EXACTLY as written in OPTIONS.
- Yes/No questions: "Yes" or "No".
- Free text: one sentence, max 25 words, first person.

USER:
CANDIDATE FACTS:
{{settings.facts}}
PROFILE SKILLS: {{profile.skills}}
RESUME (excerpt): {{profile.resumeText first 6000 chars}}
JOB: {{job.title}} at {{job.company}}

QUESTION: {{question}}
INPUT TYPE: {{text|radio|checkbox|dropdown}}
OPTIONS: {{options or "none"}}

Return JSON: { "answer": string | string[], "confidence": number (0-1), "basis": "which fact you used" }
```

---

## 8. Naukri DOM Layer

All selectors live in `src/naukri/selectors.ts` as **arrays of fallbacks**, tried in order:

```ts
export const SEL = {
  searchCard:      ['.srp-jobtuple-wrapper', 'article.jobTuple'],
  cardTitle:       ['a.title'],
  cardCompany:     ['.comp-name', 'a.subTitle'],
  cardLocation:    ['.locWdth', '.loc-wrap'],
  cardExperience:  ['.expwdth', '.exp-wrap'],
  cardSalary:      ['.sal-wrap', '.sal'],
  cardSkills:      ['ul.tags-gt li', 'ul.tags li'],
  cardPosted:      ['.job-post-day', '.postedDate'],
  applyButton:     ['#apply-button', 'button.apply-button'],
  companySiteBtn:  ['#company-site-button'],
  alreadyApplied:  ['#already-applied'],
  chatDrawer:      ['[class*="chatbot_Drawer"]'],
  chatBotMessage:  ['[class*="botMsg"]'],
  chatTextInput:   ['[class*="chatbot"] [contenteditable="true"]', '[class*="chatbot"] textarea'],
  chatOption:      ['[class*="chatbot"] input[type="radio"]', '[class*="chatbot"] input[type="checkbox"]'],
  chatSend:        ['[class*="chatbot"] .sendMsg', '[class*="chatbot"] button'],
  // + text-based fallbacks matched by button innerText: 'Apply', 'Applied', 'Apply on company site'
} as const;
```

> ⚠️ **These selectors are starting points and have not been checked against the live site.** Before writing parsers, open real Naukri search, job, profile and chatbot pages in DevTools and confirm or correct every selector. Save sanitized HTML of each page type into `tests/fixtures/` and write parser unit tests against those files.

Helpers:
- `query(el, key)` tries each fallback and returns the first match, or throws `SELECTOR_MISSING` with the key name. The UI shows "Naukri layout changed: `<key>`".
- `waitFor(key, timeout)` uses a MutationObserver, not polling.
- `humanClick(el)` scrolls the element into view, waits 200–600 ms, then dispatches pointer/mouse events and `click()`.
- `humanType(el, text)` types character by character with 30–90 ms delays and fires `input` and `change` events (works on contenteditable elements too).

---

## 9. Side Panel UI

Tabs:
1. **Setup:** Gemini key (masked, with a Test button), resume upload, Naukri profile status (last synced + Refresh), merged profile view with a conflicts warning, keywords and locations (with suggestions from P1), filters, scores and limits, `facts` form.
2. **Run:** a large **Find & Apply** button, plus separate **Find only** and **Apply queued** buttons. Shows the live stage, a progress bar, counters, a scrolling log, and **Pause / Stop / Resume**. Shows "Applied today: X / cap".
3. **Jobs:** a table with filters by status and score. Columns: score, title, company, posted, status, reason, missing skills. Row actions: open on Naukri, apply now, skip, mark applied.
4. **Needs review:** jobs stopped at screening questions. Shows the question; the user types the answer once, it's saved to `answers`, and the job is re-queued.
5. **Answers:** an editable table of all saved screening answers.
6. **Data:** export/import all data as JSON, export jobs as CSV, clear data (with confirmation).
7. **Debug:** dry-run and debug-mode toggles; logs viewer filterable by step and jobId; failure snapshots (download HTML); Gemini calls (prompt → raw response → parsed); one button per pipeline step; **Copy debug report**.

---

## 10. Folder Structure

Keep this structure exactly. Each folder answers one question, so you (or an AI) always know where to look.

```
naukri-extension/
├── README.md                      # Install, setup, and "When something breaks" guide
├── BUILD_PROMPT.md                # This file
├── wxt.config.ts                  # Manifest: permissions, side panel
├── package.json
│
├── src/
│   ├── config.ts                  # ALL numbers/URLs: delays, limits, default settings, Gemini URL
│   │
│   ├── entrypoints/               # "Where does the extension start?"
│   │   ├── background.ts          #   starts the orchestrator, listens for side-panel commands
│   │   ├── naukri.content.ts      #   runs on naukri.com, routes commands to src/naukri/*
│   │   └── sidepanel/             #   the React UI
│   │       ├── index.html
│   │       ├── main.tsx
│   │       ├── App.tsx            #   just the tab switcher
│   │       └── tabs/              #   one file per tab
│   │           ├── SetupTab.tsx
│   │           ├── RunTab.tsx
│   │           ├── JobsTab.tsx
│   │           ├── NeedsReviewTab.tsx
│   │           ├── AnswersTab.tsx
│   │           ├── DataTab.tsx
│   │           └── DebugTab.tsx   #   logs, snapshots, AI calls, run-one-step buttons, copy report
│   │
│   ├── steps/                     # "What does the pipeline do?" - read in order, one file per step
│   │   ├── 1-checkLogin.ts
│   │   ├── 2-buildProfile.ts      #   resume + Naukri profile -> merged profile
│   │   ├── 3-searchJobs.ts        #   fresh jobs only (gate #1)
│   │   ├── 4-filterJobs.ts        #   hard filters, no AI
│   │   ├── 5-enrichJobs.ts        #   full JD + freshness gate #2 + apply type
│   │   ├── 6-scoreJobs.ts         #   rule score + Gemini score
│   │   ├── 7-queueJobs.ts         #   pick what to apply to today
│   │   └── 8-applyToJob.ts        #   apply to ONE job (calls chatbot answers)
│   │
│   ├── orchestrator/              # "Who runs the steps?"
│   │   ├── runPipeline.ts         #   calls steps 1-8 in order, saves progress after each
│   │   └── runState.ts            #   load/save/resume run state, stop/pause flags
│   │
│   ├── naukri/                    # "How do we read/click Naukri?" - the ONLY code that touches Naukri's DOM
│   │   ├── selectors.ts           #   every selector, with fallbacks  <- first place to look when Naukri changes
│   │   ├── searchUrl.ts           #   builds search URLs
│   │   ├── readSearchPage.ts
│   │   ├── readJobPage.ts
│   │   ├── readProfilePage.ts
│   │   ├── clickApply.ts
│   │   ├── chatbot.ts             #   read question / type answer / send
│   │   └── domHelpers.ts          #   query(), waitFor(), humanClick(), humanType()
│   │
│   ├── matching/                  # "How do we decide a job is good?" - pure functions, no DOM, no network
│   │   ├── postedDate.ts          #   "2 days ago" -> date
│   │   ├── experienceRange.ts     #   "2-5 Yrs" -> {min, max}
│   │   ├── hardFilters.ts
│   │   ├── ruleScore.ts
│   │   ├── skillSynonyms.ts
│   │   └── answerRules.ts         #   rule-based answers (CTC, notice, years of X)
│   │
│   ├── ai/                        # "How do we talk to Gemini?"
│   │   ├── gemini.ts              #   one function: askGemini(promptName, prompt, schema)
│   │   └── prompts.ts             #   P1, P2, P3 as plain template functions
│   │
│   ├── db/                        # "Where is data stored?"
│   │   ├── database.ts            #   Dexie tables (schema)
│   │   ├── types.ts               #   Settings, Profile, Job, Answer, Run, Log interfaces
│   │   └── exportImport.ts
│   │
│   └── shared/                    # Small helpers used everywhere
│       ├── log.ts                 #   log(step, message, data?)
│       ├── messages.ts            #   message types between background / content / side panel
│       └── sleep.ts               #   sleep(), randomDelay()
│
└── tests/
    ├── fixtures/                  # saved Naukri HTML pages (personal data removed)
    ├── postedDate.test.ts
    ├── experienceRange.test.ts
    ├── hardFilters.test.ts
    ├── ruleScore.test.ts
    └── readSearchPage.test.ts
```

**Where to look when something breaks** (put this table in the README too):

| Symptom | Look in |
|---|---|
| No jobs found / jobs missing fields | `naukri/selectors.ts`, `naukri/readSearchPage.ts`, Debug → Snapshots |
| Old jobs getting through | `matching/postedDate.ts`, `steps/3-searchJobs.ts`, `steps/5-enrichJobs.ts` |
| Wrong jobs being applied to | `matching/hardFilters.ts`, `matching/ruleScore.ts`, `ai/prompts.ts` (P2), Debug → AI calls |
| Apply button not clicked | `naukri/selectors.ts`, `naukri/clickApply.ts` |
| Screening questions stuck or wrong | `naukri/chatbot.ts`, `matching/answerRules.ts`, `ai/prompts.ts` (P3), Answers tab |
| Run stopped halfway | `orchestrator/runState.ts`, Debug → Logs |
| Gemini errors | `ai/gemini.ts`, Debug → AI calls |

**Manifest permissions (keep minimal):** `storage`, `sidePanel`, `tabs`, `scripting`, `alarms`, `notifications`, `unlimitedStorage`.
**host_permissions:** `https://*.naukri.com/*`, `https://generativelanguage.googleapis.com/*`.

---

## 11. Error Handling

| Situation | Behavior |
|---|---|
| Not logged in | Stop the run and show a "Log in to Naukri" button that opens the login page |
| Captcha / unusual-activity page | **Pause** the run, send a Chrome notification, and wait for the user to click Resume |
| Selector missing | Mark the job `failed` with the selector key. After 3 in a row, stop the run (the site layout probably changed) |
| Gemini 429 / quota | Back off (2 s, 8 s, 30 s). If still failing, pause with "Gemini quota reached" |
| Invalid Gemini JSON | Retry once, then mark the item `failed` |
| Service worker killed | Continue automatically from the saved cursor (R8) |
| Daily cap reached | End the run cleanly with a summary |
| Naukri's own "daily apply limit" message | Set `appliedToday = dailyCap` and end the run |

---

## 12. Acceptance Criteria

The build is done when **all** of these pass:

1. **Freshness:** with `maxJobAgeDays = 3`, no job with `postedAt` older than 3 days reaches `queued` (unit tests on `postedDate.ts` + an integration check on fixtures).
2. **Match quality:** every `applied` job has `finalScore >= minScore`, a `matchReason`, and passed all hard filters (assert in the repo layer before setting `applied`).
3. **No duplicates:** running the same search twice applies to each job at most once.
4. **Profile merge:** skills from both resume and Naukri profile appear, tagged by source, and conflicts are shown.
5. **Screening Q&A:** known questions are answered from memory without calling Gemini. Low-confidence questions end in `needs_review`, not a guessed answer.
6. **Resumability:** killing the service worker during `APPLYING` (chrome://serviceworker-internals → Stop) and restarting continues from the same queue position.
7. **Limits:** never more than `dailyCap` applies per calendar day. Delays between applies are always ≥ 8 s.
8. **Data:** an export → clear → import round trip restores settings, profile, jobs and answers exactly.
9. **Selectors:** all selectors are in `selectors.ts`. Parser tests pass on fixtures.
10. **Privacy:** no network requests to any domain except naukri.com and generativelanguage.googleapis.com (check in DevTools Network).
11. **Simplicity:** every file has the header comment (S7), no file is over ~200 lines, there are no classes, and `npm run lint` + `npm test` pass.
12. **Debuggability:** with dry-run on, a full run completes and every job can be traced from search to "WOULD APPLY" in the Debug tab by filtering on its jobId.

---

## 13. Build Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | WXT scaffold, folder structure from §10, `config.ts`, `log.ts`, Dexie schema, Settings tab, **Debug tab (logs + copy report)**, Gemini key test | Settings persist across browser restart; logs appear in the Debug tab |
| M2 | Resume upload + P1 parsing + Naukri profile scraping + merge view | Merged profile shows skills from both sources |
| M3 | Search + card parsing + posted-date normalization + hard filters (no applying yet) | "Find only" fills the Jobs tab with fresh, filtered jobs |
| M4 | Enrich (JD) + rule score + P2 scoring + queue | Jobs show scores, reasons, missing skills |
| M5 | Apply flow **without** chatbot (jobs with direct Apply) + already-applied/external detection | Test on 3 real jobs, all states recorded correctly |
| M6 | Chatbot Q&A: memory → rules → P3, needs-review flow, Answers tab | Jobs with screening questions apply end-to-end |
| M7 | State machine resumability, pause/resume, captcha pause, daily cap, delays | Criteria 6 and 7 pass |
| M8 | Export/import, CSV, optional daily alarm, README, polish | All acceptance criteria pass |

> **Test safely:** keep **dry-run on** until M6 works end-to-end in dry-run. Then, for the first real runs, set `maxAppliesPerRun = 2` and `minScore = 85`, and watch the worker tab while it runs.

---

## 14. Do NOT

- ❌ Call any third-party server or add analytics.
- ❌ Store the user's Naukri password. The extension relies on the existing browser login.
- ❌ Open many tabs or apply in parallel.
- ❌ Auto-solve or bypass captchas. Pause and hand control to the user.
- ❌ Fill screening answers with guesses when the facts don't support them.
- ❌ Hard-code selectors outside `selectors.ts`.
- ❌ Change the user's Naukri profile in any way.
- ❌ Add classes, clever generics, state-machine or DI libraries, or "utility frameworks". Plain functions only (§1.5).
- ❌ Write an empty `catch {}` or log an error without the step name and jobId.

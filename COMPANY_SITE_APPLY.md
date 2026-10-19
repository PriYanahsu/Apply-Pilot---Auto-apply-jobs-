# Company-site apply

Implemented as the `COMPANY_APPLYING` step. It does not run until Naukri and LinkedIn in-platform applies are finished for the run.

Today, a job that applies on the company website is saved as status `external` and left alone. Naukri does that in `src/steps/8-applyToJob.ts`. LinkedIn does that in `src/steps/linkedin/li-5-enrichJobs.ts` and `src/steps/linkedin/li-8-applyToJob.ts`. The company URL is not stored. The extension may only run on `naukri.com`, `linkedin.com`, and Gemini (`wxt.config.ts`).

## Hard rule

Company-site apply is the last step of a run. It starts only after every in-platform apply queue for that run is empty.

| Run | In-platform work that must finish first | Then |
|---|---|---|
| Naukri only | `APPLYING` returns (queue empty, per-run limit, or daily cap) | company-site step |
| LinkedIn only | `LI_APPLYING` returns the same way | company-site step |
| Run both | Naukri run finishes, then the chained LinkedIn run finishes `LI_APPLYING` | company-site step, once, on the LinkedIn run |

Do not open a company site while `APPLYING` or `LI_APPLYING` still has a queued job. Do not start company sites at the end of the Naukri half of Run both. That half only chains LinkedIn (`chainNext` in `src/entrypoints/background.ts`). Company sites wait until that second run's Easy Apply queue is done.

`find` mode does not apply anywhere, including company sites. `apply-now` / `apply-one` stays on the one in-platform job. It does not continue into company sites.

## What to reuse

LinkedIn Easy Apply already walks a form page by page:

1. `readEasyApplyForm()` reads the live dialog: label, type, options, required, error, and the footer button (`Next` / `Review` / `Submit`).
2. `fillFormPage()` answers empty fields from saved answers, then rules, then Gemini, using the resume and profile. It does not invent facts.
3. `walkThroughForm()` clicks that button, waits until the page changes, and repeats. Test mode fills and discards before Submit.

Company sites use that same loop. Do not dump the page HTML and regex inputs. Read the live form. Unknown question, login wall, captcha, or a site that is not a known apply system goes to `needs_review` or stays `external`. Same rule as Naukri screening (`needs_review`).

## Order inside the new step

The step runs only after the rule above. Inside it:

1. Load jobs already marked `external` that have a saved company URL and passed the same safety checks as an in-platform apply (score, reason, freshness, not already applied).
2. Skip hosts that are not a known apply system. Leave those as Company site for a manual apply.
3. Known hosts, in order: Greenhouse, Lever, Ashby. Workday stays manual until it has its own adapter.
4. For each job: open the company URL, read the visible fields, fill from the profile, click the button under the form, repeat until submit or a stop.
5. Count it applied only when that site shows its own success state. Otherwise `failed` or `needs_review`. Never mark `applied` just because the form was filled.

Test mode fills and leaves without submitting, same as Easy Apply.

## Data

On the Naukri or LinkedIn job page, when apply type is external, save the outbound URL on the job before setting status `external`. The Naukri/LinkedIn job URL stays in `url`. The company URL is a separate field. If the click only redirects, store the final URL from the worker tab (`src/steps/8-applyToJob.ts` already sees that redirect and then drops it).

Host permission has to include those apply-system domains before a content script can run there. Do not request every site on the internet in the first version.

## Out of scope

- Applying on a company site before the in-platform queues are done.
- A generic HTML parser for arbitrary career pages.
- Uploading the resume into Workday, or creating accounts, or solving captchas.

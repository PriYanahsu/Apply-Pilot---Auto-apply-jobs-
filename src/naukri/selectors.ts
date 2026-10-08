/**
 * FILE: naukri/selectors.ts
 * WHAT: EVERY Naukri DOM selector and URL pattern (rule R9). Each key is a list of fallbacks tried in order.
 * CALLED BY: naukri/domHelpers.ts and the naukri/read*.ts parsers.
 * IF IT BREAKS: this is the FIRST place to look when Naukri changes its layout.
 *   1. Open Debug > Snapshots, download the HTML for the failing selector key.
 *   2. Open the same page on naukri.com, right-click > Inspect, find the element.
 *   3. Add the new selector at the START of that key's list. Keep the old ones as fallbacks.
 * NOTE: job-page keys (applyButton, jobHeader, jobDescription, jobStats) were checked against a real job page.
 *       The rest are best-effort; verify them against the live site (BUILD_PROMPT §8).
 */

export const SEL = {
  // ----- search results page -----
  searchCard: ['.srp-jobtuple-wrapper', 'article.jobTuple', '[data-job-id]'],
  cardTitle: ['a.title', '.title a', 'a[class*="title"]'],
  cardCompany: ['.comp-name', 'a.subTitle', '[class*="comp-name"]'],
  cardLocation: ['.locWdth', '.loc-wrap', '.loc', '[class*="loc"]'],
  cardExperience: ['.expwdth', '.exp-wrap', '.exp', '[class*="exp"]'],
  cardSalary: ['.sal-wrap', '.sal', '[class*="sal"]'],
  cardSkills: ['ul.tags-gt li', 'ul.tags li', '[class*="tags"] li'],
  cardDescription: ['.job-desc', '.job-description', '[class*="job-desc"]'],
  cardPosted: ['.job-post-day', '.postedDate', '[class*="post-day"]'],
  noResults: ['[class*="no-result"]', '.noResultContainer'],

  // ----- job detail page -----
  // ----- verified against a real job page (Oct 2026) -----
  jobTitle: ['h1[class*="jd-header-title"]', '.jd-header-title', 'h1'],
  jobCompany: ['[class*="jd-header-comp-name"] a', '.jd-header-comp-name a', '[class*="comp-name"]'],
  jobDescription: ['[class*="dang-inner-html"]', 'section[class*="job-desc-container"]', '.job-desc', '[class*="job-desc"]'],
  jobSkills: ['[class*="key-skill"] [class*="chip"]', '[class*="key-skill"] a'],
  // Preferred (must-have) key skills carry this icon inside their chip.
  jobSkillPreferredIcon: ['i.ni-icon-jd-save'],
  jobLocation: ['[class*="jhc__location"]', '[class*="jhc__loc"]'],
  jobStats: ['[class*="jhc__stat"]', '[class*="jd-stats"] > span', '[class*="jd-stats"] span'],
  // "jhc__exp__" with trailing underscores: plain "jhc__exp" also matches the experience+salary container.
  jobExperience: ['[class*="jhc__exp__"]', '[class*="jhc__exp"] span'],
  // Role / Industry / Department rows AND the Education rows ("UG: ...", "PG: ...") - two blocks, one list.
  jobOtherDetails: ['[class*="other-details"] [class*="details"], [class*="education"] [class*="details"]'],
  // Naukri's own "Job match score" (logged in only): Early Applicant / Keyskills / Location / Work Experience.
  matchScoreItem: ['[class*="MS__details"]'],
  matchScoreCheckIcon: ['i[class*="check"]'],
  // Confirmed on the live site: <button id="apply-button" class="styles_apply-button__uJI3A apply-button">Apply</button>
  // Walk-in jobs use <button id="walkin-button" class="styles_walkin-button__gRooP walkin-button">I am interested</button>
  applyButton: ['#apply-button', 'button.apply-button', 'button[class*="apply-button"]', '#walkin-button', 'button[class*="walkin-button"]'],
  companySiteButton: ['#company-site-button', 'button[class*="company-site-button"]'],
  alreadyApplied: ['#already-applied', 'button[class*="already-applied"]', '[id*="already-applied"]', 'span[class*="already-applied"]', '[class*="applied-status"]'],
  jobHeader: ['#job_header', 'section[class*="job-header-container"]'],
  applySuccess: ['[class*="apply-message"]', '[class*="applied-success"]', '.success-msg'],

  // ----- chatbot (screening questions) - structure checked on the live site (Oct 2026): -----
  // div.chatbot_Drawer > .chatbot_MessageContainer > ul.list > li.botItem > div.botMsg.msg   (the questions)
  //                    > .footerWrapper > .footerInputBoxWrapper (text box) + div.chipsContainer (answer chips)
  //                    > div.sendMsgbtn_container (Send; hidden for chip questions - a chip click sends itself)
  // NOTE: li.botLogo > div.chipMsg is the bot's logo row, NOT an answer chip.
  chatDrawer: ['[class*="chatbot_Drawer"]', '[class*="chatbot_drawer"]', '.chatbot_DrawerContentWrapper'],
  chatBotMessage: ['li[class*="botItem"] [class*="botMsg"]', '[class*="botMsg"]'],
  chatTextInput: ['[class*="footerInputBoxWrapper"] [contenteditable="true"]', '[class*="footerInputBoxWrapper"] textarea', '[class*="footerInputBoxWrapper"] input', '[class*="chatbot"] [contenteditable="true"]', '[class*="chatbot"] textarea'],
  chatRadioOption: ['[class*="chatbot"] input[type="radio"]'],
  chatCheckboxOption: ['[class*="chatbot"] input[type="checkbox"]'],
  chatChipOption: ['[class*="chipsContainer"] [class*="chip"]', '[class*="chipsContainer"] [class*="Chip"]', '[class*="chipsContainer"] span'],
  chatLoadMore: ['[class*="chipsContainer"] [class*="loadMore"]', '[class*="chipsContainer"] [class*="load-more"]', '[class*="chipsContainer"] a'],
  chatDropdown: ['[class*="chatbot"] select'],
  chatSend: ['[class*="sendMsgbtn_container"] [class*="sendMsg"]', '[class*="sendMsgbtn_container"] button', '[class*="sendMsgbtn_container"]', '[class*="chatbot"] .sendMsg'],

  // ----- profile page (/mnjuser/profile) -----
  profileName: ['[class*="fullname"]', '.name', 'h1'],
  profileHeadline: ['#lazyResumeHead .prof-desc', '[class*="resumeHeadline"]', '.resumeHeadline'],
  profileKeySkills: ['#lazyKeySkills .chip', '[class*="keySkills"] .chip', '.keySkills span'],
  profileItSkillRows: ['#lazyITSkills tr', '[class*="itSkills"] tr', '.itSkills tr'],
  profileEmployment: ['#lazyEmployment', '[class*="employment"]'],
  profileDetails: ['.prof-detail', '[class*="personalDetails"]', '[class*="profile-details"]', '.info'],

  // ----- page-level checks -----
  captcha: ['iframe[src*="recaptcha"]', 'iframe[src*="captcha"]', '#captcha', '[class*="captcha"]'],
} as const;

export type SelectorKey = keyof typeof SEL;

/** Button texts used as a fallback when the button selectors above stop working. */
export const BUTTON_TEXT = {
  // Some jobs (often recruiter-posted) show "I am interested" instead of "Apply" - it is Naukri's apply too.
  apply: ['apply', 'i am interested', "i'm interested"],
  // After applying the button becomes "Applied" (or "Interested" / "Interest shown" for "I am interested" jobs).
  applied: ['applied', 'interested', 'interest shown'],
  companySite: ['apply on company site', 'apply on company website'],
} as const;

/** Text that means "the application went through". */
export const APPLY_SUCCESS_TEXTS = ['you have successfully applied', 'successfully applied', 'application sent'];
/** Chatbot messages that END the conversation (Naukri then submits by itself) - never answer these. */
export const CHATBOT_CLOSING_TEXTS = [
  'thank you for your response', 'thank you for your responses', 'thanks for your response', 'thanks for your responses',
  'thank you for answering', 'thanks for answering', 'we have received your response', 'your responses have been',
  'your application has been', 'all the best', 'thank you for sharing', 'thanks for sharing',
];

/** Chatbot messages that START the conversation (not questions) - never answer these, wait for the first question. */
export const CHATBOT_INTRO_TEXTS = [
  'thank you for showing interest', 'thanks for showing interest', 'kindly answer all', 'please answer all',
  'answer all the recruiter', 'answer the following questions', 'answer a few questions', 'to successfully apply',
];

/** Text that means "Naukri's own daily apply limit was hit". */
export const DAILY_LIMIT_TEXTS = ['daily quota', 'apply limit', 'maximum number of applies', 'reached the limit'];
/** Text that means captcha / bot check. */
export const CAPTCHA_TEXTS = ['unusual activity', 'verify you are human', 'are you a robot'];

/**
 * Search URL pattern (verify in DevTools):
 * https://www.naukri.com/{kw-slug}-jobs[-in-{loc-slug}][-{page}]?k={kw}&l={loc}&experience={years}&jobAge={days}
 */
export const SEARCH_URL = {
  pathTemplate: '/{keywordSlug}-jobs{locationPart}{pagePart}',
  locationPart: '-in-{locationSlug}',
  pagePart: '-{page}',
  params: { keyword: 'k', location: 'l', experience: 'experience', jobAge: 'jobAge' },
} as const;

/** A Naukri job URL ends with a long numeric id, e.g. ...-3-to-5-years-061024500123 */
export const JOB_ID_IN_URL_PATTERN = /-(\d{9,})(?:[?#/]|$)/;

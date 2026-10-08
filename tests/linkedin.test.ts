// @vitest-environment jsdom
/**
 * FILE: tests/linkedin.test.ts
 * WHAT: LinkedIn readers against HTML shaped like the live site (Oct 2026 screenshots): scrambled class names,
 *       stable hooks only (componentkey, aria-label, data-testid, data-sdui-screen).
 */
import { describe, expect, it } from 'vitest';
import { readEasyApplyForm } from '../src/linkedin/easyApplyForm';
import { detectLinkedInApplyType } from '../src/linkedin/readJobPage';
import { readLinkedInSearchPage } from '../src/linkedin/readSearchPage';
import { buildLinkedInSearchUrl } from '../src/linkedin/searchUrl';

HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

const CARD = `
<div role="button" tabindex="0" class="fmbjqw fmbgm7" componentkey="job-card-component-ref-4475438772">
  <div class="e0sle3"><figure class="fmblfu" aria-hidden="true"></figure>
    <div class="e0sanj"><p class="fmbkzy"><span class="e0sarb">Jr. Associate - Full Stack Developer</span><span aria-hidden="true">Jr. Associate - Full Stack Developer</span></p></div>
    <div class="e0skio"><p class="e0skzy">Interloop Consulting I India &amp; UAE</p></div>
    <p class="fmbkzy fmbkxo">New Delhi (On-site)</p>
    <p class="e0sanj">You'd be a top applicant</p>
    <p class="e0sanj">1 day ago · Easy Apply</p>
  </div>
</div>`;

describe('LinkedIn search page', () => {
  it('reads the new-UI job card by its componentkey', () => {
    document.body.innerHTML = `<div data-testid="lazy-column" componentkey="SearchResultsMainContent">${CARD}</div>`;
    expect(readLinkedInSearchPage(document)).toEqual([expect.objectContaining({
      jobId: 'li-4475438772', url: 'https://www.linkedin.com/jobs/view/4475438772/',
      title: 'Jr. Associate - Full Stack Developer', company: 'Interloop Consulting I India & UAE',
      location: 'New Delhi (On-site)', postedText: '1 day ago',
    })]);
  });
  it('builds a full-time, your-level, last-N-days, newest-first search URL', () => {
    expect(buildLinkedInSearchUrl({ keyword: 'Java Developer', location: 'India', page: 2, maxJobAgeDays: 3, experienceYears: 1 }))
      .toBe('https://www.linkedin.com/jobs/search/?keywords=Java+Developer&location=India&f_JT=F&f_E=2%2C3&f_TPR=r259200&sortBy=DD&start=25');
    expect(buildLinkedInSearchUrl({ keyword: 'React', location: '', page: 1, maxJobAgeDays: 1, easyApplyOnly: true })).toContain('f_AL=true');
  });
  it('marks whether a card is Easy Apply', () => {
    document.body.innerHTML = CARD + CARD.replace('4475438772', '4475438999').replace('1 day ago · Easy Apply', '2 hours ago');
    expect(readLinkedInSearchPage(document).map((card) => card.easyApply)).toEqual([true, false]);
  });
});

describe('LinkedIn job page', () => {
  it('finds Easy Apply by aria-label', () => {
    document.body.innerHTML = `<div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails">
      <button class="fmbk8d" type="button" aria-label="Easy Apply to this job"><span>Easy Apply</span></button></div>`;
    expect(detectLinkedInApplyType(document)).toBe('easy_apply');
  });
  it('recognises an already-applied job', () => {
    document.body.innerHTML = '<div><span>Applied 2 minutes ago</span><button>Save</button></div>';
    expect(detectLinkedInApplyType(document)).toBe('already_applied');
  });
});

const DIALOG = (inner: string, footer = '<button type="button"><span>Next</span></button>') => `
<dialog open aria-labelledby="dialog-header"><header id="dialog-header">Apply to Interloop Consulting I India &amp; UAE</header>
<div data-testid="dialog-content"><div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.easyapply.EasyApply">
  <span>1/7 pages</span>${inner}${footer}
  <button aria-label="Dismiss">x</button>
</div></div></dialog>`;

describe('LinkedIn Easy Apply form', () => {
  it('page 1: contact info is prefilled, so nothing needs answering', () => {
    document.body.innerHTML = DIALOG(`<p>Contact info</p>
      <div componentkey="easyApplyFieldFocus_ea.q::37187271074::FIRST_NAME::firstName.validation"><label for="fn">First name*</label><input id="fn" type="text" value="Priyanshu"></div>
      <div componentkey="easyApplyFieldFocus_ea.q::37187271082::LAST_NAME::lastName.validation"><label for="ln">Last name*</label><input id="ln" type="text" value="Kumar"></div>
      <div componentkey="easyApplyFieldFocus_phone"><label for="cc">Phone country code*</label><select id="cc"><option>Select an option</option><option selected>India (+91)</option></select></div>`);
    const form = readEasyApplyForm();
    expect(form).toMatchObject({ open: true, done: false, progress: '1/7 pages', primaryButton: 'next' });
    expect(form.fields.map((field) => [field.label, field.kind, field.value[0], field.required])).toEqual([
      ['First name', 'text', 'Priyanshu', true], ['Last name', 'text', 'Kumar', true], ['Phone country code', 'select', 'India (+91)', true],
    ]);
  });
  it('page 2: the resume list is a "resume" question', () => {
    document.body.innerHTML = DIALOG(`<p>Resume*</p>
      <div><input type="radio" name="resume" id="r1" checked><label for="r1">Priyanshu Kumar - Full Stack Engineer Resume.pdf 10/7/2026</label></div>
      <div><input type="radio" name="resume" id="r2"><label for="r2">Priyanshu_Kumar_FullStack_Engineer.pdf 9/26/2026</label></div>`);
    const [resume] = readEasyApplyForm().fields;
    expect(resume?.kind).toBe('resume');
    expect(resume?.options).toHaveLength(2);
  });
  it('questions page: empty number / radio / dropdown, a rejected answer, and the Review button', () => {
    document.body.innerHTML = DIALOG(`
      <div componentkey="easyApplyFieldFocus_q1"><label for="y">How many years of work experience do you have with Java?*</label><input id="y" type="text" value="abc" aria-invalid="true"><div role="alert">Enter a whole number between 0 and 99</div></div>
      <fieldset componentkey="easyApplyFieldFocus_q2"><legend>Are you comfortable commuting to this job's location?*</legend>
        <input type="radio" name="commute" id="c1"><label for="c1">Yes</label><input type="radio" name="commute" id="c2"><label for="c2">No</label></fieldset>
      <div componentkey="easyApplyFieldFocus_q3"><label for="e">English proficiency*</label><select id="e"><option>Select an option</option><option>Native or bilingual</option><option>Professional</option></select></div>`,
      '<button><span>Review</span></button>');
    const form = readEasyApplyForm();
    expect(form.primaryButton).toBe('review');
    expect(form.errors).toEqual(['Enter a whole number between 0 and 99']);
    expect(form.fields.map((field) => [field.label, field.kind, field.options])).toEqual([
      ['How many years of work experience do you have with Java?', 'text', []],
      ["Are you comfortable commuting to this job's location?", 'radio', ['Yes', 'No']],
      ['English proficiency', 'select', ['Native or bilingual', 'Professional']],
    ]);
  });
  it('knows when LinkedIn says the application was sent', () => {
    document.body.innerHTML = DIALOG('<h2>Your application was sent to Interloop Consulting</h2>', '<button><span>Done</span></button>');
    expect(readEasyApplyForm().done).toBe(true);
  });
});

describe('LinkedIn CLASSIC search page (still shown to many accounts)', () => {
  it('reads classic cards: title link, lockup subtitle (company) and caption (location)', () => {
    document.body.innerHTML = `<ul>
      <li class="scaffold-layout__list-item" data-occludable-job-id="4478000001">
        <div class="job-card-container" data-job-id="4478000001">
          <div class="artdeco-entity-lockup__title"><a class="job-card-list__title job-card-container__link" href="/jobs/view/4478000001/">
            <span aria-hidden="true"><strong>Junior Web Developer – HTML5 / CSS3 / JavaScript</strong></span>
            <span class="visually-hidden">Junior Web Developer – HTML5 / CSS3 / JavaScript</span></a></div>
          <div class="artdeco-entity-lockup__subtitle"><span>Semiconductor For You</span></div>
          <div class="artdeco-entity-lockup__caption"><ul class="job-card-container__metadata-wrapper"><li><span>Nagpur, Maharashtra, India (On-site)</span></li></ul></div>
          <ul class="job-card-list__footer-wrapper"><li>Viewed</li><li><span>Easy Apply</span></li></ul>
          <time datetime="2026-10-08">14 minutes ago</time>
        </div></li>
      <li class="scaffold-layout__list-item" data-occludable-job-id="4478000002"></li>
    </ul>`;
    const cards = readLinkedInSearchPage(document);
    // The second card is still empty (not scrolled into view yet) - skipped, not an error.
    expect(cards).toEqual([expect.objectContaining({
      jobId: 'li-4478000001', title: 'Junior Web Developer – HTML5 / CSS3 / JavaScript',
      company: 'Semiconductor For You', location: 'Nagpur, Maharashtra, India (On-site)', postedText: '14 minutes ago',
    })]);
  });
});

describe('LinkedIn job page: closed jobs and other layouts', () => {
  it('"Not currently accepting applications" = closed (from a live run)', async () => {
    const { readLinkedInJobPage } = await import('../src/linkedin/readJobPage');
    document.body.innerHTML = `<main><h1>Web Developer</h1><p>Noida, Uttar Pradesh, India · 15 minutes ago · 32 applicants</p>
      <div><span>Not currently accepting applications</span></div></main>`;
    expect(readLinkedInJobPage(document)).toMatchObject({ title: 'Web Developer', applyType: 'closed', postedText: '15 minutes ago' });
  });
  it('reads the job text from the classic #job-details block', async () => {
    const { readLinkedInJobPage } = await import('../src/linkedin/readJobPage');
    document.body.innerHTML = `<div class="jobs-search__job-details"><h1>Full Stack Engineer</h1>
      <button aria-label="Easy Apply to Full Stack Engineer at Recro"><span>Easy Apply</span></button>
      <div id="job-details"><h2>About the job</h2><p>We need a Full Stack Engineer with React, Node.js and PostgreSQL to build our platform.</p></div></div>`;
    const detail = readLinkedInJobPage(document);
    expect(detail.applyType).toBe('easy_apply');
    expect(detail.description).toContain('React, Node.js and PostgreSQL');
  });
});

describe('LinkedIn job page in an unknown layout', () => {
  it('falls back to the panel text instead of failing', async () => {
    const { readLinkedInJobPage } = await import('../src/linkedin/readJobPage');
    document.body.innerHTML = `<nav>Home My Network Jobs</nav><main><h1>Full Stack Developer</h1>
      <button aria-label="Easy Apply to this job"><span>Easy Apply</span></button>
      <div class="x1y2"><div class="z9"><span>We are hiring a Full Stack Developer: Java, Spring Boot, React. 1-3 years.</span></div></div></main>`;
    const detail = readLinkedInJobPage(document);
    expect(detail.applyType).toBe('easy_apply');
    expect(detail.description).toContain('Java, Spring Boot, React');
    expect(detail.description).not.toContain('My Network');
  });
});

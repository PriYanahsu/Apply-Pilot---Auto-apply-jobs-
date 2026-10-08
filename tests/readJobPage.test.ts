// @vitest-environment jsdom
/**
 * FILE: tests/readJobPage.test.ts
 * WHAT: Parser test against a REAL Naukri job page (tests/fixtures/job-page-real.html, logged out)
 *       plus the logged-in "Job match score" block as seen on the live site.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJobPage } from '../src/naukri/readJobPage';

function loadFixture(name: string): Document {
  return new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8'), 'text/html');
}

// jsdom has no layout engine, so treat every element as visible (must run before any page is parsed).
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

describe('readJobPage on a real job page', () => {
  const page = loadFixture('job-page-real.html');
  const detail = readJobPage(page);

  it('reads the header', () => {
    expect(detail.title).toBe('React JS Developer');
    expect(detail.company).toContain('Infosys');
    expect(detail.experienceText).toBe('2 - 5 years'); // not "2 - 5 years Not Disclosed"
    expect(detail.location).toBe('Pune, Chennai, Bengaluru');
    expect(detail.postedText).toBe('2 days ago');
  });
  it('reads the full description and key skills', () => {
    expect(detail.description).toContain('Roles & Responsibilities');
    expect(detail.description.length).toBeGreaterThan(500);
    expect(detail.skills).toEqual(expect.arrayContaining(['Node.js', 'TypeScript', 'React.js', 'Azure']));
    expect(detail.preferredSkills).toEqual(['Node.js', 'TypeScript', 'Javascript', 'React.js', 'Nestjs']);
  });
  it('reads role, industry and education', () => {
    expect(detail.role).toContain('Software Development');
    expect(detail.industry).toBe('IT Services & Consulting');
    expect(detail.education).toContain('B.Tech / B.E.');
  });
  it('finds the Apply button', () => {
    expect(detail.applyType).toBe('naukri');
  });
});

describe('Naukri "Job match score" (logged in)', () => {
  // Icon classes copied from the live logged-in page: ✓ = ni-icon-check_circle, ✗ = ni-icon-crossMatchscore
  it('reads check / cross per item', () => {
    const page = new DOMParser().parseFromString(`
      <section class="styles_job-desc-container__txpYf"><div class="styles_short-desc__8IUp6"><div class="styles_JDC__dang-inner-html__h0K4t"><p>Dear Aspirants,</p><p>Requirement Angular + .NET Developer</p></div></div>
      <div class="styles_JDC__match-score__VnjLL">
        <div class="styles_MS__details__iS7mj"><i class="ni-icon-check_circle"></i><span>Early Applicant</span></div>
        <div class="styles_MS__details__iS7mj"><i class="ni-icon-crossMatchscore"></i><span>Keyskills</span></div>
        <div class="styles_MS__details__iS7mj"><i class="ni-icon-check_circle"></i><span>Location</span></div>
        <div class="styles_MS__details__iS7mj"><i class="ni-icon-check_circle"></i><span>Work Experience</span></div>
      </div></section>
      <button id="apply-button" class="styles_apply-button__uJI3A apply-button">Apply</button>`, 'text/html');
    expect(readJobPage(page).naukriMatch).toEqual({ 'early applicant': true, keyskills: false, location: true, 'work experience': true });
  });
});

describe('"I am interested" jobs (live site, Oct 2026)', () => {
  function page(buttonHtml: string): Document {
    return new DOMParser().parseFromString(`<div class="styles_JDC__dang-inner-html__h0K4t">Go developer</div>${buttonHtml}`, 'text/html');
  }
  it('treats "I am interested" as a Naukri apply button', () => {
    expect(readJobPage(page('<button class="styles_save-job-button">Save</button><button class="styles_interested-button">I am interested</button>')).applyType).toBe('naukri');
  });
  it('treats "Interested" (after clicking) as already applied', () => {
    expect(readJobPage(page('<button>Interested</button>')).applyType).toBe('already_applied');
  });
});

describe('readJobPage on a REAL walk-in job page', () => {
  it('finds the "I am interested" walk-in button (#walkin-button)', () => {
    const detail = readJobPage(loadFixture('job-page-walkin-real.html'));
    expect(detail.title).toContain('Backend Java Developer Intern'); // Naukri shows "Walk-in || ..."
    expect(detail.applyType).toBe('naukri');
    expect(detail.description.length).toBeGreaterThan(100);
  });
});

describe('"Applied" shown as a label, not a button', () => {
  it('a header badge saying Applied counts as already applied', () => {
    const page = new DOMParser().parseFromString(`
      <section id="job_header"><h1 class="styles_jd-header-title__rZwM1">Java Developer</h1>
        <div class="styles_jhc__apply-button-container__5Bqnb"><span class="styles_applied__x1"><i class="ni-icon-check"></i>Applied</span></div>
      </section>
      <div class="styles_JDC__dang-inner-html__h0K4t">Build Spring Boot services</div>`, 'text/html');
    expect(readJobPage(page).applyType).toBe('already_applied');
  });
  it('the word "applied" inside a sentence does NOT count', () => {
    const page = new DOMParser().parseFromString(`
      <section id="job_header"><p>100+ people applied for this job</p></section>
      <div class="styles_JDC__dang-inner-html__h0K4t">Build Spring Boot services</div>
      <button id="apply-button" class="styles_apply-button__uJI3A apply-button">Apply</button>`, 'text/html');
    expect(readJobPage(page).applyType).toBe('naukri');
  });
});

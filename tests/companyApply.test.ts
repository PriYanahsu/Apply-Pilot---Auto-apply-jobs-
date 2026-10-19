// @vitest-environment jsdom
/**
 * FILE: tests/companyApply.test.ts
 * WHAT: Company-site host detection, when the company step is appended, and reading a Greenhouse-style form.
 */
import { describe, expect, it } from 'vitest';
import { appendCompanyStep, applyFormUrl, companyUrlFromHref, companyUrlFromText, detectAts, isOffsiteUrl, pickCompanyUrl } from '../src/company/hosts';
import { readCompanyForm } from '../src/company/readApplyForm';

HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

describe('company site hosts', () => {
  it('recognises Greenhouse, Lever, and Ashby, and leaves Workday alone', () => {
    expect(detectAts('https://boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(detectAts('https://job-boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(detectAts('https://jobs.lever.co/acme/abc')).toBe('lever');
    expect(detectAts('https://jobs.eu.lever.co/acme/abc')).toBe('lever');
    expect(detectAts('https://jobs.ashbyhq.com/acme/abc')).toBe('ashby');
    expect(detectAts('https://acme.wd5.myworkdayjobs.com/job/1')).toBeNull();
    expect(detectAts('https://www.naukri.com/job/1')).toBeNull();
  });

  it('unwraps a LinkedIn redirect and ignores a Naukri URL', () => {
    expect(companyUrlFromHref('https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fboards.greenhouse.io%2Facme%2Fjobs%2F1')).toBe('https://boards.greenhouse.io/acme/jobs/1');
    expect(companyUrlFromHref('https://www.naukri.com/job-listings-1')).toBe('');
    expect(companyUrlFromText('Redirected to https://jobs.lever.co/acme/abc')).toBe('https://jobs.lever.co/acme/abc');
  });

  it('prefers the apply control link over a random link on the page', () => {
    const picked = pickCompanyUrl(
      ['https://acme.wd5.myworkdayjobs.com/job/1'],
      ['https://boards.greenhouse.io/other/jobs/9'],
    );
    expect(picked).toBe('https://acme.wd5.myworkdayjobs.com/job/1');
    expect(pickCompanyUrl([], ['https://jobs.ashbyhq.com/acme/role'])).toBe('https://jobs.ashbyhq.com/acme/role');
  });
});

describe('company form URL', () => {
  it('opens the page that holds the form', () => {
    expect(applyFormUrl('https://jobs.lever.co/acme/abc-123')).toBe('https://jobs.lever.co/acme/abc-123/apply');
    expect(applyFormUrl('https://jobs.lever.co/acme/abc-123/apply')).toBe('https://jobs.lever.co/acme/abc-123/apply');
    expect(applyFormUrl('https://jobs.ashbyhq.com/acme/abc-123')).toBe('https://jobs.ashbyhq.com/acme/abc-123/application');
    expect(applyFormUrl('https://boards.greenhouse.io/acme/jobs/42')).toBe('https://boards.greenhouse.io/embed/job_app?for=acme&token=42');
    expect(applyFormUrl('https://job-boards.greenhouse.io/acme/jobs/42')).toBe('https://job-boards.greenhouse.io/acme/jobs/42');
  });

  it('treats only real non-job-board pages as off site', () => {
    expect(isOffsiteUrl('https://acme.com/careers')).toBe(true);
    expect(isOffsiteUrl('about:blank')).toBe(false);
    expect(isOffsiteUrl('https://www.linkedin.com/jobs/view/1')).toBe(false);
  });
});

describe('when company sites run', () => {
  it('appends the company step after in-platform apply, and holds it on the Naukri half of Run both', () => {
    expect(appendCompanyStep(['CHECK_LOGIN', 'QUEUEING', 'APPLYING'], false)).toEqual(['CHECK_LOGIN', 'QUEUEING', 'APPLYING', 'COMPANY_APPLYING']);
    expect(appendCompanyStep(['LI_CHECK_LOGIN', 'LI_APPLYING'], false)).toEqual(['LI_CHECK_LOGIN', 'LI_APPLYING', 'COMPANY_APPLYING']);
    expect(appendCompanyStep(['CHECK_LOGIN', 'SEARCHING', 'SCORING'], false)).toEqual(['CHECK_LOGIN', 'SEARCHING', 'SCORING']);
    expect(appendCompanyStep(['CHECK_LOGIN', 'APPLYING', 'COMPANY_APPLYING'], true)).toEqual(['CHECK_LOGIN', 'APPLYING']);
  });
});

describe('company form reader', () => {
  it('reads required fields and the submit button', () => {
    document.body.innerHTML = `
      <form>
        <label for="first_name">First name *</label>
        <input id="first_name" name="first_name" required />
        <label for="email">Email</label>
        <input id="email" name="email" value="a@b.com" />
        <label for="resume">Resume *</label>
        <input id="resume" name="resume" type="file" required />
        <input type="submit" value="Submit application" />
      </form>`;
    const form = readCompanyForm(document, 'https://boards.greenhouse.io/acme/jobs/1');
    expect(form.open).toBe(true);
    expect(form.done).toBe(false);
    expect(form.primaryButton).toBe('submit');
    expect(form.fields.map((field) => field.label)).toEqual(['First name', 'Email', 'Resume']);
    expect(form.fields[0]?.required).toBe(true);
    expect(form.fields[1]?.value).toEqual(['a@b.com']);
    expect(form.fields[2]?.kind).toBe('resume');
  });

  it('treats a thank-you heading as submitted, and a password page as a login wall', () => {
    document.body.innerHTML = '<h1>Thank you for applying</h1>';
    expect(readCompanyForm(document, 'https://boards.greenhouse.io/acme/jobs/1').done).toBe(true);

    document.body.innerHTML = '<form><label>Email<input type="email" /></label><label>Password<input type="password" /></label></form>';
    expect(readCompanyForm(document, 'https://jobs.lever.co/acme/login').blocked).toBe('login');
  });

  it('reads an Ashby success message and drops keys from an earlier read', () => {
    document.body.innerHTML = '<h2>Your application was successfully submitted.</h2>';
    expect(readCompanyForm(document, 'https://jobs.ashbyhq.com/acme/1/application').done).toBe(true);

    document.body.innerHTML = '<form><label for="a">A</label><input id="a" /><label for="b">B</label><input id="b" /></form>';
    readCompanyForm(document, 'https://jobs.lever.co/acme/1/apply');
    document.getElementById('a')?.remove();
    readCompanyForm(document, 'https://jobs.lever.co/acme/1/apply');
    expect(document.querySelectorAll('[data-ap-key="f0"]').length).toBe(1);
    expect(document.getElementById('b')?.getAttribute('data-ap-key')).toBe('f0');
  });
});

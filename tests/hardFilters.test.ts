/**
 * FILE: tests/hardFilters.test.ts
 * WHAT: The no-AI hard filters from §5.4.
 */
import { describe, expect, it } from 'vitest';
import { checkHardFilters, locationMatches, titleHasExcludedWord } from '../src/matching/hardFilters';

const settings = { excludeTitleWords: ['intern', 'sales', 'php'], excludeCompanies: ['Bad Corp'], locations: ['Bangalore'], candidateYears: 4 };
const profile = { skillNames: ['React', 'TypeScript', 'Node.js'], targetTitles: ['Frontend Developer'] };
const goodJob = { title: 'React Developer', company: 'Good Ltd', location: 'Bengaluru', experienceText: '3-6 Yrs', skills: ['ReactJS', 'Redux'] };

describe('checkHardFilters', () => {
  it('passes a good job', () => {
    expect(checkHardFilters(goodJob, settings, profile)).toBeNull();
  });
  it('rejects excluded title words as whole words only', () => {
    expect(checkHardFilters({ ...goodJob, title: 'React Intern' }, settings, profile)).toMatch(/intern/);
    expect(titleHasExcludedWord('Internal Tools Engineer', ['intern'])).toBeNull();
    expect(titleHasExcludedWord('PHP/React developer', ['php'])).toBe('php');
  });
  it('rejects excluded companies', () => {
    expect(checkHardFilters({ ...goodJob, company: 'Bad Corp Pvt Ltd' }, settings, profile)).toMatch(/excluded/);
  });
  it('rejects experience that does not fit', () => {
    expect(checkHardFilters({ ...goodJob, experienceText: '8-12 Yrs' }, settings, profile)).toMatch(/Experience/);
    expect(checkHardFilters({ ...goodJob, experienceText: '0-1 Yrs' }, settings, profile)).toMatch(/Experience/);
  });
  it('rejects other locations but always allows remote', () => {
    expect(checkHardFilters({ ...goodJob, location: 'Chennai' }, settings, profile)).toMatch(/Location/);
    expect(locationMatches('Remote', ['Bangalore'])).toBe(true);
    expect(locationMatches('Hybrid - Work from home, Pune', ['Bangalore'])).toBe(true);
    expect(locationMatches('Anything', [])).toBe(true);
  });
  it('rejects zero skill overlap AND no shared title word', () => {
    expect(checkHardFilters({ ...goodJob, title: 'Data Analyst', skills: ['Excel', 'Tableau'] }, settings, profile)).toMatch(/No skill overlap/);
    expect(checkHardFilters({ ...goodJob, title: 'Frontend Developer', skills: ['Excel'] }, settings, profile)).toBeNull();
  });
});

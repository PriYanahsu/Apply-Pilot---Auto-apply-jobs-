// @vitest-environment jsdom
/**
 * FILE: tests/readSearchPage.test.ts
 * WHAT: Parser test for search-result cards against tests/fixtures/search-page.html (acceptance #9).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobIdFromUrl, readSearchPage } from '../src/naukri/readSearchPage';
import { buildSearchUrl } from '../src/naukri/searchUrl';

function loadFixture(name: string): Document {
  return new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8'), 'text/html');
}

describe('readSearchPage', () => {
  const cards = readSearchPage(loadFixture('search-page.html'));

  it('reads every complete card and skips broken ones', () => {
    expect(cards.map((card) => card.jobId)).toEqual(['081024500111', '081024500222']);
  });
  it('reads all card fields', () => {
    expect(cards[0]).toMatchObject({
      title: 'React Developer', company: 'Acme Software', location: 'Bengaluru', experienceText: '3-6 Yrs',
      salaryText: '12-18 Lacs PA', skills: ['React.js', 'TypeScript', 'Redux'], postedText: '2 Days Ago',
    });
  });
  it('falls back to the id inside the URL', () => {
    expect(cards[1]?.postedText).toBe('Just Now');
    expect(jobIdFromUrl('https://www.naukri.com/job-listings-x-y-123456789012?src=a')).toBe('123456789012');
  });
  it('throws SELECTOR_MISSING on a page with no cards', () => {
    const empty = new DOMParser().parseFromString('<html><body><p>hi</p></body></html>', 'text/html');
    expect(() => readSearchPage(empty)).toThrowError(/No job cards/);
  });
});

describe('buildSearchUrl', () => {
  it('builds the Naukri URL with freshness filter', () => {
    expect(buildSearchUrl({ keyword: 'React Developer', location: 'Bangalore', page: 2, experienceYears: 4, maxJobAgeDays: 3 }))
      .toBe('https://www.naukri.com/react-developer-jobs-in-bangalore-2?k=React+Developer&l=Bangalore&experience=4&jobAge=3');
    expect(buildSearchUrl({ keyword: 'node js', location: '', page: 1, experienceYears: 0, maxJobAgeDays: 1 }))
      .toBe('https://www.naukri.com/node-js-jobs?k=node+js&jobAge=1');
  });
});

describe('readSearchPage on a REAL Naukri search page', () => {
  const cards = readSearchPage(loadFixture('search-page-real.html'));
  it('reads all 20 cards with every field', () => {
    expect(cards).toHaveLength(20);
    expect(cards[0]).toMatchObject({
      jobId: '190826038428', title: 'React JS Developer', company: 'Infosys', experienceText: '2-5 Yrs',
      location: 'Hybrid - Pune, Chennai, Bengaluru', postedText: '2 days ago',
    });
    expect(cards[0]?.skills).toContain('React.js');
    for (const card of cards) {
      expect(card.url).toMatch(/^https:\/\/www\.naukri\.com\/job-listings-/);
      expect(card.postedText).not.toBe('');
    }
  });
});

describe('naukriJobAgeFilter', () => {
  it('asks Naukri for the next supported age up', async () => {
    const { naukriJobAgeFilter } = await import('../src/naukri/searchUrl');
    expect([1, 2, 3, 4, 5, 7].map(naukriJobAgeFilter)).toEqual([1, 3, 3, 7, 7, 7]);
  });
});

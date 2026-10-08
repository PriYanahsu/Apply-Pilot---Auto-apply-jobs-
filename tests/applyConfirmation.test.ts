// @vitest-environment jsdom
/**
 * FILE: tests/applyConfirmation.test.ts
 * WHAT: Naukri's apply confirmation page (real URL from a live run, Oct 2026) and chatbot input-type detection.
 */
import { describe, expect, it } from 'vitest';
import { readApplyConfirmation } from '../src/naukri/applyConfirmation';
import { readInputType } from '../src/naukri/chatbot';

// jsdom has no layout engine: treat every element as visible.
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

const REAL_URL = 'https://www.naukri.com/myapply/saveApply?strJobsarr=[071026928133]&applytype=single&resId=287661572&ApplyMode=1&id=298721804&src=h&logstr=----F-0-1--------F-0-1---&applySrc=----F-0-1---&multiApplyResp=%7B%22071026928133%22%3A200%7D&jobTitle=Java%20Spring%20boot%20-%20Fresher';

describe('readApplyConfirmation', () => {
  it('code 200 for our job = applied', () => {
    expect(readApplyConfirmation(REAL_URL, '071026928133')).toEqual({ result: 'applied', code: 200 });
  });
  it('another code = rejected', () => {
    expect(readApplyConfirmation(REAL_URL.replace('%3A200', '%3A409'), '071026928133')).toEqual({ result: 'rejected', code: 409 });
  });
  it('not our job / not a confirmation page = null', () => {
    expect(readApplyConfirmation(REAL_URL, '999')).toBeNull();
    expect(readApplyConfirmation('https://www.naukri.com/job-listings-x-123456789012', '123456789012')).toBeNull();
  });
});

describe('chatbot readInputType', () => {
  function drawer(html: string): HTMLElement {
    const element = document.createElement('div');
    element.className = 'chatbot_Drawer';
    element.innerHTML = html;
    return element;
  }
  it('empty chip-like elements do NOT make a free-text question into chips', () => {
    expect(readInputType(drawer('<div class="chatbot_ChipsContainer"><span class="chatbot_Chip"></span></div><div class="textArea" contenteditable="true"></div>')))
      .toEqual({ inputType: 'text', options: [] });
    expect(readInputType(drawer('<div class="chatbot_Chip"> </div>'))).toEqual({ inputType: 'text', options: [] });
  });
  it('chips with text inside chipsContainer = chips', () => {
    expect(readInputType(drawer('<div class="chipsContainer"><div class="chatbot_Chip">Yes</div><div class="chatbot_Chip">No</div></div>'))).toEqual({ inputType: 'chips', options: ['Yes', 'No'] });
  });
  it('radio options ignore disabled answers from earlier questions', () => {
    const html = '<div class="chatbot_x"><input type="radio" id="a" disabled><label for="a">Old</label><input type="radio" id="b"><label for="b">Yes</label><input type="radio" id="c"><label for="c">No</label></div>';
    expect(readInputType(drawer(html))).toEqual({ inputType: 'radio', options: ['Yes', 'No'] });
  });
});

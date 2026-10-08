// @vitest-environment jsdom
/**
 * FILE: tests/chatbot.test.ts
 * WHAT: Chatbot reading against the structure seen on the live site (Oct 2026):
 *       li.botLogo > div.chipMsg (logo row, NOT a chip), li.botItem > div.botMsg (question),
 *       div.chipsContainer (answer chips + "Load more"), div.sendMsgbtn_container (hidden for chips).
 */
import { describe, expect, it } from 'vitest';
import { readChatbot } from '../src/naukri/chatbot';
import { fillText } from '../src/naukri/domHelpers';

HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

function renderChatbot(footerHtml: string): void {
  document.body.innerHTML = `
    <div class="_chatBotContainer"><div class="chatbot_Drawer chatbot_right"><div class="chatbot_DrawerContentWrapper">
      <div class="chatbot_MessageContainer"><ul class="list">
        <li class="botLogo chatbot_ListItem"><div class="chipMsg"><span></span></div></li>
        <li class="botItem chatbot_ListItem"><div class="botMsg msg"><div><span>Hi, thanks for applying.</span></div></div></li>
        <li class="botItem chatbot_ListItem"><div class="botMsg msg"><div><span>In which domain have you managed projects or programs?</span></div></div></li>
      </ul>
      <div class="footerWrapper"><div class="footerInputBoxWrapper"><div class="textArea" contenteditable="true"></div></div></div>
      ${footerHtml}
      <div class="sendMsgbtn_container visibility-hidden"><div class="sendMsg">Save</div></div>
      </div>
    </div></div></div>`;
}

describe('readChatbot on the real Naukri chatbot structure', () => {
  it('reads the latest question and the chip options (not the logo row, not "Load more")', () => {
    renderChatbot(`<div class="chipsContainer">
      <div class="chatbot_Chip chipInRow"><span>BPM</span></div><div class="chatbot_Chip chipInRow"><span>IT Services</span></div>
      <div class="chatbot_Chip chipInRow"><span>Technology</span></div><a class="loadMore">Load more</a></div>`);
    expect(readChatbot()).toEqual({
      state: 'question',
      question: 'In which domain have you managed projects or programs?',
      inputType: 'chips',
      options: ['BPM', 'IT Services', 'Technology'],
    });
  });
  it('a question with an empty chips container is a text question', () => {
    renderChatbot('<div class="chipsContainer"></div>');
    expect(readChatbot()).toMatchObject({ inputType: 'text', options: [] });
  });
});

describe('fillText (answers go in all at once)', () => {
  const longAnswer = 'I am a Full Stack Engineer with over 1 year of experience in Java, Spring Boot, React, Next.js and PostgreSQL, currently building production microservices and dashboards at Cognivac for real customers every day.';

  it('fills a contenteditable chat box with the whole answer quickly and fires input', async () => {
    const box = document.createElement('div');
    box.setAttribute('contenteditable', 'true'); // as in Naukri's HTML: <div class="textArea" contenteditable="true">
    document.body.appendChild(box);
    let inputEvents = 0;
    box.addEventListener('input', () => { inputEvents += 1; });
    const started = Date.now();
    await fillText(box, longAnswer);
    expect(box.textContent).toBe(longAnswer);
    expect(inputEvents).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(2_000); // letter-by-letter took ~22 s for this
  });

  it('fills a normal text input', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    await fillText(input, longAnswer);
    expect(input.value).toBe(longAnswer);
  });
});

describe('readChatbotSettled (options drawn after the question)', () => {
  it('waits until the tick-boxes appear instead of calling it a text question', async () => {
    const { readChatbotSettled } = await import('../src/naukri/chatbot');
    renderChatbot('<div class="chipsContainer"></div>');
    // Naukri draws the options ~0.4 s after the question bubble.
    setTimeout(() => {
      const container = document.querySelector('.chipsContainer');
      if (container) container.innerHTML = '<div class="chatbot_Chip"><span>OOPs</span></div><div class="chatbot_Chip"><span>Git/Version Control</span></div>';
    }, 400);
    const state = await readChatbotSettled();
    expect(state.inputType).toBe('chips');
    expect(state.options).toEqual(['OOPs', 'Git/Version Control']);
  });
});

/**
 * FILE: entrypoints/sidepanel/readResumePdf.ts
 * WHAT: Extracts plain text from an uploaded resume PDF with pdf.js (runs in the side panel, not the worker).
 * CALLED BY: tabs/setup/ResumeProfileSection.tsx
 * RETURNS: the resume text. Scanned PDFs return very little text - the UI then asks the user to paste it.
 * NOTE: pdf.js needs its worker file. Chrome does NOT serve ".mjs" files from extensions as JavaScript,
 *       so `npm run copy-pdf-worker` (runs before every build) copies it to public/pdf.worker.min.js.
 */
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('/pdf.worker.min.js');

export async function readResumePdf(file: File): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pageTexts.join('\n').replace(/[ \t]+/g, ' ').trim();
}

/**
 * FILE: naukri/applyConfirmation.ts
 * WHAT: Reads Naukri's apply confirmation page. After a successful apply Naukri often moves to
 *       /myapply/saveApply?...&multiApplyResp={"<jobId>":200} - 200 is Naukri's own "application accepted" code.
 * CALLED BY: steps/8-applyToJob.ts
 * RETURNS: 'applied' (code 200), 'rejected' (any other code), or null (not a confirmation page / job not listed).
 */

export const APPLY_CONFIRMATION_PATH = '/myapply/saveApply';
const ACCEPTED_CODE = 200;

export function readApplyConfirmation(url: string, jobId: string): { result: 'applied' | 'rejected'; code: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    console.log('[applyConfirmation] not a URL', url, error);
    return null;
  }
  if (!parsed.pathname.startsWith(APPLY_CONFIRMATION_PATH)) return null;
  const responseText = parsed.searchParams.get('multiApplyResp');
  if (!responseText) return null;
  try {
    const codes = JSON.parse(responseText) as Record<string, number>;
    const code = codes[jobId];
    if (code === undefined) return null;
    return { result: Number(code) === ACCEPTED_CODE ? 'applied' : 'rejected', code: Number(code) };
  } catch (error) {
    console.log('[applyConfirmation] multiApplyResp is not JSON', responseText, error);
    return null;
  }
}

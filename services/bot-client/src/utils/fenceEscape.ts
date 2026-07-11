/**
 * Neutralize embedded triple-backticks in text interpolated into a code
 * fence. Discord closes a fence at ANY ``` occurrence — not just line start
 * like GitHub markdown — so untrusted content (memory previews, pipeline
 * step reasons) could otherwise terminate the fence early and spill the
 * rest of a fixed-width table into loose markdown. It also protects
 * splitMessage's code-block detection from mis-pairing fences.
 *
 * A zero-width space between the backticks keeps the visible text intact
 * (backslash escapes would render literally inside a fence).
 */
export function escapeFenceBreaks(text: string): string {
  return text.replace(/`{3,}/g, run => run.split('').join('\u200b'));
}

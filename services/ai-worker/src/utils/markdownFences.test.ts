/**
 * Direct unit tests for the Markdown fence helpers. The cut in
 * responseArtifacts.ts pins these through its own cases; these pin the
 * helpers' contracts on their own.
 */

import { describe, it, expect } from 'vitest';
import { fenceMarkerOf, nextFenceState } from './markdownFences.js';

describe('fenceMarkerOf', () => {
  it('reads a backtick run as a backtick marker', () => {
    expect(fenceMarkerOf('```')).toEqual({ char: '`', length: 3, bare: true });
  });

  it('reads a tilde run as a tilde marker', () => {
    expect(fenceMarkerOf('~~~')).toEqual({ char: '~', length: 3, bare: true });
  });

  it('reports the full length of a longer run', () => {
    expect(fenceMarkerOf('`````')?.length).toBe(5);
  });

  it('marks a line with an info string as non-bare', () => {
    expect(fenceMarkerOf('```ts')).toEqual({ char: '`', length: 3, bare: false });
  });

  it('treats trailing whitespace after the run as bare', () => {
    expect(fenceMarkerOf('```   ')?.bare).toBe(true);
  });

  it('recognizes a fence line indented by up to three spaces', () => {
    expect(fenceMarkerOf('   ```')).toEqual({ char: '`', length: 3, bare: true });
  });

  it('returns null for a fence line indented by four spaces (indented code)', () => {
    expect(fenceMarkerOf('    ```')).toBeNull();
  });

  it('returns null for a fence line behind a leading tab', () => {
    expect(fenceMarkerOf('\t```')).toBeNull();
  });

  it('returns null for a backtick run whose remainder holds a backtick (an inline span)', () => {
    expect(fenceMarkerOf('```code``` more')).toBeNull();
  });

  it('keeps a tilde run with a backtick in its info string as a non-bare marker', () => {
    expect(fenceMarkerOf('~~~ a`b')).toEqual({ char: '~', length: 3, bare: false });
  });

  it('reads a backtick fence line ending in CRLF as bare', () => {
    expect(fenceMarkerOf('```\r')).toEqual({ char: '`', length: 3, bare: true });
  });

  it('reads a tilde fence line ending in CRLF as bare', () => {
    expect(fenceMarkerOf('~~~\r\n')).toEqual({ char: '~', length: 3, bare: true });
  });

  it('returns null for a line with only two backticks', () => {
    expect(fenceMarkerOf('``')).toBeNull();
  });

  it('returns null for a run that is not at the line start', () => {
    expect(fenceMarkerOf('a ``` b')).toBeNull();
  });

  it('returns null for a plain text line', () => {
    expect(fenceMarkerOf('plain text')).toBeNull();
  });
});

describe('nextFenceState', () => {
  const openTicks = { char: '`', length: 3, bare: true } as const;

  it('opens on a bare fence line when no fence is open', () => {
    expect(nextFenceState(null, openTicks)).toEqual(openTicks);
  });

  it('opens on a fence line with an info string when no fence is open', () => {
    const withInfo = { char: '`', length: 3, bare: false } as const;
    expect(nextFenceState(null, withInfo)).toEqual(withInfo);
  });

  it('closes on a bare run of the same character at the opener length', () => {
    expect(nextFenceState(openTicks, { char: '`', length: 3, bare: true })).toBeNull();
  });

  it('closes on a bare run longer than the opener', () => {
    expect(nextFenceState(openTicks, { char: '`', length: 4, bare: true })).toBeNull();
  });

  it('stays open on a shorter run than the opener', () => {
    const fourTicks = { char: '`', length: 4, bare: true } as const;
    expect(nextFenceState(fourTicks, { char: '`', length: 3, bare: true })).toEqual(fourTicks);
  });

  it('stays open on a run of the other character', () => {
    expect(nextFenceState(openTicks, { char: '~', length: 3, bare: true })).toEqual(openTicks);
  });

  it('stays open on a fence line with an info string', () => {
    expect(nextFenceState(openTicks, { char: '`', length: 3, bare: false })).toEqual(openTicks);
  });
});

/** A fence line's marker: its character, the length of its run, and whether it is bare. */
export interface FenceMarker {
  char: '`' | '~';
  length: number;
  /** True when nothing but whitespace follows the run (an info string makes it non-bare). */
  bare: boolean;
}

/**
 * The fence marker a line opens or closes with, or null for a non-fence line.
 * A fence line is a run of three or more backticks or tildes after at most three
 * leading spaces (CommonMark: four spaces or a leading tab make it indented code,
 * not a fence). A backtick run whose remainder contains a backtick is not a fence
 * line either: a backtick fence's info string cannot contain a backtick, so an
 * inline triple-backtick span at a line start is text, not a fence.
 */
export function fenceMarkerOf(line: string): FenceMarker | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (match === null) {
    return null;
  }
  const run = match[1];
  const remainder = line.slice(match[0].length);
  if (run.startsWith('`') && remainder.includes('`')) {
    return null;
  }
  return {
    char: run.startsWith('`') ? '`' : '~',
    length: run.length,
    bare: remainder.trim().length === 0,
  };
}

/**
 * A fence line outside a fence opens one, with or without an info string. Inside a
 * fence, only a BARE run of the same character at least as long as the opener closes
 * it; any other fence line, including one with an info string (```` ```ts ````), is content.
 */
export function nextFenceState(open: FenceMarker | null, marker: FenceMarker): FenceMarker | null {
  if (open === null) {
    return marker;
  }
  const closes = open.char === marker.char && marker.length >= open.length && marker.bare;
  return closes ? null : open;
}

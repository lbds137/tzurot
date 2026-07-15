/**
 * Release-notes classifier + DM formatter.
 *
 * Consumes a published GitHub Release body written in the repo's
 * Conventional-Changelog format (H3 category sections, `- **scope:** …`
 * items, a `**Full Changelog**` trailer — see `.claude/rules/05-tooling.md`)
 * and derives:
 * - the broadcast level (owner policy: Breaking Changes → major,
 *   Features → minor, anything else → patch — content-derived, never the
 *   version delta), keyed on the shared RELEASE_LEVEL_SECTIONS literals the
 *   notes GENERATOR also emits, and
 * - the DM body: title + the body's sections in their curated document
 *   order (trailer dropped, link appended), fitted to the broadcast cap.
 *
 * Pure functions; the announce orchestrator owns all I/O.
 */

import { RELEASE_LEVEL_SECTIONS } from '@tzurot/common-types/constants/releaseNotes';
import { BROADCAST_MESSAGE_MAX_LENGTH } from '@tzurot/common-types/schemas/api/broadcast';
import type { NotifyLevelValue } from '@tzurot/common-types/schemas/api/notifications';
import { truncateText } from '@tzurot/common-types/utils/discord';

export interface ReleaseSection {
  heading: string;
  lines: string[];
}

export interface ParsedReleaseNotes {
  /** H3 sections in document order (the human curated that order). */
  sections: ReleaseSection[];
  /** Lines before the first H3 heading. */
  preamble: string[];
  /** The `**Full Changelog**` line, when present (excluded from sections). */
  trailer: string | null;
}

/** H3 only — the notes format's category level. Deeper headings stay body text.
 *  The `\S` anchor keeps the two quantifiers from exchanging characters
 *  (regexp/no-super-linear-backtracking); trailing spaces trim in code. */
const H3_HEADING_RE = /^###[ \t]+(\S.*)$/;
const TRAILER_RE = /^\*\*full changelog\*\*:/i;

export function parseReleaseSections(body: string): ParsedReleaseNotes {
  const preamble: string[] = [];
  const sections: ReleaseSection[] = [];
  let trailer: string | null = null;
  let current: ReleaseSection | null = null;

  for (const line of body.split(/\r?\n/)) {
    if (TRAILER_RE.test(line.trim())) {
      trailer = line.trim();
      continue;
    }
    const heading = H3_HEADING_RE.exec(line);
    if (heading !== null) {
      current = { heading: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current === null) {
      preamble.push(line);
    } else {
      current.lines.push(line);
    }
  }

  return { sections, preamble, trailer };
}

function hasSection(parsed: ParsedReleaseNotes, name: string): boolean {
  return parsed.sections.some(
    section =>
      // Case-insensitive so a hand-edited "breaking changes" can't silently
      // downgrade the announcement to patch.
      section.heading.trim().toLowerCase() === name.toLowerCase() &&
      section.lines.some(line => line.trim() !== '')
  );
}

/**
 * Derive the broadcast level from the notes content. Only sections with at
 * least one non-empty line count — an empty leftover heading is not a claim.
 * Unknown sections (Bug Fixes, Improvements, Database Migrations, …) carry
 * no level semantics and fall through to patch.
 */
export function classifyReleaseLevel(parsed: ParsedReleaseNotes): NotifyLevelValue {
  if (hasSection(parsed, RELEASE_LEVEL_SECTIONS.major)) {
    return 'major';
  }
  if (hasSection(parsed, RELEASE_LEVEL_SECTIONS.minor)) {
    return 'minor';
  }
  return 'patch';
}

/** Marker appended when whole trailing lines were dropped to fit the cap. */
const TRIM_MARKER = '\n…';

/**
 * Drop whole trailing lines until the content (plus a trim marker) fits the
 * budget; fall back to a hard mid-line cut only when a single line overflows
 * the entire budget.
 */
function fitToBudget(content: string, budget: number): string {
  if (content.length <= budget) {
    return content;
  }
  const lines = content.split('\n');
  while (lines.length > 1) {
    lines.pop();
    const candidate = lines.join('\n').trimEnd() + TRIM_MARKER;
    if (candidate.length <= budget) {
      return candidate;
    }
  }
  return truncateText(content, budget);
}

function toBlock(section: ReleaseSection): string | null {
  const lines = [...section.lines];
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }
  if (lines.length === 0) {
    return null;
  }
  return `### ${section.heading}\n${lines.join('\n')}`;
}

/**
 * Build the DM body: bold tag title, the notes' sections in document order,
 * and the GitHub release link — fitted under BROADCAST_MESSAGE_MAX_LENGTH
 * (the DM worker appends the opt-out footer on top; the cap already budgets
 * for it). Markdown is intentionally NOT escaped: the body is trusted
 * repo-owner content whose markdown is the point.
 */
export function formatReleaseAnnouncement(
  release: { tagName: string; htmlUrl: string },
  parsed: ParsedReleaseNotes
): string {
  const title = `**${release.tagName}**`;
  const link = release.htmlUrl;

  const blocks: string[] = [];
  const preambleText = parsed.preamble.join('\n').trim();
  if (preambleText !== '') {
    blocks.push(preambleText);
  }
  for (const section of parsed.sections) {
    const block = toBlock(section);
    if (block !== null) {
      blocks.push(block);
    }
  }

  if (blocks.length === 0) {
    return `${title}\n\n${link}`;
  }

  // Title and link are fixed; only the middle flexes ('\n\n' seams × 2).
  const budget = BROADCAST_MESSAGE_MAX_LENGTH - title.length - link.length - 4;
  const content = fitToBudget(blocks.join('\n\n'), budget);
  return `${title}\n\n${content}\n\n${link}`;
}

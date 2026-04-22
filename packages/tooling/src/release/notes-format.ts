/**
 * Release-notes formatting primitives
 *
 * Pure functions: parse Conventional-Commit PR titles, group by section,
 * render as markdown matching the format in `.claude/rules/05-tooling.md`.
 *
 * Kept deliberately side-effect-free so the tests can cover every branch
 * without shelling out to git or gh.
 */

export interface MergedPr {
  number: number;
  title: string;
  mergedAt: string;
}

export interface ConventionalParts {
  type: string;
  scope: string | null;
  breaking: boolean;
  description: string;
}

/**
 * Conventional-Commit types recognized by commitlint in this repo.
 * Additional prefixes (e.g., a typo or non-standard type) produce a
 * `null` parse and the PR falls into the "Unparseable" bucket.
 */
// The `\S` after `\s*` anchors the description capture to a non-whitespace
// character, preventing ambiguous backtracking between the two overlapping
// quantifiers (flagged by regexp/no-super-linear-backtracking).
const CONVENTIONAL_RE =
  /^(feat|fix|chore|refactor|test|docs|perf|ci|build|revert|style)(\(([^)]+)\))?(!)?:\s*(\S.*)$/;

/**
 * Map each Conventional-Commit type to the release-notes section header.
 * Breaking changes (`!` suffix on the type) override this and route to
 * the Breaking Changes section regardless of type.
 */
const SECTION_MAP: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  refactor: 'Improvements',
  perf: 'Improvements',
  chore: 'Chores',
  test: 'Tests',
  docs: 'Chores', // docs rarely warrant a user-facing note; bucket with chores
  ci: 'Chores',
  build: 'Chores',
  revert: 'Chores',
  style: 'Chores',
};

/**
 * Order of sections in the rendered output. Breaking Changes always
 * comes first per the format rule in 05-tooling.md.
 */
export const SECTION_ORDER = [
  'Breaking Changes',
  'Features',
  'Bug Fixes',
  'Improvements',
  'Chores',
  'Tests',
] as const;

export function parseConventional(title: string): ConventionalParts | null {
  const match = CONVENTIONAL_RE.exec(title);
  if (match === null) {
    return null;
  }
  return {
    type: match[1],
    scope: match[3] ?? null,
    breaking: match[4] === '!',
    description: match[5].trim(),
  };
}

/**
 * Format a single line item in the canonical `- **scope:** description (#N)`
 * shape. When the PR has no scope, use `misc` as a fallback so the
 * human editor can rename to something meaningful before shipping.
 */
export function formatLineItem(pr: MergedPr, parts: ConventionalParts): string {
  const scope = parts.scope ?? 'misc';
  return `- **${scope}:** ${parts.description} (#${pr.number})`;
}

export interface GroupedSections {
  /** Section-name → line items. Keys are a subset of SECTION_ORDER. */
  sections: Map<string, string[]>;
  /** PRs whose title didn't parse as Conventional Commit. */
  unparseable: MergedPr[];
}

/**
 * Group a list of merged PRs into release-notes sections. PRs must be
 * pre-sorted in the order they should appear in each section (typically
 * chronological by merge time).
 */
export function groupBySections(prs: MergedPr[]): GroupedSections {
  const sections = new Map<string, string[]>();
  const unparseable: MergedPr[] = [];

  for (const pr of prs) {
    const parts = parseConventional(pr.title);
    if (parts === null) {
      unparseable.push(pr);
      continue;
    }
    const sectionName = parts.breaking ? 'Breaking Changes' : (SECTION_MAP[parts.type] ?? 'Chores');
    const line = formatLineItem(pr, parts);
    const existing = sections.get(sectionName);
    if (existing === undefined) {
      sections.set(sectionName, [line]);
    } else {
      existing.push(line);
    }
  }

  return { sections, unparseable };
}

export interface RenderOptions {
  /** The previous release tag (e.g., `v3.0.0-beta.103`). */
  fromTag: string;
  /** ISO timestamp of `fromTag` (used in the banner comment). */
  fromTimestamp: string;
}

/**
 * Render a complete draft-notes markdown document from grouped sections.
 * Includes a warning banner telling the human to review and rewrite
 * before shipping — reduces the risk of rubber-stamping.
 */
export function renderMarkdown(grouped: GroupedSections, options: RenderOptions): string {
  const lines: string[] = [];

  lines.push(
    `<!-- Draft release notes from merged PRs since ${options.fromTag} (${options.fromTimestamp}). -->`
  );
  lines.push(
    '<!-- WARNING: review each line before shipping — consolidate related items, rewrite for user-impact framing, NOT just copy-paste. -->'
  );
  lines.push('');

  for (const section of SECTION_ORDER) {
    const items = grouped.sections.get(section);
    if (items === undefined || items.length === 0) {
      continue;
    }
    lines.push(`### ${section}`);
    lines.push('');
    for (const item of items) {
      lines.push(item);
    }
    lines.push('');
  }

  if (grouped.unparseable.length > 0) {
    lines.push('### Unparseable (title did not match Conventional Commits — manual review)');
    lines.push('');
    for (const pr of grouped.unparseable) {
      lines.push(`- ${pr.title} (#${pr.number})`);
    }
    lines.push('');
  }

  // Placeholder compare URL — the human replaces `HEAD` with the new
  // release tag before publishing the GitHub Release.
  lines.push(
    `**Full Changelog**: https://github.com/lbds137/tzurot/compare/${options.fromTag}...HEAD`
  );

  return lines.join('\n');
}

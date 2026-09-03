/**
 * Pure check functions for `guard:readme` (see check-readme.ts for the
 * filesystem-facts gatherer and the CLI shell). Each function here takes the
 * README text plus already-gathered facts and returns a list of findings —
 * empty means clean. Kept in a separate module purely to stay under the
 * per-file line budget; nothing here touches the filesystem.
 *
 * Class 4 (slash commands) has no allowlist — a shipped command with no
 * README mention is always a finding. That is a deliberate decision: unlike
 * the ops-CLI reference, the README's Slash Commands section is a short,
 * user-facing enumeration where "deliberately undocumented" has no
 * legitimate case.
 */

import GithubSlugger from 'github-slugger';

import { escapeRegExp } from '../utils/regex.js';

/** One classified README line — see {@link classifyLines}. */
export interface ClassifiedLine {
  /** The original README line, verbatim. */
  line: string;
  /** True only for lines INSIDE a fence; a delimiter line itself is false. */
  fenced: boolean;
  /**
   * True for both the opening and the closing fence delimiter lines.
   *
   * Keeps the classification complete and unambiguous on its own terms,
   * rather than carrying only what today's consumers happen to read. Without
   * it, a delimiter line is indistinguishable from ordinary outside-fence
   * text except by a derived subtlety — both carry `fenced: false`, so
   * telling them apart would mean leaning on `tag !== null`. An explicit
   * field beats a clever derivation.
   */
  delimiter: boolean;
  /**
   * Lowercased info-string of the ENCLOSING fence's opening delimiter
   * (`''` when the opening fence had no info-string); null for lines
   * outside any fence.
   */
  tag: string | null;
}

/** Trimmed lines whose leading run of ``` or ~~~ marks a fence delimiter. */
const FENCE_DELIMITER = /^(`{3,}|~{3,})/;

/**
 * Classifies every README line as fenced interior, a fence delimiter, or
 * plain text, tracking each fence's opening info-string so consumers never
 * re-implement fence-tracking themselves.
 *
 * A fence opened with a run of backticks is closed only by a later
 * delimiter line using the SAME character — a `~~~` line encountered while
 * a ``` fence is open (or vice versa) is ordinary interior content, not a
 * closer. An unterminated fence at EOF leaves the remaining lines
 * classified as fenced.
 *
 * Closing-fence LENGTH is not validated against the opener, so a run of
 * three backticks closes a four-backtick fence where CommonMark would keep
 * it as interior text — pinned by the classifyLines test titled
 * "documented limitation: a shorter closing run still closes a longer fence".
 */
export function classifyLines(readme: string): ClassifiedLine[] {
  const result: ClassifiedLine[] = [];
  let fenceChar: string | null = null;
  let tag: string | null = null;
  for (const line of readme.split('\n')) {
    const trimmed = line.trim();
    const match = FENCE_DELIMITER.exec(trimmed);
    if (fenceChar === null && match !== null) {
      fenceChar = match[1][0];
      tag = trimmed.slice(match[1].length).trim().toLowerCase();
      result.push({ line, fenced: false, delimiter: true, tag });
      continue;
    }
    if (fenceChar !== null && match?.[1].startsWith(fenceChar) === true) {
      result.push({ line, fenced: false, delimiter: true, tag });
      fenceChar = null;
      tag = null;
      continue;
    }
    const insideFence = fenceChar !== null;
    result.push({ line, fenced: insideFence, delimiter: false, tag: insideFence ? tag : null });
  }
  return result;
}

/**
 * README lines with the interior of every fenced code block blanked out
 * (fence delimiter lines are kept as-is; line count and indices are
 * preserved). Both heading scans below need this — a `# comment` inside a
 * shell fence is not a heading, but a raw line-by-line scan can't tell the
 * difference.
 */
export function stripFencedBlocks(readme: string): string[] {
  return classifyLines(readme).map(c => (c.fenced ? '' : c.line));
}

/** Everything between a heading LINE (exact match) and the next `#`-heading. */
export function extractSection(readme: string, headingLine: string): string {
  const lines = readme.split('\n');
  const strippedLines = stripFencedBlocks(readme);
  const startIdx = strippedLines.findIndex(line => line.trim() === headingLine);
  if (startIdx === -1) {
    return '';
  }
  const restStripped = strippedLines.slice(startIdx + 1);
  const endIdx = restStripped.findIndex(line => /^#{1,6}\s/.test(line));
  const rest = lines.slice(startIdx + 1);
  return (endIdx === -1 ? rest : rest.slice(0, endIdx)).join('\n');
}

// ---------------------------------------------------------------------------
// Class 1: Project Structure tree vs. on-disk directories
// ---------------------------------------------------------------------------

const TOP_BULLET = /^-\s+\*\*`([a-z-]+)\/`\*\*/;
const SUB_BULLET = /^\s+-\s+`([^`/]+)\/`/;

/** The `services/` and `packages/` sub-bullet names named in the README tree. */
export function parseProjectStructureTree(readme: string): {
  services: string[];
  packages: string[];
} {
  const section = extractSection(readme, '## Project Structure');
  const result: { services: string[]; packages: string[] } = { services: [], packages: [] };
  let current: 'services' | 'packages' | null = null;
  for (const line of section.split('\n')) {
    const top = TOP_BULLET.exec(line);
    if (top) {
      current = top[1] === 'services' || top[1] === 'packages' ? top[1] : null;
      continue;
    }
    if (current === null) {
      continue;
    }
    const sub = SUB_BULLET.exec(line);
    if (sub) {
      result[current].push(sub[1]);
    }
  }
  result.services.sort();
  result.packages.sort();
  return result;
}

/** Bidirectional diff between the README tree and the on-disk directories. */
export function checkProjectStructure(
  readme: string,
  onDiskServices: string[],
  onDiskPackages: string[]
): string[] {
  const tree = parseProjectStructureTree(readme);
  const findings: string[] = [];
  for (const [label, named, onDisk] of [
    ['services', tree.services, onDiskServices],
    ['packages', tree.packages, onDiskPackages],
  ] as const) {
    for (const name of named) {
      if (!onDisk.includes(name)) {
        findings.push(
          `README's Project Structure lists ${label}/${name}/ but that directory does not exist`
        );
      }
    }
    for (const name of onDisk) {
      if (!named.includes(name)) {
        findings.push(
          `${label}/${name}/ exists on disk but is not listed under ${label}/ in the README's Project Structure`
        );
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Class 2: Prerequisites versions vs. package.json engines
// ---------------------------------------------------------------------------

const NODE_LINE = /Node\.js\s+(\d+)/;
const PNPM_LINE = /\bpnpm\s+(\d+)\+/;

/** The Node/pnpm major versions stated in the Prerequisites section. */
export function parsePrerequisiteVersions(readme: string): {
  node: string | null;
  pnpm: string | null;
} {
  const section = extractSection(readme, '### Prerequisites');
  const node = NODE_LINE.exec(section);
  const pnpm = PNPM_LINE.exec(section);
  return { node: node ? node[1] : null, pnpm: pnpm ? pnpm[1] : null };
}

/**
 * The first integer in an `engines` range — the major version for the
 * `>=X.Y.Z` shape this repo's root `package.json` uses (currently
 * `node: ">=24.0.0"` and `pnpm: ">=10.0.0"`).
 *
 * Documented limitation: a compound range such as `^24 || >=25` would
 * mis-read as `24` (the first integer, not the effective minimum), and that
 * mis-read is silent — it produces no finding even when the effective
 * minimum differs from the first integer, so the guard would report clean
 * on a genuinely stale README. Not a bug, because no such range is in use
 * here.
 */
function firstInteger(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const match = /\d+/.exec(value);
  return match ? match[0] : null;
}

/** Diff the Prerequisites versions against root `package.json` `engines`. */
export function checkPrerequisites(
  readme: string,
  engines: { node?: string; pnpm?: string }
): string[] {
  const findings: string[] = [];
  const readmeVersions = parsePrerequisiteVersions(readme);
  const engineNode = firstInteger(engines.node);
  const enginePnpm = firstInteger(engines.pnpm);

  if (readmeVersions.node === null) {
    findings.push('Prerequisites has no "Node.js <version>" line');
  }
  if (engineNode === null) {
    findings.push('package.json engines has no "node" range to compare against');
  }
  if (readmeVersions.node !== null && engineNode !== null && readmeVersions.node !== engineNode) {
    findings.push(
      `Prerequisites says "Node.js ${readmeVersions.node}" but package.json engines.node requires ${engineNode}`
    );
  }

  if (readmeVersions.pnpm === null) {
    findings.push('Prerequisites has no "pnpm <version>+" line');
  }
  if (enginePnpm === null) {
    findings.push('package.json engines has no "pnpm" range to compare against');
  }
  if (readmeVersions.pnpm !== null && enginePnpm !== null && readmeVersions.pnpm !== enginePnpm) {
    findings.push(
      `Prerequisites says "pnpm ${readmeVersions.pnpm}+" but package.json engines.pnpm requires ${enginePnpm}`
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Class 3: Fenced `pnpm` scripts vs. root package.json scripts
// ---------------------------------------------------------------------------

// Subcommand names printed by `pnpm --help` (pnpm 10; transcribed by hand, so
// re-verify against `pnpm --help` at the next pnpm major); anything else is
// treated as a package.json script.
const PNPM_BUILTINS = new Set([
  'add',
  'i',
  'install',
  'ln',
  'link',
  'rm',
  'remove',
  'unlink',
  'up',
  'update',
  'audit',
  'ls',
  'list',
  'outdated',
  'why',
  'create',
  'dlx',
  'exec',
  'run',
  'c',
  'config',
  'init',
  'publish',
  'self-update',
]);

/** Fence languages whose contents are worth scanning for `pnpm` invocations. */
const SHELL_FENCE_TAGS = new Set(['bash', 'sh', 'shell', 'zsh']);

/** Strip a trailing `# comment` — only a `#` preceded by whitespace counts. */
function stripTrailingComment(line: string): string {
  const hashIdx = line.search(/\s#/);
  return hashIdx === -1 ? line : line.slice(0, hashIdx);
}

/**
 * Script tokens named after `pnpm ` inside shell-tagged fenced code blocks, deduped in order.
 *
 * Documented limitation: only the first `pnpm` invocation on a fenced line is
 * read — a chained line such as `pnpm lint && pnpm test` yields `lint` only,
 * dropping `test` — not a bug, because this guard only needs to see that at
 * least one script named on the line is a real `package.json` script; no
 * fenced README line in this repo chains two different scripts on one line.
 */
export function extractFencedPnpmCommands(readme: string): string[] {
  const commands: string[] = [];
  const seen = new Set<string>();
  for (const c of classifyLines(readme)) {
    if (!c.fenced || c.tag === null || !SHELL_FENCE_TAGS.has(c.tag)) {
      continue;
    }
    const line = stripTrailingComment(c.line).trim();
    if (!line.startsWith('pnpm ')) {
      continue;
    }
    const next = line.split(/\s+/)[1];
    if (next === undefined || next.startsWith('-') || PNPM_BUILTINS.has(next)) {
      continue;
    }
    if (!seen.has(next)) {
      seen.add(next);
      commands.push(next);
    }
  }
  return commands;
}

/** Every fenced `pnpm <script>` must name a real root `package.json` script. */
export function checkFencedScripts(readme: string, scripts: Record<string, unknown>): string[] {
  const scriptKeys = new Set(Object.keys(scripts));
  return extractFencedPnpmCommands(readme)
    .filter(command => !scriptKeys.has(command))
    .map(
      command =>
        `fenced \`pnpm ${command}\` has no matching "${command}" key in package.json scripts`
    );
}

// ---------------------------------------------------------------------------
// Class 4: Slash Commands section vs. shipped commands (no allowlist)
// ---------------------------------------------------------------------------

/** The `### Slash Commands` section body. */
export function extractSlashCommandsSection(readme: string): string {
  return extractSection(readme, '### Slash Commands');
}

/** Every shipped slash command and context-menu command must be mentioned. */
export function checkSlashCommands(
  readme: string,
  commandModules: string[],
  contextMenuNames: string[]
): string[] {
  const section = extractSlashCommandsSection(readme);
  const findings: string[] = [];
  for (const name of commandModules) {
    if (!new RegExp('`/' + escapeRegExp(name) + '`').test(section)) {
      findings.push(
        `/${name} is a shipped slash command but no \`/${name}\` appears in the README's Slash Commands section`
      );
    }
  }
  for (const name of contextMenuNames) {
    if (!section.includes(name)) {
      findings.push(
        `"${name}" is a shipped message context-menu command but does not appear in the README's Slash Commands section`
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Class 5: Relative link targets resolve
// ---------------------------------------------------------------------------

const HEADING = /^#{1,6}\s+(\S.*)$/;
const LINK_TARGET = /\]\(([^)]+)\)/g;

/** The slug of every README heading, using GitHub's own slugger (duplicate headings get -1, -2, ...). */
export function extractHeadingSlugs(readme: string): Set<string> {
  const slugger = new GithubSlugger();
  const slugs = new Set<string>();
  for (const line of stripFencedBlocks(readme)) {
    const match = HEADING.exec(line);
    if (match) {
      slugs.add(slugger.slug(match[1]));
    }
  }
  return slugs;
}

/**
 * Every `](target)` in the README, in document order (duplicates included).
 * Fenced-block interiors are excluded, so a `](...)` inside a shell/code
 * fence is not scanned as a real link.
 */
export function extractLinkTargets(readme: string): string[] {
  return [...stripFencedBlocks(readme).join('\n').matchAll(LINK_TARGET)].map(match => match[1]);
}

/**
 * Every non-external link target must resolve: a bare `#anchor` against a
 * heading slug, otherwise the path (fragment ignored) against `pathExists`.
 */
export function checkLinks(readme: string, pathExists: (relPath: string) => boolean): string[] {
  const headingSlugs = extractHeadingSlugs(readme);
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const target of extractLinkTargets(readme)) {
    if (seen.has(target) || /^(?:https?:|mailto:)/.test(target)) {
      continue;
    }
    seen.add(target);
    const hashIdx = target.indexOf('#');
    const pathPart = hashIdx === -1 ? target : target.slice(0, hashIdx);
    const fragment = hashIdx === -1 ? '' : target.slice(hashIdx + 1);
    if (pathPart === '') {
      if (!headingSlugs.has(fragment)) {
        findings.push(`README link target "${target}" has no matching heading anchor`);
      }
      continue;
    }
    if (!pathExists(pathPart)) {
      findings.push(`README link target "${target}" does not resolve to a file or directory`);
    }
  }
  return findings;
}

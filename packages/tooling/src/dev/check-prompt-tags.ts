/**
 * Guard: every structural prompt tag must be classified.
 *
 * The ai-worker assembles the LLM system prompt from XML-like structural tags
 * (`<system_identity>`, `<character>`, `<memory_archive>`, …). User-authored
 * content (personality fields, memories, quoted messages) is placed INSIDE
 * these tags. `escapeXmlContent` (packages/common-types promptSanitizer) only
 * neutralizes the closing tags listed in `PROTECTED_TAGS`; a structural tag
 * that encloses user content but is NOT protected is a prompt-injection
 * breakout seam — a public personality can emit `</character></system_identity>`
 * and escape into top-level prompt scope for every user who talks to it.
 *
 * This guard fails closed: every literal structural tag emitted by the prompt
 * assembly sources must be classified as EITHER
 *   - PROTECTED (in promptSanitizer's `PROTECTED_TAGS` — escaped in user content), OR
 *   - KNOWN_UNPROTECTED (this file's registry — proven to wrap only
 *     system-generated content, or handled by the separate
 *     `neutralizeWrapperClosingTags` mechanism).
 * A newly-added structural tag in neither list fails the guard, forcing the
 * author to decide whether it needs escaping. The check is bidirectional: a
 * KNOWN_UNPROTECTED entry no longer emitted is stale and also fails.
 *
 * Binary sync-check (like guard:duplicate-exports): no threshold, no WHY.md,
 * no --summary.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROTECTED_TAGS } from '@tzurot/common-types/utils/promptSanitizer';

/**
 * Where prompt assembly lives. Every prompt-emitting file uses one of the XML
 * escapers, so a file is IN the surface iff it imports one — this auto-discovers
 * new formatters instead of hardcoding a file list that silently goes stale
 * (conversationUtils.ts / xmlMetadataFormatters.ts live outside services/prompt/,
 * and shared formatters like common-types environmentFormatter.ts live in a
 * different package — a directory allowlist would miss all of these).
 */
const SCAN_ROOTS = ['services/ai-worker/src', 'packages/common-types/src'] as const;
const ESCAPER_IMPORT = /\bescapeXmlContent\b|\bescapeXml\b|\bneutralizeWrapperClosingTags\b/;

/**
 * Structural tags proven to enclose ONLY system-generated content (hardcoded
 * constraint text, current datetime, request ids), OR handled by the separate
 * `neutralizeWrapperClosingTags` pre-escaping mechanism rather than
 * `escapeXmlContent`. Each entry states WHY it is safe unprotected — adding a
 * tag here is a security assertion, not a formality.
 *
 * NOTE: this registry is populated from the audit in the prompt-tag-injection
 * fix. Do not add a tag here to silence the guard without confirming its
 * content is genuinely non-user-controlled.
 */
const CHARACTER_FIELD =
  'Persona field inside author-controlled <character>; value escapeXmlContent-escaped, section boundary protected.';
const PROTOCOL_FIELD =
  'Protocol field inside author-controlled <protocol>; value escapeXmlContent-escaped, section boundary protected.';

export const KNOWN_UNPROTECTED_TAGS: Record<string, string> = {
  // Hardcoded system text — no user content ever interpolated.
  instruction: 'Hardcoded instruction strings (memory/participants/references).',
  platform_constraints: 'Hardcoded safety constraints (HardcodedConstraints).',
  output_constraints: 'Hardcoded output-format constraints (HardcodedConstraints).',
  context:
    'Wrapper over <datetime> (system time) + <location> (escapeXml); no escaped-content descendant.',
  datetime: 'System-generated current time (formatFullDateTime).',
  request_id: 'System-generated correlation id.',
  think: 'Literal example text inside a hardcoded <constraint>, not a content wrapper.',
  user: 'Literal example text inside a hardcoded <constraint>, not a content wrapper.',
  // Values fully entity-escaped via escapeXml (< > & " ' → entities) — a closing
  // tag in the value is neutralized regardless of tag name.
  name: 'Participant display name via escapeXml (full).',
  pronouns: 'Participant pronouns via escapeXml (full).',
  location: 'Guild/channel names via escapeXml (full).',
  server: 'Self-closing; guild name attribute via escapeXml.',
  category: 'Self-closing; category name attribute via escapeXml.',
  channel: 'Self-closing; channel name/type/topic attributes via escapeXml.',
  thread: 'Self-closing; thread name attribute via escapeXml.',
  time: 'Self-closing; timestamp attributes via escapeXml.',
  from_id: 'Attribute-only (escapeXml) plus literal constraint text; not a content tag.',
  roles: 'Wraps <role> elements whose values are escapeXml (full).',
  guild_info: 'Attributes + child <role>s all escapeXml (full).',
  // Structured-escape mechanisms other than escapeXmlContent.
  transcript:
    'voice_transcripts/transcript use neutralizeWrapperClosingTags on every emission path (see promptSanitizer).',
  voice_transcripts:
    'Wrapper for <transcript>; content neutralized via neutralizeWrapperClosingTags.',
  // Passthrough of pre-escaped upstream XML.
  embeds:
    'Passthrough of bot-client EmbedParser output; all embed fields escapeXml (full) upstream.',
  // Internal field tags inside an author-controlled section (<character>/<protocol>).
  // The section BOUNDARY (character/system_identity/protocol) is protected, so a
  // field value can't escape to top-level; the personality author already owns
  // the whole section, so injecting a sibling field within it is not an
  // escalation. Field VALUES are escapeXmlContent-escaped. (Protecting these
  // would also break the outer escapeXmlContent pass that re-wraps persona/protocol.)
  display_name: CHARACTER_FIELD,
  character_info: CHARACTER_FIELD,
  personality_traits: CHARACTER_FIELD,
  personality_tone: CHARACTER_FIELD,
  personality_age: CHARACTER_FIELD,
  personality_appearance: CHARACTER_FIELD,
  personality_likes: CHARACTER_FIELD,
  personality_dislikes: CHARACTER_FIELD,
  conversational_goals: CHARACTER_FIELD,
  conversational_examples: CHARACTER_FIELD,
  permissions: PROTOCOL_FIELD,
  permitted: PROTOCOL_FIELD,
  character_directives: PROTOCOL_FIELD,
  directive: PROTOCOL_FIELD,
  formatting_rules: PROTOCOL_FIELD,
  rule: PROTOCOL_FIELD,
};

// A structural tag literal INSIDE a string/template — `<tag>`, `</tag>`,
// `<tag ...>` (attributes), OR `<tag${...}>` (dynamic-attribute open, e.g.
// `<quote${attrs}>`). The char after the tag name may be `>`, whitespace, or
// `$` (template interpolation). Scanned only within extracted string contents,
// so TS generics (`Array<string>`) in type position never match. No internal
// `\s*` runs — avoids the super-linear-backtracking class the linter flags.
const TSX_TAG = /<\/?([a-z][a-z0-9_]*)(?:[\s$][^>]*)?>/g;
// Data-driven emission: a `tag: 'name'` / `tag: "name"` property in a
// field-definition array (PersonalityFieldsFormatter's PERSONALITY_FIELDS emits
// `<${field.tag}>` at runtime, so the tag name only exists as this string value).
const TAG_PROPERTY = /\btag\s*:\s*['"]([a-z][a-z0-9_]*)['"]/g;
// Section-helper emission: `addArraySection(parts, items, 'tag', mapper)` emits
// `<${tag}>` from its 3rd (string-literal) argument, so the tag name only exists
// as that positional literal, never as `<tag>` in source. `[^,]+` already spans
// whitespace, so no adjacent `\s*` (avoids the super-linear-backtracking class).
const HELPER_TAG_ARG = /addArraySection\([^,]+,[^,]+,\s*['"]([a-z][a-z0-9_]*)['"]/g;
// String and template literals — their CONTENTS are where emitted tags live.
const STRING_LITERALS = /`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/gs;

/** Strip line + block comments so tags mentioned in prose don't count as emitted. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Extract the set of structural tag names emitted by a source file — literal
 * `<tag>`/`<tag${...}>` forms inside string/template literals, data-driven
 * `tag: 'name'` field-definition values, AND section-helper positional tag
 * arguments. Comments are stripped first; scanning inside string literals keeps
 * TypeScript generics out of the result.
 */
export function extractStructuralTags(source: string): Set<string> {
  const stripped = stripComments(source);
  const tags = new Set<string>();
  for (const literal of stripped.match(STRING_LITERALS) ?? []) {
    for (const match of literal.matchAll(TSX_TAG)) {
      tags.add(match[1]);
    }
  }
  for (const match of stripped.matchAll(TAG_PROPERTY)) {
    tags.add(match[1]);
  }
  for (const match of stripped.matchAll(HELPER_TAG_ARG)) {
    tags.add(match[1]);
  }
  return tags;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

/** Is this file part of prompt assembly? (imports an XML escaper) */
export function isPromptAssemblyFile(source: string): boolean {
  return ESCAPER_IMPORT.test(source);
}

/** Collect every structural tag emitted across the prompt-assembly sources. */
export function collectEmittedTags(rootDir: string): Set<string> {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walk(join(rootDir, root), files);
  }
  const all = new Set<string>();
  for (const file of files) {
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    if (!isPromptAssemblyFile(src)) {
      continue;
    }
    for (const tag of extractStructuralTags(src)) {
      all.add(tag);
    }
  }
  return all;
}

export interface PromptTagResult {
  unclassified: string[];
  staleKnownUnprotected: string[];
  staleProtected: string[];
}

export function analyzePromptTags(rootDir: string): PromptTagResult {
  const emitted = collectEmittedTags(rootDir);
  const protectedSet = new Set<string>(PROTECTED_TAGS);
  const knownUnprotected = new Set(Object.keys(KNOWN_UNPROTECTED_TAGS));

  const unclassified = [...emitted]
    .filter(tag => !protectedSet.has(tag) && !knownUnprotected.has(tag))
    .sort();

  const staleKnownUnprotected = [...knownUnprotected].filter(tag => !emitted.has(tag)).sort();
  const staleProtected = [...protectedSet].filter(tag => !emitted.has(tag)).sort();

  return { unclassified, staleKnownUnprotected, staleProtected };
}

function reportTagList(heading: string, tags: string[], hint: string): void {
  if (tags.length === 0) {
    return;
  }
  console.error(heading);
  for (const tag of tags) {
    console.error(`  <${tag}>`);
  }
  console.error(hint);
}

export function checkPromptTags(): void {
  const { unclassified, staleKnownUnprotected, staleProtected } = analyzePromptTags(process.cwd());

  if (
    unclassified.length === 0 &&
    staleKnownUnprotected.length === 0 &&
    staleProtected.length === 0
  ) {
    console.log('✓ Every structural prompt tag is classified (protected or known-unprotected).');
    return;
  }

  reportTagList(
    `❌ ${unclassified.length} structural prompt tag(s) emitted but not classified:`,
    unclassified,
    '\n  Each must be EITHER added to PROTECTED_TAGS (packages/common-types promptSanitizer,\n' +
      '  if it encloses user-authored content) OR to KNOWN_UNPROTECTED_TAGS in\n' +
      '  packages/tooling/src/dev/check-prompt-tags.ts (with a reason, if it wraps only\n' +
      '  system-generated content). Unclassified = fail closed.'
  );
  reportTagList(
    `\n❌ ${staleKnownUnprotected.length} KNOWN_UNPROTECTED_TAGS entr(ies) no longer emitted (stale):`,
    staleKnownUnprotected,
    '\n  Remove the stale entr(y/ies) from KNOWN_UNPROTECTED_TAGS.'
  );
  reportTagList(
    `\n❌ ${staleProtected.length} PROTECTED_TAGS entr(ies) no longer emitted (stale):`,
    staleProtected,
    '\n  Remove the stale entr(y/ies) from PROTECTED_TAGS, or (if the tag IS emitted\n' +
      '  via an idiom the extractor misses) extend extractStructuralTags to see it.'
  );

  process.exitCode = 1;
}

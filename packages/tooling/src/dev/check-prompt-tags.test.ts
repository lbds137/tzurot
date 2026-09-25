import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTECTED_TAGS } from '@tzurot/common-types/utils/promptSanitizer';
import {
  extractStructuralTags,
  stripComments,
  stripRegexLiterals,
  scanSource,
  analyzePromptTags,
  collectEmittedTags,
  KNOWN_UNPROTECTED_TAGS,
  KNOWN_NON_PROMPT_TAGS,
} from './check-prompt-tags.js';

// packages/tooling/src/dev/ → repo root is four levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('check-prompt-tags', () => {
  describe('extractStructuralTags', () => {
    it('extracts literal tags from string/template literals', () => {
      const src = 'const x = `<memory_archive>${body}</memory_archive>`;';
      expect([...extractStructuralTags(src)].sort()).toEqual(['memory_archive']);
    });

    it('extracts data-driven tag names from tag-property field definitions', () => {
      const src =
        "const FIELDS = [{ key: 'a', tag: 'character_info' }, { tag: 'personality_traits' }];";
      expect([...extractStructuralTags(src)].sort()).toEqual([
        'character_info',
        'personality_traits',
      ]);
    });

    it('does NOT match TypeScript generics in type position', () => {
      const src =
        'const s = new Set<string>(); function f(): Promise<void> {} let u = x as unknown;';
      expect(extractStructuralTags(src).size).toBe(0);
    });

    it('ignores tags that appear only in comments', () => {
      const src = `
        // a comment mentioning </persona>
        /* block comment with <character> */
        const real = '<protocol>x</protocol>';
      `;
      expect([...extractStructuralTags(src)]).toEqual(['protocol']);
    });

    it('matches attribute-bearing tags', () => {
      const src = 'const x = `<participant id="${id}">${body}</participant>`;';
      expect([...extractStructuralTags(src)].sort()).toEqual(['participant']);
    });

    it('matches dynamic-attribute open tags (`<tag${attrs}>`)', () => {
      // formatQuoteElement emits `<quote${attrs.length > 0 ? ...}>` — the char
      // after the tag name is `$`, not a literal space or `>`.
      const src = 'const parts = [`<quote${attrs.length > 0 ? " " + attrs : ""}>`];';
      expect(extractStructuralTags(src).has('quote')).toBe(true);
    });

    it('matches tag names passed positionally to addArraySection', () => {
      // The tag is only ever a string arg; it is emitted via `<${tag}>` inside
      // the helper, so a literal-`<tag>` scan alone would miss it.
      const src = "addArraySection(parts, opts.attachmentLines, 'attachments', a => a);";
      expect(extractStructuralTags(src).has('attachments')).toBe(true);
    });
  });

  describe('string-aware scanning', () => {
    it('never reads a slash inside a string as the start of a regex literal', () => {
      const src = 'const p = "C:/foo<tag>/rest";';
      expect(extractStructuralTags(src).has('tag')).toBe(true);
    });

    it('never reads parens/slashes inside a string as regex/division syntax', () => {
      const src = 'emit("(/<tag>/)");';
      expect(extractStructuralTags(src).has('tag')).toBe(true);
    });

    it('does not treat a `//` inside a string as a comment', () => {
      const src = 'const s = "a//b<tag>";';
      expect(extractStructuralTags(src).has('tag')).toBe(true);
    });

    it('never lets a quote inside a regex literal open a phantom string', () => {
      const src = 'const re = /[\'"]/g; const b = "x"; type T = Foo<phantom>;';
      expect(extractStructuralTags(src).has('phantom')).toBe(false);
    });

    it('keeps division as division, never a regex start', () => {
      // The odd slash count before the string and the trailing division are
      // deliberate: this goes red if every `/` were read as a regex start.
      const src = "const r = a / b / c / d; const s = '<kept>'; const q = m / n;";
      expect(extractStructuralTags(src).has('kept')).toBe(true);
    });

    it('never lets a quote inside a block or line comment open a string', () => {
      const src = "/* see '<c1>' */ const a = 1; // see \"<c2>\"\nconst b = '<real>';";
      expect([...extractStructuralTags(src)].sort()).toEqual(['real']);
    });

    it('extracts tags from a template literal with interpolation', () => {
      const src = 'const t = `<t>${x}</t>`;';
      expect(extractStructuralTags(src).has('t')).toBe(true);
    });

    it('recognizes a regex literal after a binary operator (a quote inside it opens no string)', () => {
      const src = 'const n = x - /[\'"]/.source; type T = Foo<phantom>; const s = "<real>";';
      expect([...extractStructuralTags(src)].sort()).toEqual(['real']);
    });
  });

  describe('stripComments', () => {
    it('removes line and block comments but keeps a `://` in a string-ish position intact', () => {
      expect(stripComments('a // b\nc')).toBe('a \nc');
      expect(stripComments('a /* b */ c')).toBe('a  c');
      // The `[^:]` guard keeps `://` (e.g. URLs) from being treated as a line comment.
      expect(stripComments('https://x')).toContain('https://x');
    });

    it('does not treat a `//` inside a string as a comment', () => {
      expect(stripComments('const s = "a//b";')).toBe('const s = "a//b";');
    });
  });

  describe('stripRegexLiterals', () => {
    it('keeps the preceding token when stripping a regex literal', () => {
      expect(stripRegexLiterals('x = /a\\/b[/]/gi;')).toBe('x = ;');
    });

    it('strips a quote glyph inside a regex character class instead of treating it as a string opener', () => {
      const src =
        "const a = '<real>'; const re = /['\"]/g; const b = \"x\"; type T = Foo<phantom>; const c = 'y';";
      const tags = extractStructuralTags(src);
      expect(tags.has('real')).toBe(true);
      expect(tags.has('phantom')).toBe(false);
    });

    it('does not treat division as a regex literal (unpaired slashes on one line)', () => {
      const src = "const r = a / b / c; const w = x / y; const s = '<kept>'; const q = m / n;";
      expect(extractStructuralTags(src).has('kept')).toBe(true);
    });

    it('ends a regex literal at the first unescaped slash outside a character class', () => {
      const src = 'const re = /[/]"/; type T = Foo<phantom>; const t = "<after>";';
      expect([...extractStructuralTags(src)].sort()).toEqual(['after']);
    });

    it('recognizes a regex literal after `return` (a quote inside it stays out of string pairing)', () => {
      const src = 'function f(s) { return /"/.test(s); } type T = Foo<phantom>; const u = "<ok>";';
      expect([...extractStructuralTags(src)].sort()).toEqual(['ok']);
    });

    it('keeps a regex-start slash with no closing slash on its line as division', () => {
      expect(stripRegexLiterals('x = (a\n/ 2)')).toBe('x = (a\n/ 2)');
    });

    it('treats a slash right after a regex literal as division, not a new regex start', () => {
      expect(stripRegexLiterals('x = /a/ / 2 / 3')).toBe('x =  / 2 / 3');
    });
  });

  describe('scanSource', () => {
    it('keeps string/template literal delimiters in both code and the literals list', () => {
      const result = scanSource('a = \'x\' + "y" + `z`;', {
        comments: true,
        regexLiterals: true,
      });
      expect(result.literals).toEqual(["'x'", '"y"', '`z`']);
      expect(result.code).toBe('a = \'x\' + "y" + `z`;');
    });

    it('ends an unterminated single-quoted string at the newline', () => {
      const result = scanSource("a = 'x\nb = '<t>';", {
        comments: true,
        regexLiterals: true,
      });
      expect(result.literals).toEqual(["'x", "'<t>'"]);
    });

    it('runs an unterminated block comment to the end of input', () => {
      expect(stripComments('a /* b')).toBe('a ');
    });

    it('strips a regex literal at the very start of input', () => {
      expect(stripRegexLiterals('/[\'"]/g.test(x); const s = "<t>";')).toBe(
        '.test(x); const s = "<t>";'
      );
    });

    it('clamps a trailing backslash at the end of input inside a string', () => {
      const result = scanSource("a = 'x\\", { comments: true, regexLiterals: true });
      expect(result.literals).toEqual(["'x\\"]);
    });

    it('a block comment spanning a newline resets the after-regex state like a bare newline', () => {
      const src =
        'const n = /a/ /* one\ntwo */ /["\']/.source; type T = Foo<phantom>; const s = "<real>";';
      expect([...extractStructuralTags(src)].sort()).toEqual(['real']);
    });
  });

  describe('classification registries', () => {
    it('every KNOWN_UNPROTECTED_TAGS entry has a non-empty reason', () => {
      for (const [tag, reason] of Object.entries(KNOWN_UNPROTECTED_TAGS)) {
        expect(reason.length, `${tag} needs a reason`).toBeGreaterThan(0);
      }
    });

    it('every KNOWN_NON_PROMPT_TAGS entry has a non-empty reason', () => {
      for (const [tag, reason] of Object.entries(KNOWN_NON_PROMPT_TAGS)) {
        expect(reason.length, `${tag} needs a reason`).toBeGreaterThan(0);
      }
    });

    it('the two registries are disjoint (a tag is a prompt tag OR not, never both)', () => {
      for (const tag of Object.keys(KNOWN_NON_PROMPT_TAGS)) {
        expect(tag in KNOWN_UNPROTECTED_TAGS, `${tag} is in both registries`).toBe(false);
      }
    });
  });

  describe('fail-closed classification', () => {
    it('a newly-emitted unclassified tag would be flagged (acceptance criterion)', () => {
      // Compositional proof: the extractor finds a fake structural tag, and it
      // is in NEITHER registry — so analyze's `unclassified` filter reports it.
      const emitted = extractStructuralTags('const x = `<test_section>${y}</test_section>`;');
      expect(emitted.has('test_section')).toBe(true);
      const inProtected = new Set<string>(PROTECTED_TAGS).has('test_section');
      const inKnown = 'test_section' in KNOWN_UNPROTECTED_TAGS;
      expect(inProtected || inKnown).toBe(false); // → would be reported unclassified
    });
  });

  describe('analyzePromptTags (real tree)', () => {
    it('reports no unclassified and no stale tags (both directions) on the current codebase', () => {
      const result = analyzePromptTags(REPO_ROOT);
      expect(result.unclassified).toEqual([]);
      expect(result.staleKnownUnprotected).toEqual([]);
      expect(result.staleProtected).toEqual([]);
    });

    it('actually DISCOVERS the helper/dynamic-emitted tags (not just hand-listed)', () => {
      // Regression for the guard's own blind spots: if the extractor stops
      // seeing these idioms, the real tree would flag them as stale-protected.
      const emitted = collectEmittedTags(REPO_ROOT);
      for (const tag of ['attachments', 'quote', 'chat_log', 'server', 'channel']) {
        expect(emitted.has(tag), `extractor must discover <${tag}>`).toBe(true);
      }
    });

    it('discovers a tag in an escaper-import-less file (the widened-scan guarantee)', () => {
      // <current_conversation> is emitted by ContextWindowManager.ts, which does
      // NOT import an XML escaper — the import-gated scan was blind to it. This
      // pins that the scan is now unconditional (its whole reason for existing).
      expect(collectEmittedTags(REPO_ROOT).has('current_conversation')).toBe(true);
    });
  });
});

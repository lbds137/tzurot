import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTECTED_TAGS } from '@tzurot/common-types/utils/promptSanitizer';
import {
  extractStructuralTags,
  stripComments,
  isPromptAssemblyFile,
  analyzePromptTags,
  collectEmittedTags,
  KNOWN_UNPROTECTED_TAGS,
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

  describe('stripComments', () => {
    it('removes line and block comments but keeps a `://` in a string-ish position intact', () => {
      expect(stripComments('a // b\nc')).toBe('a \nc');
      expect(stripComments('a /* b */ c')).toBe('a  c');
      // The `[^:]` guard keeps `://` (e.g. URLs) from being treated as a line comment.
      expect(stripComments('https://x')).toContain('https://x');
    });
  });

  describe('isPromptAssemblyFile', () => {
    it('is true for files importing an XML escaper, false otherwise', () => {
      expect(isPromptAssemblyFile("import { escapeXmlContent } from '...';")).toBe(true);
      expect(isPromptAssemblyFile("import { escapeXml } from '...';")).toBe(true);
      expect(isPromptAssemblyFile("import { neutralizeWrapperClosingTags } from '...';")).toBe(
        true
      );
      expect(isPromptAssemblyFile("import { foo } from '...';")).toBe(false);
    });
  });

  describe('KNOWN_UNPROTECTED_TAGS registry', () => {
    it('every entry has a non-empty reason', () => {
      for (const [tag, reason] of Object.entries(KNOWN_UNPROTECTED_TAGS)) {
        expect(reason.length, `${tag} needs a reason`).toBeGreaterThan(0);
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
  });
});

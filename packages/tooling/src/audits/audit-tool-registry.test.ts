/**
 * Tests for the audit-tool registry.
 *
 * Structural assertions about the registry itself — no duplicate commands,
 * no empty descriptions, paths are repo-relative. The actual file-existence
 * check against the real WHY.md files lives in
 * `check-audit-tool-docs.test.ts` (the "real repo + actual registry" test).
 */

import { describe, it, expect } from 'vitest';
import { AUDIT_TOOL_REGISTRY } from './audit-tool-registry.js';

describe('AUDIT_TOOL_REGISTRY', () => {
  it('has at least one entry', () => {
    // Sanity check — a zero-entry registry would make the guard a no-op
    // without anyone noticing.
    expect(AUDIT_TOOL_REGISTRY.length).toBeGreaterThan(0);
  });

  it('has no duplicate command names', () => {
    const commands = AUDIT_TOOL_REGISTRY.map(e => e.command);
    const unique = new Set(commands);
    expect(unique.size, `Duplicate commands: ${commands.join(', ')}`).toBe(commands.length);
  });

  it('has no duplicate WHY.md paths', () => {
    // Two registry entries pointing at the same WHY.md would mean one tool's
    // documentation is doing double-duty — better to point both entries at
    // the same `command` field, or to split the WHY.md file. Either way,
    // this is a smell to catch.
    const paths = AUDIT_TOOL_REGISTRY.map(e => e.whyPath);
    const unique = new Set(paths);
    expect(unique.size, `Duplicate whyPaths: ${paths.join(', ')}`).toBe(paths.length);
  });

  it('every entry has a non-empty description', () => {
    for (const entry of AUDIT_TOOL_REGISTRY) {
      expect(
        entry.description.trim().length,
        `Empty description for command "${entry.command}"`
      ).toBeGreaterThan(0);
    }
  });

  it('every whyPath is repo-relative (no leading slash, no absolute path)', () => {
    // The guard joins `repoRoot` + `whyPath`, so an absolute path would
    // produce a malformed lookup. Keep all paths relative.
    for (const entry of AUDIT_TOOL_REGISTRY) {
      expect(entry.whyPath.startsWith('/'), `Absolute path in registry: ${entry.whyPath}`).toBe(
        false
      );
      expect(
        entry.whyPath.includes('..'),
        `Path with .. traversal in registry: ${entry.whyPath}`
      ).toBe(false);
    }
  });

  it('every whyPath ends in .WHY.md or WHY.md', () => {
    // Convention: WHY.md files end in either `<basename>.WHY.md` (when next
    // to a specific source file) or `WHY.md` (when covering a directory).
    // A path ending in `.md` but not matching either suggests a typo.
    for (const entry of AUDIT_TOOL_REGISTRY) {
      const matches = entry.whyPath.endsWith('.WHY.md') || entry.whyPath.endsWith('/WHY.md');
      expect(matches, `whyPath does not match the WHY.md naming convention: ${entry.whyPath}`).toBe(
        true
      );
    }
  });
});

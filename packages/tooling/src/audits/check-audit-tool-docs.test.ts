/**
 * Tests for the audit-tool-docs guard.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkAuditToolDocsFromRegistry, checkAuditToolDocs } from './check-audit-tool-docs.js';
import type { AuditToolEntry } from './audit-tool-registry.js';
import { AUDIT_TOOL_REGISTRY } from './audit-tool-registry.js';
import { parseSummary } from './summary.js';

async function withTempRepo<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'audit-tool-docs-'));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scaffold(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

const SUBSTANTIAL_WHY_CONTENT = `# Why this exists

## What

A non-stub explanation that crosses the minimum content threshold.

## Why

The reason this tool was built — substantial enough that a future
reader gets actionable context, not just a placeholder.

## Decay check

Specific guidance on when to delete this tool or update it.
`;

describe('checkAuditToolDocsFromRegistry', () => {
  it('returns zero findings when every registered tool has a substantial WHY.md', async () => {
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
        { command: 'tool-b', whyPath: 'src/b.WHY.md', description: 'Tool B' },
      ];
      scaffold(root, {
        'src/a.WHY.md': SUBSTANTIAL_WHY_CONTENT,
        'src/b.WHY.md': SUBSTANTIAL_WHY_CONTENT,
      });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.totalTools).toBe(2);
      expect(result.missing).toEqual([]);
      expect(result.stubs).toEqual([]);
    });
  });

  it('flags a tool whose WHY.md is missing entirely', async () => {
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
        { command: 'tool-b', whyPath: 'src/b.WHY.md', description: 'Tool B' },
      ];
      scaffold(root, {
        'src/a.WHY.md': SUBSTANTIAL_WHY_CONTENT,
        // b.WHY.md missing
      });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].command).toBe('tool-b');
      expect(result.stubs).toEqual([]);
    });
  });

  it('flags a stub WHY.md below the content threshold', async () => {
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
      ];
      scaffold(root, {
        'src/a.WHY.md': '# Why this exists\n\nTODO: write this later.',
      });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.missing).toEqual([]);
      expect(result.stubs).toHaveLength(1);
      expect(result.stubs[0].command).toBe('tool-a');
      expect(result.stubs[0].chars).toBeLessThan(200);
    });
  });

  it('flags an empty WHY.md as a stub', async () => {
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
      ];
      scaffold(root, {
        'src/a.WHY.md': '',
      });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.stubs).toHaveLength(1);
      expect(result.stubs[0].chars).toBe(0);
    });
  });

  it('strips YAML frontmatter before measuring content', async () => {
    // A WHY.md with a substantial frontmatter block but stub body
    // should still be flagged — the frontmatter is metadata, not content.
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
      ];
      scaffold(root, {
        'src/a.WHY.md': `---
title: Tool A
author: Someone
description: A long description that on its own would cross the content threshold but is metadata not body content so the guard should not be fooled by it
---

# Stub
TODO.`,
      });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.stubs).toHaveLength(1);
    });
  });

  it('strips frontmatter even when closing --- is followed by non-whitespace on the same line', async () => {
    // Edge case: malformed YAML where the closing fence runs into a
    // heading (`---# Body`). Without the `[^\n]*` after `---`, the
    // strip regex bails and frontmatter bytes count toward the
    // threshold, letting a stub with verbose YAML metadata slip past.
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
      ];
      scaffold(root, {
        'src/a.WHY.md': `---
title: Tool A
description: padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding
---# Why this tool exists

TODO.`,
      });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.stubs).toHaveLength(1);
      // Body after strip is `# Why this tool exists\n\nTODO.` (~28 chars)
      expect(result.stubs[0].chars).toBeLessThan(50);
    });
  });

  it('strips frontmatter even when the closing --- has no trailing newline', async () => {
    // Edge case for programmatically-generated WHY.md files that don't
    // append a final newline after the closing fence. Without the
    // `(?:\n|$)` in the strip regex, the frontmatter would survive and
    // its length would push a stub past the content threshold.
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
      ];
      // Frontmatter long enough that without stripping, the file would
      // pass the 200-char threshold; with proper stripping, only the
      // tiny body remains and the file should be flagged as a stub.
      // No trailing newline after the closing fence.
      scaffold(root, {
        'src/a.WHY.md': `---
title: Tool A
description: padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding
---`,
      });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.stubs).toHaveLength(1);
      expect(result.stubs[0].chars).toBe(0);
    });
  });

  it('treats a directory at the WHY.md path as missing', async () => {
    // Edge case: if someone accidentally creates a directory where a WHY.md
    // file should be, treat it as missing (the file isn't there).
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
      ];
      mkdirSync(join(root, 'src/a.WHY.md'), { recursive: true });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.missing).toHaveLength(1);
    });
  });

  it('reports both missing AND stub findings in a single run', async () => {
    await withTempRepo(root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
        { command: 'tool-b', whyPath: 'src/b.WHY.md', description: 'Tool B' },
        { command: 'tool-c', whyPath: 'src/c.WHY.md', description: 'Tool C' },
      ];
      scaffold(root, {
        'src/a.WHY.md': SUBSTANTIAL_WHY_CONTENT, // ok
        'src/b.WHY.md': 'stub', // too short
        // c.WHY.md missing
      });
      const result = checkAuditToolDocsFromRegistry(root, registry);
      expect(result.missing).toHaveLength(1);
      expect(result.stubs).toHaveLength(1);
      expect(result.missing[0].command).toBe('tool-c');
      expect(result.stubs[0].command).toBe('tool-b');
    });
  });
});

describe('checkAuditToolDocs (CLI entry point with --summary)', () => {
  it('emits an ok JSONL summary line when registry is fully documented', async () => {
    await withTempRepo(async root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
      ];
      scaffold(root, { 'src/a.WHY.md': SUBSTANTIAL_WHY_CONTENT });
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      try {
        await checkAuditToolDocs({ repoRoot: root, summary: true, registry });
      } finally {
        consoleSpy.mockRestore();
      }
      const summary = parseSummary(captured[captured.length - 1]);
      expect(summary.tool).toBe('guard:audit-tool-docs');
      expect(summary.status).toBe('ok');
      expect(summary.findings).toBe(0);
    });
  });

  it('emits a fail JSONL summary + exits 1 when findings exist', async () => {
    await withTempRepo(async root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-a', whyPath: 'src/a.WHY.md', description: 'Tool A' },
        { command: 'tool-b', whyPath: 'src/b.WHY.md', description: 'Tool B' },
      ];
      scaffold(root, {
        'src/a.WHY.md': SUBSTANTIAL_WHY_CONTENT,
        // b.WHY.md missing
      });
      vi.resetModules();
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        const { checkAuditToolDocs: checkFresh } = await import('./check-audit-tool-docs.js');
        await checkFresh({ repoRoot: root, summary: true, registry });
        const summary = parseSummary(captured[captured.length - 1]);
        expect(summary.tool).toBe('guard:audit-tool-docs');
        expect(summary.status).toBe('fail');
        expect(summary.findings).toBe(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });
});

describe('checkAuditToolDocs (CLI entry point, non-summary path)', () => {
  it('prints command + path + fix-hint for missing WHY.md + exits 1', async () => {
    await withTempRepo(async root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-missing', whyPath: 'src/missing.WHY.md', description: 'Tool' },
      ];
      // No WHY.md created → missing
      vi.resetModules();
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        const { checkAuditToolDocs: checkFresh } = await import('./check-audit-tool-docs.js');
        await checkFresh({ repoRoot: root, summary: false, registry });
        // Assertions inside try (mockRestore clears call history).
        const allOutput = captured.join('\n');
        expect(allOutput).toContain('tool-missing');
        expect(allOutput).toContain('src/missing.WHY.md');
        expect(allOutput).toContain('Missing WHY.md');
        expect(allOutput).toContain('AUDIT_TOOL_REGISTRY');
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });

  it('prints stub help text + char count when WHY.md is a stub', async () => {
    await withTempRepo(async root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-stub', whyPath: 'src/stub.WHY.md', description: 'Tool' },
      ];
      scaffold(root, { 'src/stub.WHY.md': '# Stub\nTODO.' });
      vi.resetModules();
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        const { checkAuditToolDocs: checkFresh } = await import('./check-audit-tool-docs.js');
        await checkFresh({ repoRoot: root, summary: false, registry });
        const allOutput = captured.join('\n');
        expect(allOutput).toContain('tool-stub');
        expect(allOutput).toContain('Stub WHY.md');
        expect(allOutput).toMatch(/\d+ chars/);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });

  it('prints success banner when every tool has a non-stub WHY.md', async () => {
    await withTempRepo(async root => {
      const registry: AuditToolEntry[] = [
        { command: 'tool-ok', whyPath: 'src/ok.WHY.md', description: 'Tool' },
      ];
      scaffold(root, { 'src/ok.WHY.md': SUBSTANTIAL_WHY_CONTENT });
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      try {
        await checkAuditToolDocs({ repoRoot: root, summary: false, registry });
      } finally {
        consoleSpy.mockRestore();
      }
      const allOutput = captured.join('\n');
      expect(allOutput).toContain('All 1 audit tools');
      expect(allOutput).toContain('non-stub');
    });
  });
});

describe('checkAuditToolDocsFromRegistry (against real repo + actual registry)', () => {
  it('reports zero findings against the project state', async () => {
    // The actual registry must pass the guard against the actual repo.
    // This test fails if a WHY.md gets renamed, deleted, or stubbed.
    const repoRoot = join(__dirname, '../../../..');
    const result = checkAuditToolDocsFromRegistry(repoRoot, AUDIT_TOOL_REGISTRY);
    expect(
      result.missing,
      `Missing WHY.md: ${result.missing.map(m => m.whyPath).join(', ')}`
    ).toEqual([]);
    expect(
      result.stubs,
      `Stub WHY.md (below threshold): ${result.stubs
        .map(s => `${s.whyPath} (${s.chars} chars)`)
        .join(', ')}`
    ).toEqual([]);
  });
});

/**
 * Tests for the commands:audit runner module.
 *
 * Covers the manifest loader, the aggregate-verdict `summarize`, and the
 * `runCommandsAudit` summary-mode wiring. The consistency checks, renderers,
 * and core helpers are tested in their own colocated files.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadManifest, summarize, runCommandsAudit } from './commandsAudit.js';
import type { CommandManifest } from './commandsAuditCore.js';

const HELP_CATEGORIES = ['Memory', 'Character', 'Other'];

function manifest(overrides: Partial<CommandManifest> = {}): CommandManifest {
  return {
    helpCategories: HELP_CATEGORIES,
    commands: [],
    ...overrides,
  };
}

function writeManifestFile(m: CommandManifest): string {
  const dir = mkdtempSync(join(tmpdir(), 'cmd-audit-'));
  const path = join(dir, 'command-manifest.json');
  writeFileSync(path, JSON.stringify(m, null, 2));
  return path;
}

describe('commandsAudit: loadManifest', () => {
  const created: string[] = [];
  afterEach(() => {
    // Remove the whole mkdtemp dir (each path is <dir>/command-manifest.json),
    // not just the file, so the temp directory doesn't leak.
    for (const p of created.splice(0)) rmSync(dirname(p), { recursive: true, force: true });
  });

  it('loads a manifest from a path', () => {
    const m = manifest({
      commands: [
        {
          name: 'memory',
          category: 'Memory',
          description: 'Manage your long-term memories',
          handlers: {
            execute: true,
            autocomplete: false,
            selectMenu: false,
            button: false,
            modal: false,
          },
          componentPrefixes: [],
          data: { name: 'memory', description: 'Manage your long-term memories' },
        },
      ],
    });
    const path = writeManifestFile(m);
    created.push(path);
    const loaded = loadManifest({ manifestPath: path });
    expect(loaded.commands).toHaveLength(1);
    expect(loaded.commands[0].name).toBe('memory');
  });

  it('throws a helpful error when the manifest is missing', () => {
    expect(() => loadManifest({ manifestPath: '/no/such/manifest.json' })).toThrow(
      /Generate it with/
    );
  });

  it('throws on a malformed manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmd-audit-'));
    const path = join(dir, 'command-manifest.json');
    writeFileSync(path, JSON.stringify({ foo: 'bar' }));
    created.push(path);
    expect(() => loadManifest({ manifestPath: path })).toThrow(/Malformed/);
  });
});

describe('commandsAudit: summarize', () => {
  it('returns fail when there are error findings', () => {
    const { status } = summarize([{ command: 'x', severity: 'error', rule: 'r', detail: 'd' }]);
    expect(status).toBe('fail');
  });
  it('returns warn when only warnings', () => {
    const { status } = summarize([{ command: 'x', severity: 'warn', rule: 'r', detail: 'd' }]);
    expect(status).toBe('warn');
  });
  it('returns ok when clean', () => {
    expect(summarize([]).status).toBe('ok');
  });
});

describe('commandsAudit: runCommandsAudit (summary mode)', () => {
  const created: string[] = [];
  afterEach(() => {
    // Remove the whole mkdtemp dir (each path is <dir>/command-manifest.json),
    // not just the file, so the temp directory doesn't leak.
    for (const p of created.splice(0)) rmSync(dirname(p), { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('emits a JSONL summary line with tool=commands:audit', async () => {
    const m = manifest({
      commands: [
        {
          name: 'memory',
          category: 'Memory',
          description: 'Manage your long-term memories',
          handlers: {
            execute: true,
            autocomplete: false,
            selectMenu: false,
            button: false,
            modal: false,
          },
          componentPrefixes: [],
          data: { name: 'memory', description: 'Manage your long-term memories' },
        },
      ],
    });
    const path = writeManifestFile(m);
    created.push(path);
    const captured: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });
    await runCommandsAudit({ summary: true, manifestPath: path });
    const parsed = JSON.parse(captured[captured.length - 1]) as { tool: string; status: string };
    expect(parsed.tool).toBe('commands:audit');
    expect(parsed.status).toBe('ok');
  });

  it('emits JSON with finding counts and an inventory in json format', async () => {
    // A command with a bad category produces one error-severity finding, so the
    // json branch (emitJson) exercises both the summary counts and the
    // inventory projection (subcommands + leaf options).
    const m = manifest({
      commands: [
        {
          name: 'memory',
          category: 'Bogus', // not a help category -> category-coverage error
          description: 'Manage your long-term memories',
          handlers: {
            execute: true,
            autocomplete: false,
            selectMenu: false,
            button: false,
            modal: false,
          },
          componentPrefixes: [],
          data: {
            name: 'memory',
            description: 'Manage your long-term memories',
            options: [
              {
                type: 1,
                name: 'browse',
                description: 'Browse memories',
                options: [{ type: 3, name: 'query', description: 'Search text' }],
              },
            ],
          },
        },
      ],
    });
    const path = writeManifestFile(m);
    created.push(path);
    const captured: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });
    // format: 'json' with an error-severity finding would call process.exit(1);
    // stub it so the test observes the emitted JSON instead of exiting.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await runCommandsAudit({ format: 'json', manifestPath: path });
    expect(exitSpy).toHaveBeenCalledWith(1);

    const parsed = JSON.parse(captured.join('\n')) as {
      summary: { total: number; errors: number; warnings: number };
      findings: { rule: string }[];
      inventory: { name: string; subcommands: string[]; options: { name: string }[] }[];
    };
    expect(parsed.summary.errors).toBeGreaterThanOrEqual(1);
    expect(parsed.findings.some(f => f.rule === 'category-coverage')).toBe(true);
    expect(parsed.inventory[0].name).toBe('memory');
    expect(parsed.inventory[0].subcommands).toContain('browse');
    expect(parsed.inventory[0].options.some(o => o.name === 'query')).toBe(true);
  });
});

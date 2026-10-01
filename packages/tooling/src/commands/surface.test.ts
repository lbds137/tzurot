import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cac } from 'cac';

import type { SurfaceEntry, SurfaceInventory } from '../surface/types.js';
import { registerSurfaceCommands, resolveFlagConflict, resolveFormat } from './surface.js';

const JSON_STUB = '{"stubbed":"json"}';
const MD_STUB = '# stubbed markdown';

// The factories cover the action's DYNAMIC imports too — the wiring tests run
// the real cac parser against the real registered command with every
// downstream module stubbed.
vi.mock('../surface/analyzer.js', () => ({
  analyzeBotClient: vi.fn(),
}));

vi.mock('../surface/snapshot.js', () => ({
  buildSnapshotJson: vi.fn(() => JSON_STUB),
  renderSnapshotMarkdown: vi.fn(() => MD_STUB),
  evaluateCheck: vi.fn(),
  writeSnapshotFiles: vi.fn(),
  SNAPSHOT_JSON_PATH: 'docs/reference/conformance/discord-surface.json',
  SNAPSHOT_MD_PATH: 'docs/reference/conformance/discord-surface.md',
}));

vi.mock('../surface/render.js', () => ({
  renderTerminal: vi.fn(() => 'terminal-out'),
  renderJson: vi.fn(() => 'json-out'),
  renderMarkdownOutput: vi.fn(() => 'markdown-out'),
}));

const ENTRY: SurfaceEntry = {
  category: 'client-methods',
  file: 'services/bot-client/src/example.ts',
  symbol: 'reply',
  count: 2,
};

const INVENTORY: SurfaceInventory = { entries: [ENTRY], totalSites: 2, elapsedMs: 0 };

describe('resolveFormat', () => {
  it('accepts the three valid formats', () => {
    for (const format of ['terminal', 'json', 'markdown']) {
      const resolution = resolveFormat(format);
      expect(resolution.ok).toBe(true);
      if (resolution.ok) expect(resolution.format).toBe(format);
    }
  });

  it('defaults to terminal when the flag is absent', () => {
    const resolution = resolveFormat(undefined);
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.format).toBe('terminal');
  });

  it('rejects an unknown format naming the valid ones', () => {
    const resolution = resolveFormat('md');
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.message).toContain('md');
      expect(resolution.message).toContain('terminal, json, markdown');
    }
  });
});

describe('resolveFlagConflict', () => {
  it('rejects --check together with --write, naming both flags', () => {
    const result = resolveFlagConflict({ check: true, write: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('--check');
      expect(result.message).toContain('--write');
    }
  });

  it('allows --check alone', () => {
    expect(resolveFlagConflict({ check: true }).ok).toBe(true);
  });

  it('allows --write alone', () => {
    expect(resolveFlagConflict({ write: true }).ok).toBe(true);
  });

  it('allows neither flag', () => {
    expect(resolveFlagConflict({}).ok).toBe(true);
  });
});

describe('surface:inventory command wiring', () => {
  let cli: ReturnType<typeof cac>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { analyzeBotClient } = await import('../surface/analyzer.js');
    vi.mocked(analyzeBotClient).mockResolvedValue(INVENTORY);
    cli = cac('test');
    registerSurfaceCommands(cli);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  async function runWithArgs(args: string[]): Promise<void> {
    cli.parse(['node', 'test', 'surface:inventory', ...args], { run: false });
    await (cli.runMatchedCommand() as Promise<void>);
  }

  it('routes the default run to the terminal renderer', async () => {
    const { analyzeBotClient } = await import('../surface/analyzer.js');
    const { evaluateCheck, writeSnapshotFiles } = await import('../surface/snapshot.js');
    const { renderJson, renderMarkdownOutput, renderTerminal } =
      await import('../surface/render.js');

    await runWithArgs([]);

    // cac applies the { default: 'terminal' } to --format, so the no-flags run
    // reaches the terminal branch through resolveFormat('terminal').
    expect(analyzeBotClient).toHaveBeenCalledWith(process.cwd());
    expect(renderTerminal).toHaveBeenCalledWith(INVENTORY);
    expect(logSpy).toHaveBeenCalledWith('terminal-out');
    expect(renderJson).not.toHaveBeenCalled();
    expect(renderMarkdownOutput).not.toHaveBeenCalled();
    expect(writeSnapshotFiles).not.toHaveBeenCalled();
    expect(evaluateCheck).not.toHaveBeenCalled();
  });

  it('routes --format json to the JSON renderer', async () => {
    const { renderJson } = await import('../surface/render.js');
    const { renderMarkdownOutput, renderTerminal } = await import('../surface/render.js');

    await runWithArgs(['--format', 'json']);

    expect(renderJson).toHaveBeenCalledWith(INVENTORY);
    expect(logSpy).toHaveBeenCalledWith('json-out');
    expect(renderTerminal).not.toHaveBeenCalled();
    expect(renderMarkdownOutput).not.toHaveBeenCalled();
  });

  it('routes --format markdown to the markdown renderer', async () => {
    const { renderMarkdownOutput } = await import('../surface/render.js');

    await runWithArgs(['--format', 'markdown']);

    expect(renderMarkdownOutput).toHaveBeenCalledWith(INVENTORY);
    expect(logSpy).toHaveBeenCalledWith('markdown-out');
  });

  it('routes --check through evaluateCheck without writing', async () => {
    const { evaluateCheck, writeSnapshotFiles } = await import('../surface/snapshot.js');

    vi.mocked(evaluateCheck).mockReturnValue({ ok: true, drifted: [], hint: '' });

    await runWithArgs(['--check']);

    expect(evaluateCheck).toHaveBeenCalledWith(process.cwd(), INVENTORY.entries);
    expect(writeSnapshotFiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date'));
  });

  it('routes --write to writeSnapshotFiles with the built strings', async () => {
    const { SNAPSHOT_JSON_PATH, SNAPSHOT_MD_PATH, evaluateCheck } =
      await import('../surface/snapshot.js');
    const { writeSnapshotFiles } = await import('../surface/snapshot.js');

    await runWithArgs(['--write']);

    expect(writeSnapshotFiles).toHaveBeenCalledWith(process.cwd(), JSON_STUB, MD_STUB);
    expect(evaluateCheck).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(SNAPSHOT_JSON_PATH));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(SNAPSHOT_MD_PATH));
  });

  it('rejects conflicting --check and --write before any work', async () => {
    const { analyzeBotClient } = await import('../surface/analyzer.js');
    const { evaluateCheck, writeSnapshotFiles } = await import('../surface/snapshot.js');

    await runWithArgs(['--check', '--write']);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--check'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--write'));
    expect(evaluateCheck).not.toHaveBeenCalled();
    expect(writeSnapshotFiles).not.toHaveBeenCalled();
    expect(analyzeBotClient).not.toHaveBeenCalled();
  });
});

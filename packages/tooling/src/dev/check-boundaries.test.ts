import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: Object.assign((s: string) => s, { bold: (s: string) => s }),
    red: Object.assign((s: string) => s, { bold: (s: string) => s }),
    dim: (s: string) => s,
  },
}));

// Mock fs
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkBoundaries,
  BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS,
} from './check-boundaries.js';

describe('checkBoundaries', () => {
  let consoleLogSpy: MockInstance;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    // Default: empty directories
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
      typeof statSync
    >);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('should export checkBoundaries function', () => {
    expect(typeof checkBoundaries).toBe('function');
  });

  describe('when no files exist', () => {
    it('should report no violations', async () => {
      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });
  });

  describe('--summary mode', () => {
    it('emits exactly one JSONL audit-summary line and no human output', async () => {
      await checkBoundaries({ summary: true });

      const lines = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .filter(line => line.trim().length > 0);
      // Only the JSONL line — no header/decorative output in summary mode.
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(parsed).toMatchObject({ tool: 'guard:boundaries', status: 'ok', findings: 0 });
    });

    it('reports status:fail (exit 1) when an error-severity violation exists', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`import { PrismaClient } from '@prisma/client';`);

      await checkBoundaries({ summary: true });

      const line = consoleLogSpy.mock.calls.map(c => c.join(' ')).find(l => l.trim().length > 0);
      const parsed = JSON.parse(line ?? '{}') as Record<string, unknown>;
      expect(parsed).toMatchObject({ tool: 'guard:boundaries', status: 'fail' });
      expect(parsed.findings as number).toBeGreaterThan(0);
      expect(process.exitCode).toBe(1);
    });

    it('reports status:warn (no exit code) when only warning-severity violations exist', async () => {
      // ai-worker importing discord.js is a warning-severity rule, not an error.
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('ai-worker/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`import { Client } from 'discord.js';`);

      await checkBoundaries({ summary: true });

      const line = consoleLogSpy.mock.calls.map(c => c.join(' ')).find(l => l.trim().length > 0);
      const parsed = JSON.parse(line ?? '{}') as Record<string, unknown>;
      expect(parsed).toMatchObject({ tool: 'guard:boundaries', status: 'warn' });
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('violation detection', () => {
    it('should detect bot-client importing @prisma/client', async () => {
      // Setup: bot-client has one file
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(output).toContain('@prisma/client');
      expect(process.exitCode).toBe(1);
    });

    it('should detect bot-client importing Prisma-backed code from the common-types barrel', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        `import { PrismaClient } from '@tzurot/common-types';`
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(output).toContain('Prisma-backed');
      expect(process.exitCode).toBe(1);
    });

    it('should detect bot-client importing Prisma from the deep services/prisma subpath', async () => {
      // Post-barrel: PrismaClient/Prisma live at @tzurot/common-types/services/prisma.
      // The widened boundary regex must catch that deep path, not just the bare barrel.
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        `import { PrismaClient } from '@tzurot/common-types/services/prisma';`
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(output).toContain('Prisma-backed');
      expect(process.exitCode).toBe(1);
    });

    it('should detect bot-client importing createPrismaClient from the common-types barrel', async () => {
      // createPrismaClient is the Prisma entry point after the singleton eviction;
      // bot-client owning a client would reintroduce the direct-DB boundary break.
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        `import { createPrismaClient } from '@tzurot/common-types';`
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(output).toContain('Prisma-backed');
      expect(process.exitCode).toBe(1);
    });

    it('should detect a Prisma-backed symbol in a MULTI-LINE common-types import', async () => {
      // Regression guard: the old line-by-line scan skipped any line without the
      // `import` keyword, so `createPrismaClient,` on its own line was invisible.
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        [
          'import {',
          '  createLogger,',
          '  createPrismaClient,',
          "} from '@tzurot/common-types';",
        ].join('\n')
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(process.exitCode).toBe(1);
    });

    it('should detect a Prisma-backed module imported via its own services subpath', async () => {
      // SystemSettingsService is importable at its OWN subpath through the
      // package's wildcard exports — the specifier arm must span any
      // common-types subpath, not just services/prisma.
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        `import { SystemSettingsService } from '@tzurot/common-types/services/SystemSettingsService';`
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(output).toContain('Prisma-backed');
      expect(process.exitCode).toBe(1);
    });

    it('should not flag getSystemSettings (plural) despite the banned singular', async () => {
      // getSystemSetting (singular, the ambient Prisma-backed read) is banned;
      // getSystemSettings (plural) is a different symbol. Pins the \b word
      // boundary so a future rewrite to substring matching fails here.
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        `import { getSystemSettings } from '@tzurot/common-types';`
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });

    it('should detect the Prisma namespace imported from the common-types barrel', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        `import type { Prisma } from '@tzurot/common-types';`
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(process.exitCode).toBe(1);
    });

    it('should detect api-gateway importing from bot-client', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('api-gateway/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { something } from '@tzurot/bot-client';
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(process.exitCode).toBe(1);
    });

    it('should report warnings for discord.js in ai-worker', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('ai-worker/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { Client } from 'discord.js';
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('warning');
      // Warnings don't set exit code
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('allowed imports', () => {
    it('should allow common-types imports', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { PersonalityConfig } from '@tzurot/common-types';
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });

    it('should allow a multi-line common-types import with no Prisma-backed symbols', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        [
          'import {',
          '  createLogger,',
          '  PersonalityConfig,',
          '  LoadedPersonality,',
          "} from '@tzurot/common-types';",
        ].join('\n')
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });

    it('should allow a Prisma-named symbol imported from a non-barrel (local) module', async () => {
      // The rule is scoped to `from '@tzurot/common-types'` — a local module that
      // happens to export a same-named symbol must NOT trip it (no false positive).
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
        String(dir).includes('bot-client/src') ? ['test.ts'] : []) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(
        `import { createPrismaClient } from './utils/localShim.js';`
      );

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });

    it('should allow internal service imports', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { formatMessage } from './utils/formatter.js';
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });
  });

  describe('file filtering', () => {
    it('should skip test files', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['test.test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);

      await checkBoundaries();

      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('should skip node_modules', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['node_modules', 'test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockImplementation((path: unknown) => {
        const pathStr = String(path);
        return {
          isDirectory: () => pathStr.includes('node_modules'),
        } as ReturnType<typeof statSync>;
      });
      vi.mocked(readFileSync).mockReturnValue('// clean file');

      await checkBoundaries();

      // Should only read test.ts, not anything in node_modules
      expect(readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('output formatting', () => {
    it('should show tips', async () => {
      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Tips');
      expect(output).toContain('common-types');
    });

    it('should show verbose output when requested', async () => {
      await checkBoundaries({ verbose: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Checking');
    });
  });
});

describe('bot-client Prisma-symbol ban list (drift guard)', () => {
  // Discovery scans common-types SOURCE for modules that import Prisma —
  // type-only imports (`import type { PrismaClient }`) are erased from built
  // JS, so dist cannot be the discovery surface — then imports each discovered
  // module via its package subpath (the built dist, what consumers actually
  // resolve) to enumerate its runtime exports. Loading the generated Prisma
  // client is heavy the first time; done once in beforeAll (with a generous
  // hook timeout) so the import cost lands in setup, not under the 5s
  // per-test budget when every package's vitest runs at once in CI.
  const PRISMA_IMPORT_MARKER = /from\s+['"][^'"]*(?:generated\/prisma|\/prisma\.js)/;
  const COMMON_TYPES_SRC = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../common-types/src'
  );
  // module subpath (e.g. 'services/prisma') → its runtime export names
  const moduleExports = new Map<string, string[]>();

  beforeAll(async () => {
    // node:fs is module-mocked for the scanner tests above; the drift guard
    // walks the real tree.
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const prismaBackedFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        // generated/ IS the Prisma client (plus unrelated codegen output) —
        // it's the thing being guarded against, not a re-export surface.
        if (entry.name === 'generated') {
          continue;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.d.ts') &&
          PRISMA_IMPORT_MARKER.test(fs.readFileSync(full, 'utf-8'))
        ) {
          prismaBackedFiles.push(full);
        }
      }
    };
    walk(COMMON_TYPES_SRC);

    for (const file of prismaBackedFiles) {
      const subpath = relative(COMMON_TYPES_SRC, file).replace(/\.ts$/, '').split(sep).join('/');
      // Resolves through the package's wildcard exports to the built dist. A
      // failure here means common-types needs a rebuild, or a Prisma-backed
      // module landed in a directory the exports map doesn't cover.
      const mod = (await import(/* @vite-ignore */ `@tzurot/common-types/${subpath}`)) as object;
      moduleExports.set(subpath, Object.keys(mod));
    }
  }, 30_000);

  it('discovery finds the known Prisma-backed modules (scanner self-check)', () => {
    // If the walk or the marker regex breaks, discovery returns empty and the
    // missing-entry assertion below passes vacuously — pin the known modules
    // so a dead scanner fails loudly instead.
    expect([...moduleExports.keys()]).toEqual(
      expect.arrayContaining(['services/prisma', 'services/SystemSettingsService'])
    );
  });

  it('every runtime export of every Prisma-backed module is in the ban list (missing-entry direction)', () => {
    const banned: readonly string[] = BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS;
    for (const [subpath, names] of moduleExports) {
      for (const name of names) {
        expect(
          banned.includes(name),
          `"${name}" (exported from @tzurot/common-types/${subpath}, a Prisma-importing module) is missing from BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS — add it so bot-client is banned from importing it, or, if it is genuinely safe for bot-client, add an explicit allowlist to this drift guard with the justification.`
        ).toBe(true);
      }
    }
  });

  it('every banned symbol is a real export of a Prisma-backed module (stale-entry direction)', () => {
    const union = new Set([...moduleExports.values()].flat());
    for (const symbol of BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS) {
      expect(
        union.has(symbol),
        `"${symbol}" is in check-boundaries' bot-client ban list but no Prisma-backed @tzurot/common-types module exports it — prune it from BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS (the symbol was renamed, deleted, or moved elsewhere).`
      ).toBe(true);
    }
  });
});

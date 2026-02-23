/**
 * Tests for Dead File Finder
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExecFileSync = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

describe('find-dead-files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('parseKnipOutput', () => {
    it('should extract file paths from knip output', async () => {
      const { parseKnipOutput } = await import('./find-dead-files.js');

      const output = [
        'packages/common-types/src/types/test/fixtures.ts                            ',
        'services/bot-client/src/utils/safeInteraction.ts                             ',
        '',
        ' WARN  Unsupported engine',
        '',
      ].join('\n');

      const result = parseKnipOutput(output);
      expect(result).toEqual([
        'packages/common-types/src/types/test/fixtures.ts',
        'services/bot-client/src/utils/safeInteraction.ts',
      ]);
    });

    it('should handle empty output', async () => {
      const { parseKnipOutput } = await import('./find-dead-files.js');
      expect(parseKnipOutput('')).toEqual([]);
    });

    it('should handle .tsx files', async () => {
      const { parseKnipOutput } = await import('./find-dead-files.js');
      const output = 'services/bot-client/src/components/Foo.tsx  ';
      expect(parseKnipOutput(output)).toEqual(['services/bot-client/src/components/Foo.tsx']);
    });

    it('should filter out non-file lines', async () => {
      const { parseKnipOutput } = await import('./find-dead-files.js');

      const output = [
        '> tzurot@3.0.0 knip',
        '> knip --production --include files',
        '',
        'services/bot-client/src/utils/foo.ts  ',
        ' WARN  something',
      ].join('\n');

      expect(parseKnipOutput(output)).toEqual(['services/bot-client/src/utils/foo.ts']);
    });
  });

  describe('filterFalsePositives', () => {
    it('should filter test utility directories', async () => {
      const { filterFalsePositives } = await import('./find-dead-files.js');

      const files = [
        'services/ai-worker/src/test/mocks/index.ts',
        'services/bot-client/src/utils/safeInteraction.ts',
      ];

      expect(filterFalsePositives(files)).toEqual([
        'services/bot-client/src/utils/safeInteraction.ts',
      ]);
    });

    it('should filter test-utils files', async () => {
      const { filterFalsePositives } = await import('./find-dead-files.js');
      expect(filterFalsePositives(['services/api-gateway/src/test-utils.ts'])).toEqual([]);
    });

    it('should filter mock files', async () => {
      const { filterFalsePositives } = await import('./find-dead-files.js');
      expect(filterFalsePositives(['services/ai-worker/src/test/LLM.mock.ts'])).toEqual([]);
    });

    it('should filter fixture files', async () => {
      const { filterFalsePositives } = await import('./find-dead-files.js');
      expect(filterFalsePositives(['packages/common-types/src/types/test/fixtures.ts'])).toEqual(
        []
      );
    });

    it('should filter command submodules', async () => {
      const { filterFalsePositives } = await import('./find-dead-files.js');

      const files = [
        'services/bot-client/src/commands/admin/cleanup.ts',
        'services/bot-client/src/commands/character/api.ts',
        'services/bot-client/src/utils/dashboard/DashboardBuilder.ts', // NOT a command submodule
      ];

      expect(filterFalsePositives(files)).toEqual([
        'services/bot-client/src/utils/dashboard/DashboardBuilder.ts',
      ]);
    });

    it('should filter scripts directory', async () => {
      const { filterFalsePositives } = await import('./find-dead-files.js');
      expect(filterFalsePositives(['services/bot-client/scripts/deploy-commands.ts'])).toEqual([]);
    });

    it('should filter vitest config files', async () => {
      const { filterFalsePositives } = await import('./find-dead-files.js');
      expect(filterFalsePositives(['vitest.e2e.config.ts'])).toEqual([]);
    });

    it('should keep genuinely suspicious files', async () => {
      const { filterFalsePositives } = await import('./find-dead-files.js');

      const files = [
        'services/bot-client/src/utils/safeInteraction.ts',
        'services/bot-client/src/memory/ConversationManager.ts',
      ];

      expect(filterFalsePositives(files)).toEqual(files);
    });
  });

  describe('hasNonTestImporters', () => {
    it('should return true when grep finds non-test importers', async () => {
      const { hasNonTestImporters } = await import('./find-dead-files.js');

      mockExecFileSync.mockReturnValue('services/bot-client/src/index.ts\n');

      const result = hasNonTestImporters('services/bot-client/src/utils/foo.ts', [
        'services/',
        'packages/',
      ]);

      expect(result).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'grep',
        expect.arrayContaining(['/foo\\.js[\'"]', 'services/', 'packages/']),
        expect.anything()
      );
    });

    it('should return false when grep finds no matches', async () => {
      const { hasNonTestImporters } = await import('./find-dead-files.js');

      mockExecFileSync.mockImplementation(() => {
        const error = new Error('No matches') as Error & { status: number };
        error.status = 1;
        throw error;
      });

      const result = hasNonTestImporters('services/bot-client/src/utils/dead.ts', [
        'services/',
        'packages/',
      ]);

      expect(result).toBe(false);
    });

    it('should exclude the file itself from results', async () => {
      const { hasNonTestImporters } = await import('./find-dead-files.js');

      // grep returns only the file itself
      mockExecFileSync.mockReturnValue('services/bot-client/src/utils/foo.ts\n');

      const result = hasNonTestImporters('services/bot-client/src/utils/foo.ts', [
        'services/',
        'packages/',
      ]);

      expect(result).toBe(false);
    });

    it('should handle .tsx files correctly', async () => {
      const { hasNonTestImporters } = await import('./find-dead-files.js');

      mockExecFileSync.mockReturnValue('services/bot-client/src/App.ts\n');

      const result = hasNonTestImporters('services/bot-client/src/components/Foo.tsx', [
        'services/',
        'packages/',
      ]);

      expect(result).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'grep',
        expect.arrayContaining(['/Foo\\.js[\'"]', 'services/', 'packages/']),
        expect.anything()
      );
    });

    it('should return true when other files import it (excluding self)', async () => {
      const { hasNonTestImporters } = await import('./find-dead-files.js');

      mockExecFileSync.mockReturnValue(
        'services/bot-client/src/utils/foo.ts\nservices/bot-client/src/index.ts\n'
      );

      const result = hasNonTestImporters('services/bot-client/src/utils/foo.ts', [
        'services/',
        'packages/',
      ]);

      expect(result).toBe(true);
    });
  });

  describe('findDeadFiles', () => {
    it('should return empty when knip finds no unused files', async () => {
      const { findDeadFiles } = await import('./find-dead-files.js');

      mockExecFileSync.mockReturnValueOnce(''); // knip output

      const result = findDeadFiles();

      expect(result.deadFiles).toEqual([]);
      expect(result.totalKnipHits).toBe(0);
    });

    it('should filter false positives and verify candidates', async () => {
      const { findDeadFiles } = await import('./find-dead-files.js');

      // First call: knip output
      mockExecFileSync.mockImplementationOnce(() => {
        const error = new Error('knip found issues') as Error & { stdout: string; stderr: string };
        error.stdout = [
          'services/bot-client/src/commands/admin/cleanup.ts  ', // false positive
          'services/bot-client/src/utils/deadCode.ts          ', // candidate
        ].join('\n');
        error.stderr = '';
        throw error;
      });

      // Second call: grep for deadCode importers (no matches = dead)
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('No matches');
      });

      const result = findDeadFiles();

      expect(result.totalKnipHits).toBe(2);
      expect(result.filteredCount).toBe(1); // command submodule filtered
      expect(result.deadFiles).toEqual(['services/bot-client/src/utils/deadCode.ts']);
    });
  });

  describe('runFindDeadFiles', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      process.exitCode = undefined;
    });

    it('should print success when no dead files found', async () => {
      const { runFindDeadFiles } = await import('./find-dead-files.js');

      mockExecFileSync.mockReturnValueOnce(''); // knip output

      runFindDeadFiles();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No unused files detected');
      expect(process.exitCode).toBeUndefined();
    });

    it('should set exitCode 1 when dead files found', async () => {
      const { runFindDeadFiles } = await import('./find-dead-files.js');

      // knip output with a candidate
      mockExecFileSync.mockImplementationOnce(() => {
        const error = new Error('knip') as Error & { stdout: string; stderr: string };
        error.stdout = 'services/bot-client/src/utils/dead.ts  ';
        error.stderr = '';
        throw error;
      });

      // grep: no importers
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('No matches');
      });

      runFindDeadFiles();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('potentially dead file');
      expect(output).toContain('dead.ts');
      expect(process.exitCode).toBe(1);
    });
  });
});

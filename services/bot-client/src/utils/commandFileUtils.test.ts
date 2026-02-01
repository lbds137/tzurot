/**
 * Tests for commandFileUtils
 *
 * Tests the "Index-or-Root" pattern for command file discovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCommandFiles } from './commandFileUtils.js';

// Mock filesystem operations
vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readdirSync, statSync } from 'node:fs';

describe('getCommandFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Index-or-Root pattern', () => {
    it('should include root-level .ts files', () => {
      vi.mocked(readdirSync).mockReturnValue(['ping.ts', 'help.ts'] as unknown as ReturnType<
        typeof readdirSync
      >);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);

      const files = getCommandFiles('/commands');

      expect(files).toContain('/commands/ping.ts');
      expect(files).toContain('/commands/help.ts');
      expect(files).toHaveLength(2);
    });

    it('should include root-level .js files', () => {
      vi.mocked(readdirSync).mockReturnValue(['ping.js'] as unknown as ReturnType<
        typeof readdirSync
      >);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);

      const files = getCommandFiles('/commands');

      expect(files).toContain('/commands/ping.js');
      expect(files).toHaveLength(1);
    });

    it('should exclude .d.ts files', () => {
      vi.mocked(readdirSync).mockReturnValue([
        'ping.ts',
        'ping.d.ts',
        'types.d.ts',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);

      const files = getCommandFiles('/commands');

      expect(files).toContain('/commands/ping.ts');
      expect(files).not.toContain('/commands/ping.d.ts');
      expect(files).not.toContain('/commands/types.d.ts');
      expect(files).toHaveLength(1);
    });

    it('should include index.ts in subdirectories', () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce(['preset'] as unknown as ReturnType<typeof readdirSync>) // Root level
        .mockReturnValueOnce(['index.ts', 'list.ts', 'api.ts'] as unknown as ReturnType<
          typeof readdirSync
        >); // preset/

      vi.mocked(statSync).mockImplementation((path: unknown) => {
        const pathStr = String(path);
        return {
          isDirectory: () => pathStr.endsWith('preset'),
        } as ReturnType<typeof statSync>;
      });

      const files = getCommandFiles('/commands');

      expect(files).toContain('/commands/preset/index.ts');
      expect(files).not.toContain('/commands/preset/list.ts');
      expect(files).not.toContain('/commands/preset/api.ts');
      expect(files).toHaveLength(1);
    });

    it('should include index.js in subdirectories (production)', () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce(['preset'] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce(['index.js', 'list.js', 'api.js'] as unknown as ReturnType<
          typeof readdirSync
        >);

      vi.mocked(statSync).mockImplementation((path: unknown) => {
        const pathStr = String(path);
        return {
          isDirectory: () => pathStr.endsWith('preset'),
        } as ReturnType<typeof statSync>;
      });

      const files = getCommandFiles('/commands');

      expect(files).toContain('/commands/preset/index.js');
      expect(files).not.toContain('/commands/preset/list.js');
      expect(files).not.toContain('/commands/preset/api.js');
      expect(files).toHaveLength(1);
    });

    it('should skip non-index files in subdirectories (helpers, subcommands)', () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce(['admin'] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([
          'index.ts',
          'ping.ts',
          'cleanup.ts',
          'db-sync.ts',
        ] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((path: unknown) => {
        const pathStr = String(path);
        return {
          isDirectory: () => pathStr.endsWith('admin'),
        } as ReturnType<typeof statSync>;
      });

      const files = getCommandFiles('/commands');

      // Only index.ts should be included
      expect(files).toContain('/commands/admin/index.ts');
      expect(files).not.toContain('/commands/admin/ping.ts');
      expect(files).not.toContain('/commands/admin/cleanup.ts');
      expect(files).not.toContain('/commands/admin/db-sync.ts');
      expect(files).toHaveLength(1);
    });

    it('should handle nested subdirectories (only index at each level)', () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce(['preset'] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce(['index.ts', 'global'] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce(['edit.ts', 'delete.ts'] as unknown as ReturnType<typeof readdirSync>); // No index.ts here

      vi.mocked(statSync).mockImplementation((path: unknown) => {
        const pathStr = String(path);
        return {
          isDirectory: () => pathStr.endsWith('preset') || pathStr.endsWith('global'),
        } as ReturnType<typeof statSync>;
      });

      const files = getCommandFiles('/commands');

      // Only preset/index.ts should be included
      // global/ has no index.ts so nothing from there
      expect(files).toContain('/commands/preset/index.ts');
      expect(files).not.toContain('/commands/preset/global/edit.ts');
      expect(files).not.toContain('/commands/preset/global/delete.ts');
      expect(files).toHaveLength(1);
    });

    it('should handle mixed root files and subdirectories', () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce(['ping.ts', 'preset', 'help.ts'] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce(['index.ts', 'list.ts'] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((path: unknown) => {
        const pathStr = String(path);
        return {
          isDirectory: () => pathStr.endsWith('preset'),
        } as ReturnType<typeof statSync>;
      });

      const files = getCommandFiles('/commands');

      expect(files).toContain('/commands/ping.ts');
      expect(files).toContain('/commands/help.ts');
      expect(files).toContain('/commands/preset/index.ts');
      expect(files).not.toContain('/commands/preset/list.ts');
      expect(files).toHaveLength(3);
    });

    it('should return empty array for empty directory', () => {
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      const files = getCommandFiles('/commands');

      expect(files).toHaveLength(0);
    });

    it('should ignore non-.ts/.js files', () => {
      vi.mocked(readdirSync).mockReturnValue([
        'ping.ts',
        'README.md',
        'config.json',
        '.gitkeep',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);

      const files = getCommandFiles('/commands');

      expect(files).toContain('/commands/ping.ts');
      expect(files).not.toContain('/commands/README.md');
      expect(files).not.toContain('/commands/config.json');
      expect(files).not.toContain('/commands/.gitkeep');
      expect(files).toHaveLength(1);
    });
  });
});

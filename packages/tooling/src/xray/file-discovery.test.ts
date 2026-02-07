import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readdirSync, statSync } from 'node:fs';
import { discoverFiles } from './file-discovery.js';

describe('discoverFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty directories
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
      typeof statSync
    >);
  });

  it('should return empty array when no packages found', () => {
    const result = discoverFiles('/root');
    expect(result).toEqual([]);
  });

  it('should discover packages in services/ and packages/ dirs', () => {
    vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
      const d = String(dir);
      if (d === '/root/services') return ['bot-client', 'ai-worker'];
      if (d === '/root/packages') return ['common-types'];
      if (d.endsWith('/src')) return ['index.ts'];
      return [];
    }) as typeof readdirSync);

    vi.mocked(statSync).mockImplementation(((path: unknown) => {
      const p = String(path);
      if (p.endsWith('/src')) return { isDirectory: () => true } as ReturnType<typeof statSync>;
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    }) as typeof statSync);

    const result = discoverFiles('/root');

    const names = result.map(r => r.name);
    expect(names).toContain('bot-client');
    expect(names).toContain('ai-worker');
    expect(names).toContain('common-types');
  });

  it('should filter by package names', () => {
    vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
      const d = String(dir);
      if (d === '/root/services') return ['bot-client', 'ai-worker'];
      if (d === '/root/packages') return ['common-types'];
      if (d.endsWith('/src')) return ['index.ts'];
      return [];
    }) as typeof readdirSync);

    vi.mocked(statSync).mockImplementation(((path: unknown) => {
      const p = String(path);
      if (p.endsWith('/src')) return { isDirectory: () => true } as ReturnType<typeof statSync>;
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    }) as typeof statSync);

    const result = discoverFiles('/root', { packages: ['bot-client'] });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bot-client');
  });

  it('should exclude test files by default', () => {
    vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
      const d = String(dir);
      if (d === '/root/services') return ['bot-client'];
      if (d === '/root/packages') return [];
      if (d.endsWith('/src')) return ['index.ts', 'index.test.ts', 'helper.d.ts'];
      return [];
    }) as typeof readdirSync);

    vi.mocked(statSync).mockImplementation(((path: unknown) => {
      const p = String(path);
      if (p.endsWith('/src')) return { isDirectory: () => true } as ReturnType<typeof statSync>;
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    }) as typeof statSync);

    const result = discoverFiles('/root');

    expect(result).toHaveLength(1);
    expect(result[0].files).toHaveLength(1);
    expect(result[0].files[0]).toContain('index.ts');
  });

  it('should include test files when option set', () => {
    vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
      const d = String(dir);
      if (d === '/root/services') return ['bot-client'];
      if (d === '/root/packages') return [];
      if (d.endsWith('/src')) return ['index.ts', 'index.test.ts'];
      return [];
    }) as typeof readdirSync);

    vi.mocked(statSync).mockImplementation(((path: unknown) => {
      const p = String(path);
      if (p.endsWith('/src')) return { isDirectory: () => true } as ReturnType<typeof statSync>;
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    }) as typeof statSync);

    const result = discoverFiles('/root', { includeTests: true });

    expect(result).toHaveLength(1);
    expect(result[0].files).toHaveLength(2);
  });

  it('should skip node_modules, dist, and .turbo directories', () => {
    vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
      const d = String(dir);
      if (d === '/root/services') return ['bot-client'];
      if (d === '/root/packages') return [];
      if (d.endsWith('/src')) return ['node_modules', 'dist', '.turbo', 'utils', 'index.ts'];
      if (d.endsWith('/utils')) return ['helper.ts'];
      return [];
    }) as typeof readdirSync);

    vi.mocked(statSync).mockImplementation(((path: unknown) => {
      const p = String(path);
      if (
        p.endsWith('/src') ||
        p.endsWith('/node_modules') ||
        p.endsWith('/dist') ||
        p.endsWith('/.turbo') ||
        p.endsWith('/utils')
      ) {
        return { isDirectory: () => true } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    }) as typeof statSync);

    const result = discoverFiles('/root');

    expect(result).toHaveLength(1);
    // Should have index.ts and utils/helper.ts, but NOT anything from skipped dirs
    expect(result[0].files).toHaveLength(2);
  });

  it('should skip generated/ directories', () => {
    vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
      const d = String(dir);
      if (d === '/root/services') return [];
      if (d === '/root/packages') return ['common-types'];
      if (d.endsWith('/src')) return ['generated', 'utils', 'index.ts'];
      if (d.endsWith('/generated')) return ['client.ts', 'models.ts'];
      if (d.endsWith('/utils')) return ['helper.ts'];
      return [];
    }) as typeof readdirSync);

    vi.mocked(statSync).mockImplementation(((path: unknown) => {
      const p = String(path);
      if (p.endsWith('/src') || p.endsWith('/generated') || p.endsWith('/utils')) {
        return { isDirectory: () => true } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    }) as typeof statSync);

    const result = discoverFiles('/root');

    expect(result).toHaveLength(1);
    // Should have index.ts and utils/helper.ts, but NOT generated/client.ts or generated/models.ts
    expect(result[0].files).toHaveLength(2);
    const fileNames = result[0].files.map(f => f.split('/').pop());
    expect(fileNames).toContain('index.ts');
    expect(fileNames).toContain('helper.ts');
    expect(fileNames).not.toContain('client.ts');
    expect(fileNames).not.toContain('models.ts');
  });
});

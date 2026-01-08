import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    yellow: (s: string) => s,
    dim: (s: string) => s,
  },
}));

describe('createSafeMigration', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should be a placeholder function', async () => {
    const { createSafeMigration } = await import('./create-safe-migration.js');
    await createSafeMigration();

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('not yet migrated');
    expect(output).toContain('prisma migrate dev');
  });
});

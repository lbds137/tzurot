import { describe, it, expect } from 'vitest';

describe('data module exports', () => {
  it('should export backupPersonalities', async () => {
    const module = await import('./backup.js');
    expect(typeof module.backupPersonalities).toBe('function');
  });

  it('should export bulkImport', async () => {
    const module = await import('./bulk-import.js');
    expect(typeof module.bulkImport).toBe('function');
  });

  it('should export importPersonality', async () => {
    const module = await import('./import-personality.js');
    expect(typeof module.importPersonality).toBe('function');
  });
});

describe('stub implementations', () => {
  it('backupPersonalities should be a placeholder', async () => {
    const { backupPersonalities } = await import('./backup.js');
    // Should not throw
    await expect(backupPersonalities()).resolves.toBeUndefined();
  });

  it('bulkImport should be a placeholder', async () => {
    const { bulkImport } = await import('./bulk-import.js');
    await expect(bulkImport()).resolves.toBeUndefined();
  });

  it('importPersonality should be a placeholder', async () => {
    const { importPersonality } = await import('./import-personality.js');
    await expect(importPersonality('test')).resolves.toBeUndefined();
  });
});

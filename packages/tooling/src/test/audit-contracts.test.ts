/**
 * Tests for audit-contracts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs operations
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

describe('audit-contracts', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process.cwd
    vi.spyOn(process, 'cwd').mockReturnValue('/mock/project');

    // Reset process.exitCode
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('auditContracts', () => {
    it('should export auditContracts function', async () => {
      const module = await import('./audit-contracts.js');
      expect(typeof module.auditContracts).toBe('function');
    });

    it('should pass when no new gaps are found', async () => {
      // Setup: schemas directory exists with one schema
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return true;
        if (path.includes('e2e')) return false;
        if (path.includes('baseline')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return ['test.ts'];
        if (path.includes('types')) return [];
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('test.ts')) {
          return 'export const TestSchema = z.object({});';
        }
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: ['test:TestSchema'],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        return '';
      });

      const { auditContracts } = await import('./audit-contracts.js');
      const result = auditContracts();

      expect(result).toBe(true);
      expect(process.exitCode).toBeUndefined();
    });

    it('should fail when new gaps are found', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return true;
        if (path.includes('e2e')) return false;
        if (path.includes('baseline')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return ['test.ts'];
        if (path.includes('types')) return [];
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('test.ts')) {
          return 'export const TestSchema = z.object({});';
        }
        if (path.includes('baseline')) {
          // Empty baseline - schema is a NEW gap
          return JSON.stringify({
            knownGaps: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        return '';
      });

      const { auditContracts } = await import('./audit-contracts.js');
      const result = auditContracts();

      // Returns false on failure; caller handles exit code
      expect(result).toBe(false);
    });

    it('should update baseline when --update flag is passed', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return true;
        if (path.includes('e2e')) return false;
        if (path.includes('baseline')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return ['test.ts'];
        if (path.includes('types')) return [];
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('test.ts')) {
          return 'export const TestSchema = z.object({});';
        }
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        return '';
      });

      const { auditContracts } = await import('./audit-contracts.js');
      const result = auditContracts({ update: true });

      expect(result).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalled();

      // Verify baseline was written with updated gaps
      const writeCall = mockWriteFileSync.mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1] as string);
      expect(writtenContent.knownGaps).toContain('test:TestSchema');
      expect(writtenContent.version).toBe(2);
    });

    it('should fail in strict mode with any gaps', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return true;
        if (path.includes('e2e')) return false;
        if (path.includes('baseline')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return ['test.ts'];
        if (path.includes('types')) return [];
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('test.ts')) {
          return 'export const TestSchema = z.object({});';
        }
        if (path.includes('baseline')) {
          // Gap is in baseline (known), but strict mode still fails
          return JSON.stringify({
            knownGaps: ['test:TestSchema'],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        return '';
      });

      const { auditContracts } = await import('./audit-contracts.js');
      const result = auditContracts({ strict: true });

      // Returns false on failure; caller handles exit code
      expect(result).toBe(false);
    });

    it('should handle missing schemas directory gracefully', async () => {
      mockExistsSync.mockReturnValue(false);

      const { auditContracts } = await import('./audit-contracts.js');
      const result = auditContracts();

      // Should still pass (no schemas = no gaps)
      expect(result).toBe(true);
    });

    it('should create default baseline when file does not exist', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return true;
        if (path.includes('baseline')) return false; // No baseline file
        return false;
      });

      mockReaddirSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return ['test.ts'];
        if (path.includes('types')) return [];
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('test.ts')) {
          return 'export const TestSchema = z.object({});';
        }
        return '';
      });

      const { auditContracts } = await import('./audit-contracts.js');
      // New schema with no baseline = new gap = fail
      const result = auditContracts();

      expect(result).toBe(false);
    });
  });

  describe('collectContractAuditData', () => {
    it('should export collectContractAuditData function', async () => {
      const module = await import('./audit-contracts.js');
      expect(typeof module.collectContractAuditData).toBe('function');
    });

    it('should return correct coverage statistics', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return true;
        if (path.includes('e2e')) return false;
        if (path.includes('baseline')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation((path: string) => {
        if (path.includes('schemas/api')) return ['test.ts'];
        if (path.includes('types')) return ['test.schema.test.ts'];
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith('test.ts') && !path.includes('schema.test')) {
          return 'export const TestSchema = z.object({});\nexport const OtherSchema = z.object({});';
        }
        if (path.includes('schema.test.ts')) {
          return `
            import { TestSchema } from '../schemas/api/test';
            TestSchema.safeParse({});
          `;
        }
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: ['test:OtherSchema'],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        return '';
      });

      const { collectContractAuditData } = await import('./audit-contracts.js');
      const result = collectContractAuditData('/mock/project');

      expect(result.allSchemas).toHaveLength(2);
      expect(result.coverage).toBe(50); // 1 of 2 tested
    });
  });
});

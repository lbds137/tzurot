/**
 * Tests for audit-unified
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs operations
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  statSync: mockStatSync,
}));

describe('audit-unified', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process.cwd
    vi.spyOn(process, 'cwd').mockReturnValue('/mock/project');

    // Reset process.exitCode
    process.exitCode = undefined;

    // Default stat mock - files are files, not directories
    mockStatSync.mockImplementation(() => ({
      isDirectory: () => false,
      isFile: () => true,
    }));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  /**
   * Helper to setup mocks for a clean baseline scenario (no gaps)
   */
  function setupCleanBaseline(): void {
    mockExistsSync.mockImplementation((path: string) => {
      if (path.includes('test-coverage-baseline')) return true;
      if (path.includes('service-integration-baseline')) return true;
      if (path.includes('contract-coverage-baseline')) return true;
      if (path.includes('common-types/src/schemas/api')) return true;
      if (path.includes('common-types/src/types')) return true;
      if (path.includes('ai-worker/src')) return true;
      if (path.includes('api-gateway/src')) return true;
      if (path.includes('bot-client/src')) return true;
      if (path.includes('common-types/src')) return true;
      if (path.includes('tests/e2e')) return false;
      return false;
    });

    mockReaddirSync.mockImplementation(() => []);

    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('test-coverage-baseline')) {
        return JSON.stringify({
          version: 1,
          lastUpdated: '2024-01-01',
          services: { knownGaps: [], exempt: [] },
          contracts: { knownGaps: [] },
          notes: {
            serviceExemptionCriteria: 'Services without direct Prisma calls',
            contractExemptionCriteria: 'None',
          },
        });
      }
      if (path.includes('service-integration-baseline')) {
        return JSON.stringify({
          knownGaps: [],
          exempt: [],
          lastUpdated: '2024-01-01',
          version: 1,
        });
      }
      if (path.includes('contract-coverage-baseline')) {
        return JSON.stringify({
          knownGaps: [],
          lastUpdated: '2024-01-01',
          version: 1,
        });
      }
      return '';
    });
  }

  describe('auditUnified', () => {
    it('should export auditUnified function', async () => {
      const module = await import('./audit-unified.js');
      expect(typeof module.auditUnified).toBe('function');
    });

    it('should pass when no gaps exist', async () => {
      setupCleanBaseline();

      const { auditUnified } = await import('./audit-unified.js');
      const result = auditUnified();

      expect(result).toBe(true);
    });

    it('should pass when all gaps are known in baseline', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('.int.test.ts')) return false;
        if (path.includes('.int.test.ts')) return false;
        if (path.includes('test-coverage-baseline')) return true;
        if (path.includes('service-integration-baseline')) return true;
        if (path.includes('contract-coverage-baseline')) return true;
        if (path.includes('common-types/src/schemas/api')) return true;
        if (path.includes('common-types/src/types')) return true;
        if (path.includes('ai-worker/src')) return true;
        if (path.includes('api-gateway/src')) return true;
        if (path.includes('bot-client/src')) return true;
        if (path.includes('common-types/src')) return true;
        if (path.includes('tests/e2e')) return false;
        return false;
      });

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src')) return ['KnownService.ts'];
        if (dir.includes('common-types/src/schemas/api')) return ['test-schema.ts'];
        if (dir.includes('common-types/src/types')) return [];
        return [];
      });

      mockStatSync.mockImplementation((path: string) => ({
        isDirectory: () => !path.includes('.ts'),
        isFile: () => path.includes('.ts'),
      }));

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('test-coverage-baseline')) {
          return JSON.stringify({
            version: 1,
            lastUpdated: '2024-01-01',
            services: {
              knownGaps: ['services/ai-worker/src/KnownService.ts'],
              exempt: [],
            },
            contracts: {
              knownGaps: ['test-schema:TestSchema'],
            },
            notes: {
              serviceExemptionCriteria: 'Services without direct Prisma calls',
              contractExemptionCriteria: 'None',
            },
          });
        }
        if (path.includes('service-integration-baseline')) {
          return JSON.stringify({
            knownGaps: ['services/ai-worker/src/KnownService.ts'],
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('contract-coverage-baseline')) {
          return JSON.stringify({
            knownGaps: ['test-schema:TestSchema'],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('KnownService.ts')) {
          return `export class KnownService { doSomething() { return true; } }`;
        }
        if (path.includes('test-schema.ts')) {
          return 'export const TestSchema = z.object({ id: z.string() });';
        }
        return '';
      });

      const { auditUnified } = await import('./audit-unified.js');
      const result = auditUnified();

      // Should pass because gaps are known in baseline
      expect(result).toBe(true);
    });

    it('should fail when new service gaps are found', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('.int.test.ts')) return false;
        if (path.includes('.int.test.ts')) return false;
        if (path.includes('test-coverage-baseline')) return true;
        if (path.includes('service-integration-baseline')) return true;
        if (path.includes('contract-coverage-baseline')) return true;
        if (path.includes('common-types/src/schemas/api')) return true;
        if (path.includes('common-types/src/types')) return true;
        if (path.includes('ai-worker/src')) return true;
        if (path.includes('api-gateway/src')) return true;
        if (path.includes('bot-client/src')) return true;
        if (path.includes('common-types/src')) return true;
        if (path.includes('tests/e2e')) return false;
        return false;
      });

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src')) return ['NewService.ts'];
        if (dir.includes('common-types/src/schemas/api')) return [];
        if (dir.includes('common-types/src/types')) return [];
        return [];
      });

      mockStatSync.mockImplementation((path: string) => ({
        isDirectory: () => !path.includes('.ts'),
        isFile: () => path.includes('.ts'),
      }));

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('test-coverage-baseline')) {
          return JSON.stringify({
            version: 1,
            lastUpdated: '2024-01-01',
            services: { knownGaps: [], exempt: [] }, // NewService is NOT in baseline
            contracts: { knownGaps: [] },
            notes: {
              serviceExemptionCriteria: 'Services without direct Prisma calls',
              contractExemptionCriteria: 'None',
            },
          });
        }
        if (path.includes('service-integration-baseline')) {
          return JSON.stringify({
            knownGaps: [],
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('contract-coverage-baseline')) {
          return JSON.stringify({
            knownGaps: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('NewService.ts')) {
          return `export class NewService {
  process() {
    return true;
  }
}`;
        }
        return '';
      });

      const { auditUnified } = await import('./audit-unified.js');
      const result = auditUnified();

      expect(result).toBe(false);
    });

    it('should update baseline when --update flag is passed', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('.int.test.ts')) return false;
        if (path.includes('.int.test.ts')) return false;
        if (path.includes('test-coverage-baseline')) return true;
        if (path.includes('service-integration-baseline')) return true;
        if (path.includes('contract-coverage-baseline')) return true;
        if (path.includes('common-types/src/schemas/api')) return true;
        if (path.includes('common-types/src/types')) return true;
        if (path.includes('ai-worker/src')) return true;
        if (path.includes('api-gateway/src')) return true;
        if (path.includes('bot-client/src')) return true;
        if (path.includes('common-types/src')) return true;
        if (path.includes('tests/e2e')) return false;
        return false;
      });

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src')) return ['NewService.ts'];
        if (dir.includes('common-types/src/schemas/api')) return [];
        if (dir.includes('common-types/src/types')) return [];
        return [];
      });

      mockStatSync.mockImplementation((path: string) => ({
        isDirectory: () => !path.includes('.ts'),
        isFile: () => path.includes('.ts'),
      }));

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('test-coverage-baseline')) {
          return JSON.stringify({
            version: 1,
            lastUpdated: '2024-01-01',
            services: { knownGaps: [], exempt: [] },
            contracts: { knownGaps: [] },
            notes: {
              serviceExemptionCriteria: 'Services without direct Prisma calls',
              contractExemptionCriteria: 'None',
            },
          });
        }
        if (path.includes('service-integration-baseline')) {
          return JSON.stringify({
            knownGaps: [],
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('contract-coverage-baseline')) {
          return JSON.stringify({
            knownGaps: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('NewService.ts')) {
          return 'export class NewService { doSomething() {} }';
        }
        return '';
      });

      const { auditUnified } = await import('./audit-unified.js');
      const result = auditUnified({ update: true });

      expect(result).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalled();

      // Verify baseline was written with updated version
      const writeCall = mockWriteFileSync.mock.calls[0];
      expect(writeCall[0]).toContain('test-coverage-baseline.json');
      const writtenContent = JSON.parse(writeCall[1] as string);
      expect(writtenContent.version).toBe(2);
    });

    // Note: Strict mode functionality is tested in audit-services.test.ts.
    // The unified audit passes options through to the underlying audits,
    // so we only need to verify the option is passed correctly via CLI tests.

    it('should only audit services when --category=services', async () => {
      setupCleanBaseline();

      const { auditUnified } = await import('./audit-unified.js');
      const result = auditUnified({ category: 'services' });

      expect(result).toBe(true);

      // Should only show service section in output
      const logs = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]);
      expect(logs.some((l: unknown) => typeof l === 'string' && l.includes('SERVICE TESTS'))).toBe(
        true
      );
      // Contract section should not appear
      expect(logs.some((l: unknown) => typeof l === 'string' && l.includes('CONTRACT TESTS'))).toBe(
        false
      );
    });

    it('should only audit contracts when --category=contracts', async () => {
      setupCleanBaseline();

      const { auditUnified } = await import('./audit-unified.js');
      const result = auditUnified({ category: 'contracts' });

      expect(result).toBe(true);

      // Should only show contract section in output
      const logs = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]);
      expect(logs.some((l: unknown) => typeof l === 'string' && l.includes('CONTRACT TESTS'))).toBe(
        true
      );
      // Service section should not appear
      expect(logs.some((l: unknown) => typeof l === 'string' && l.includes('SERVICE TESTS'))).toBe(
        false
      );
    });
  });

  describe('loadUnifiedBaseline', () => {
    it('should export loadUnifiedBaseline function', async () => {
      const module = await import('./audit-unified.js');
      expect(typeof module.loadUnifiedBaseline).toBe('function');
    });

    it('should load existing unified baseline', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('test-coverage-baseline');
      });

      mockReadFileSync.mockImplementation(() => {
        return JSON.stringify({
          version: 5,
          lastUpdated: '2024-06-15',
          services: { knownGaps: ['svc1'], exempt: ['svc2'] },
          contracts: { knownGaps: ['schema1'] },
          notes: {
            serviceExemptionCriteria: 'Test',
            contractExemptionCriteria: 'None',
          },
        });
      });

      const { loadUnifiedBaseline } = await import('./audit-unified.js');
      const baseline = loadUnifiedBaseline('/mock/project');

      expect(baseline.version).toBe(5);
      expect(baseline.services.knownGaps).toContain('svc1');
      expect(baseline.services.exempt).toContain('svc2');
      expect(baseline.contracts.knownGaps).toContain('schema1');
    });
  });

  describe('migrateFromLegacyBaselines', () => {
    it('should export migrateFromLegacyBaselines function', async () => {
      const module = await import('./audit-unified.js');
      expect(typeof module.migrateFromLegacyBaselines).toBe('function');
    });

    it('should migrate from legacy baselines', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return (
          path.includes('service-integration-baseline') ||
          path.includes('contract-coverage-baseline')
        );
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('service-integration-baseline')) {
          return JSON.stringify({
            knownGaps: ['svc-gap-1'],
            exempt: ['svc-exempt-1'],
            notes: { exemptionCriteria: 'Legacy exemption reason' },
          });
        }
        if (path.includes('contract-coverage-baseline')) {
          return JSON.stringify({
            knownGaps: ['contract-gap-1'],
          });
        }
        return '';
      });

      const { migrateFromLegacyBaselines } = await import('./audit-unified.js');
      const baseline = migrateFromLegacyBaselines('/mock/project');

      expect(baseline.services.knownGaps).toContain('svc-gap-1');
      expect(baseline.services.exempt).toContain('svc-exempt-1');
      expect(baseline.contracts.knownGaps).toContain('contract-gap-1');
      expect(baseline.notes.serviceExemptionCriteria).toBe('Legacy exemption reason');
    });

    it('should create empty baseline when no legacy baselines exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { migrateFromLegacyBaselines } = await import('./audit-unified.js');
      const baseline = migrateFromLegacyBaselines('/mock/project');

      expect(baseline.version).toBe(1);
      expect(baseline.services.knownGaps).toEqual([]);
      expect(baseline.services.exempt).toEqual([]);
      expect(baseline.contracts.knownGaps).toEqual([]);
    });
  });

  describe('saveUnifiedBaseline', () => {
    it('should export saveUnifiedBaseline function', async () => {
      const module = await import('./audit-unified.js');
      expect(typeof module.saveUnifiedBaseline).toBe('function');
    });

    it('should save baseline to correct path', async () => {
      const { saveUnifiedBaseline } = await import('./audit-unified.js');

      const baseline = {
        version: 3,
        lastUpdated: '2024-01-15',
        services: { knownGaps: [], exempt: [] },
        contracts: { knownGaps: [] },
        notes: {
          serviceExemptionCriteria: 'Test',
          contractExemptionCriteria: 'None',
        },
      };

      saveUnifiedBaseline('/mock/project', baseline);

      expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
      const [path, content] = mockWriteFileSync.mock.calls[0];
      expect(path).toBe('/mock/project/test-coverage-baseline.json');

      const written = JSON.parse(content as string);
      expect(written.version).toBe(3);
    });
  });

  describe('collectUnifiedAuditData', () => {
    it('should export collectUnifiedAuditData function', async () => {
      const module = await import('./audit-unified.js');
      expect(typeof module.collectUnifiedAuditData).toBe('function');
    });
  });
});

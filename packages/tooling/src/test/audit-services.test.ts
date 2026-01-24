/**
 * Tests for audit-services
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

describe('audit-services', () => {
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

    // Default stat mock - files are files, not directories
    mockStatSync.mockImplementation(() => ({
      isDirectory: () => false,
      isFile: () => true,
    }));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('auditServices', () => {
    it('should export auditServices function', async () => {
      const module = await import('./audit-services.js');
      expect(typeof module.auditServices).toBe('function');
    });

    it('should pass when no new gaps are found', async () => {
      // Setup: one service file, already in baseline
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) return true;
        if (path.includes('ai-worker/src') || path.includes('api-gateway/src')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation(() => []);

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: [],
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        return '';
      });

      const { auditServices } = await import('./audit-services.js');
      const result = auditServices();

      expect(result).toBe(true);
      expect(process.exitCode).toBeUndefined();
    });

    it('should fail when new service gaps are found', async () => {
      // Setup: Mock file system to simulate finding a service file not in baseline
      // Key insight: statSync must return isDirectory:true for dirs, isDirectory:false for files
      mockExistsSync.mockImplementation((path: string) => {
        // IMPORTANT: Check specific patterns BEFORE general directory patterns!
        // The path to a component test file includes 'ai-worker/src' too
        if (path.includes('.component.test.ts')) return false; // Must be first!
        if (path.includes('service-integration-baseline')) return true;
        if (path.includes('ai-worker/src')) return true;
        if (path.includes('api-gateway/src')) return true;
        if (path.includes('bot-client/src')) return true;
        if (path.includes('common-types/src')) return true;
        return false;
      });

      // Simulate directory structure: ai-worker/src contains NewService.ts
      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src')) return ['NewService.ts'];
        return [];
      });

      // KEY FIX: statSync must distinguish directories from files
      mockStatSync.mockImplementation((path: string) => {
        return {
          isDirectory: () => !path.includes('.ts'),
          isFile: () => path.includes('.ts'),
        };
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: [], // Empty - NewService is a NEW gap
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('NewService.ts')) {
          // Multi-line content so isReExportFile returns false
          // (single-line exports are flagged as re-export/barrel files)
          return `export class NewService {
  process() {
    return true;
  }
}`;
        }
        return '';
      });

      const { auditServices } = await import('./audit-services.js');
      const result = auditServices();

      // Returns false on failure; caller handles exit code
      expect(result).toBe(false);
    });

    it('should update baseline when --update flag is passed', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) return true;
        if (path.includes('services/ai-worker/src')) return true;
        if (path.includes('.component.test.ts')) return false;
        return false;
      });

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src') && !dir.includes('/services')) {
          return ['services'];
        }
        if (dir.includes('ai-worker/src/services')) {
          return ['TestService.ts'];
        }
        return [];
      });

      mockStatSync.mockImplementation((path: string) => ({
        isDirectory: () => path.includes('/services') && !path.includes('Service.ts'),
        isFile: () => path.includes('Service.ts'),
      }));

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: [],
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('TestService.ts')) {
          return 'export class TestService { doSomething() {} }';
        }
        return '';
      });

      const { auditServices } = await import('./audit-services.js');
      const result = auditServices({ update: true });

      expect(result).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalled();

      // Verify baseline was written with updated gaps
      const writeCall = mockWriteFileSync.mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1] as string);
      expect(writtenContent.version).toBe(2);
    });

    it('should fail in strict mode with any gaps', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        // IMPORTANT: Check specific patterns BEFORE general directory patterns!
        if (path.includes('.component.test.ts')) return false; // Must be first!
        if (path.includes('service-integration-baseline')) return true;
        if (path.includes('ai-worker/src')) return true;
        if (path.includes('api-gateway/src')) return true;
        if (path.includes('bot-client/src')) return true;
        if (path.includes('common-types/src')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src')) return ['KnownService.ts'];
        return [];
      });

      // KEY FIX: statSync must distinguish directories from files
      mockStatSync.mockImplementation((path: string) => ({
        isDirectory: () => !path.includes('.ts'),
        isFile: () => path.includes('.ts'),
      }));

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) {
          return JSON.stringify({
            // Gap is KNOWN (in baseline), so normal mode would pass
            // But strict mode should still fail
            knownGaps: ['services/ai-worker/src/KnownService.ts'],
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('KnownService.ts')) {
          // Multi-line content so isReExportFile returns false
          return `export class KnownService {
  doSomething() {
    return true;
  }
}`;
        }
        return '';
      });

      const { auditServices } = await import('./audit-services.js');
      const result = auditServices({ strict: true });

      // Returns false on failure; caller handles exit code
      expect(result).toBe(false);
    });

    it('should skip re-export files', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) return true;
        if (path.includes('services/ai-worker/src')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src') && !dir.includes('/services')) {
          return ['services'];
        }
        if (dir.includes('ai-worker/src/services')) {
          return ['ReExportService.ts'];
        }
        return [];
      });

      mockStatSync.mockImplementation((path: string) => ({
        isDirectory: () => path.includes('/services') && !path.includes('Service.ts'),
        isFile: () => path.includes('Service.ts'),
      }));

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: [],
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('ReExportService.ts')) {
          // Re-export file - should be skipped
          return "export { SomeService } from './other';";
        }
        return '';
      });

      const { auditServices } = await import('./audit-services.js');
      const result = auditServices();

      // Should pass - re-export files are skipped
      expect(result).toBe(true);
    });

    it('should skip files with backward compatibility comment', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) return true;
        if (path.includes('services/ai-worker/src')) return true;
        return false;
      });

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src') && !dir.includes('/services')) {
          return ['services'];
        }
        if (dir.includes('ai-worker/src/services')) {
          return ['LegacyService.ts'];
        }
        return [];
      });

      mockStatSync.mockImplementation((path: string) => ({
        isDirectory: () => path.includes('/services') && !path.includes('Service.ts'),
        isFile: () => path.includes('Service.ts'),
      }));

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: [],
            exempt: [],
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('LegacyService.ts')) {
          // Has backward compatibility comment in header
          return `/**
 * Backward compatibility - re-exports from new location
 */
export { NewService as LegacyService } from './NewService';`;
        }
        return '';
      });

      const { auditServices } = await import('./audit-services.js');
      const result = auditServices();

      // Should pass - backward compat files are skipped
      expect(result).toBe(true);
    });

    it('should respect exempt list from baseline', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) return true;
        if (path.includes('services/ai-worker/src')) return true;
        if (path.includes('.component.test.ts')) return false;
        return false;
      });

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.includes('ai-worker/src') && !dir.includes('/services')) {
          return ['services'];
        }
        if (dir.includes('ai-worker/src/services')) {
          return ['ExemptService.ts'];
        }
        return [];
      });

      mockStatSync.mockImplementation((path: string) => ({
        isDirectory: () => path.includes('/services') && !path.includes('Service.ts'),
        isFile: () => path.includes('Service.ts'),
      }));

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('baseline')) {
          return JSON.stringify({
            knownGaps: [],
            exempt: ['services/ai-worker/src/services/ExemptService.ts'], // Exempt!
            lastUpdated: '2024-01-01',
            version: 1,
          });
        }
        if (path.includes('ExemptService.ts')) {
          return 'export class ExemptService { doSomething() {} }';
        }
        return '';
      });

      const { auditServices } = await import('./audit-services.js');
      const result = auditServices();

      // Should pass - service is exempt
      expect(result).toBe(true);
    });
  });

  describe('collectServiceAuditData', () => {
    it('should export collectServiceAuditData function', async () => {
      const module = await import('./audit-services.js');
      expect(typeof module.collectServiceAuditData).toBe('function');
    });
  });
});

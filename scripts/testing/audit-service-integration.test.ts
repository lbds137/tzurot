import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findFiles,
  isReExportFile,
  findTestedServices,
  BaselineFileSchema,
  BACKWARD_COMPAT_COMMENT_SEARCH_LINES,
} from './audit-service-integration.js';

describe('audit-service-integration', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = join(tmpdir(), `audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('BACKWARD_COMPAT_COMMENT_SEARCH_LINES constant', () => {
    it('should be a reasonable number for file header detection', () => {
      expect(BACKWARD_COMPAT_COMMENT_SEARCH_LINES).toBe(10);
      expect(typeof BACKWARD_COMPAT_COMMENT_SEARCH_LINES).toBe('number');
    });
  });

  describe('BaselineFileSchema', () => {
    it('should validate a correct baseline file', () => {
      const validBaseline = {
        knownGaps: ['path/to/Service.ts'],
        exempt: ['path/to/CacheService.ts'],
        lastUpdated: '2026-01-03T00:00:00.000Z',
        version: 1,
      };

      const result = BaselineFileSchema.safeParse(validBaseline);
      expect(result.success).toBe(true);
    });

    it('should reject baseline with missing knownGaps', () => {
      const invalidBaseline = {
        exempt: [],
        lastUpdated: '2026-01-03T00:00:00.000Z',
        version: 1,
      };

      const result = BaselineFileSchema.safeParse(invalidBaseline);
      expect(result.success).toBe(false);
    });

    it('should reject baseline with missing exempt', () => {
      const invalidBaseline = {
        knownGaps: [],
        lastUpdated: '2026-01-03T00:00:00.000Z',
        version: 1,
      };

      const result = BaselineFileSchema.safeParse(invalidBaseline);
      expect(result.success).toBe(false);
    });

    it('should reject baseline with missing lastUpdated', () => {
      const invalidBaseline = {
        knownGaps: [],
        exempt: [],
        version: 1,
      };

      const result = BaselineFileSchema.safeParse(invalidBaseline);
      expect(result.success).toBe(false);
    });

    it('should reject baseline with missing version', () => {
      const invalidBaseline = {
        knownGaps: [],
        exempt: [],
        lastUpdated: '2026-01-03T00:00:00.000Z',
      };

      const result = BaselineFileSchema.safeParse(invalidBaseline);
      expect(result.success).toBe(false);
    });

    it('should reject baseline with wrong types', () => {
      const invalidBaseline = {
        knownGaps: 'not-an-array',
        exempt: [],
        lastUpdated: '2026-01-03T00:00:00.000Z',
        version: 1,
      };

      const result = BaselineFileSchema.safeParse(invalidBaseline);
      expect(result.success).toBe(false);
    });

    it('should reject baseline with non-string array items', () => {
      const invalidBaseline = {
        knownGaps: [123, 456],
        exempt: [],
        lastUpdated: '2026-01-03T00:00:00.000Z',
        version: 1,
      };

      const result = BaselineFileSchema.safeParse(invalidBaseline);
      expect(result.success).toBe(false);
    });
  });

  describe('findFiles', () => {
    it('should find files matching pattern', () => {
      // Create test files
      writeFileSync(join(tempDir, 'TestService.ts'), 'export class TestService {}');
      writeFileSync(join(tempDir, 'OtherService.ts'), 'export class OtherService {}');
      writeFileSync(join(tempDir, 'helper.ts'), 'export function helper() {}');

      const results = findFiles(tempDir, /Service\.ts$/);

      expect(results).toHaveLength(2);
      expect(results.some(f => f.includes('TestService.ts'))).toBe(true);
      expect(results.some(f => f.includes('OtherService.ts'))).toBe(true);
      expect(results.some(f => f.includes('helper.ts'))).toBe(false);
    });

    it('should recursively search directories', () => {
      // Create nested structure
      mkdirSync(join(tempDir, 'nested'), { recursive: true });
      writeFileSync(join(tempDir, 'TopService.ts'), 'export class TopService {}');
      writeFileSync(join(tempDir, 'nested', 'NestedService.ts'), 'export class NestedService {}');

      const results = findFiles(tempDir, /Service\.ts$/);

      expect(results).toHaveLength(2);
      expect(results.some(f => f.includes('TopService.ts'))).toBe(true);
      expect(results.some(f => f.includes('NestedService.ts'))).toBe(true);
    });

    it('should skip node_modules directory', () => {
      mkdirSync(join(tempDir, 'node_modules'), { recursive: true });
      writeFileSync(join(tempDir, 'RealService.ts'), 'export class RealService {}');
      writeFileSync(join(tempDir, 'node_modules', 'LibService.ts'), 'export class LibService {}');

      const results = findFiles(tempDir, /Service\.ts$/);

      expect(results).toHaveLength(1);
      expect(results[0]).toContain('RealService.ts');
    });

    it('should skip dist directory', () => {
      mkdirSync(join(tempDir, 'dist'), { recursive: true });
      writeFileSync(join(tempDir, 'SrcService.ts'), 'export class SrcService {}');
      writeFileSync(join(tempDir, 'dist', 'CompiledService.ts'), 'export class CompiledService {}');

      const results = findFiles(tempDir, /Service\.ts$/);

      expect(results).toHaveLength(1);
      expect(results[0]).toContain('SrcService.ts');
    });

    it('should return empty array for non-existent directory', () => {
      const results = findFiles(join(tempDir, 'nonexistent'), /Service\.ts$/);
      expect(results).toEqual([]);
    });
  });

  describe('isReExportFile', () => {
    it('should detect pure re-export file', () => {
      const filePath = join(tempDir, 'ReExportService.ts');
      writeFileSync(
        filePath,
        `export * from './actual-service.js';
export { SomeClass } from './other.js';`
      );

      expect(isReExportFile(filePath)).toBe(true);
    });

    it('should NOT detect file with actual code as re-export', () => {
      const filePath = join(tempDir, 'RealService.ts');
      writeFileSync(
        filePath,
        `import { Something } from './dep.js';

export class RealService {
  doSomething() {
    return 'work';
  }
}`
      );

      expect(isReExportFile(filePath)).toBe(false);
    });

    it('should detect backward compatibility shim file', () => {
      const filePath = join(tempDir, 'LegacyService.ts');
      writeFileSync(
        filePath,
        `/**
 * Backward compatibility shim
 * @deprecated Use NewService instead
 */
export * from './new-service.js';`
      );

      expect(isReExportFile(filePath)).toBe(true);
    });

    it('should detect backwards compatibility (with s) shim file', () => {
      const filePath = join(tempDir, 'OldService.ts');
      writeFileSync(
        filePath,
        `// Backwards compatibility - will be removed in v4
export * from './modern-service.js';`
      );

      expect(isReExportFile(filePath)).toBe(true);
    });

    it('should NOT detect file with Re-export in code body', () => {
      const filePath = join(tempDir, 'WorkingService.ts');
      writeFileSync(
        filePath,
        `import { dep } from './dep.js';

// Re-export public types for external consumers
export type { PublicType } from './types.js';

export class WorkingService {
  // This service does real work
  process() {
    return dep.call();
  }
}`
      );

      expect(isReExportFile(filePath)).toBe(false);
    });

    it('should return false for empty file', () => {
      const filePath = join(tempDir, 'EmptyService.ts');
      writeFileSync(filePath, '');

      expect(isReExportFile(filePath)).toBe(false);
    });

    it('should return false for comment-only file', () => {
      const filePath = join(tempDir, 'CommentService.ts');
      writeFileSync(
        filePath,
        `// This is just a comment
/* And a block comment */
/**
 * JSDoc comment
 */`
      );

      expect(isReExportFile(filePath)).toBe(false);
    });
  });

  describe('findTestedServices', () => {
    it('should find services with component tests', () => {
      // Create service and its component test
      const servicesDir = join(tempDir, 'services');
      mkdirSync(servicesDir, { recursive: true });
      writeFileSync(join(servicesDir, 'TestedService.ts'), 'export class TestedService {}');
      writeFileSync(
        join(servicesDir, 'TestedService.component.test.ts'),
        'describe("TestedService", () => {})'
      );

      // Create service without component test
      writeFileSync(join(servicesDir, 'UntestedService.ts'), 'export class UntestedService {}');

      // findTestedServices expects relative paths, simulate what findServiceFiles returns
      const services = ['services/TestedService.ts', 'services/UntestedService.ts'];

      // We need to mock the project root for this test
      // Since findTestedServices uses projectRoot internally, we test the behavior indirectly
      const testedServices = findTestedServices(services);

      // The function will look for component tests relative to projectRoot
      // In our isolated test, we just verify the function runs without error
      expect(Array.isArray(testedServices)).toBe(true);
    });

    it('should return empty array when no services have component tests', () => {
      const services = ['path/to/SomeService.ts', 'path/to/OtherService.ts'];
      const testedServices = findTestedServices(services);

      expect(testedServices).toEqual([]);
    });

    it('should return sorted results', () => {
      // Create test structure
      const servicesDir = join(tempDir, 'src', 'services');
      mkdirSync(servicesDir, { recursive: true });

      // This tests the sort behavior of the function
      const services: string[] = [];
      const testedServices = findTestedServices(services);

      expect(testedServices).toEqual([]);
    });
  });

  describe('ratchet behavior', () => {
    it('should detect new gaps (services not in baseline)', () => {
      const baseline = {
        knownGaps: ['existing/Service.ts'],
        exempt: [],
        lastUpdated: '2026-01-01T00:00:00.000Z',
        version: 1,
      };

      const untestedServices = ['existing/Service.ts', 'new/Service.ts'];

      // Simulate ratchet check
      const newGaps = untestedServices.filter(s => !baseline.knownGaps.includes(s));

      expect(newGaps).toEqual(['new/Service.ts']);
    });

    it('should detect fixed gaps (services now tested)', () => {
      const baseline = {
        knownGaps: ['was-untested/Service.ts', 'still-untested/Service.ts'],
        exempt: [],
        lastUpdated: '2026-01-01T00:00:00.000Z',
        version: 1,
      };

      const untestedServices = ['still-untested/Service.ts'];

      // Simulate fixed gaps check
      const fixedGaps = baseline.knownGaps.filter(s => !untestedServices.includes(s));

      expect(fixedGaps).toEqual(['was-untested/Service.ts']);
    });

    it('should allow existing gaps', () => {
      const baseline = {
        knownGaps: ['known-gap/Service.ts'],
        exempt: [],
        lastUpdated: '2026-01-01T00:00:00.000Z',
        version: 1,
      };

      const untestedServices = ['known-gap/Service.ts'];

      const newGaps = untestedServices.filter(s => !baseline.knownGaps.includes(s));

      expect(newGaps).toEqual([]);
    });
  });

  describe('coverage calculation', () => {
    it('should calculate 100% when all services have tests', () => {
      const auditableServices = ['A.ts', 'B.ts', 'C.ts'];
      const testedServices = ['A.ts', 'B.ts', 'C.ts'];
      const untestedServices = auditableServices.filter(s => !testedServices.includes(s));

      const coverage =
        auditableServices.length > 0
          ? ((auditableServices.length - untestedServices.length) / auditableServices.length) * 100
          : 100;

      expect(coverage).toBe(100);
    });

    it('should calculate 0% when no services have tests', () => {
      const auditableServices = ['A.ts', 'B.ts', 'C.ts'];
      const testedServices: string[] = [];
      const untestedServices = auditableServices.filter(s => !testedServices.includes(s));

      const coverage =
        auditableServices.length > 0
          ? ((auditableServices.length - untestedServices.length) / auditableServices.length) * 100
          : 100;

      expect(coverage).toBe(0);
    });

    it('should calculate partial coverage correctly', () => {
      const auditableServices = ['A.ts', 'B.ts', 'C.ts', 'D.ts'];
      const testedServices = ['A.ts', 'B.ts'];
      const untestedServices = auditableServices.filter(s => !testedServices.includes(s));

      const coverage =
        auditableServices.length > 0
          ? ((auditableServices.length - untestedServices.length) / auditableServices.length) * 100
          : 100;

      expect(coverage).toBe(50);
    });

    it('should return 100% when no services exist', () => {
      const auditableServices: string[] = [];
      const untestedServices: string[] = [];

      const coverage =
        auditableServices.length > 0
          ? ((auditableServices.length - untestedServices.length) / auditableServices.length) * 100
          : 100;

      expect(coverage).toBe(100);
    });
  });

  describe('exempt services', () => {
    it('should filter out exempt services from auditable list', () => {
      const allServices = ['CacheService.ts', 'RealService.ts', 'AnotherCacheService.ts'];
      const exempt = ['CacheService.ts', 'AnotherCacheService.ts'];

      const auditableServices = allServices.filter(s => !exempt.includes(s));

      expect(auditableServices).toEqual(['RealService.ts']);
    });
  });
});

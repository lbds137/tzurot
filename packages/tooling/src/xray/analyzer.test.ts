import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: Object.assign((s: string) => s, { bold: (s: string) => s }),
    red: Object.assign((s: string) => s, { bold: (s: string) => s }),
    dim: (s: string) => s,
    bold: (s: string) => s,
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { analyzeMonorepo, runXray } from './analyzer.js';

function setupMockPackage(
  packageName: string,
  packageType: 'services' | 'packages',
  files: Record<string, string>
): void {
  const fileNames = Object.keys(files);

  vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
    const d = String(dir);
    if (d.endsWith(`/${packageType}`)) return [packageName];
    if (d.endsWith('/services') && packageType !== 'services') return [];
    if (d.endsWith('/packages') && packageType !== 'packages') return [];
    if (d.endsWith(`/${packageName}/src`)) return fileNames;
    return [];
  }) as typeof readdirSync);

  vi.mocked(statSync).mockImplementation(((path: unknown) => {
    const p = String(path);
    if (p.endsWith('/src')) return { isDirectory: () => true } as ReturnType<typeof statSync>;
    return { isDirectory: () => false } as ReturnType<typeof statSync>;
  }) as typeof statSync);

  vi.mocked(readFileSync).mockImplementation(((path: unknown) => {
    const p = String(path);
    for (const [name, content] of Object.entries(files)) {
      if (p.endsWith(`/${name}`)) return content;
    }
    return '';
  }) as typeof readFileSync);
}

describe('analyzeMonorepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a report with packages and summary', () => {
    setupMockPackage('bot-client', 'services', {
      'index.ts': 'export function main(): void {}\nexport const VERSION = "1.0";\n',
    });

    const report = analyzeMonorepo('/root');

    expect(report.generatedAt).toBeDefined();
    expect(report.packages).toHaveLength(1);
    expect(report.packages[0].name).toBe('bot-client');
    expect(report.packages[0].files).toHaveLength(1);
    expect(report.summary.totalFiles).toBe(1);
    expect(report.summary.totalFunctions).toBe(1);
  });

  it('should compute package health with warnings for large packages', () => {
    // Create a large file content
    const bigFile = Array.from({ length: 500 }, (_, i) => `export const VAR_${i} = ${i};`).join(
      '\n'
    );
    setupMockPackage('big-service', 'services', {
      'big.ts': bigFile,
    });

    const report = analyzeMonorepo('/root');

    const health = report.summary.byPackage['big-service']?.health;
    expect(health).toBeDefined();
    expect(health?.largestFile.lines).toBeGreaterThan(400);
    expect(health?.warnings.length).toBeGreaterThan(0);
  });

  it('should include imports when format is md', () => {
    setupMockPackage('test-pkg', 'packages', {
      'index.ts': `import { foo } from './foo.js';\nexport function bar(): void {}\n`,
    });

    const report = analyzeMonorepo('/root', { format: 'md' });

    const file = report.packages[0].files[0];
    expect(file.imports).toHaveLength(1);
    expect(file.imports[0].source).toBe('./foo.js');
  });

  it('should not include imports for terminal format by default', () => {
    setupMockPackage('test-pkg', 'packages', {
      'index.ts': `import { foo } from './foo.js';\nexport function bar(): void {}\n`,
    });

    const report = analyzeMonorepo('/root', { format: 'terminal' });

    const file = report.packages[0].files[0];
    expect(file.imports).toHaveLength(0);
  });
});

describe('runXray', () => {
  let consoleLogSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
      typeof statSync
    >);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should output terminal format by default', async () => {
    await runXray();

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('XRAY ANALYSIS');
  });

  it('should write to file when output option is set', async () => {
    await runXray({ format: 'json', output: '/tmp/test.json' });

    expect(writeFileSync).toHaveBeenCalledWith('/tmp/test.json', expect.any(String), 'utf-8');

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Report written to');
  });

  it('should output valid JSON in json format', async () => {
    setupMockPackage('test-pkg', 'packages', {
      'index.ts': 'export function hello(): void {}\n',
    });

    await runXray({ format: 'json' });

    const jsonOutput = consoleLogSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(jsonOutput) as Record<string, unknown>;
    expect(parsed).toHaveProperty('generatedAt');
    expect(parsed).toHaveProperty('packages');
    expect(parsed).toHaveProperty('summary');
  });

  it('should output markdown in md format', async () => {
    setupMockPackage('test-pkg', 'packages', {
      'index.ts': 'export function hello(): void {}\n',
    });

    await runXray({ format: 'md' });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('# Xray Codebase Analysis');
    expect(output).toContain('| Package |');
  });
});

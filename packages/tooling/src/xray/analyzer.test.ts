import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// ts-morph has a cold-start cost (~500ms) that can exceed the default 5s timeout on slower CI runners
vi.setConfig({ testTimeout: 15_000 });

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

  it('should count suppressions in package health', () => {
    setupMockPackage('test-pkg', 'packages', {
      'index.ts': `// eslint-disable-next-line no-console\nconsole.log('hi');\nexport const x = 1;\n`,
    });

    const report = analyzeMonorepo('/root');

    const health = report.summary.byPackage['test-pkg']?.health;
    expect(health?.totalSuppressions).toBe(1);
    expect(report.summary.totalSuppressions).toBe(1);
  });

  it('should report zero suppressions for clean code', () => {
    setupMockPackage('test-pkg', 'packages', {
      'index.ts': 'export const x = 1;\n',
    });

    const report = analyzeMonorepo('/root');

    const health = report.summary.byPackage['test-pkg']?.health;
    expect(health?.totalSuppressions).toBe(0);
    expect(report.summary.totalSuppressions).toBe(0);
  });

  it('should skip unparseable files and continue analysis', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Set up two files: one good, one that throws on read
    const goodContent = 'export const x = 1;\n';
    vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
      const d = String(dir);
      if (d.endsWith('/services')) return ['test-svc'];
      if (d.endsWith('/packages')) return [];
      if (d.endsWith('/test-svc/src')) return ['good.ts', 'bad.ts'];
      return [];
    }) as typeof readdirSync);

    vi.mocked(statSync).mockImplementation(((path: unknown) => {
      const p = String(path);
      if (p.endsWith('/src')) return { isDirectory: () => true } as ReturnType<typeof statSync>;
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    }) as typeof statSync);

    vi.mocked(readFileSync).mockImplementation(((path: unknown) => {
      const p = String(path);
      if (p.endsWith('bad.ts')) throw new Error('EACCES: permission denied');
      if (p.endsWith('good.ts')) return goodContent;
      return '';
    }) as typeof readFileSync);

    const report = analyzeMonorepo('/root');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Warning: Skipped .+bad\.ts: EACCES: permission denied/)
    );
    // Only the good file should be in the report
    expect(report.packages[0].files).toHaveLength(1);
    expect(report.packages[0].files[0].path).toContain('good.ts');
    // Summary should reflect 1 file, not 2
    expect(report.summary.totalFiles).toBe(1);

    consoleWarnSpy.mockRestore();
  });

  it('should include suppressions in file data', () => {
    setupMockPackage('test-pkg', 'packages', {
      'index.ts': `// @ts-expect-error -- test\nexport const x = 1;\n// eslint-disable-next-line no-unused-vars\nconst y = 2;\n`,
    });

    const report = analyzeMonorepo('/root', { includePrivate: true });

    const file = report.packages[0].files[0];
    expect(file.suppressions).toHaveLength(2);
    expect(file.suppressions[0].kind).toBe('ts-expect-error');
    expect(file.suppressions[1].kind).toBe('eslint-disable-next-line');
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

  it('should output suppression audit when suppressions flag is set', async () => {
    setupMockPackage('test-pkg', 'packages', {
      'index.ts': `// eslint-disable-next-line no-console\nconsole.log('hi');\nexport const x = 1;\n`,
    });

    await runXray({ suppressions: true });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('SUPPRESSION AUDIT');
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

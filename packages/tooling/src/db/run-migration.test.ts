import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: Object.assign((s: string) => s, {
      bold: (s: string) => s,
    }),
    blue: (s: string) => s,
  },
}));

// Track env-runner mock state
const envRunnerMock = {
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  runPrismaCommand: vi.fn(),
  confirmProductionOperation: vi.fn(),
};

// Mock env-runner
vi.mock('../utils/env-runner.js', () => envRunnerMock);

describe('runMigration', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // Default successful command
    envRunnerMock.runPrismaCommand.mockResolvedValue({
      stdout: 'Migration success',
      stderr: '',
      exitCode: 0,
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should export runMigration function', async () => {
    const module = await import('./run-migration.js');
    expect(typeof module.runMigration).toBe('function');
  });

  it('should export deployMigration function', async () => {
    const module = await import('./run-migration.js');
    expect(typeof module.deployMigration).toBe('function');
  });

  describe('local environment', () => {
    it('should run prisma migrate dev for local', async () => {
      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'local' });

      expect(envRunnerMock.runPrismaCommand).toHaveBeenCalledWith('local', 'migrate', ['dev']);
    });

    it('should run prisma migrate status for dry run', async () => {
      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'local', dryRun: true });

      expect(envRunnerMock.runPrismaCommand).toHaveBeenCalledWith('local', 'migrate', ['status']);
    });

    it('should exit with code 1 on migration failure', async () => {
      envRunnerMock.runPrismaCommand.mockResolvedValue({
        stdout: '',
        stderr: 'Migration failed',
        exitCode: 1,
      });

      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'local' });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Railway environments', () => {
    it('should run prisma migrate deploy for dev', async () => {
      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'dev' });

      expect(envRunnerMock.runPrismaCommand).toHaveBeenCalledWith('dev', 'migrate', ['deploy']);
    });

    it('should require confirmation for prod without --force', async () => {
      envRunnerMock.confirmProductionOperation.mockResolvedValue(false);

      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'prod' });

      expect(envRunnerMock.confirmProductionOperation).toHaveBeenCalledWith('run migrations');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should skip confirmation for prod with --force', async () => {
      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'prod', force: true });

      expect(envRunnerMock.confirmProductionOperation).not.toHaveBeenCalled();
      expect(envRunnerMock.runPrismaCommand).toHaveBeenCalledWith('prod', 'migrate', ['deploy']);
    });

    it('should proceed with confirmation for prod when user confirms', async () => {
      envRunnerMock.confirmProductionOperation.mockResolvedValue(true);

      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'prod' });

      expect(envRunnerMock.confirmProductionOperation).toHaveBeenCalled();
      expect(envRunnerMock.runPrismaCommand).toHaveBeenCalledWith('prod', 'migrate', ['deploy']);
    });

    it('should show production warnings', async () => {
      envRunnerMock.confirmProductionOperation.mockResolvedValue(true);

      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'prod' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('PRODUCTION');
    });
  });

  describe('dry run mode', () => {
    it('should skip confirmation in dry run mode', async () => {
      const { runMigration } = await import('./run-migration.js');
      await runMigration({ env: 'prod', dryRun: true });

      expect(envRunnerMock.confirmProductionOperation).not.toHaveBeenCalled();
      expect(envRunnerMock.runPrismaCommand).toHaveBeenCalledWith('prod', 'migrate', ['status']);
    });
  });
});

describe('deployMigration', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    envRunnerMock.runPrismaCommand.mockResolvedValue({
      stdout: 'Migration success',
      stderr: '',
      exitCode: 0,
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should run with force flag (skip confirmation)', async () => {
    const { deployMigration } = await import('./run-migration.js');
    await deployMigration({ env: 'prod' });

    expect(envRunnerMock.confirmProductionOperation).not.toHaveBeenCalled();
    expect(envRunnerMock.runPrismaCommand).toHaveBeenCalled();
  });

  it('should default to local environment', async () => {
    const { deployMigration } = await import('./run-migration.js');
    await deployMigration();

    expect(envRunnerMock.validateEnvironment).toHaveBeenCalled();
  });
});

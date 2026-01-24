import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cac } from 'cac';

// Mock the database functions
vi.mock('../db/check-migration-drift.js', () => ({
  checkMigrationDrift: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/fix-migration-drift.js', () => ({
  fixMigrationDrift: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/inspect-database.js', () => ({
  inspectDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/create-safe-migration.js', () => ({
  createSafeMigration: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../data/backup.js', () => ({
  backupPersonalities: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../data/bulk-import.js', () => ({
  bulkImport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../data/import-personality.js', () => ({
  importPersonality: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../deployment/deploy-dev.js', () => ({
  deployDev: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../deployment/verify-build.js', () => ({
  verifyBuild: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../deployment/update-gateway-url.js', () => ({
  updateGatewayUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../test/audit-contracts.js', () => ({
  auditContracts: vi.fn().mockReturnValue(true),
}));

vi.mock('../test/audit-services.js', () => ({
  auditServices: vi.fn().mockReturnValue(true),
}));

describe('command handlers', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('db commands', () => {
    it('should call check-migration-drift handler', async () => {
      const { registerDbCommands } = await import('./db.js');
      const { checkMigrationDrift } = await import('../db/check-migration-drift.js');
      const cli = cac('test');
      registerDbCommands(cli);

      // Use cli.parse() - the proper way to test cac CLIs
      cli.parse(['node', 'test', 'db:check-drift'], { run: true });

      // Allow async handler to complete
      await vi.waitFor(() => {
        expect(checkMigrationDrift).toHaveBeenCalled();
      });
    });

    it('should call fix-migration-drift handler with args', async () => {
      const { registerDbCommands } = await import('./db.js');
      const { fixMigrationDrift } = await import('../db/fix-migration-drift.js');
      const cli = cac('test');
      registerDbCommands(cli);

      cli.parse(['node', 'test', 'db:fix-drift', 'migration1', 'migration2'], { run: true });

      await vi.waitFor(() => {
        expect(fixMigrationDrift).toHaveBeenCalledWith(
          ['migration1', 'migration2'],
          expect.objectContaining({})
        );
      });
    });

    it('should call inspect-database handler with options', async () => {
      const { registerDbCommands } = await import('./db.js');
      const { inspectDatabase } = await import('../db/inspect-database.js');
      const cli = cac('test');
      registerDbCommands(cli);

      cli.parse(['node', 'test', 'db:inspect', '--table', 'users', '--indexes'], { run: true });

      await vi.waitFor(() => {
        expect(inspectDatabase).toHaveBeenCalledWith(
          expect.objectContaining({ table: 'users', indexes: true })
        );
      });
    });

    it('should call create-safe-migration handler', async () => {
      const { registerDbCommands } = await import('./db.js');
      const { createSafeMigration } = await import('../db/create-safe-migration.js');
      const cli = cac('test');
      registerDbCommands(cli);

      cli.parse(['node', 'test', 'db:safe-migrate'], { run: true });

      await vi.waitFor(() => {
        expect(createSafeMigration).toHaveBeenCalled();
      });
    });
  });

  describe('data commands', () => {
    it('should call backup handler', async () => {
      const { registerDataCommands } = await import('./data.js');
      const { backupPersonalities } = await import('../data/backup.js');
      const cli = cac('test');
      registerDataCommands(cli);

      cli.parse(['node', 'test', 'data:backup'], { run: true });

      await vi.waitFor(() => {
        expect(backupPersonalities).toHaveBeenCalled();
      });
    });

    it('should call bulk-import handler', async () => {
      const { registerDataCommands } = await import('./data.js');
      const { bulkImport } = await import('../data/bulk-import.js');
      const cli = cac('test');
      registerDataCommands(cli);

      cli.parse(['node', 'test', 'data:bulk-import', '--dry-run'], { run: true });

      await vi.waitFor(() => {
        expect(bulkImport).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
      });
    });

    it('should call import-personality handler with name', async () => {
      const { registerDataCommands } = await import('./data.js');
      const { importPersonality } = await import('../data/import-personality.js');
      const cli = cac('test');
      registerDataCommands(cli);

      cli.parse(['node', 'test', 'data:import', 'personality-name', '--dry-run'], { run: true });

      await vi.waitFor(() => {
        expect(importPersonality).toHaveBeenCalledWith(
          'personality-name',
          expect.objectContaining({ dryRun: true })
        );
      });
    });
  });

  describe('deploy commands', () => {
    it('should call deploy-dev handler', async () => {
      const { registerDeployCommands } = await import('./deploy.js');
      const { deployDev } = await import('../deployment/deploy-dev.js');
      const cli = cac('test');
      registerDeployCommands(cli);

      cli.parse(['node', 'test', 'deploy:dev'], { run: true });

      await vi.waitFor(() => {
        expect(deployDev).toHaveBeenCalled();
      });
    });

    it('should call verify-build handler', async () => {
      const { registerDeployCommands } = await import('./deploy.js');
      const { verifyBuild } = await import('../deployment/verify-build.js');
      const cli = cac('test');
      registerDeployCommands(cli);

      cli.parse(['node', 'test', 'deploy:verify'], { run: true });

      await vi.waitFor(() => {
        expect(verifyBuild).toHaveBeenCalled();
      });
    });

    it('should call update-gateway-url handler', async () => {
      const { registerDeployCommands } = await import('./deploy.js');
      const { updateGatewayUrl } = await import('../deployment/update-gateway-url.js');
      const cli = cac('test');
      registerDeployCommands(cli);

      cli.parse(['node', 'test', 'deploy:update-gateway'], { run: true });

      await vi.waitFor(() => {
        expect(updateGatewayUrl).toHaveBeenCalled();
      });
    });
  });

  describe('test commands', () => {
    it('should call audit-contracts handler', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditContracts } = await import('../test/audit-contracts.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit-contracts'], { run: true });

      await vi.waitFor(() => {
        expect(auditContracts).toHaveBeenCalledWith(expect.objectContaining({}));
      });
    });

    it('should call audit-contracts handler with --update flag', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditContracts } = await import('../test/audit-contracts.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit-contracts', '--update'], { run: true });

      await vi.waitFor(() => {
        expect(auditContracts).toHaveBeenCalledWith(expect.objectContaining({ update: true }));
      });
    });

    it('should call audit-services handler', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditServices } = await import('../test/audit-services.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit-services'], { run: true });

      await vi.waitFor(() => {
        expect(auditServices).toHaveBeenCalledWith(expect.objectContaining({}));
      });
    });

    it('should call audit-services handler with --strict flag', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditServices } = await import('../test/audit-services.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit-services', '--strict'], { run: true });

      await vi.waitFor(() => {
        expect(auditServices).toHaveBeenCalledWith(expect.objectContaining({ strict: true }));
      });
    });

    it('should call both audits for test:audit command', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditContracts } = await import('../test/audit-contracts.js');
      const { auditServices } = await import('../test/audit-services.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit'], { run: true });

      await vi.waitFor(() => {
        expect(auditContracts).toHaveBeenCalled();
        expect(auditServices).toHaveBeenCalled();
      });
    });
  });
});

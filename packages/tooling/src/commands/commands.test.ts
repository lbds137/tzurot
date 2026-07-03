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

vi.mock('../deployment/deploy-dev.js', () => ({
  deployDev: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../deployment/verify-build.js', () => ({
  verifyBuild: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../deployment/update-gateway-url.js', () => ({
  updateGatewayUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../deployment/logs.js', () => ({
  fetchLogs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../test/audit-unified.js', () => ({
  auditUnified: vi.fn().mockReturnValue(true),
}));

vi.mock('../voice/audit-references.js', () => ({
  auditReferences: vi.fn().mockResolvedValue(undefined),
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

    it('delivers an all-digit --job-id to fetchLogs as a STRING (CAC auto-casts to number)', async () => {
      // CAC/mri parses `--job-id 42317` to the number 42317; without the
      // String() coercion in deploy.ts, logs.ts's `typeof === 'string'` term
      // filter silently drops it — the dig runs unfiltered while looking
      // successful. This test crosses the real cli.parse() boundary the
      // logs.test.ts unit tests bypass.
      const { registerDeployCommands } = await import('./deploy.js');
      const { fetchLogs } = await import('../deployment/logs.js');
      const cli = cac('test');
      registerDeployCommands(cli);

      cli.parse(['node', 'test', 'logs', '--env', 'prod', '--job-id', '42317'], { run: true });

      await vi.waitFor(() => {
        expect(fetchLogs).toHaveBeenCalledWith(expect.objectContaining({ jobId: '42317' }));
      });
    });
  });

  describe('test commands', () => {
    it('should call auditUnified for test:audit command', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditUnified } = await import('../test/audit-unified.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit'], { run: true });

      await vi.waitFor(() => {
        expect(auditUnified).toHaveBeenCalledWith(expect.objectContaining({}));
      });
    });

    it('should call auditUnified with --category=services', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditUnified } = await import('../test/audit-unified.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit', '--category=services'], { run: true });

      await vi.waitFor(() => {
        expect(auditUnified).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'services' })
        );
      });
    });

    it('should call auditUnified with --strict flag', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditUnified } = await import('../test/audit-unified.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit', '--strict'], { run: true });

      await vi.waitFor(() => {
        expect(auditUnified).toHaveBeenCalledWith(expect.objectContaining({ strict: true }));
      });
    });

    it('should call auditUnified with --update flag', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditUnified } = await import('../test/audit-unified.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit', '--update'], { run: true });

      await vi.waitFor(() => {
        expect(auditUnified).toHaveBeenCalledWith(expect.objectContaining({ update: true }));
      });
    });

    it('should call deprecated test:audit-contracts and delegate to auditUnified', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditUnified } = await import('../test/audit-unified.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit-contracts'], { run: true });

      await vi.waitFor(() => {
        expect(auditUnified).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'contracts' })
        );
      });
    });

    it('should call deprecated test:audit-services and delegate to auditUnified', async () => {
      const { registerTestCommands } = await import('./test.js');
      const { auditUnified } = await import('../test/audit-unified.js');
      const cli = cac('test');
      registerTestCommands(cli);

      cli.parse(['node', 'test', 'test:audit-services'], { run: true });

      await vi.waitFor(() => {
        expect(auditUnified).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'services' })
        );
      });
    });
  });

  describe('voice commands', () => {
    it('should call audit-references handler with --env prod', async () => {
      const { registerVoiceCommands } = await import('./voice.js');
      const { auditReferences } = await import('../voice/audit-references.js');
      const cli = cac('test');
      registerVoiceCommands(cli);

      cli.parse(['node', 'test', 'voice-refs:audit', '--env', 'prod'], { run: true });

      await vi.waitFor(() => {
        expect(auditReferences).toHaveBeenCalledWith(expect.objectContaining({ env: 'prod' }));
      });
    });

    it('should call audit-references handler with --json flag', async () => {
      const { registerVoiceCommands } = await import('./voice.js');
      const { auditReferences } = await import('../voice/audit-references.js');
      const cli = cac('test');
      registerVoiceCommands(cli);

      cli.parse(['node', 'test', 'voice-refs:audit', '--json'], { run: true });

      await vi.waitFor(() => {
        expect(auditReferences).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
      });
    });
  });
});

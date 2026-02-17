import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cac } from 'cac';

describe('CLI', () => {
  describe('version', () => {
    it('should read version from package.json', () => {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const packageJsonPath = join(__dirname, '..', 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
        version: string;
      };

      expect(packageJson.version).toBeDefined();
      expect(typeof packageJson.version).toBe('string');
      expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('package.json', () => {
    it('should have correct package name', () => {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const packageJsonPath = join(__dirname, '..', 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
        name: string;
        bin: Record<string, string>;
      };

      expect(packageJson.name).toBe('@tzurot/tooling');
      expect(packageJson.bin?.ops).toBe('./dist/cli.js');
    });
  });
});

describe('CLI command registration', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should register db commands', async () => {
    const { registerDbCommands } = await import('./commands/db.js');
    const cli = cac('test');

    registerDbCommands(cli);

    // Verify commands are registered by checking the CLI has commands
    expect(cli.commands.length).toBeGreaterThan(0);
  });

  it('should register deploy commands', async () => {
    const { registerDeployCommands } = await import('./commands/deploy.js');
    const cli = cac('test');

    registerDeployCommands(cli);

    expect(cli.commands.length).toBeGreaterThan(0);
  });
});

describe('command action handlers', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('db commands should have action handlers', async () => {
    const { registerDbCommands } = await import('./commands/db.js');
    const cli = cac('test');
    registerDbCommands(cli);

    // Each command should have an actionHandler
    for (const cmd of cli.commands) {
      expect(cmd.commandAction).toBeDefined();
    }
  });

  it('deploy commands should have action handlers', async () => {
    const { registerDeployCommands } = await import('./commands/deploy.js');
    const cli = cac('test');
    registerDeployCommands(cli);

    for (const cmd of cli.commands) {
      expect(cmd.commandAction).toBeDefined();
    }
  });
});

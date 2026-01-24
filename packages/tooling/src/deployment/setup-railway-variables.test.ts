/**
 * Tests for Railway Variables Setup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupRailwayVariables } from './setup-railway-variables.js';

// Mock node modules
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock chalk to return plain strings
vi.mock('chalk', () => ({
  default: {
    blue: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}));

// Mock env-runner
vi.mock('../utils/env-runner.js', () => ({
  checkRailwayCli: vi.fn(() => true),
  getRailwayEnvName: vi.fn((env: string) => (env === 'dev' ? 'development' : 'production')),
}));

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { checkRailwayCli } from '../utils/env-runner.js';

describe('setupRailwayVariables', () => {
  const mockExecFileSync = vi.mocked(execFileSync);
  const mockReadFileSync = vi.mocked(readFileSync);
  const mockExistsSync = vi.mocked(existsSync);
  const mockCheckRailwayCli = vi.mocked(checkRailwayCli);

  // Capture console output
  const consoleLogs: string[] = [];
  const consoleErrors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogs.length = 0;
    consoleErrors.length = 0;

    console.log = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    };

    // Default mocks
    mockCheckRailwayCli.mockReturnValue(true);
    mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
      // Handle 'railway status' call
      if (cmd === 'railway' && args?.[0] === 'status') {
        return 'Project: test-project\nEnvironment: development';
      }
      return '';
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-test-key
OPENAI_API_KEY=sk-openai-key
DISCORD_TOKEN=test-discord-token
DISCORD_CLIENT_ID=123456789
BOT_OWNER_ID=987654321
`);
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  describe('dry run mode', () => {
    it('should not call railway variables --set in dry run mode', async () => {
      await setupRailwayVariables({ env: 'dev', dryRun: true, yes: true });

      // Should not have called any --set commands (execFileSync uses args array)
      const setCalls = mockExecFileSync.mock.calls.filter(
        call => Array.isArray(call[1]) && call[1].includes('--set')
      );
      expect(setCalls).toHaveLength(0);
    });

    it('should show what would be set in dry run mode', async () => {
      await setupRailwayVariables({ env: 'dev', dryRun: true, yes: true });

      const output = consoleLogs.join('\n');
      expect(output).toContain('[DRY RUN]');
      expect(output).toContain('Would set shared variable');
    });
  });

  describe('environment validation', () => {
    it('should exit if Railway CLI is not authenticated', async () => {
      mockCheckRailwayCli.mockReturnValue(false);

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(setupRailwayVariables({ env: 'dev', dryRun: true, yes: true })).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrors.join('\n')).toContain('Railway CLI not authenticated');
      mockExit.mockRestore();
    });

    it('should exit if not linked to Railway project', async () => {
      mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'railway' && args?.[0] === 'status') {
          throw new Error('Not linked');
        }
        return '';
      });

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(setupRailwayVariables({ env: 'dev', dryRun: true, yes: true })).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrors.join('\n')).toContain('Not linked to a Railway project');
      mockExit.mockRestore();
    });
  });

  describe('variable parsing', () => {
    it('should read variables from .env file', async () => {
      await setupRailwayVariables({ env: 'dev', dryRun: true, yes: true });

      const output = consoleLogs.join('\n');
      expect(output).toContain('AI_PROVIDER: openrouter');
      expect(output).toContain('OPENROUTER_API_KEY: ***set***');
    });

    it('should use default values for missing variables', async () => {
      mockReadFileSync.mockReturnValue(`
OPENROUTER_API_KEY=sk-test-key
DISCORD_TOKEN=test-token
DISCORD_CLIENT_ID=123456789
`);

      await setupRailwayVariables({ env: 'dev', dryRun: true, yes: true });

      const output = consoleLogs.join('\n');
      // Should use defaults
      expect(output).toContain('WHISPER_MODEL: whisper-1');
      // Note: EMBEDDING_MODEL removed - local embeddings don't need env config
    });

    it('should report 0 variables when .env file is missing', async () => {
      mockExistsSync.mockReturnValue(false);

      // Will fail validation for required vars, but should report 0 vars read
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(setupRailwayVariables({ env: 'dev', dryRun: true, yes: true })).rejects.toThrow(
        'process.exit called'
      );

      const output = consoleLogs.join('\n');
      expect(output).toContain('Read 0 variables from .env');
      mockExit.mockRestore();
    });
  });

  describe('required variable validation', () => {
    it('should exit if required variables are missing', async () => {
      mockReadFileSync.mockReturnValue(''); // Empty .env

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(setupRailwayVariables({ env: 'dev', dryRun: true, yes: true })).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrors.join('\n')).toContain('Missing required variables');
      mockExit.mockRestore();
    });
  });

  describe('Railway environment mapping', () => {
    it('should use "development" for env=dev', async () => {
      await setupRailwayVariables({ env: 'dev', dryRun: true, yes: true });

      const output = consoleLogs.join('\n');
      expect(output).toContain('DEVELOPMENT');
    });

    it('should use "production" for env=prod', async () => {
      await setupRailwayVariables({ env: 'prod', dryRun: true, yes: true });

      const output = consoleLogs.join('\n');
      expect(output).toContain('PRODUCTION');
    });
  });

  describe('targetKey mapping', () => {
    it('should map API_GATEWAY_PORT to PORT for api-gateway', async () => {
      mockReadFileSync.mockReturnValue(`
OPENROUTER_API_KEY=sk-test-key
DISCORD_TOKEN=test-token
DISCORD_CLIENT_ID=123456789
API_GATEWAY_PORT=3000
`);

      await setupRailwayVariables({ env: 'dev', dryRun: true, yes: true });

      const output = consoleLogs.join('\n');
      // Should read as API_GATEWAY_PORT
      expect(output).toContain('API_GATEWAY_PORT: 3000');
      // Should set as PORT
      expect(output).toContain('Would set api-gateway variable: PORT');
    });

    it('should map AI_WORKER_PORT to PORT for ai-worker', async () => {
      mockReadFileSync.mockReturnValue(`
OPENROUTER_API_KEY=sk-test-key
DISCORD_TOKEN=test-token
DISCORD_CLIENT_ID=123456789
AI_WORKER_PORT=3001
`);

      await setupRailwayVariables({ env: 'dev', dryRun: true, yes: true });

      const output = consoleLogs.join('\n');
      // Should read as AI_WORKER_PORT
      expect(output).toContain('AI_WORKER_PORT: 3001');
      // Should set as PORT
      expect(output).toContain('Would set ai-worker variable: PORT');
    });
  });

  describe('secret handling', () => {
    it('should hide secret values in output', async () => {
      await setupRailwayVariables({ env: 'dev', dryRun: true, yes: true });

      const output = consoleLogs.join('\n');
      // Secrets should be hidden
      expect(output).toContain('OPENROUTER_API_KEY: ***set***');
      expect(output).toContain('DISCORD_TOKEN: ***set***');
      // Non-secrets should be visible
      expect(output).toContain('AI_PROVIDER: openrouter');
    });
  });

  describe('shell safety', () => {
    it('should safely handle values with shell metacharacters', async () => {
      // Values with shell metacharacters that could cause injection
      mockReadFileSync.mockReturnValue(`
OPENROUTER_API_KEY=sk-test-key
DISCORD_TOKEN=test-token"; rm -rf /; echo "injected
DISCORD_CLIENT_ID=123456789
`);

      // Mock execFileSync - handle status call and variable sets
      mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'railway' && args?.[0] === 'status') {
          return 'Project: test-project\nEnvironment: development';
        }
        return '';
      });

      await setupRailwayVariables({ env: 'dev', dryRun: false, yes: true });

      // Find a call that sets DISCORD_TOKEN
      const discordTokenCall = mockExecFileSync.mock.calls.find(call => {
        const args = call[1] as string[] | undefined;
        return (
          call[0] === 'railway' &&
          args?.some(arg => typeof arg === 'string' && arg.startsWith('DISCORD_TOKEN='))
        );
      });

      expect(discordTokenCall).toBeDefined();
      // The value should be passed as-is, not interpreted by shell
      const args = discordTokenCall![1] as string[];
      const setArg = args.find(arg => arg.startsWith('DISCORD_TOKEN='));
      expect(setArg).toBe('DISCORD_TOKEN=test-token"; rm -rf /; echo "injected');
    });

    it('should safely handle values with backticks and $() subshells', async () => {
      mockReadFileSync.mockReturnValue(`
OPENROUTER_API_KEY=sk-test-key
DISCORD_TOKEN=token-with-\`whoami\`-and-$(id)
DISCORD_CLIENT_ID=123456789
`);

      // Mock execFileSync - handle status call and variable sets
      mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'railway' && args?.[0] === 'status') {
          return 'Project: test-project\nEnvironment: development';
        }
        return '';
      });

      await setupRailwayVariables({ env: 'dev', dryRun: false, yes: true });

      const discordTokenCall = mockExecFileSync.mock.calls.find(call => {
        const args = call[1] as string[] | undefined;
        return (
          call[0] === 'railway' &&
          args?.some(arg => typeof arg === 'string' && arg.startsWith('DISCORD_TOKEN='))
        );
      });

      expect(discordTokenCall).toBeDefined();
      const args = discordTokenCall![1] as string[];
      const setArg = args.find(arg => arg.startsWith('DISCORD_TOKEN='));
      // Backticks and $() should be preserved literally
      expect(setArg).toBe('DISCORD_TOKEN=token-with-`whoami`-and-$(id)');
    });
  });
});

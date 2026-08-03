/**
 * Tests for deployCommands
 *
 * Command entry points MUST default-export their Command. These tests run the
 * real dynamic import against two on-disk fixture modules — one with a default
 * export, one with named exports only — so the loader's accept/reject decision
 * is exercised for real rather than through a stubbed import.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Routes } from 'discord.js';
import validCommandFixture, { TO_JSON_SENTINEL } from './fixtures/validCommand.js';
import * as noDefaultExportFixture from './fixtures/noDefaultExport.js';

const { mockPut, mockSetToken, mockLogger, mockGetConfig } = vi.hoisted(() => ({
  mockPut: vi.fn(),
  mockSetToken: vi.fn(),
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockGetConfig: vi.fn(),
}));

// Only REST is replaced — `Routes` (and everything else discord.js exports)
// stays real so the asserted route strings are the ones production builds.
vi.mock('discord.js', async () => {
  const actual = await vi.importActual<typeof import('discord.js')>('discord.js');
  class MockREST {
    setToken(token: string): this {
      mockSetToken(token);
      return this;
    }
    put(route: string, options: { body: unknown }): Promise<unknown> {
      return mockPut(route, options) as Promise<unknown>;
    }
  }
  return { ...actual, REST: MockREST };
});

vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

vi.mock('./commandFileUtils.js', () => ({
  getCommandFiles: vi.fn(),
}));

import { deployCommands } from './deployCommands.js';
import { getCommandFiles } from './commandFileUtils.js';

const VALID_FIXTURE_PATH = fileURLToPath(new URL('./fixtures/validCommand.ts', import.meta.url));
const NO_DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/noDefaultExport.ts', import.meta.url)
);

/** What `validCommand`'s `toJSON()` produces — the only shape that may deploy. */
const EXPECTED_VALID_JSON = { name: 'fixture-valid', description: TO_JSON_SENTINEL };

const FULL_CONFIG = {
  DISCORD_CLIENT_ID: 'client-id-123',
  DISCORD_TOKEN: 'token-abc',
  GUILD_ID: 'guild-id-456',
};

/** The body handed to `rest.put`, unwrapped from the single recorded call. */
function putBody(): unknown {
  expect(mockPut).toHaveBeenCalledTimes(1);
  return (mockPut.mock.calls[0][1] as { body: unknown }).body;
}

describe('deployCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(FULL_CONFIG);
    mockPut.mockResolvedValue(undefined);
    vi.mocked(getCommandFiles).mockReturnValue([VALID_FIXTURE_PATH, NO_DEFAULT_FIXTURE_PATH]);
  });

  describe('fixture shapes (guards the rejection test against going vacuous)', () => {
    it('validCommand has a default export carrying data + execute', async () => {
      expect(validCommandFixture.data.name).toBe('fixture-valid');
      await expect(validCommandFixture.execute()).resolves.toBeUndefined();
    });

    it('noDefaultExport is deploy-shaped in every way EXCEPT the default export', async () => {
      // Both named exports are present and serializable, so the rejection below
      // can only be about the missing default export — nothing else.
      expect(noDefaultExportFixture.data.name).toBe('fixture-no-default');
      expect(noDefaultExportFixture.data.toJSON()).toEqual({ name: 'fixture-no-default' });
      await expect(noDefaultExportFixture.execute()).resolves.toBeUndefined();

      expect('default' in noDefaultExportFixture).toBe(false);
    });
  });

  describe('command loading', () => {
    it('deploys the default-exporting command and rejects the named-export module', async () => {
      await deployCommands(false);

      // EXACTLY one command — the no-default module must not slip in.
      expect(putBody()).toEqual([EXPECTED_VALID_JSON]);
      expect(mockPut).toHaveBeenCalledWith(
        Routes.applicationGuildCommands('client-id-123', 'guild-id-456'),
        { body: [EXPECTED_VALID_JSON] }
      );
    });

    it('warns with the offending file path when a module has no default export', async () => {
      await deployCommands(false);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        { filePath: NO_DEFAULT_FIXTURE_PATH },
        'Skipping invalid command file'
      );
      // The valid fixture must NOT have been warned about.
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it('serializes command data through toJSON rather than forwarding the raw builder', async () => {
      // The sentinel lives only in toJSON()'s output, so its presence in the
      // deploy payload is proof the serialization step actually ran.
      expect(validCommandFixture.data).not.toHaveProperty('description');

      await deployCommands(false);

      expect(JSON.stringify(putBody())).toContain(TO_JSON_SENTINEL);
    });

    it('deploys nothing when every discovered file is invalid', async () => {
      vi.mocked(getCommandFiles).mockReturnValue([NO_DEFAULT_FIXTURE_PATH]);

      await deployCommands(false);

      expect(putBody()).toEqual([]);
    });
  });

  describe('deployment target', () => {
    it('deploys to the guild route when global is false and a guild id is set', async () => {
      await deployCommands(false);

      expect(mockSetToken).toHaveBeenCalledWith('token-abc');
      expect(mockPut.mock.calls[0][0]).toBe(
        Routes.applicationGuildCommands('client-id-123', 'guild-id-456')
      );
    });

    it('deploys globally by default', async () => {
      await deployCommands();

      expect(mockPut.mock.calls[0][0]).toBe(Routes.applicationCommands('client-id-123'));
    });

    it('falls back to the global route when no guild id is configured', async () => {
      mockGetConfig.mockReturnValue({ ...FULL_CONFIG, GUILD_ID: undefined });

      await deployCommands(false);

      expect(mockPut.mock.calls[0][0]).toBe(Routes.applicationCommands('client-id-123'));
    });
  });

  describe('failure paths', () => {
    it('rejects when DISCORD_CLIENT_ID is missing', async () => {
      mockGetConfig.mockReturnValue({ ...FULL_CONFIG, DISCORD_CLIENT_ID: '' });

      await expect(deployCommands()).rejects.toThrow(
        'Missing DISCORD_CLIENT_ID or DISCORD_TOKEN environment variables'
      );
      expect(mockPut).not.toHaveBeenCalled();
    });

    it('rejects when DISCORD_TOKEN is missing', async () => {
      mockGetConfig.mockReturnValue({ ...FULL_CONFIG, DISCORD_TOKEN: undefined });

      await expect(deployCommands()).rejects.toThrow(
        'Missing DISCORD_CLIENT_ID or DISCORD_TOKEN environment variables'
      );
      expect(mockPut).not.toHaveBeenCalled();
    });

    it('logs and rethrows when the Discord API call fails', async () => {
      const apiError = new Error('Discord API rejected the deploy');
      mockPut.mockRejectedValue(apiError);

      await expect(deployCommands(false)).rejects.toThrow('Discord API rejected the deploy');
      expect(mockLogger.error).toHaveBeenCalledWith({ err: apiError }, 'Error deploying commands');
    });
  });
});

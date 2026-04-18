/**
 * Character Voice Command Tests
 *
 * Tests voice reference upload and clear handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
  updateCharacter: vi.fn(),
}));

import { handleVoice } from './voice.js';
import { fetchCharacter, updateCharacter } from './api.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const mockConfig = { GATEWAY_URL: 'http://test' } as unknown as EnvConfig;

function createMockContext(
  subcommand: string,
  options: Record<string, unknown> = {}
): DeferredCommandContext {
  return {
    interaction: {
      options: {
        getSubcommand: vi.fn().mockReturnValue(subcommand),
        getString: vi.fn().mockImplementation((name: string) => options[name] ?? null),
        getAttachment: vi.fn().mockImplementation((name: string) => options[name] ?? null),
      },
      guildId: 'guild-123',
    },
    user: { id: 'user-123', username: 'testuser', globalName: 'testuser' },
    editReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

describe('handleVoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('voice', () => {
    it('should reject non-audio files', async () => {
      const context = createMockContext('voice', {
        character: 'test-char',
        audio: { contentType: 'image/png', size: 1024, url: 'https://cdn.discordapp.com/file.png' },
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Invalid file type'));
      expect(fetchCharacter).not.toHaveBeenCalled();
    });

    it('should reject files that are too large', async () => {
      const context = createMockContext('voice', {
        character: 'test-char',
        audio: {
          contentType: 'audio/wav',
          size: 11 * 1024 * 1024, // 11MB, over the 10MB limit
          url: 'https://cdn.discordapp.com/file.wav',
        },
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('too large'));
    });

    it('should reject if character not found', async () => {
      const context = createMockContext('voice', {
        character: 'nonexistent',
        audio: { contentType: 'audio/wav', size: 1024, url: 'https://cdn.discordapp.com/file.wav' },
      });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should reject if user cannot edit character', async () => {
      const context = createMockContext('voice', {
        character: 'test-char',
        audio: { contentType: 'audio/wav', size: 1024, url: 'https://cdn.discordapp.com/file.wav' },
      });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'Test',
        displayName: 'Test',
        canEdit: false,
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining("don't have permission")
      );
    });

    it('should upload voice reference and enable voice on success', async () => {
      const mockAudioBuffer = Buffer.from('fake-audio-data');
      const mockFetchResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockAudioBuffer.buffer),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse));

      const context = createMockContext('voice', {
        character: 'test-char',
        audio: {
          contentType: 'audio/wav',
          size: mockAudioBuffer.length,
          url: 'https://cdn.discordapp.com/file.wav',
        },
      });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'Test',
        displayName: 'Test Character',
        canEdit: true,
      });
      (updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await handleVoice(context, mockConfig);

      expect(updateCharacter).toHaveBeenCalledWith(
        'test-char',
        {
          voiceReferenceData: expect.stringContaining('data:audio/wav;base64,'),
          voiceEnabled: true,
        },
        { discordId: 'user-123', username: 'testuser', displayName: 'testuser' },
        mockConfig
      );
      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Voice reference uploaded')
      );
    });

    it('should handle download failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const context = createMockContext('voice', {
        character: 'test-char',
        audio: {
          contentType: 'audio/wav',
          size: 1024,
          url: 'https://cdn.discordapp.com/file.wav',
        },
      });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'Test',
        displayName: 'Test',
        canEdit: true,
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to download'));
    });

    it('should accept null contentType as invalid', async () => {
      const context = createMockContext('voice', {
        character: 'test-char',
        audio: { contentType: null, size: 1024, url: 'https://cdn.discordapp.com/file' },
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Invalid file type'));
    });

    it('should reject malformed attachment URLs', async () => {
      const context = createMockContext('voice', {
        character: 'test-char',
        audio: {
          contentType: 'audio/wav',
          size: 1024,
          url: 'not-a-valid-url',
        },
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith('❌ Invalid attachment URL.');
      expect(fetchCharacter).not.toHaveBeenCalled();
    });

    it('should reject non-Discord CDN URLs', async () => {
      const context = createMockContext('voice', {
        character: 'test-char',
        audio: {
          contentType: 'audio/wav',
          size: 1024,
          url: 'https://evil.example.com/malicious.wav',
        },
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith('❌ Invalid attachment URL.');
      // Should reject before making any gateway calls
      expect(fetchCharacter).not.toHaveBeenCalled();
      expect(updateCharacter).not.toHaveBeenCalled();
    });
  });

  describe('voice-clear', () => {
    it('should reject if character not found', async () => {
      const context = createMockContext('voice-clear', { character: 'nonexistent' });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should reject if user cannot edit character', async () => {
      const context = createMockContext('voice-clear', { character: 'test-char' });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'Test',
        displayName: 'Test',
        canEdit: false,
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining("don't have permission")
      );
    });

    it('should clear voice reference and disable voice on success', async () => {
      const context = createMockContext('voice-clear', { character: 'test-char' });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'Test',
        displayName: 'Test Character',
        canEdit: true,
      });
      (updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await handleVoice(context, mockConfig);

      expect(updateCharacter).toHaveBeenCalledWith(
        'test-char',
        { voiceReferenceData: null, voiceEnabled: false },
        { discordId: 'user-123', username: 'testuser', displayName: 'testuser' },
        mockConfig
      );
      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Voice reference removed')
      );
    });
  });

  describe('unknown subcommand', () => {
    it('should reply with error for unknown subcommands', async () => {
      const context = createMockContext('voice-unknown', { character: 'test-char' });

      await handleVoice(context, mockConfig);

      expect(fetchCharacter).not.toHaveBeenCalled();
      expect(updateCharacter).not.toHaveBeenCalled();
      expect(context.editReply).toHaveBeenCalledWith('❌ Unknown voice command.');
    });
  });
});

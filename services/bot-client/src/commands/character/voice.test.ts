/**
 * Character Voice Command Tests
 *
 * Tests voice reference upload and clear handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
}));

vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
  updateCharacter: vi.fn(),
}));

import { GatewayApiError } from '@tzurot/clients';
import { handleVoice } from './voice.js';
import { fetchCharacter, updateCharacter } from './api.js';
import type { EnvConfig } from '@tzurot/common-types/config/config';
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
      const context = createMockContext('set', {
        character: 'test-char',
        audio: { contentType: 'image/png', size: 1024, url: 'https://cdn.discordapp.com/file.png' },
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid audio format')
      );
      expect(fetchCharacter).not.toHaveBeenCalled();
    });

    it('should reject files that are too large', async () => {
      const context = createMockContext('set', {
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
      const context = createMockContext('set', {
        character: 'nonexistent',
        audio: { contentType: 'audio/wav', size: 1024, url: 'https://cdn.discordapp.com/file.wav' },
      });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should reject if user cannot edit character', async () => {
      const context = createMockContext('set', {
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
        expect.stringContaining('do not have permission')
      );
    });

    it('should upload voice reference and enable voice on success', async () => {
      const mockAudioBuffer = Buffer.from('fake-audio-data');
      const mockFetchResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockAudioBuffer.buffer),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse));

      const context = createMockContext('set', {
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

      // Third arg is the `userClient` stub minted by the mocked `clientsFor`.
      // Auth identity now flows through the brand on `userClient`, not the
      // per-call payload, so the assertion is intentionally loose here.
      expect(updateCharacter).toHaveBeenCalledWith(
        'test-char',
        {
          voiceReferenceData: expect.stringContaining('data:audio/wav;base64,'),
          voiceEnabled: true,
        },
        expect.any(Object),
        mockConfig
      );
      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Voice reference uploaded')
      );
    });

    it('renders the outcome-uncertain shape on an upload timeout (never "try again")', async () => {
      // Wiring proof: a typed timeout from updateCharacter reaches the
      // classifier and renders the verify-first copy.
      const mockAudioBuffer = Buffer.from('fake-audio-data');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(mockAudioBuffer.buffer),
        })
      );
      const context = createMockContext('set', {
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
      (updateCharacter as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GatewayApiError('Failed to update personality: 0 - timed out', 0, 'timeout')
      );

      await handleVoice(context, mockConfig);

      const reply = (context.editReply as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as string;
      expect(reply).toContain('may still be applying');
      expect(reply).not.toMatch(/try again/i);
    });

    it('should handle download failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const context = createMockContext('set', {
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
      const context = createMockContext('set', {
        character: 'test-char',
        audio: { contentType: null, size: 1024, url: 'https://cdn.discordapp.com/file' },
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid audio format')
      );
    });

    it('should reject malformed attachment URLs', async () => {
      const context = createMockContext('set', {
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
      const context = createMockContext('set', {
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

    it('rejects the autocomplete-error sentinel before validating attachment', async () => {
      const context = createMockContext('set', {
        character: '__autocomplete_error__',
        audio: { contentType: 'audio/wav', size: 1024, url: 'https://cdn.discordapp.com/file.wav' },
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      // Sentinel guard is early-exit before any attachment validation or gateway call
      expect(fetchCharacter).not.toHaveBeenCalled();
    });
  });

  it('classifies a READ-phase failure as a load error, never write-uncertain', async () => {
    const context = createMockContext('set', {
      character: 'test-char',
      audio: {
        contentType: 'audio/wav',
        size: 1024,
        url: 'https://cdn.discordapp.com/file.wav',
      },
    });
    (fetchCharacter as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GatewayApiError('Failed to fetch character: 0 - timed out', 0, 'timeout')
    );

    await handleVoice(context, mockConfig);

    const reply = (context.editReply as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
    expect(reply).toContain("Couldn't load the character right now");
    expect(reply).not.toContain('may still be applying');
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('renders the retry-honest timeout line when the CDN download aborts', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
    const context = createMockContext('set', {
      character: 'test-char',
      audio: {
        contentType: 'audio/wav',
        size: 1024,
        url: 'https://cdn.discordapp.com/file.wav',
      },
    });
    (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'Test',
      displayName: 'Test Character',
      canEdit: true,
    });

    await handleVoice(context, mockConfig);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Voice download timed out')
    );
  });

  it('renders the download-failure line on a non-OK CDN response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    const context = createMockContext('set', {
      character: 'test-char',
      audio: {
        contentType: 'audio/wav',
        size: 1024,
        url: 'https://cdn.discordapp.com/file.wav',
      },
    });
    (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'Test',
      displayName: 'Test Character',
      canEdit: true,
    });

    await handleVoice(context, mockConfig);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to download the audio file')
    );
  });

  describe('voice clear', () => {
    it('classifies a clear-write timeout as outcome-uncertain', async () => {
      const context = createMockContext('clear', { character: 'test-char' });
      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'Test',
        displayName: 'Test Character',
        canEdit: true,
      });
      (updateCharacter as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GatewayApiError('Failed to update personality: 0 - timed out', 0, 'timeout')
      );

      await handleVoice(context, mockConfig);

      const reply = (context.editReply as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as string;
      expect(reply).toContain('may still be applying');
      expect(reply).not.toMatch(/try again/i);
    });

    it('should reject if character not found', async () => {
      const context = createMockContext('clear', { character: 'nonexistent' });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should reject if user cannot edit character', async () => {
      const context = createMockContext('clear', { character: 'test-char' });

      (fetchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'Test',
        displayName: 'Test',
        canEdit: false,
      });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining('do not have permission')
      );
    });

    it('should clear voice reference and disable voice on success', async () => {
      const context = createMockContext('clear', { character: 'test-char' });

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
        expect.any(Object),
        mockConfig
      );
      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Voice reference removed')
      );
    });

    it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
      const context = createMockContext('clear', { character: '__autocomplete_error__' });

      await handleVoice(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
      expect(fetchCharacter).not.toHaveBeenCalled();
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

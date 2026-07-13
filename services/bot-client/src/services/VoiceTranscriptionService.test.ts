/**
 * VoiceTranscriptionService Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VoiceTranscriptionService } from './VoiceTranscriptionService.js';
import type { Message } from 'discord.js';
import { MessageReferenceType } from 'discord.js';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';

// Mock dependencies
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  transcribe: vi.fn(),
}));

vi.mock('../redis.js', () => ({
  voiceTranscriptCache: {
    store: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types/utils/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/discord')>(
    '@tzurot/common-types/utils/discord'
  );
  return {
    ...actual,
    splitMessage: vi.fn((content: string) => {
      // Simple mock: split on 2000 char boundaries
      const chunks: string[] = [];
      for (let i = 0; i < content.length; i += 2000) {
        chunks.push(content.slice(i, i + 2000));
      }
      return chunks.length > 0 ? chunks : [content];
    }),
  };
});

import { splitMessage } from '@tzurot/common-types/utils/discord';
import { AudioTooLongError, SttUnavailableError } from '@tzurot/common-types/utils/errors';
import { voiceTranscriptCache } from '../redis.js';
import { transcribe } from '../utils/gatewayServiceCalls.js';

describe('VoiceTranscriptionService', () => {
  let service: VoiceTranscriptionService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    service = new VoiceTranscriptionService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('hasVoiceAttachment', () => {
    it('detects a voice message (audio content-type + duration)', () => {
      const message = createMockMessage({
        attachments: [
          {
            contentType: 'audio/ogg',
            duration: 5.2,
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(true);
    });

    it('does NOT treat a duration on a non-audio attachment as voice (guards against video)', () => {
      // A duration alone is not enough — a non-audio attachment that happens to
      // carry a duration (video, binary) is not a voice message.
      const message = createMockMessage({
        attachments: [
          {
            contentType: 'application/octet-stream',
            duration: 5.2,
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('does NOT transcribe a video attachment despite its duration (the MP4 false-positive)', () => {
      // A video carries a duration but a video/* content-type, so it must not be
      // treated as a voice message — the gate requires audio content-type AND duration.
      const message = createMockMessage({
        attachments: [
          {
            contentType: 'video/mp4',
            duration: 30,
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should return false for non-voice attachments', () => {
      const message = createMockMessage({
        attachments: [
          {
            contentType: 'image/png',
            duration: null,
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should return false when no attachments', () => {
      const message = createMockMessage({ attachments: [] });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should detect voice attachment in forwarded message snapshot', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.ogg',
                contentType: 'audio/ogg',
                name: 'voice.ogg',
                size: 50000,
                duration: 5.2,
              },
            ],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(true);
    });

    it('does NOT treat a forwarded duration-only (non-audio) snapshot attachment as voice', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.bin',
                contentType: 'application/octet-stream',
                name: 'voice.bin',
                size: 50000,
                duration: 10.0,
              },
            ],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('does NOT treat a forwarded video snapshot attachment as voice (MP4 false-positive)', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/video/forwarded.mp4',
                contentType: 'video/mp4',
                name: 'clip.mp4',
                size: 500000,
                duration: 30.0,
              },
            ],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should return false when forwarded snapshot has no audio', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/image.png',
                contentType: 'image/png',
                name: 'image.png',
                size: 50000,
                duration: null,
              },
            ],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should return false when forwarded snapshot has empty attachments', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should return false when forwarded snapshot has null attachments', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: null,
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });
  });

  describe('transcribe', () => {
    it('should skip transcription of bot own voice messages', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            duration: 5.2,
          },
        ],
        authorId: 'bot-user-999',
      });

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
      expect(vi.mocked(transcribe)).not.toHaveBeenCalled();
    });

    it('should transcribe voice message and send to Discord', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice-message.ogg',
            size: 50000,
            duration: 5.2,
            waveform: 'base64data',
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'This is the transcribed text',
      });

      const result = await service.transcribe(message, false, false);

      expect(result).toEqual({
        transcript: 'This is the transcribed text',
        continueToPersonalityHandler: false,
      });

      // Should send typing indicator
      expect((message.channel as { sendTyping?: unknown }).sendTyping).toHaveBeenCalledOnce();

      // Should call gateway transcribe with attachment metadata and userId
      expect(vi.mocked(transcribe)).toHaveBeenCalledWith(
        [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            originalUrl: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice-message.ogg',
            size: 50000,
            isVoiceMessage: true,
            duration: 5.2,
            waveform: 'base64data',
          },
        ],
        'test-user-123'
      );

      // Should reply with transcript (without pinging user)
      expect(message.reply).toHaveBeenCalledWith({
        content: 'This is the transcribed text',
        allowedMentions: { parse: [], repliedUser: false },
      });

      // Should cache in Redis
      expect(voiceTranscriptCache.store).toHaveBeenCalledWith(
        'https://cdn.discord.com/voice/123.ogg',
        'This is the transcribed text'
      );
    });

    it('appends a Discord subtext attribution to the last chunk when provider is known', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });
      vi.mocked(transcribe).mockResolvedValue({
        content: 'Hello there',
        provider: 'mistral',
      });

      await service.transcribe(message, false, false);

      // Single chunk → attribution appended to the only reply
      expect(message.reply).toHaveBeenCalledWith({
        content: 'Hello there\n-# Transcribed by [Mistral](<https://mistral.ai/news/voxtral>)',
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('omits attribution when provider is unknown (silent rather than ugly)', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });
      vi.mocked(transcribe).mockResolvedValue({
        content: 'Hello there',
        // no provider field
      });

      await service.transcribe(message, false, false);

      expect(message.reply).toHaveBeenCalledWith({
        content: 'Hello there',
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('omits attribution when showModelFooter=false (user opted out)', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });
      vi.mocked(transcribe).mockResolvedValue({
        content: 'Hello there',
        provider: 'mistral',
        showModelFooter: false, // explicit user-default opt-out
      });

      await service.transcribe(message, false, false);

      expect(message.reply).toHaveBeenCalledWith({
        content: 'Hello there',
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('renders attribution when showModelFooter=true (explicit opt-in)', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });
      vi.mocked(transcribe).mockResolvedValue({
        content: 'Hello there',
        provider: 'mistral',
        showModelFooter: true,
      });

      await service.transcribe(message, false, false);

      expect(message.reply).toHaveBeenCalledWith({
        content: 'Hello there\n-# Transcribed by [Mistral](<https://mistral.ai/news/voxtral>)',
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('renders attribution when showModelFooter is undefined (legacy back-compat)', async () => {
      // During a deploy-window mismatch where api-gateway hasn't deployed yet,
      // the bot-client may see responses without the showModelFooter field.
      // Footer should keep rendering — preserving the pre-toggle behavior.
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });
      vi.mocked(transcribe).mockResolvedValue({
        content: 'Hello there',
        provider: 'mistral',
        // showModelFooter intentionally omitted
      });

      await service.transcribe(message, false, false);

      expect(message.reply).toHaveBeenCalledWith({
        content: 'Hello there\n-# Transcribed by [Mistral](<https://mistral.ai/news/voxtral>)',
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('should set continueToPersonalityHandler=true when hasMention=true', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Transcript with mention',
      });

      const result = await service.transcribe(message, true, false);

      expect(result?.continueToPersonalityHandler).toBe(true);
    });

    it('should set continueToPersonalityHandler=true when isReply=true', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Transcript as reply',
      });

      const result = await service.transcribe(message, false, true);

      expect(result?.continueToPersonalityHandler).toBe(true);
    });

    it('should handle chunked transcripts', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 30.0,
          },
        ],
      });

      // Long transcript that will be chunked
      const longTranscript = 'x'.repeat(3000);
      vi.mocked(transcribe).mockResolvedValue({
        content: longTranscript,
      });

      await service.transcribe(message, false, false);

      // Should call splitMessage for chunking
      expect(splitMessage).toHaveBeenCalledWith(longTranscript);

      // Should send multiple replies (mocked to create 2 chunks)
      expect(message.reply).toHaveBeenCalledTimes(2);
    });

    it('falls back to a separate attribution message when inline would exceed the 2000-char limit', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 30.0,
          },
        ],
      });

      // 4000-char transcript → splits into [2000, 2000]. Inlining attribution
      // on the last chunk would yield 2045+ chars, tripping Discord's 50035
      // error. Verify the helper falls back to a separate follow-up reply.
      const longTranscript = 'x'.repeat(4000);
      vi.mocked(transcribe).mockResolvedValue({
        content: longTranscript,
        provider: 'voice-engine', // longest display name → worst-case overflow
      });

      await service.transcribe(message, false, false);

      // Expect 3 replies: chunk1 (2000), chunk2 (2000, raw), attribution (~46)
      expect(message.reply).toHaveBeenCalledTimes(3);
      const calls = (message.reply as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0].content).toBe('x'.repeat(2000));
      expect(calls[1][0].content).toBe('x'.repeat(2000));
      expect(calls[1][0].content).not.toContain('-# Transcribed by');
      expect(calls[2][0].content).toBe(
        '-# Transcribed by [Self-hosted (Parakeet TDT)](<https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2>)'
      );
    });

    it('attaches the provider attribution only to the LAST chunk on multi-chunk transcripts', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 30.0,
          },
        ],
      });

      // 3000-char transcript splits into two 2000-char chunks via the mocked
      // splitMessage at the top of this file. Pin the invariant that the
      // attribution rides only on the final chunk so future loop changes
      // can't silently put it on every chunk or skip it entirely.
      const longTranscript = 'x'.repeat(3000);
      vi.mocked(transcribe).mockResolvedValue({
        content: longTranscript,
        provider: 'mistral',
      });

      await service.transcribe(message, false, false);

      expect(message.reply).toHaveBeenCalledTimes(2);
      const calls = (message.reply as ReturnType<typeof vi.fn>).mock.calls;

      // First chunk: raw, no attribution
      expect(calls[0][0].content).toBe('x'.repeat(2000));
      expect(calls[0][0].content).not.toContain('-# Transcribed by');

      // Last chunk: ends with the attribution line
      expect(calls[1][0].content).toBe(
        `${'x'.repeat(1000)}\n-# Transcribed by [Mistral](<https://mistral.ai/news/voxtral>)`
      );
    });

    it('should handle missing contentType gracefully', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.bin',
            contentType: null,
            name: 'voice.bin',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Transcribed text',
      });

      await service.transcribe(message, false, false);

      // Should use CONTENT_TYPES.BINARY as fallback
      const call = vi.mocked(transcribe).mock.calls[0][0];
      expect(call[0].contentType).toBe(CONTENT_TYPES.BINARY);
    });

    it('should return null and send error message when transcription fails', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockRejectedValue(new Error('Transcription failed'));

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
      expect(message.reply).toHaveBeenCalledWith({
        content: "Sorry, I couldn't transcribe that voice message.",
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('should send timeout-specific error when transcription times out', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      // AbortSignal.timeout() throws DOMException with name 'TimeoutError'
      const timeoutError = new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError'
      );
      vi.mocked(transcribe).mockRejectedValue(timeoutError);

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('taking too long'),
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('should show a "too long" message when transcription rejects with AudioTooLongError', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 800,
          },
        ],
      });

      vi.mocked(transcribe).mockRejectedValue(new AudioTooLongError('Audio too long (800s).'));

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('too long'),
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('should return null when gateway returns empty response', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue(
        null as unknown as Awaited<ReturnType<typeof transcribe>>
      );

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
      expect(message.reply).toHaveBeenCalledWith({
        content: "Sorry, I couldn't transcribe that voice message.",
        allowedMentions: { parse: [], repliedUser: false },
      });
    });

    it('should return null when gateway returns response without content', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({ content: '' });

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
    });

    it('should not throw if error reply fails', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockRejectedValue(new Error('Transcription failed'));
      (message.reply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Channel deleted'));

      // Should not throw
      const result = await service.transcribe(message, false, false);
      expect(result).toBeNull();
    });

    it('should refresh typing indicator every 8s during long transcriptions', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 30.0,
          },
        ],
      });

      // Make transcription take time so intervals fire
      vi.mocked(transcribe).mockImplementation(
        () =>
          new Promise(resolve => {
            // eslint-disable-next-line no-restricted-syntax -- Mocked 20s transcription latency under vi.useFakeTimers(); driven by advanceTimersByTimeAsync below to prove the typing-refresh interval fires during a long transcription, not a real delay
            setTimeout(() => resolve({ content: 'Transcript' }), 20000);
          })
      );

      const promise = service.transcribe(message, false, false);

      // Initial sendTyping called immediately
      expect((message.channel as any).sendTyping).toHaveBeenCalledTimes(1);

      // Advance 8s — interval fires
      await vi.advanceTimersByTimeAsync(8000);
      expect((message.channel as any).sendTyping).toHaveBeenCalledTimes(2);

      // Advance another 8s — interval fires again
      await vi.advanceTimersByTimeAsync(8000);
      expect((message.channel as any).sendTyping).toHaveBeenCalledTimes(3);

      // Advance past the setTimeout (4s more to reach 20s total)
      await vi.advanceTimersByTimeAsync(4000);

      const result = await promise;
      expect(result?.transcript).toBe('Transcript');
    });

    it('should clear typing interval on success', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Transcript',
      });

      await service.transcribe(message, false, false);

      // After completion, advancing time should NOT trigger more sendTyping calls
      const callCount = (message.channel as any).sendTyping.mock.calls.length;
      await vi.advanceTimersByTimeAsync(16000);
      expect((message.channel as any).sendTyping).toHaveBeenCalledTimes(callCount);
    });

    it('should clear typing interval on error', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockRejectedValue(new Error('Network error'));

      await service.transcribe(message, false, false);

      // After error, advancing time should NOT trigger more sendTyping calls
      const callCount = (message.channel as any).sendTyping.mock.calls.length;
      await vi.advanceTimersByTimeAsync(16000);
      expect((message.channel as any).sendTyping).toHaveBeenCalledTimes(callCount);
    });

    describe('taking-longer notice', () => {
      const VOICE_ATTACHMENT = {
        url: 'https://cdn.discord.com/voice/123.ogg',
        contentType: 'audio/ogg',
        name: 'voice.ogg',
        size: 50000,
        duration: 5.2,
      };

      function transcribeResolvingAfter(ms: number, outcome: 'resolve' | 'reject'): void {
        vi.mocked(transcribe).mockImplementation(
          () =>
            new Promise((resolve, reject) => {
              setTimeout(() => {
                if (outcome === 'resolve') {
                  resolve({ content: 'Slow but successful transcript' });
                } else {
                  reject(new Error('slow failure'));
                }
              }, ms);
            })
        );
      }

      it('sends the notice ONCE past the threshold and deletes it on success', async () => {
        const message = createMockMessage({ attachments: [VOICE_ATTACHMENT], channelSend: true });
        transcribeResolvingAfter(40_000, 'resolve');

        const promise = service.transcribe(message, false, false);
        // Interval ticks at 8/16/24/32s — threshold (20s) crossed at the 24s tick.
        await vi.advanceTimersByTimeAsync(35_000);
        const send = (message.channel as any).send;
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toContain('taking longer than expected');

        await vi.advanceTimersByTimeAsync(10_000); // completes the transcription
        const result = await promise;
        expect(result?.transcript).toBe('Slow but successful transcript');

        // The notice must not linger next to the delivered transcript.
        const sentNotice = await send.mock.results[0].value;
        expect(sentNotice.delete).toHaveBeenCalledTimes(1);
      });

      it('never sends the notice on the fast path', async () => {
        const message = createMockMessage({ attachments: [VOICE_ATTACHMENT], channelSend: true });
        vi.mocked(transcribe).mockResolvedValue({ content: 'Fast transcript' });

        await service.transcribe(message, false, false);
        await vi.advanceTimersByTimeAsync(60_000); // interval already cleared

        expect((message.channel as any).send).not.toHaveBeenCalled();
      });

      it('deletes a notice whose send resolves AFTER the transcription finishes (race guard)', async () => {
        // The trickiest branch: finish() fires while channel.send is still in
        // flight. The late-resolving notice must be deleted on arrival, not
        // stranded as a false "still stuck" signal.
        const message = createMockMessage({ attachments: [VOICE_ATTACHMENT], channelSend: true });
        const lateDelete = vi.fn().mockResolvedValue(undefined);
        // Fake-timer delay (suite runs under vi.useFakeTimers): the send
        // resolves 30s after being triggered (~24s) = ~54s, well past the
        // transcription completing at 26s.
        const sendResolveDelayMs = 30_000;
        (message.channel as any).send = vi.fn().mockImplementation(
          () =>
            new Promise(resolve => {
              setTimeout(
                () => resolve({ id: 'late-notice', delete: lateDelete }),
                sendResolveDelayMs
              );
            })
        );
        transcribeResolvingAfter(26_000, 'resolve');

        const promise = service.transcribe(message, false, false);
        await vi.advanceTimersByTimeAsync(26_000); // notice triggered at 24s; transcription done at 26s
        const result = await promise;
        expect(result?.transcript).toBe('Slow but successful transcript');
        expect(lateDelete).not.toHaveBeenCalled(); // send still in flight

        await vi.advanceTimersByTimeAsync(30_000); // the late send resolves
        expect(lateDelete).toHaveBeenCalledTimes(1);
      });

      it('survives a failed notice send (transcript still delivered)', async () => {
        const message = createMockMessage({ attachments: [VOICE_ATTACHMENT], channelSend: true });
        (message.channel as any).send = vi.fn().mockRejectedValue(new Error('Missing Permissions'));
        transcribeResolvingAfter(30_000, 'resolve');

        const promise = service.transcribe(message, false, false);
        await vi.advanceTimersByTimeAsync(35_000);
        const result = await promise;

        expect((message.channel as any).send).toHaveBeenCalledTimes(1);
        expect(result?.transcript).toBe('Slow but successful transcript');
      });

      it('deletes the notice on error too (three-state UX: typing → notice → error)', async () => {
        const message = createMockMessage({ attachments: [VOICE_ATTACHMENT], channelSend: true });
        transcribeResolvingAfter(30_000, 'reject');

        const promise = service.transcribe(message, false, false);
        await vi.advanceTimersByTimeAsync(24_000);
        const send = (message.channel as any).send;
        expect(send).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(10_000);
        const result = await promise;
        expect(result).toBeNull(); // error path replies + returns null

        const sentNotice = await send.mock.results[0].value;
        expect(sentNotice.delete).toHaveBeenCalledTimes(1);
      });
    });

    it('shows the retry-aware message for SttUnavailableError', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      vi.mocked(transcribe).mockRejectedValue(new SttUnavailableError());

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('temporarily unavailable'),
        })
      );
    });

    it('should skip typing indicator if channel does not support it', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
        noTypingSupport: true,
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Transcript',
      });

      await service.transcribe(message, false, false);

      // Should not have called sendTyping
      expect((message.channel as { sendTyping?: unknown }).sendTyping).toBeUndefined();
    });

    it('should transcribe voice from forwarded message snapshot when no direct attachments', async () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.ogg',
                contentType: 'audio/ogg',
                name: 'forwarded-voice.ogg',
                size: 45000,
                duration: 8.5,
                waveform: 'forwardedWaveformData',
              },
            ],
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Transcribed from forwarded message',
      });

      const result = await service.transcribe(message, false, false);

      expect(result).toEqual({
        transcript: 'Transcribed from forwarded message',
        continueToPersonalityHandler: false,
      });

      // Should call gateway transcribe with forwarded attachment metadata and userId
      expect(vi.mocked(transcribe)).toHaveBeenCalledWith(
        [
          {
            url: 'https://cdn.discord.com/voice/forwarded.ogg',
            originalUrl: 'https://cdn.discord.com/voice/forwarded.ogg',
            contentType: 'audio/ogg',
            name: 'forwarded-voice.ogg',
            size: 45000,
            isVoiceMessage: true,
            duration: 8.5,
            waveform: 'forwardedWaveformData',
          },
        ],
        'test-user-123'
      );

      // Should cache in Redis with forwarded attachment URL
      expect(voiceTranscriptCache.store).toHaveBeenCalledWith(
        'https://cdn.discord.com/voice/forwarded.ogg',
        'Transcribed from forwarded message'
      );
    });

    it('should handle forwarded snapshot with null contentType', async () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.bin',
                contentType: null,
                name: 'forwarded-voice.bin',
                size: 45000,
                duration: 5.0,
              },
            ],
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Transcribed with fallback content type',
      });

      await service.transcribe(message, false, false);

      // Should use CONTENT_TYPES.BINARY as fallback
      const call = vi.mocked(transcribe).mock.calls[0][0];
      expect(call[0].contentType).toBe(CONTENT_TYPES.BINARY);
    });

    it('should prefer direct attachments over forwarded snapshots', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/direct.ogg',
            contentType: 'audio/ogg',
            name: 'direct-voice.ogg',
            size: 30000,
            duration: 3.0,
          },
        ],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.ogg',
                contentType: 'audio/ogg',
                name: 'forwarded-voice.ogg',
                size: 45000,
                duration: 8.5,
              },
            ],
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Transcribed direct attachment',
      });

      await service.transcribe(message, false, false);

      // Should use direct attachment, not forwarded
      const call = vi.mocked(transcribe).mock.calls[0][0];
      expect(call[0].url).toBe('https://cdn.discord.com/voice/direct.ogg');
    });

    it('should filter out non-audio attachments from direct attachments', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/audio.ogg',
            contentType: 'audio/ogg',
            name: 'voice-message.ogg',
            size: 30000,
            duration: 3.0,
          },
          {
            url: 'https://cdn.discord.com/images/photo.png',
            contentType: 'image/png',
            name: 'photo.png',
            size: 500000,
            duration: null,
          },
        ],
      });

      vi.mocked(transcribe).mockResolvedValue({
        content: 'Audio only transcript',
      });

      await service.transcribe(message, false, false);

      // Should only send the audio attachment, not the image
      const call = vi.mocked(transcribe).mock.calls[0][0];
      expect(call).toHaveLength(1);
      expect(call[0].url).toBe('https://cdn.discord.com/voice/audio.ogg');
    });

    describe('bot-authored audio (forwarded persona voice messages)', () => {
      // Bot's clientId is 'bot-user-999' per createMockMessage's default.
      // Filenames matching `bot-user-999-{slug}-{ts}.{ext}` are recognized
      // as our own TTS output and should bypass STT entirely.
      const ownFilename = 'bot-user-999-lila-zot-lilit-mon8lv05.ogg';

      it('skips gateway STT call when forwarded snapshot audio is bot-authored', async () => {
        const message = createMockMessage({
          attachments: [],
          messageSnapshots: [
            {
              attachments: [
                {
                  url: 'https://cdn.discord.com/voice/forwarded.ogg',
                  contentType: 'audio/ogg',
                  name: ownFilename,
                  size: 50000,
                  duration: 5.2,
                },
              ],
            },
          ],
        });

        const result = await service.transcribe(message, false, false);

        expect(vi.mocked(transcribe)).not.toHaveBeenCalled();
        expect(result?.transcript).toContain('Forwarded voice message');
        expect(result?.transcript).toContain('lila-zot-lilit');
      });

      it('caches the placeholder so re-forwards reuse the same text', async () => {
        const message = createMockMessage({
          attachments: [],
          messageSnapshots: [
            {
              attachments: [
                {
                  url: 'https://cdn.discord.com/voice/forwarded.ogg',
                  contentType: 'audio/ogg',
                  name: ownFilename,
                  size: 50000,
                  duration: 5.2,
                },
              ],
            },
          ],
        });

        await service.transcribe(message, false, false);

        expect(voiceTranscriptCache.store).toHaveBeenCalledWith(
          'https://cdn.discord.com/voice/forwarded.ogg',
          expect.stringContaining('Forwarded voice message')
        );
      });

      it('does NOT post a visible reply — the skip is silent (log-only)', async () => {
        // The "we didn't re-transcribe our own TTS" notice is an implementation
        // detail; users shouldn't see it. We cache the placeholder for the
        // model's context but post nothing to the channel.
        const message = createMockMessage({
          attachments: [],
          messageSnapshots: [
            {
              attachments: [
                {
                  url: 'https://cdn.discord.com/voice/forwarded.ogg',
                  contentType: 'audio/ogg',
                  name: ownFilename,
                  size: 50000,
                  duration: 5.2,
                },
              ],
            },
          ],
        });

        await service.transcribe(message, false, false);

        const replyMock = (message as unknown as { reply: ReturnType<typeof vi.fn> }).reply;
        expect(replyMock).not.toHaveBeenCalled();
      });

      it('preserves continueToPersonalityHandler when forward has a mention/reply', async () => {
        const message = createMockMessage({
          attachments: [],
          messageSnapshots: [
            {
              attachments: [
                {
                  url: 'https://cdn.discord.com/voice/forwarded.ogg',
                  contentType: 'audio/ogg',
                  name: ownFilename,
                  size: 50000,
                  duration: 5.2,
                },
              ],
            },
          ],
        });

        const result = await service.transcribe(message, true, false);

        expect(result?.continueToPersonalityHandler).toBe(true);
      });

      it('does NOT skip STT when filename is from a different bot identity', async () => {
        // Filename is well-formed but uses someone else's clientId. This bot
        // should treat it as a regular forwarded audio (transcribe normally).
        const otherBotFilename = '111111111111111111-lila-zot-lilit-mon8lv05.ogg';
        const message = createMockMessage({
          attachments: [],
          messageSnapshots: [
            {
              attachments: [
                {
                  url: 'https://cdn.discord.com/voice/forwarded.ogg',
                  contentType: 'audio/ogg',
                  name: otherBotFilename,
                  size: 50000,
                  duration: 5.2,
                },
              ],
            },
          ],
        });
        vi.mocked(transcribe).mockResolvedValue({ content: 'transcribed text' });

        await service.transcribe(message, false, false);

        expect(vi.mocked(transcribe)).toHaveBeenCalledTimes(1);
      });

      it('falls through to normal STT when batch has mixed bot/human attachments', async () => {
        // Documented edge case in `classifyAsOwnBotAudio`: only short-circuits
        // when ALL attachments are bot-authored. A mixed batch (rare in
        // practice — voice messages are typically single-attachment) preserves
        // the human-authored audio's transcription by going through the
        // normal STT path.
        const message = createMockMessage({
          attachments: [],
          messageSnapshots: [
            {
              attachments: [
                {
                  url: 'https://cdn.discord.com/voice/bot.ogg',
                  contentType: 'audio/ogg',
                  name: ownFilename,
                  size: 50000,
                  duration: 5.2,
                },
                {
                  url: 'https://cdn.discord.com/voice/human.ogg',
                  contentType: 'audio/ogg',
                  name: 'human-recording.ogg',
                  size: 50000,
                  duration: 5.2,
                },
              ],
            },
          ],
        });
        vi.mocked(transcribe).mockResolvedValue({ content: 'transcribed text' });

        await service.transcribe(message, false, false);

        expect(vi.mocked(transcribe)).toHaveBeenCalledTimes(1);
      });

      it('falls through to normal STT when message.client.user is undefined', async () => {
        // discord.js types `client.user` as optional. Symmetric with the
        // send-side fallback in DiscordResponseSender: if we can't read the
        // bot's clientId, we can't classify, so we degrade to normal STT.
        // The fallback path is otherwise covered implicitly by the
        // `attachments.length === 0` guard, but this test makes the
        // contract explicit.
        const message = createMockMessage({
          attachments: [],
          messageSnapshots: [
            {
              attachments: [
                {
                  url: 'https://cdn.discord.com/voice/forwarded.ogg',
                  contentType: 'audio/ogg',
                  name: ownFilename,
                  size: 50000,
                  duration: 5.2,
                },
              ],
            },
          ],
        });
        // Override the default mock client.user.id to undefined.
        (message as unknown as { client: { user: undefined } }).client = { user: undefined };
        vi.mocked(transcribe).mockResolvedValue({ content: 'transcribed text' });

        await service.transcribe(message, false, false);

        expect(vi.mocked(transcribe)).toHaveBeenCalledTimes(1);
      });

      it('does NOT skip STT for legacy voice.ogg filenames', async () => {
        // Pre-fix uploads used `voice.{ext}`. Forwards of those should fall
        // through to normal STT (no clientId match in the filename).
        const message = createMockMessage({
          attachments: [],
          messageSnapshots: [
            {
              attachments: [
                {
                  url: 'https://cdn.discord.com/voice/legacy.ogg',
                  contentType: 'audio/ogg',
                  name: 'voice.ogg',
                  size: 50000,
                  duration: 5.2,
                },
              ],
            },
          ],
        });
        vi.mocked(transcribe).mockResolvedValue({ content: 'transcribed text' });

        await service.transcribe(message, false, false);

        expect(vi.mocked(transcribe)).toHaveBeenCalledTimes(1);
      });
    });
  });
});

// Helper function to create mock Discord message
interface MockAttachment {
  url?: string;
  contentType?: string | null;
  name?: string;
  size?: number;
  duration?: number | null;
  waveform?: string | null;
}

interface MockSnapshotAttachment {
  url: string;
  contentType: string | null;
  name: string;
  size: number;
  duration: number | null;
  waveform?: string | null;
}

interface MockMessageSnapshot {
  attachments: MockSnapshotAttachment[] | null;
}

interface MockMessageOptions {
  attachments?: MockAttachment[];
  messageSnapshots?: MockMessageSnapshot[];
  noTypingSupport?: boolean;
  authorId?: string;
  /** Give the mock channel a `send` method (the taking-longer notice path). */
  channelSend?: boolean;
}

function createMockAttachmentsMap(attachmentsList: MockSnapshotAttachment[] | null): Map<
  string,
  MockSnapshotAttachment
> & {
  some: (predicate: (a: MockSnapshotAttachment) => boolean) => boolean;
} {
  const map = new Map<string, MockSnapshotAttachment>();

  if (attachmentsList) {
    attachmentsList.forEach((att, index) => {
      map.set(`snapshot-att-${index}`, att);
    });
  }

  // Add Collection-like methods
  (map as any).some = function (predicate: (a: MockSnapshotAttachment) => boolean) {
    for (const value of this.values()) {
      if (predicate(value)) {
        return true;
      }
    }
    return false;
  };

  return map as Map<string, MockSnapshotAttachment> & {
    some: (predicate: (a: MockSnapshotAttachment) => boolean) => boolean;
  };
}

function createMockMessage(options: MockMessageOptions = {}): Message {
  const attachments = new Map();

  (options.attachments || []).forEach((att, index) => {
    attachments.set(`attachment-${index}`, {
      url: att.url || `https://cdn.discord.com/file-${index}`,
      contentType: att.contentType === undefined ? 'application/octet-stream' : att.contentType,
      name: att.name || `file-${index}`,
      size: att.size || 1000,
      duration: att.duration === undefined ? null : att.duration,
      waveform: att.waveform,
    });
  });

  // Add Collection-like methods to Map (Discord.js Collection extends Map)
  (attachments as any).some = function (predicate: any) {
    for (const value of this.values()) {
      if (predicate(value)) {
        return true;
      }
    }
    return false;
  };

  // Create messageSnapshots if provided
  let messageSnapshots:
    Map<string, { attachments: ReturnType<typeof createMockAttachmentsMap> }> | undefined;
  if (options.messageSnapshots && options.messageSnapshots.length > 0) {
    messageSnapshots = new Map();
    options.messageSnapshots.forEach((snapshot, index) => {
      messageSnapshots!.set(`snapshot-${index}`, {
        attachments: createMockAttachmentsMap(snapshot.attachments),
      });
    });
  }

  const channel: any = options.noTypingSupport
    ? {}
    : {
        sendTyping: vi.fn().mockResolvedValue(undefined),
        ...(options.channelSend === true && {
          send: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve({ id: 'notice-123', delete: vi.fn().mockResolvedValue(undefined) })
            ),
        }),
      };

  // If messageSnapshots is provided, include forward reference type
  // This is required by the centralized forwardedMessageUtils detection
  const reference = messageSnapshots !== undefined ? { type: MessageReferenceType.Forward } : null;

  return {
    attachments,
    messageSnapshots,
    reference,
    channel,
    author: { id: options.authorId ?? 'test-user-123' },
    client: { user: { id: 'bot-user-999' } },
    reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
  } as unknown as Message;
}

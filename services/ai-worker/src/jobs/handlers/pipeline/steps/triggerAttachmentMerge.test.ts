/**
 * triggerAttachmentMerge Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import type { ProcessedAttachment } from '../../../../services/MultimodalProcessor.js';
import { buildAttachmentDescriptions } from '../../../../services/RAGUtils.js';
import type { TriggerAttachmentDownload } from '../types.js';
import {
  mergeTriggerAttachments,
  restoreOriginalMetadata,
  urlBasename,
} from './triggerAttachmentMerge.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

const AUDIO_URL = 'https://cdn.example.com/attachments/1/1/voice-message.ogg';
const PHOTO_URL = 'https://cdn.example.com/attachments/1/2/photo.png';
const PDF_URL = 'https://cdn.example.com/attachments/1/3/report.pdf';
const DATA_URL = 'data:application/octet-stream;base64,AAAA';

const audio: AttachmentMetadata = {
  url: AUDIO_URL,
  name: 'voice-message.ogg',
  contentType: 'audio/ogg',
  size: 100,
  isVoiceMessage: true,
  duration: 5.2,
};
const photo: AttachmentMetadata = {
  url: PHOTO_URL,
  name: 'photo.png',
  contentType: 'image/png',
  size: 200,
};
const pdf: AttachmentMetadata = {
  url: PDF_URL,
  name: 'report.pdf',
  contentType: 'application/pdf',
  size: 300,
};

const downloadedCopy = (a: AttachmentMetadata): AttachmentMetadata => ({
  ...a,
  url: DATA_URL,
  originalUrl: a.url,
});
const ok = (a: AttachmentMetadata): TriggerAttachmentDownload => ({
  original: a,
  downloaded: downloadedCopy(a),
});
const failedDownload = (a: AttachmentMetadata): TriggerAttachmentDownload => ({
  original: a,
  downloaded: null,
});

const jobEntry = (
  type: ProcessedAttachment['type'],
  url: string,
  description: string,
  name = 'placeholder'
): ProcessedAttachment => ({
  type,
  description,
  originalUrl: url,
  metadata: { url, name, contentType: 'unknown/unknown', size: 0 },
});

const noInline = vi.fn<(attachments: AttachmentMetadata[]) => Promise<ProcessedAttachment[]>>();

describe('triggerAttachmentMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noInline.mockReset();
  });

  describe('mergeTriggerAttachments', () => {
    it('keeps original order for a mixed trigger and inlines the pdf with its CDN URL', async () => {
      noInline.mockResolvedValueOnce([
        {
          type: AttachmentType.File,
          description: 'not supported',
          originalUrl: DATA_URL,
          metadata: downloadedCopy(pdf),
        },
      ]);
      const downloads = [ok(audio), ok(photo), ok(pdf)];
      // Job results arrive in job order [photo, audio].
      const jobEntries = [
        jobEntry(AttachmentType.Image, PHOTO_URL, 'a photo'),
        jobEntry(AttachmentType.Audio, AUDIO_URL, 'hello there'),
      ];

      const merged = await mergeTriggerAttachments({
        jobEntries,
        downloads,
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged.map(m => m.type)).toEqual([
        AttachmentType.Audio,
        AttachmentType.Image,
        AttachmentType.File,
      ]);
      expect(noInline).toHaveBeenCalledTimes(1);
      expect(noInline).toHaveBeenCalledWith([downloadedCopy(pdf)]);
      expect(merged[2].originalUrl).toBe(PDF_URL);
      expect(merged[2].metadata.url).toBe(PDF_URL);
      expect(merged[2].metadata.name).toBe('report.pdf');
    });

    it('turns a failed STT job into an audio stub that keeps the original flags', async () => {
      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [ok(audio)],
        audioFailures: [{ url: AUDIO_URL, failureReason: 'too_long' }],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged).toHaveLength(1);
      expect(merged[0].type).toBe(AttachmentType.Audio);
      expect(merged[0].description).toBe('Audio transcription failed (too_long)');
      expect(merged[0].processingFailed).toBe(true);
      expect(merged[0].metadata.isVoiceMessage).toBe(true);
      expect(merged[0].metadata.duration).toBe(5.2);
      expect(merged[0].metadata.url).toBe(AUDIO_URL);
    });

    it('falls back to "other" when a failed STT job carries no reason', async () => {
      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [ok(audio)],
        audioFailures: [{ url: AUDIO_URL }],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].description).toBe('Audio transcription failed (other)');
    });

    it('stubs a downloaded image that no job result covers', async () => {
      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [ok(photo)],
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].type).toBe(AttachmentType.Image);
      expect(merged[0].description).toBe('Image processing failed (no result returned)');
      expect(merged[0].processingFailed).toBe(true);
    });

    it('stubs an original whose download failed', async () => {
      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [failedDownload(photo)],
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].description).toBe('Image processing failed (download failed)');
      expect(noInline).not.toHaveBeenCalled();
    });

    it('prefers the job entry over a stub when the download failed but a result exists', async () => {
      const merged = await mergeTriggerAttachments({
        jobEntries: [jobEntry(AttachmentType.Audio, AUDIO_URL, 'hello there')],
        downloads: [failedDownload(audio)],
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].description).toBe('hello there');
    });

    it('keeps the real name and voice flag for a not-downloaded original after the metadata join', async () => {
      const placeholder = jobEntry(
        AttachmentType.Audio,
        AUDIO_URL,
        'hello there',
        urlBasename(AUDIO_URL)
      );
      const downloads = [failedDownload({ ...audio, name: 'my recording.ogg' })];
      const joined = restoreOriginalMetadata(
        [placeholder],
        downloads.map(d => d.original),
        'job-1'
      );

      const merged = await mergeTriggerAttachments({
        jobEntries: joined,
        downloads,
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].metadata.name).toBe('my recording.ogg');
      expect(merged[0].metadata.isVoiceMessage).toBe(true);
      expect(buildAttachmentDescriptions(merged)).toContain('[Voice message:');
    });

    it('renders an empty-transcript STT success as "No speech detected" with the original flags', async () => {
      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [ok(audio)],
        audioFailures: [],
        audioEmpties: [{ url: AUDIO_URL }],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged).toHaveLength(1);
      expect(merged[0].type).toBe(AttachmentType.Audio);
      expect(merged[0].description).toBe('No speech detected');
      expect(merged[0].originalUrl).toBe(AUDIO_URL);
      expect(merged[0].metadata.isVoiceMessage).toBe(true);
      expect(merged[0].description).not.toContain('failed');
      // 'No speech detected' is a pinned SUCCESS entry — it must stay wrapped,
      // so processingFailed stays unset.
      expect(merged[0].processingFailed).toBeUndefined();
      expect(buildAttachmentDescriptions(merged)).toContain('[Voice message:');
      expect(buildAttachmentDescriptions(merged)).toContain('<voice_transcripts>');
    });

    it('appends a job entry that matches no original without a second warning', async () => {
      const orphan = jobEntry(
        AttachmentType.Image,
        'https://cdn.example.com/attachments/9/9/x.png',
        'orphan'
      );

      const merged = await mergeTriggerAttachments({
        jobEntries: [orphan],
        downloads: [ok(audio)],
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged).toHaveLength(2);
      expect(merged[1]).toBe(orphan);
      // restoreOriginalMetadata already warns about unmatched entries.
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('produces nothing for an audio failure that matches no original', async () => {
      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [],
        audioFailures: [{ url: AUDIO_URL, failureReason: 'timeout' }],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged).toEqual([]);
    });

    it('consumes each audio failure once, so a second original with no failure gets the no-result stub', async () => {
      const secondAudio: AttachmentMetadata = {
        ...audio,
        url: 'https://cdn.example.com/attachments/1/9/second.ogg',
        name: 'second.ogg',
      };

      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [ok(audio), ok(secondAudio)],
        audioFailures: [{ url: AUDIO_URL, failureReason: 'too_long' }],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].description).toBe('Audio transcription failed (too_long)');
      expect(merged[1].description).toBe('Audio transcription failed (no result returned)');
      expect(merged[1].originalUrl).toBe(secondAudio.url);
    });

    it('consumes a failure for only one of two originals that share its URL', async () => {
      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [ok(audio), ok({ ...audio })],
        audioFailures: [{ url: AUDIO_URL, failureReason: 'too_long' }],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].description).toBe('Audio transcription failed (too_long)');
      expect(merged[1].description).toBe('Audio transcription failed (no result returned)');
    });

    it('never copies a data-URL original into a no-result stub', async () => {
      const dataPhoto: AttachmentMetadata = { ...photo, url: DATA_URL };

      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [{ original: dataPhoto, downloaded: dataPhoto }],
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].description).toBe('Image processing failed (no result returned)');
      expect(merged[0].originalUrl).toBe('');
      expect(merged[0].metadata.url).toBe('');
      expect(JSON.stringify(merged[0])).not.toContain('data:');
    });

    it('never copies a data-URL original into an inline file entry', async () => {
      const dataPdf: AttachmentMetadata = { ...pdf, url: DATA_URL };
      noInline.mockResolvedValueOnce([
        {
          type: AttachmentType.File,
          description: 'not supported',
          originalUrl: DATA_URL,
          metadata: { ...dataPdf },
        },
      ]);

      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [{ original: dataPdf, downloaded: dataPdf }],
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].originalUrl).toBe('');
      expect(merged[0].metadata.url).toBe('');
      expect(JSON.stringify(merged[0])).not.toContain('data:');
    });

    it('stubs the file slots when inline processing throws', async () => {
      noInline.mockRejectedValueOnce(new Error('boom'));

      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [ok(pdf)],
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].type).toBe(AttachmentType.File);
      expect(merged[0].description).toBe('File could not be processed (processing failed)');
      expect(merged[0].processingFailed).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { err: expect.any(Error), jobId: 'job-1', count: 1 },
        'Inline processing of trigger files threw'
      );
    });

    it('stubs the file slots when inline processing returns a list of the wrong length', async () => {
      noInline.mockResolvedValueOnce([]);

      const merged = await mergeTriggerAttachments({
        jobEntries: [],
        downloads: [ok(pdf)],
        audioFailures: [],
        processInline: noInline,
        jobId: 'job-1',
      });

      expect(merged[0].description).toBe('File could not be processed (processing failed)');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { jobId: 'job-1', count: 1 },
        'Inline processing of trigger files failed'
      );
    });
  });

  describe('urlBasename', () => {
    it('drops the query string of a signed CDN URL', () => {
      expect(urlBasename('https://cdn.discordapp.com/attachments/1/2/cat.png?ex=1&is=2&hm=3')).toBe(
        'cat.png'
      );
    });

    it('falls back to the plain split for a string that is not a URL', () => {
      expect(urlBasename('not a url/dog.png')).toBe('dog.png');
    });

    it('returns "image" for a data URL instead of its payload', () => {
      expect(urlBasename('data:image/png;base64,AAAA')).toBe('image');
    });

    it('falls back to "image" when nothing is left', () => {
      expect(urlBasename('')).toBe('image');
    });
  });
});

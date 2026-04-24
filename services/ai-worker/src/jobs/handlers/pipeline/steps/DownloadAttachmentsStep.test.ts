/**
 * DownloadAttachmentsStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType, type LLMGenerationJobData, type LoadedPersonality } from '@tzurot/common-types';
import { DownloadAttachmentsStep } from './DownloadAttachmentsStep.js';
import { AttachmentTooLargeError, HttpError } from '../../../../utils/attachmentFetch.js';
import type { GenerationContext } from '../types.js';

// Mock logger so it doesn't pollute test output.
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

// Mock the attachmentFetch utility so tests control fetch / validation /
// resize without hitting network or sharp. ExpiredJobError and the data-url
// helpers are passed through from the real module.
const { fetchAttachmentBytesMock, validateAttachmentUrlMock, resizeImageIfNeededMock } = vi.hoisted(
  () => ({
    fetchAttachmentBytesMock: vi.fn(),
    validateAttachmentUrlMock: vi.fn((url: string) => url),
    // Default: pass-through — returns { buffer, contentType } matching the real
    // function's no-resize branch. Individual tests override to simulate the
    // JPEG-conversion path when they want to exercise it.
    resizeImageIfNeededMock: vi.fn((buffer: Buffer, contentType: string) =>
      Promise.resolve({ buffer, contentType })
    ),
  })
);

vi.mock('../../../../utils/attachmentFetch.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../utils/attachmentFetch.js')>();
  return {
    ...actual,
    fetchAttachmentBytes: fetchAttachmentBytesMock,
    validateAttachmentUrl: validateAttachmentUrlMock,
    resizeImageIfNeeded: resizeImageIfNeededMock,
  };
});

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'p-1',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  systemPrompt: 'x',
  model: 'anthropic/claude-sonnet-4',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'x',
  personalityTraits: 'x',
  voiceEnabled: false,
};

function createJob(
  attachments: LLMGenerationJobData['context']['attachments'] = [],
  extendedContextAttachments: LLMGenerationJobData['context']['extendedContextAttachments'] = [],
  timestamp: number = Date.now()
): Job<LLMGenerationJobData> {
  return {
    id: 'job-123',
    timestamp,
    data: {
      requestId: 'req-001',
      jobType: JobType.LLMGeneration,
      personality: TEST_PERSONALITY,
      message: 'hi',
      context: {
        userId: 'u-1',
        userName: 'U',
        channelId: 'c-1',
        attachments,
        extendedContextAttachments,
      },
      responseDestination: { type: 'discord', channelId: 'c-1' },
    } as LLMGenerationJobData,
  } as unknown as Job<LLMGenerationJobData>;
}

function createContext(job: Job<LLMGenerationJobData>): GenerationContext {
  return { job, startTime: Date.now() };
}

describe('DownloadAttachmentsStep', () => {
  let step: DownloadAttachmentsStep;

  beforeEach(() => {
    vi.clearAllMocks();
    validateAttachmentUrlMock.mockImplementation((url: string) => url);
    resizeImageIfNeededMock.mockImplementation((buffer: Buffer, contentType: string) =>
      Promise.resolve({ buffer, contentType })
    );
    // retryDelayMs = 0 so the retry test finishes instantly instead of waiting
    // on a real 500ms setTimeout. Production uses the 500ms default.
    step = new DownloadAttachmentsStep(/* retryDelayMs= */ 0);
  });

  it('has correct name', () => {
    expect(step.name).toBe('DownloadAttachments');
  });

  it('passes through when there are no attachments (noop)', async () => {
    const job = createJob([], []);
    await step.process(createContext(job));
    expect(fetchAttachmentBytesMock).not.toHaveBeenCalled();
  });

  it('fails fast with ExpiredJobError when queue-age exceeds 12h, without fetching', async () => {
    const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
    const job = createJob(
      [{ url: 'https://cdn.discordapp.com/a/b/c.png', contentType: 'image/png', name: 'c.png' }],
      [],
      thirteenHoursAgo
    );

    await expect(step.process(createContext(job))).rejects.toThrow(/URLs have likely expired/);
    // Load-bearing assertion: pins the gate against future refactors that
    // might move it past the fetch call.
    expect(fetchAttachmentBytesMock).not.toHaveBeenCalled();
  });

  it('does not throw ExpiredJobError when there are no attachments, even on a stale job', async () => {
    // Pins the early-return-before-queue-age-gate ordering: the gate only
    // exists to guard against 403s from expired CDN URLs, so it should not
    // fire when there are no URLs. A text-only message queued through a
    // multi-hour backpressure incident must complete cleanly.
    const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
    const job = createJob([], [], thirteenHoursAgo);

    await expect(step.process(createContext(job))).resolves.toBeDefined();
    expect(fetchAttachmentBytesMock).not.toHaveBeenCalled();
  });

  it('happy path: downloads a single image and rewrites url to data URL', async () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    fetchAttachmentBytesMock.mockResolvedValueOnce(imageBytes);

    const job = createJob([
      { url: 'https://cdn.discordapp.com/a/b/cat.png', contentType: 'image/png', name: 'cat.png' },
    ]);
    await step.process(createContext(job));

    const result = job.data.context.attachments![0];
    expect(result.url).toMatch(/^data:image\/png;base64,/);
    expect(result.originalUrl).toBe('https://cdn.discordapp.com/a/b/cat.png');
    expect(result.size).toBe(imageBytes.byteLength);
    expect(validateAttachmentUrlMock).toHaveBeenCalledWith(
      'https://cdn.discordapp.com/a/b/cat.png'
    );
  });

  it('downloads multiple attachments in parallel (trigger + extended)', async () => {
    const b1 = Buffer.from('one');
    const b2 = Buffer.from('two');
    const b3 = Buffer.from('three');
    fetchAttachmentBytesMock
      .mockResolvedValueOnce(b1)
      .mockResolvedValueOnce(b2)
      .mockResolvedValueOnce(b3);

    const job = createJob(
      [
        { url: 'https://cdn.discordapp.com/1.png', contentType: 'image/png' },
        { url: 'https://cdn.discordapp.com/2.png', contentType: 'image/png' },
      ],
      [{ url: 'https://cdn.discordapp.com/3.png', contentType: 'image/png' }]
    );
    await step.process(createContext(job));

    expect(fetchAttachmentBytesMock).toHaveBeenCalledTimes(3);
    expect(job.data.context.attachments![0].url).toMatch(/^data:/);
    expect(job.data.context.attachments![1].url).toMatch(/^data:/);
    expect(job.data.context.extendedContextAttachments![0].url).toMatch(/^data:/);
  });

  it('invokes resize and reflects the smaller size + JPEG mime in the output', async () => {
    // Use small synthetic buffers — the test verifies the resize helper is
    // called and its output flows to `size`; it does not need to exercise
    // the real sharp resize or allocate multi-MiB memory under vitest workers.
    const large = Buffer.from('original-bytes-stand-in');
    const resized = Buffer.from('resized');
    fetchAttachmentBytesMock.mockResolvedValueOnce(large);
    // Simulate the real resize path: when resize fires, the helper returns
    // both the shrunken buffer and the switched-to JPEG contentType. The
    // caller must use the returned contentType for the data URL so the MIME
    // reflects the actual bytes, not the original upload type.
    resizeImageIfNeededMock.mockResolvedValueOnce({ buffer: resized, contentType: 'image/jpeg' });

    const job = createJob([
      { url: 'https://cdn.discordapp.com/big.png', contentType: 'image/png' },
    ]);
    await step.process(createContext(job));

    expect(resizeImageIfNeededMock).toHaveBeenCalledWith(large, 'image/png');
    expect(job.data.context.attachments![0].size).toBe(resized.byteLength);
    // Load-bearing assertion: the data URL MIME must match the resized bytes,
    // even though attachment.contentType metadata stays as the original input type.
    expect(job.data.context.attachments![0].url).toMatch(/^data:image\/jpeg;base64,/);
    expect(job.data.context.attachments![0].contentType).toBe('image/png');
  });

  it('fails the step on size-cap exceeded (no retry)', async () => {
    // Throw a real AttachmentTooLargeError so the instanceof guard in
    // fetchWithRetry fires. A plain Error with "AttachmentTooLarge" in its
    // message would NOT — the real error's message is "Attachment is X MiB,
    // exceeds limit of Y MiB" with no class-name substring.
    const err = new AttachmentTooLargeError(30 * 1024 * 1024, 25 * 1024 * 1024);
    fetchAttachmentBytesMock.mockRejectedValueOnce(err);

    const job = createJob([
      { url: 'https://cdn.discordapp.com/huge.png', contentType: 'image/png', name: 'huge.png' },
    ]);

    await expect(step.process(createContext(job))).rejects.toThrow(/huge\.png/);
    // No retry — the second call would have advanced the mock queue.
    expect(fetchAttachmentBytesMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on transient network error, then fails cleanly', async () => {
    const transient = new Error('network: ECONNRESET');
    fetchAttachmentBytesMock.mockRejectedValueOnce(transient).mockRejectedValueOnce(transient);

    const job = createJob([
      { url: 'https://cdn.discordapp.com/flaky.png', contentType: 'image/png' },
    ]);

    await expect(step.process(createContext(job))).rejects.toThrow(/ECONNRESET|Failed to download/);
    expect(fetchAttachmentBytesMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 403 (CDN-expiration signal)', async () => {
    // Throw a real HttpError so the instanceof+status guard fires. A plain
    // Error with "HTTP 403" in its message would match only because of the
    // old string-based check; this test pins the new typed-classification path.
    const forbidden = new HttpError(403, 'Forbidden');
    fetchAttachmentBytesMock.mockRejectedValueOnce(forbidden);

    const job = createJob([
      { url: 'https://cdn.discordapp.com/expired.png', contentType: 'image/png' },
    ]);

    await expect(step.process(createContext(job))).rejects.toThrow(/403/);
    expect(fetchAttachmentBytesMock).toHaveBeenCalledTimes(1);
  });

  it('skips fetch when url is already a data URL (idempotent)', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0K';
    const job = createJob([{ url: dataUrl, contentType: 'image/png' }]);

    await step.process(createContext(job));

    expect(fetchAttachmentBytesMock).not.toHaveBeenCalled();
    expect(validateAttachmentUrlMock).not.toHaveBeenCalled();
    // Pass-through: the same attachment object is preserved.
    expect(job.data.context.attachments![0].url).toBe(dataUrl);
  });
});

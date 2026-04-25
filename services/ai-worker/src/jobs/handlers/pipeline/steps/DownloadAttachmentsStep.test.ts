/**
 * DownloadAttachmentsStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType, type LLMGenerationJobData, type LoadedPersonality } from '@tzurot/common-types';
import { DownloadAttachmentsStep, MAX_QUEUE_AGE_MS } from './DownloadAttachmentsStep.js';
import {
  AttachmentTooLargeError,
  HttpError,
  JobPayloadTooLargeError,
} from '../../../../utils/attachmentFetch.js';
import type { GenerationContext } from '../types.js';

// Mock logger so it doesn't pollute test output. Hoisted so individual tests
// can assert on warn calls (e.g. the aggregate-cap test pins the structured
// warn fields that ops tooling may eventually key on).
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => loggerMock,
  };
});

// Mock the attachmentFetch utility so tests control fetch / validation /
// resize / data-URL building without hitting network or sharp. Error classes
// (ExpiredJobError, AttachmentTooLargeError, etc.) are passed through from
// the real module.
const {
  fetchAttachmentBytesMock,
  validateAttachmentUrlMock,
  resizeImageIfNeededMock,
  bufferToDataUrlMock,
} = vi.hoisted(() => ({
  fetchAttachmentBytesMock: vi.fn(),
  validateAttachmentUrlMock: vi.fn((url: string) => url),
  // Default: pass-through — returns { buffer, contentType } matching the real
  // function's no-resize branch. Individual tests override to simulate the
  // JPEG-conversion path when they want to exercise it.
  resizeImageIfNeededMock: vi.fn((buffer: Buffer, contentType: string) =>
    Promise.resolve({ buffer, contentType })
  ),
  // Mocked separately so tests can pass non-Buffer fixtures (e.g. fake
  // oversized objects with only a byteLength field) without depending on
  // the real bufferToDataUrl's Buffer.toString('base64') behavior.
  bufferToDataUrlMock: vi.fn(
    (_buffer: Buffer, contentType: string) => `data:${contentType};base64,FAKE`
  ),
}));

vi.mock('../../../../utils/attachmentFetch.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../utils/attachmentFetch.js')>();
  return {
    ...actual,
    fetchAttachmentBytes: fetchAttachmentBytesMock,
    validateAttachmentUrl: validateAttachmentUrlMock,
    resizeImageIfNeeded: resizeImageIfNeededMock,
    bufferToDataUrl: bufferToDataUrlMock,
  };
});

// Mock the safe-external-image fetcher. Default implementations are pass-through
// so existing tests that don't exercise the external path keep working — only
// tests that explicitly opt in to the external fallback need to override.
const { fetchExternalImageBytesMock, validateExternalImageUrlMock } = vi.hoisted(() => ({
  fetchExternalImageBytesMock: vi.fn(),
  validateExternalImageUrlMock: vi.fn((url: string) => url),
}));

vi.mock('../../../../utils/safeExternalFetch.js', () => ({
  fetchExternalImageBytes: fetchExternalImageBytesMock,
  validateExternalImageUrl: validateExternalImageUrlMock,
}));

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'p-1',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  ownerId: 'owner-uuid-test',
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
  timestamp: number = Date.now(),
  // `message` controls the partial-success-throw heuristic: when ALL attachments
  // fail AND `hasMessageText(message)` returns false, process() throws instead
  // of proceeding silently with empty attachments. Tests that want to exercise
  // the throw path pass `''`; everything else inherits the default `'hi'`.
  message: string | object = 'hi'
): Job<LLMGenerationJobData> {
  return {
    id: 'job-123',
    timestamp,
    data: {
      requestId: 'req-001',
      jobType: JobType.LLMGeneration,
      personality: TEST_PERSONALITY,
      message,
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
    // Selective fake timers per project standard (02-code-standards.md
    // "Fake Timers ALWAYS Use"): only fake Date so the queue-age boundary
    // arithmetic is deterministic. setTimeout/setInterval stay real so the
    // retry test (which uses `retryDelayMs = 0` to skip its 500ms wait)
    // resolves naturally on the macrotask queue without needing explicit
    // vi.advanceTimers calls in every retry-path test.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));

    vi.clearAllMocks();
    validateAttachmentUrlMock.mockImplementation((url: string) => url);
    resizeImageIfNeededMock.mockImplementation((buffer: Buffer, contentType: string) =>
      Promise.resolve({ buffer, contentType })
    );
    bufferToDataUrlMock.mockImplementation(
      (_buffer: Buffer, contentType: string) => `data:${contentType};base64,FAKE`
    );
    // retryDelayMs = 0 so the retry test finishes instantly instead of waiting
    // on a real 500ms setTimeout. Production uses the 500ms default.
    step = new DownloadAttachmentsStep(/* retryDelayMs= */ 0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has correct name', () => {
    expect(step.name).toBe('DownloadAttachments');
  });

  it('passes through when there are no attachments (noop)', async () => {
    const job = createJob([], []);
    await step.process(createContext(job));
    expect(fetchAttachmentBytesMock).not.toHaveBeenCalled();
  });

  it('fails fast with ExpiredJobError when queue-age exceeds threshold, without fetching', async () => {
    // +1min over the threshold — tests the actual boundary rather than a
    // hardcoded "way over" value. If MAX_QUEUE_AGE_MS changes, this test
    // continues to pin the boundary instead of silently over-testing.
    const justOverThreshold = Date.now() - MAX_QUEUE_AGE_MS - 60_000;
    const job = createJob(
      [{ url: 'https://cdn.discordapp.com/a/b/c.png', contentType: 'image/png', name: 'c.png' }],
      [],
      justOverThreshold
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
    const justOverThreshold = Date.now() - MAX_QUEUE_AGE_MS - 60_000;
    const job = createJob([], [], justOverThreshold);

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
    // originalUrl must be preserved on every group — VisionDescriptionCache
    // keys off this field for both trigger and extended-context arrays, so the
    // invariant needs to hold across both paths inside downloadAll.
    expect(job.data.context.attachments![0].originalUrl).toBe('https://cdn.discordapp.com/1.png');
    expect(job.data.context.attachments![1].originalUrl).toBe('https://cdn.discordapp.com/2.png');
    expect(job.data.context.extendedContextAttachments![0].originalUrl).toBe(
      'https://cdn.discordapp.com/3.png'
    );
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

  it('does NOT retry on size-cap exceeded; logs failure and proceeds when message has text', async () => {
    // Two assertions in one: (1) AttachmentTooLargeError short-circuits retry
    // (instanceof guard in fetchWithRetry) — a single fetch call with no
    // re-attempt; (2) per the new spec, a per-attachment failure no longer
    // aborts the step when the user's message has text content (default 'hi'
    // from createJob), since the LLM still has something to respond to.
    const err = new AttachmentTooLargeError(30 * 1024 * 1024, 25 * 1024 * 1024);
    fetchAttachmentBytesMock.mockRejectedValueOnce(err);

    const job = createJob([
      { url: 'https://cdn.discordapp.com/huge.png', contentType: 'image/png', name: 'huge.png' },
    ]);

    await expect(step.process(createContext(job))).resolves.toBeDefined();
    expect(fetchAttachmentBytesMock).toHaveBeenCalledTimes(1);
    // Failure surfaces in the structured log so an incident responder can
    // grep for the failing filename even though the step succeeded overall.
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-123', failure: expect.stringContaining('huge.png') }),
      expect.stringMatching(/Attachment download failed/)
    );
    // No surviving attachment was written back — the LLM gets text-only.
    expect(job.data.context!.attachments).toHaveLength(0);
  });

  it('proceeds with successes on partial failure (1 ok + 1 bad), naming the failure in logs', async () => {
    // Pins the `Promise.allSettled` aggregation path in `downloadAll`. Uses a
    // URL-keyed mock so the test is order-independent — `downloadOne` calls
    // run in parallel, so mockResolvedValueOnce/mockRejectedValueOnce chaining
    // would be brittle against interleaved fetch invocations.
    fetchAttachmentBytesMock.mockImplementation(async (url: string) => {
      if (url.includes('good.png')) return Buffer.from('ok');
      throw new Error('ECONNRESET');
    });

    const job = createJob([
      {
        url: 'https://cdn.discordapp.com/good.png',
        contentType: 'image/png',
        name: 'good.png',
      },
      { url: 'https://cdn.discordapp.com/bad.png', contentType: 'image/png', name: 'bad.png' },
    ]);

    // Step succeeds even with one failure — the surviving image reaches the
    // LLM, the failure is logged with the array label ('trigger/') and name.
    await expect(step.process(createContext(job))).resolves.toBeDefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-123',
        failure: expect.stringMatching(/trigger\/bad\.png/),
      }),
      expect.stringMatching(/Attachment download failed/)
    );
    // 3 calls: good.png succeeds once, bad.png fails + retries once.
    expect(fetchAttachmentBytesMock).toHaveBeenCalledTimes(3);
    // Surviving attachment makes it through to job.data.context.attachments.
    expect(job.data.context!.attachments).toHaveLength(1);
    expect(job.data.context!.attachments![0].name).toBe('good.png');
  });

  it('logs failures from both groups when each group has a failure (cross-group aggregation)', async () => {
    // Pins the outer Promise.all + downloadAll-never-throws contract: when
    // both trigger AND extended groups have failures, both are logged rather
    // than the first group's failure aborting and orphaning the second group's
    // downloads. With message='hi', step proceeds (no throw); failures still
    // surface in logs with their respective labels.
    fetchAttachmentBytesMock.mockRejectedValue(new Error('ECONNRESET'));

    const job = createJob(
      [
        {
          url: 'https://cdn.discordapp.com/trig.png',
          contentType: 'image/png',
          name: 'trig.png',
        },
      ],
      [
        {
          url: 'https://cdn.discordapp.com/ext.png',
          contentType: 'image/png',
          name: 'ext.png',
        },
      ]
    );

    await expect(step.process(createContext(job))).resolves.toBeDefined();
    // Both labels appear across the warn calls — proves both groups ran to
    // completion (Promise.allSettled at the per-attachment level + both
    // downloadAll calls awaited via Promise.all at the outer).
    const warnFailures = loggerMock.warn.mock.calls.map(
      call => (call[0] as { failure?: string }).failure ?? ''
    );
    expect(warnFailures.some(f => f.includes('trigger/trig.png'))).toBe(true);
    expect(warnFailures.some(f => f.includes('extended/ext.png'))).toBe(true);
  });

  it('THROWS only when all attachments fail AND message has no text content', async () => {
    // The exact failure-with-no-text path the production incident exposed:
    // user message is empty (or whitespace-only), all attachments fail, the
    // LLM would otherwise receive an empty prompt and hallucinate a confused
    // response. The throw classifies via LLMGenerationHandler → MEDIA_NOT_FOUND
    // so the bot's reply to Discord includes the failure list in a spoiler tag.
    fetchAttachmentBytesMock.mockRejectedValue(new Error('ECONNRESET'));

    const job = createJob(
      [
        { url: 'https://cdn.discordapp.com/a.png', contentType: 'image/png', name: 'a.png' },
        { url: 'https://cdn.discordapp.com/b.png', contentType: 'image/png', name: 'b.png' },
      ],
      [],
      Date.now(),
      '' // empty message — triggers the throw path
    );

    await expect(step.process(createContext(job))).rejects.toThrow(
      /Failed to download 2 attachment.*no text content present/s
    );
  });

  it('does NOT throw when all attachments fail but message has text (LLM responds to text)', async () => {
    // Symmetric to the previous test. When the user's message has text, the
    // LLM still has something useful to say; one bad URL no longer nukes the
    // whole conversation. This is the exact regression the production
    // incident surfaced — beta.105 threw on any failure, this is the fix.
    fetchAttachmentBytesMock.mockRejectedValue(new Error('ECONNRESET'));

    const job = createJob(
      [],
      [{ url: 'https://cdn.discordapp.com/c.png', contentType: 'image/png', name: 'c.png' }]
    );

    await expect(step.process(createContext(job))).resolves.toBeDefined();
    // The failure is logged but not thrown.
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failure: expect.stringContaining('c.png') }),
      expect.stringMatching(/Attachment download failed/)
    );
  });

  it('throws JobPayloadTooLargeError when post-resize aggregate exceeds the cap', async () => {
    // Pins the aggregate-size guard: each attachment passes per-attachment
    // cap (under MAX_ATTACHMENT_BYTES), but together they exceed the
    // aggregate cap (50 MiB) and would otherwise blow Redis's per-key limit
    // at the BullMQ JSON.stringify boundary. Use small synthetic buffers
    // and override the resize mock to return realistic post-resize sizes
    // so the test doesn't allocate hundreds of MiB.
    const smallBuf = Buffer.from('placeholder');
    fetchAttachmentBytesMock.mockResolvedValue(smallBuf);
    // Simulate two non-image attachments that bypass resize at ~30 MiB each
    // (combined: 60 MiB > 50 MiB cap). The fake { byteLength } object never
    // reaches a real Buffer method — bufferToDataUrlMock at module scope
    // accepts any input and returns a placeholder data URL, and the size
    // sum is computed directly from the byteLength field.
    const fakeOversized = { byteLength: 30 * 1024 * 1024 } as Buffer;
    resizeImageIfNeededMock.mockResolvedValue({
      buffer: fakeOversized,
      contentType: 'video/mp4',
    });

    const job = createJob([
      { url: 'https://cdn.discordapp.com/a.mp4', contentType: 'video/mp4', name: 'a.mp4' },
      { url: 'https://cdn.discordapp.com/b.mp4', contentType: 'video/mp4', name: 'b.mp4' },
    ]);

    await expect(step.process(createContext(job))).rejects.toBeInstanceOf(JobPayloadTooLargeError);
    // Pin the structured warn-log fields. Ops dashboards may eventually key
    // off these — silent renames or removals would be a regression.
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-123',
        totalBytes: 60 * 1024 * 1024,
        limit: 50 * 1024 * 1024,
        attachmentCount: 2,
      }),
      expect.stringMatching(/aggregate attachment payload exceeds limit/)
    );
  });

  it('retries once on transient network error before counting as a per-attachment failure', async () => {
    // Pins retry behavior independent of throw-vs-proceed: 2 fetch calls
    // (initial + 1 retry) before the failure is recorded. Step itself
    // proceeds (message='hi'); the failure surfaces in the warn log.
    const transient = new Error('network: ECONNRESET');
    fetchAttachmentBytesMock.mockRejectedValueOnce(transient).mockRejectedValueOnce(transient);

    const job = createJob([
      { url: 'https://cdn.discordapp.com/flaky.png', contentType: 'image/png', name: 'flaky.png' },
    ]);

    await expect(step.process(createContext(job))).resolves.toBeDefined();
    expect(fetchAttachmentBytesMock).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failure: expect.stringContaining('flaky.png') }),
      expect.stringMatching(/Attachment download failed/)
    );
  });

  it('does NOT retry on 403 (CDN-expiration signal); failure logged once', async () => {
    // Throw a real HttpError so the instanceof+status guard fires. A plain
    // Error with "HTTP 403" in its message would match only because of the
    // old string-based check; this test pins the new typed-classification path.
    // Step proceeds (message='hi'); 403 surfaces in the warn log just like
    // any other per-attachment failure.
    const forbidden = new HttpError(403, 'Forbidden');
    fetchAttachmentBytesMock.mockRejectedValueOnce(forbidden);

    const job = createJob([
      {
        url: 'https://cdn.discordapp.com/expired.png',
        contentType: 'image/png',
        name: 'expired.png',
      },
    ]);

    await expect(step.process(createContext(job))).resolves.toBeDefined();
    // Critical: only ONE call. A retry would have advanced the mock queue.
    expect(fetchAttachmentBytesMock).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failure: expect.stringMatching(/expired\.png.*HTTP 403/) }),
      expect.stringMatching(/Attachment download failed/)
    );
  });

  it('falls through to safe-external fetch when validateAttachmentUrl rejects with allowlist error', async () => {
    // The exact production-incident path: bot-client emitted a Reddit/Imgur/etc.
    // URL via the embedImageExtractor's `proxyURL ?? url` fallback. The strict
    // Discord-CDN validator rejects with "must be from Discord CDN", and the
    // step is supposed to route to the safe-external fetcher (DNS+IP guard,
    // browser UA, Content-Type assertion) instead of failing.
    validateAttachmentUrlMock.mockImplementationOnce(() => {
      throw new Error(
        'Invalid attachment URL: must be from Discord CDN (cdn.discordapp.com, media.discordapp.net)'
      );
    });
    fetchExternalImageBytesMock.mockResolvedValueOnce(Buffer.from('reddit-bytes'));

    const job = createJob([
      { url: 'https://i.redd.it/abc.jpg', contentType: 'image/jpeg', name: 'reddit.jpg' },
    ]);

    await expect(step.process(createContext(job))).resolves.toBeDefined();

    // Critical: the strict path was tried first (validate called), then the
    // external path was used (fetchExternalImageBytes called once with the
    // original URL — validateExternalImageUrl returned it unchanged via the
    // module mock's pass-through implementation).
    expect(validateAttachmentUrlMock).toHaveBeenCalledWith('https://i.redd.it/abc.jpg');
    expect(validateExternalImageUrlMock).toHaveBeenCalledWith('https://i.redd.it/abc.jpg');
    expect(fetchExternalImageBytesMock).toHaveBeenCalledTimes(1);
    // The strict-path fetcher was NOT called — fallback diverted the work.
    expect(fetchAttachmentBytesMock).not.toHaveBeenCalled();
    // Result was written back to context (1 surviving attachment).
    expect(job.data.context!.attachments).toHaveLength(1);
  });

  it('does NOT fall through on non-allowlist validation errors (real client errors propagate)', async () => {
    // Pin: only the "must be from Discord CDN" error message triggers the
    // fallback. Other validation failures (bad protocol, IP-as-hostname,
    // credentials, non-standard port) are real client errors and must NOT
    // be retried via the more permissive external path.
    validateAttachmentUrlMock.mockImplementationOnce(() => {
      throw new Error('Invalid attachment URL: protocol must be https:');
    });

    const job = createJob([
      { url: 'http://cdn.discordapp.com/x.png', contentType: 'image/png', name: 'http-only.png' },
    ]);

    // Step itself succeeds (message='hi') — the validation throw becomes a
    // per-attachment failure, logged but not aborted.
    await expect(step.process(createContext(job))).resolves.toBeDefined();
    expect(validateExternalImageUrlMock).not.toHaveBeenCalled();
    expect(fetchExternalImageBytesMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failure: expect.stringMatching(/protocol must be https/) }),
      expect.stringMatching(/Attachment download failed/)
    );
  });

  it('skips fetch when url is already a data URL (idempotent), backfilling size when absent', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0K';
    const job = createJob([{ url: dataUrl, contentType: 'image/png' }]);

    await step.process(createContext(job));

    expect(fetchAttachmentBytesMock).not.toHaveBeenCalled();
    expect(validateAttachmentUrlMock).not.toHaveBeenCalled();
    // No re-encoding: bufferToDataUrl must not be called for already-data URLs.
    expect(bufferToDataUrlMock).not.toHaveBeenCalled();
    // Pass-through preserves the URL.
    expect(job.data.context.attachments![0].url).toBe(dataUrl);
    // Load-bearing: the size backfill (Math.ceil(url.length * 3 / 4)) must
    // run for fixtures that omit `size`, otherwise the aggregate-payload
    // guard would silently undercount pre-populated data URLs as 0 bytes.
    expect(job.data.context.attachments![0].size).toBeGreaterThan(0);
    expect(job.data.context.attachments![0].size).toBe(Math.ceil((dataUrl.length * 3) / 4));
  });
});

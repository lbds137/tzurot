/**
 * Tests for `pnpm ops health:post-webhook`. Mocks the two seams the command
 * crosses: `node:fs` (report file read) and global `fetch` (Discord POST).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('chalk', () => ({
  default: { red: (s: string) => s, green: (s: string) => s },
}));

import { readFileSync } from 'node:fs';
import { runHealthWebhookPost } from './health-webhook-post.js';

const WEBHOOK_URL = 'https://discord.example.com/webhook';
/** What the command actually POSTs to: the configured webhook plus `?wait=true`. */
const POST_URL = `${WEBHOOK_URL}?wait=true`;

function jsonResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response;
}

function bodyOf(call: unknown): { content: string; allowed_mentions?: { parse: string[] } } {
  const [, init] = call as [string, RequestInit];
  return JSON.parse(init.body as string) as {
    content: string;
    allowed_mentions?: { parse: string[] };
  };
}

describe('runHealthWebhookPost', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal('fetch', mockFetch);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.DISCORD_AUDIT_WEBHOOK_URL = WEBHOOK_URL;
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.DISCORD_AUDIT_WEBHOOK_URL;
    process.exitCode = undefined;
  });

  it('posts the whole report in one message when under the 2000-char cap', async () => {
    const report = '## Audit health\nAll green.';
    vi.mocked(readFileSync).mockReturnValue(report);

    await runHealthWebhookPost();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(POST_URL);
    const body = JSON.parse(init.body as string) as { content: string };
    expect(body.content).toBe(report);
    expect(process.exitCode).toBeUndefined();
  });

  it('chunks a report over 2000 chars into multiple sequential in-order POSTs, never splitting mid-word', async () => {
    // Build a report whose body is space-separated distinct tokens, long enough
    // to force at least two chunks under splitMessage's 2000-char boundary logic.
    const tokens = Array.from({ length: 500 }, (_, i) => `token${i}`);
    const body = tokens.join(' ');
    const report = `## Audit health\n${body}`;
    vi.mocked(readFileSync).mockReturnValue(report);

    await runHealthWebhookPost();

    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);

    const postedBodies: string[] = [];
    for (const call of mockFetch.mock.calls) {
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe(POST_URL);
      const parsed = JSON.parse(init.body as string) as { content: string };
      expect(parsed.content.length).toBeLessThanOrEqual(2000);
      postedBodies.push(parsed.content);
    }

    // Order preserved + every token survives across the chunk boundaries.
    const reassembled = postedBodies.join(' ');
    for (const token of tokens) {
      expect(reassembled).toContain(token);
    }

    // No chunk boundary lands mid-token: every token-bearing chunk starts and
    // ends on a token boundary. The header line is its own chunk here — the
    // line-aware chunker flushes it before force-splitting the one over-cap
    // body line — so it is exempt from the token checks.
    const tokenChunks = postedBodies.filter(chunk => chunk.includes('token'));
    expect(tokenChunks.length).toBeGreaterThan(1);
    for (const [index, chunk] of tokenChunks.entries()) {
      expect(chunk.startsWith('token')).toBe(true);
      if (index < tokenChunks.length - 1) {
        expect(/token\d+$/.test(chunk.trimEnd())).toBe(true);
      }
    }
  });

  it('drops the preamble before "## Audit health" and keeps the header in the first chunk', async () => {
    const report = 'progress noise\nmore noise\n## Audit health\nverdict: pass';
    vi.mocked(readFileSync).mockReturnValue(report);

    await runHealthWebhookPost();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { content: string };
    expect(body.content).not.toContain('progress noise');
    expect(body.content).toContain('## Audit health');
  });

  it('posts the whole file when the header is not found (fail-open)', async () => {
    const report = 'no header here, just a raw report body';
    vi.mocked(readFileSync).mockReturnValue(report);

    await runHealthWebhookPost();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { content: string };
    expect(body.content).toBe(report);
  });

  it('does not fetch when DISCORD_AUDIT_WEBHOOK_URL is unset (exit-0 degrade)', async () => {
    delete process.env.DISCORD_AUDIT_WEBHOOK_URL;

    await runHealthWebhookPost();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not configured'));
  });

  it('does not fetch when the report file is missing (exit-0 degrade)', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    await runHealthWebhookPost();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('nothing to post'));
  });

  it('surfaces a NON-missing read error as a real failure (exit 1), not "nothing to post"', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    await runHealthWebhookPost();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to read'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('nothing to post'));
  });

  it('reads the file named by the --file option instead of the default', async () => {
    vi.mocked(readFileSync).mockReturnValue('## Audit health\ncustom-file content');

    await runHealthWebhookPost({ file: 'custom-report.txt' });

    expect(vi.mocked(readFileSync)).toHaveBeenCalledWith('custom-report.txt', 'utf-8');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('treats a header-less whitespace-only report like an empty one (no posts, exit 0)', async () => {
    // sliceFromHealthHeader fails open, so a header-less file reaches the
    // chunker whole. splitMessageByLines preserves blank lines rather than
    // collapsing them the way splitMessage does, so without a trimmed filter
    // this would POST whitespace-only content instead of degrading quietly.
    vi.mocked(readFileSync).mockReturnValue('\n\n   \n\t\n');

    await runHealthWebhookPost();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('nothing to post'));
  });

  it('treats an empty-but-present report like a missing one (no posts, exit 0)', async () => {
    vi.mocked(readFileSync).mockReturnValue('');

    await runHealthWebhookPost();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('nothing to post'));
  });

  it('posts an INCOMPLETE warning trailer and exits 1 when a mid-sequence chunk fails', async () => {
    // Two content chunks; the second POST fails, the trailer POST succeeds.
    const tokens = Array.from({ length: 500 }, (_, i) => `token${i}`);
    vi.mocked(readFileSync).mockReturnValue(`## Audit health\n${tokens.join(' ')}`);
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200))
      .mockResolvedValueOnce(jsonResponse(500))
      .mockResolvedValue(jsonResponse(200));

    await runHealthWebhookPost();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('chunk 2/'));
    // The last POST is the trailer, marking the partial report as incomplete.
    const lastCall = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    const trailerBody = JSON.parse(lastCall[1].body as string) as { content: string };
    expect(trailerBody.content).toContain('INCOMPLETE');
    expect(trailerBody.content).toContain('chunk 2 of');
  });

  it('surfaces a nonzero exit code when the webhook responds with an error status', async () => {
    vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
    mockFetch.mockResolvedValue(jsonResponse(500));

    await runHealthWebhookPost();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('keeps every newline of an oversized newline-bearing report across the chunks', async () => {
    // The real report shape, matching what the aggregator emits: the header,
    // the blank line `formatHealthReport` always inserts after it, an
    // unbroken run of tool bullets, then the blank-line-separated extras
    // sections `formatHealthExtras` appends. The bullet RUNS are what carry
    // the defect — each is one `splitMessage` "paragraph" — so the fixture
    // has to contain both the runs and the blank lines between sections.
    const bullets = Array.from(
      { length: 120 },
      (_, i) => `- ✅ **audit-tool-${i}** — ${i} finding(s) (baseline ${i})`
    );
    const extras = Array.from({ length: 20 }, (_, i) => `- margin-${i}: within baseline`);
    const report = [
      '## Audit health',
      '',
      ...bullets,
      '',
      '### Ratchet margins',
      '',
      ...extras,
    ].join('\n');
    expect(report.length).toBeGreaterThan(2000);
    vi.mocked(readFileSync).mockReturnValue(report);

    await runHealthWebhookPost();

    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    const posted = mockFetch.mock.calls.map(call => bodyOf(call).content);
    posted.forEach(content => {
      expect(content.length).toBeLessThanOrEqual(2000);
    });
    // Every source line arrives as its own line — none joined to a neighbour.
    expect(posted.flatMap(content => content.split('\n'))).toEqual(report.split('\n'));
  });

  it('sets allowed_mentions.parse to [] on every POST, trailer included', async () => {
    vi.mocked(readFileSync).mockReturnValue('## Audit health\n@everyone see the report');
    mockFetch.mockResolvedValueOnce(jsonResponse(500)).mockResolvedValue(jsonResponse(200));

    await runHealthWebhookPost();

    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    for (const call of mockFetch.mock.calls) {
      expect(bodyOf(call).allowed_mentions).toEqual({ parse: [] });
    }
    // The last POST is the trailer — proving the guard is not content-only.
    expect(bodyOf(mockFetch.mock.calls.at(-1)).content).toContain('delivery failed');
  });

  it('posts to the webhook with wait=true so Discord confirms persistence', async () => {
    vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');

    await runHealthWebhookPost();

    for (const call of mockFetch.mock.calls) {
      const [url] = call as [string, RequestInit];
      expect(new URL(url).searchParams.get('wait')).toBe('true');
    }
  });

  it('preserves an existing query string when adding wait=true', async () => {
    process.env.DISCORD_AUDIT_WEBHOOK_URL = `${WEBHOOK_URL}?thread_id=42`;
    vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');

    await runHealthWebhookPost();

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('thread_id')).toBe('42');
    expect(parsed.searchParams.get('wait')).toBe('true');
  });

  it('exits 1 without fetching when the webhook URL is malformed', async () => {
    process.env.DISCORD_AUDIT_WEBHOOK_URL = 'not-a-url';
    vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');

    await runHealthWebhookPost();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not a valid URL'));
  });

  it('uses "NO report chunks were delivered" trailer wording when the FIRST chunk fails', async () => {
    // A single-chunk report whose only POST fails: nothing landed in the
    // channel, so "the report above is INCOMPLETE" would describe a report
    // that is not there.
    vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
    mockFetch.mockResolvedValueOnce(jsonResponse(500)).mockResolvedValue(jsonResponse(200));

    await runHealthWebhookPost();

    expect(process.exitCode).toBe(1);
    const lastCall = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    const trailerBody = JSON.parse(lastCall[1].body as string) as { content: string };
    expect(trailerBody.content).toContain('NO report chunks were delivered');
    expect(trailerBody.content).not.toContain('INCOMPLETE (failed at chunk');
  });

  /**
   * Fake timers are scoped to this block only: the retry path is the only one
   * that waits, and converting the whole file would put every other case on a
   * mocked clock for no reason.
   */
  describe('429 rate-limit retries', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries once after a 429 and succeeds, leaving the exit code clean', async () => {
      vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
      mockFetch
        .mockResolvedValueOnce(jsonResponse(429, { 'Retry-After': '0.5' }))
        .mockResolvedValue(jsonResponse(200));

      const run = runHealthWebhookPost();
      await vi.runAllTimersAsync();
      await run;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(bodyOf(mockFetch.mock.calls[0]).content).toBe(bodyOf(mockFetch.mock.calls[1]).content);
      expect(process.exitCode).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('retries a 429 that carries no Retry-After header, after the default delay', async () => {
      vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
      mockFetch.mockResolvedValueOnce(jsonResponse(429)).mockResolvedValue(jsonResponse(200));

      const run = runHealthWebhookPost();
      // Just short of the 1s default: the retry must not have fired yet.
      await vi.advanceTimersByTimeAsync(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await run;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(process.exitCode).toBeUndefined();
    });

    it('gives up after the retry budget and falls back to the failure path', async () => {
      vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
      mockFetch.mockResolvedValue(jsonResponse(429, { 'Retry-After': '0.1' }));

      const run = runHealthWebhookPost();
      await vi.runAllTimersAsync();
      await run;

      // 3 attempts on the content chunk (1 + 2 retries), then 3 more on the
      // best-effort trailer, which the same 429 also rejects.
      expect(mockFetch).toHaveBeenCalledTimes(6);
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('429'));
    });

    it('falls back to the default delay when Retry-After is non-numeric', async () => {
      // A proxy emitting a garbage value, or a comma-joined duplicate header,
      // must not produce a NaN wait. parseFloat yields NaN, which fails the
      // isFinite guard and takes the same path as an absent header.
      vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
      mockFetch
        .mockResolvedValueOnce(jsonResponse(429, { 'Retry-After': 'banana' }))
        .mockResolvedValue(jsonResponse(200));

      const run = runHealthWebhookPost();
      await vi.advanceTimersByTimeAsync(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await run;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(process.exitCode).toBeUndefined();
    });

    it('honours Retry-After: 0 as an immediate retry, and a negative one as the default', async () => {
      // The two remaining numeric edges. `0` is finite and not negative, so it
      // passes through as a 0ms wait; a negative value fails the guard and
      // takes the default. Neither should reach setTimeout with NaN.
      vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
      mockFetch
        .mockResolvedValueOnce(jsonResponse(429, { 'Retry-After': '0' }))
        .mockResolvedValue(jsonResponse(200));

      const zeroRun = runHealthWebhookPost();
      await vi.advanceTimersByTimeAsync(0);
      await zeroRun;
      expect(mockFetch).toHaveBeenCalledTimes(2);

      mockFetch.mockClear();
      process.exitCode = undefined;
      mockFetch
        .mockResolvedValueOnce(jsonResponse(429, { 'Retry-After': '-5' }))
        .mockResolvedValue(jsonResponse(200));

      const negativeRun = runHealthWebhookPost();
      await vi.advanceTimersByTimeAsync(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await negativeRun;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(process.exitCode).toBeUndefined();
    });

    it('clamps an absurd Retry-After so a garbled header cannot hang the run', async () => {
      vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
      mockFetch
        .mockResolvedValueOnce(jsonResponse(429, { 'Retry-After': '99999' }))
        .mockResolvedValue(jsonResponse(200));

      const run = runHealthWebhookPost();
      // Advancing past the 60s ceiling — but nowhere near 99999s — must be
      // enough for the retry to fire.
      await vi.advanceTimersByTimeAsync(60_000);
      await run;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(process.exitCode).toBeUndefined();
    });

    it('does NOT retry a non-429 error status', async () => {
      vi.mocked(readFileSync).mockReturnValue('## Audit health\nsome content');
      mockFetch.mockResolvedValue(jsonResponse(500));

      const run = runHealthWebhookPost();
      await vi.runAllTimersAsync();
      await run;

      // One content attempt, one trailer attempt — no retries on either.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(process.exitCode).toBe(1);
    });
  });
});

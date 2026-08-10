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

function jsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
  } as Response;
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
    expect(url).toBe(WEBHOOK_URL);
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
      expect(url).toBe(WEBHOOK_URL);
      const parsed = JSON.parse(init.body as string) as { content: string };
      expect(parsed.content.length).toBeLessThanOrEqual(2000);
      postedBodies.push(parsed.content);
    }

    // Order preserved + every token survives across the chunk boundaries.
    const reassembled = postedBodies.join(' ');
    for (const token of tokens) {
      expect(reassembled).toContain(token);
    }

    // No chunk boundary lands mid-token: every chunk (after the first) starts
    // on a token boundary, and every chunk (before the last) ends on one.
    for (const [index, chunk] of postedBodies.entries()) {
      if (index > 0) {
        expect(chunk.startsWith('token') || chunk.startsWith('\n')).toBe(true);
      }
      if (index < postedBodies.length - 1) {
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
});

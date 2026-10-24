import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOOT_DEADLINE_MS } from './bootWatchdog.js';
import {
  BAN_ALERT_DEDUP_FLOOR_MS,
  EGRESS_BAN_THRESHOLD_MS,
  EGRESS_PROBE_URL,
  type EgressProbeResult,
  buildEgressBanAlertText,
  classifyEgress,
  computeBanAlertMarkerExpiry,
  humanizeRetryAfterMs,
  logEgressProbeOutcome,
  probeDiscordEgress,
  retryAfterHeaderToMs,
  runBootEgressProbe,
} from './discordEgressProbe.js';

// The observed production ban capture: HTTP 429 with `retry-after: 32260`
// (SECONDS — the unit @discordjs/rest converts with `Number(header) * 1e3`)
// and a Cloudflare HTML body.
const OBSERVED_BAN_RETRY_AFTER_MS = 32_260_000;

// Fixed epoch for the fake-timer marker tests: the marker content is asserted
// EXACTLY against this instant, so the expiry math cannot mutate silently.
const FAKE_NOW = 1_700_000_000_000;

describe('EGRESS_BAN_THRESHOLD_MS', () => {
  it('is exactly bootWatchdog BOOT_DEADLINE_MS — parity pinned to the constant, not a literal', () => {
    expect(EGRESS_BAN_THRESHOLD_MS).toBe(BOOT_DEADLINE_MS);
  });
});

describe('classifyEgress', () => {
  it('classifies 200 as ok', () => {
    expect(classifyEgress(200, undefined)).toBe('ok');
  });

  it('classifies a 429 whose retry-after clears the threshold as banned', () => {
    expect(classifyEgress(429, OBSERVED_BAN_RETRY_AFTER_MS)).toBe('banned');
  });

  it('classifies a 429 exactly at the threshold as banned', () => {
    expect(classifyEgress(429, EGRESS_BAN_THRESHOLD_MS)).toBe('banned');
  });

  it('classifies a short-retry 429 as ok (transient — boot can succeed)', () => {
    expect(classifyEgress(429, 5000)).toBe('ok');
  });

  it('classifies a 429 without a parseable retry-after as ok (cannot prove the ban shape)', () => {
    expect(classifyEgress(429, undefined)).toBe('ok');
  });

  it('classifies other statuses as unavailable', () => {
    expect(classifyEgress(500, undefined)).toBe('unavailable');
    expect(classifyEgress(403, undefined)).toBe('unavailable');
  });

  it('classifies an absent status (fetch rejection, timeout) as unavailable', () => {
    expect(classifyEgress(undefined, undefined)).toBe('unavailable');
  });

  it('respects a custom threshold', () => {
    expect(classifyEgress(429, 10_000, 5_000)).toBe('banned');
    expect(classifyEgress(429, 10_000, 60_000)).toBe('ok');
  });
});

describe('retryAfterHeaderToMs', () => {
  it('converts seconds to milliseconds, matching @discordjs/rest', () => {
    expect(retryAfterHeaderToMs('32260')).toBe(32_260_000);
  });

  it('passes a zero header through as zero (present, no wait)', () => {
    expect(retryAfterHeaderToMs('0')).toBe(0);
  });

  it('parses absent, blank, non-numeric and negative headers to undefined', () => {
    expect(retryAfterHeaderToMs(null)).toBeUndefined();
    expect(retryAfterHeaderToMs('')).toBeUndefined();
    expect(retryAfterHeaderToMs('   ')).toBeUndefined();
    expect(retryAfterHeaderToMs('abc')).toBeUndefined();
    expect(retryAfterHeaderToMs('-5')).toBeUndefined();
  });
});

describe('humanizeRetryAfterMs', () => {
  it('formats the observed capture in hours', () => {
    expect(humanizeRetryAfterMs(OBSERVED_BAN_RETRY_AFTER_MS)).toBe('9.0h');
  });

  it('formats minutes and seconds', () => {
    expect(humanizeRetryAfterMs(4.5 * 60 * 1000)).toBe('4.5m');
    expect(humanizeRetryAfterMs(12_000)).toBe('12s');
  });
});

describe('computeBanAlertMarkerExpiry', () => {
  it('uses the ban retry-after when it is the longer term', () => {
    expect(computeBanAlertMarkerExpiry(FAKE_NOW, OBSERVED_BAN_RETRY_AFTER_MS)).toBe(
      FAKE_NOW + OBSERVED_BAN_RETRY_AFTER_MS
    );
  });

  it('falls back to the dedup floor when the ban retry-after is shorter than the floor', () => {
    expect(computeBanAlertMarkerExpiry(FAKE_NOW, 30_000)).toBe(FAKE_NOW + BAN_ALERT_DEDUP_FLOOR_MS);
  });

  it('falls back to the dedup floor when the retry-after is unknown', () => {
    expect(computeBanAlertMarkerExpiry(FAKE_NOW, undefined)).toBe(
      FAKE_NOW + BAN_ALERT_DEDUP_FLOOR_MS
    );
  });
});

describe('probeDiscordEgress', () => {
  it('GETs the unauthenticated endpoint — no Authorization header ever reaches the wire', async () => {
    // Design-property pin: the probe works pre-token and must never put the
    // bot token on the wire, so the request carries no headers at all.
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    const result = await probeDiscordEgress({ fetchFn: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(EGRESS_PROBE_URL);
    expect(init.method).toBe('GET');
    expect(init.headers).toBeUndefined();
    expect(result.verdict).toBe('ok');
  });

  it('classifies the observed capture (429 + 32260s retry-after) as banned and carries the fields', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '32260' } }))
    );
    const result = await probeDiscordEgress({ fetchFn: fetchMock as unknown as typeof fetch });

    expect(result.verdict).toBe('banned');
    expect(result.status).toBe(429);
    expect(result.retryAfterMs).toBe(OBSERVED_BAN_RETRY_AFTER_MS);
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('classifies a short-retry 429 as ok but still carries retryAfterMs for the caller to log', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
    );
    const result = await probeDiscordEgress({ fetchFn: fetchMock as unknown as typeof fetch });

    expect(result.verdict).toBe('ok');
    expect(result.retryAfterMs).toBe(2000);
  });

  it('resolves unavailable on a rejecting fetch — fail-open, never throws', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
    const result = await probeDiscordEgress({ fetchFn: fetchMock as unknown as typeof fetch });

    expect(result).toMatchObject({ verdict: 'unavailable' });
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('resolves unavailable when the fetch function throws synchronously — fail-open', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('boom');
    });
    const result = await probeDiscordEgress({ fetchFn: fetchMock as unknown as typeof fetch });

    expect(result.verdict).toBe('unavailable');
  });

  // The real AbortSignal.timeout wiring (a fetch that hangs until abort) is
  // unverified here, matching the GatewayWatchdog alert-timeout precedent:
  // driving that abort under fake timers is not practical, so the injected
  // fetches settle immediately and the timeout arm is accepted as unverified.
});

describe('logEgressProbeOutcome', () => {
  const buildLogger = (): {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  } => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  it('logs a clean 200 ok at info, carrying the status field', async () => {
    const logger = buildLogger();
    const probe: EgressProbeResult = { verdict: 'ok', status: 200, elapsedMs: 96 };
    await logEgressProbeOutcome(
      logger as unknown as Parameters<typeof logEgressProbeOutcome>[0],
      probe
    );

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    const [infoFields] = logger.info.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(infoFields).toMatchObject({ verdict: 'ok', status: 200, elapsedMs: 96 });
  });

  it('logs an ok carrying a nonzero short retry-after at warn, carrying the status field', async () => {
    const logger = buildLogger();
    const probe: EgressProbeResult = {
      verdict: 'ok',
      status: 429,
      retryAfterMs: 2000,
      elapsedMs: 96,
    };
    await logEgressProbeOutcome(
      logger as unknown as Parameters<typeof logEgressProbeOutcome>[0],
      probe
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    const [warnFields] = logger.warn.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(warnFields).toMatchObject({ verdict: 'ok', status: 429, retryAfterMs: 2000 });
  });

  it('logs a 429 classified ok (missing retry-after) at warn — it must not read as a clean 200', async () => {
    const logger = buildLogger();
    const probe: EgressProbeResult = { verdict: 'ok', status: 429, elapsedMs: 96 };
    await logEgressProbeOutcome(
      logger as unknown as Parameters<typeof logEgressProbeOutcome>[0],
      probe
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    const [warnFields] = logger.warn.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(warnFields).toMatchObject({ verdict: 'ok', status: 429 });
  });

  it('logs an ok with status 200 at info even when a zero retry-after is present', async () => {
    const logger = buildLogger();
    const probe: EgressProbeResult = { verdict: 'ok', status: 200, retryAfterMs: 0, elapsedMs: 96 };
    await logEgressProbeOutcome(
      logger as unknown as Parameters<typeof logEgressProbeOutcome>[0],
      probe
    );

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a banned verdict at error and calls the onBanned hook with the probe', async () => {
    const logger = buildLogger();
    const onBanned = vi.fn(() => Promise.resolve());
    const probe: EgressProbeResult = {
      verdict: 'banned',
      status: 429,
      retryAfterMs: OBSERVED_BAN_RETRY_AFTER_MS,
      elapsedMs: 96,
    };
    await logEgressProbeOutcome(
      logger as unknown as Parameters<typeof logEgressProbeOutcome>[0],
      probe,
      onBanned
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toMatchObject({
      verdict: 'banned',
      status: 429,
      retryAfterMs: OBSERVED_BAN_RETRY_AFTER_MS,
      retryAfter: '9.0h',
    });
    expect(message).toContain('banned');
    expect(onBanned).toHaveBeenCalledWith(probe);
  });

  it('logs unavailable at warn and never calls the onBanned hook', async () => {
    const logger = buildLogger();
    const onBanned = vi.fn(() => Promise.resolve());
    const probe: EgressProbeResult = { verdict: 'unavailable', elapsedMs: 96 };
    await logEgressProbeOutcome(
      logger as unknown as Parameters<typeof logEgressProbeOutcome>[0],
      probe,
      onBanned
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(onBanned).not.toHaveBeenCalled();
  });
});

describe('buildEgressBanAlertText', () => {
  const bannedProbe: EgressProbeResult = {
    verdict: 'banned',
    status: 429,
    retryAfterMs: OBSERVED_BAN_RETRY_AFTER_MS,
    elapsedMs: 96,
  };

  it('renders the observed capture: hours, hostname, environment, and the redeploy guidance', () => {
    const text = buildEgressBanAlertText({
      environment: 'production',
      hostname: 'tzurot-abc123',
      probe: bannedProbe,
    });
    expect(text).toContain('9.0h');
    expect(text).toContain('tzurot-abc123');
    expect(text).toContain('production');
    expect(text).toContain('railway redeploy');
  });

  it('renders unknown-length for a ban with no parseable retry-after', () => {
    const text = buildEgressBanAlertText({
      environment: 'production',
      hostname: 'tzurot-abc123',
      probe: { verdict: 'banned', status: 429, elapsedMs: 96 },
    });
    expect(text).toContain('unknown-length');
  });

  it('renders unknown for an undefined environment', () => {
    const text = buildEgressBanAlertText({
      environment: undefined,
      hostname: 'tzurot-abc123',
      probe: bannedProbe,
    });
    expect(text).toContain('[unknown]');
  });
});

describe('runBootEgressProbe', () => {
  // Real fs on a unique temp dir per case: the marker path is injectable, so
  // no case can see another's marker and no fixture outlives the test.
  let markerDir: string;
  beforeEach(() => {
    markerDir = mkdtempSync(join(tmpdir(), 'egress-probe-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(markerDir, { recursive: true, force: true });
  });

  const WEBHOOK_URL = 'https://discord.com/api/webhooks/1/abc';

  const buildLogger = (): {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  } => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  const asLogger = (l: ReturnType<typeof buildLogger>): Parameters<typeof runBootEgressProbe>[0] =>
    l as unknown as Parameters<typeof runBootEgressProbe>[0];

  // One stub serves BOTH fetch consumers (the probe GET and the alert POST),
  // so a test can count every call crossing the injected boundary. A probe
  // response override lets a case classify a different shape (e.g. a 200).
  const buildFetchStub = (
    probeResponse?: () => Response
  ): {
    fetch: typeof fetch;
    webhookCallCount: () => number;
    webhookBodies: () => string[];
  } => {
    const webhookCalls: { url: string; init: RequestInit }[] = [];
    const stub = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url === EGRESS_PROBE_URL) {
          return probeResponse
            ? probeResponse()
            : new Response(null, { status: 429, headers: { 'Retry-After': '32260' } });
        }
        webhookCalls.push({ url, init: init ?? {} });
        return new Response(null, { status: 204 });
      }
    );
    return {
      fetch: stub as unknown as typeof fetch,
      webhookCallCount: () => webhookCalls.length,
      webhookBodies: () => webhookCalls.map(call => String(call.init.body)),
    };
  };

  it('seam: a banned probe reaches the webhook as exactly one POST carrying the ban text (composition pinned)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
    const logger = buildLogger();
    const stub = buildFetchStub();
    await runBootEgressProbe(asLogger(logger), {
      alertWebhookUrl: WEBHOOK_URL,
      environment: 'production',
      markerPath: join(markerDir, 'marker'),
      fetchFn: stub.fetch,
    });

    // The ERROR line fired (the guaranteed owner surface) and the webhook
    // POSTed exactly once with the pinned ban text.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(stub.webhookCallCount()).toBe(1);
    const body = stub.webhookBodies()[0] ?? '';
    const content = (JSON.parse(body) as { content: string }).content;
    expect(content).toContain('9.0h');
    expect(content).toContain(hostname());
    expect(content).toContain('railway redeploy');
    // Alerting wrote the dedup marker with the EXACT expiry — the ban's own
    // retry-after added to the frozen now, so the marker math cannot mutate
    // silently.
    expect(readFileSync(join(markerDir, 'marker'), 'utf8')).toBe(
      String(FAKE_NOW + OBSERVED_BAN_RETRY_AFTER_MS)
    );
  });

  it('unexpired marker: skips the webhook alert, still logs the error, leaves the marker alone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
    const logger = buildLogger();
    const stub = buildFetchStub();
    const markerPath = join(markerDir, 'marker');
    const futureExpiry = FAKE_NOW + 60 * 60 * 1000;
    writeFileSync(markerPath, String(futureExpiry), 'utf8');

    await runBootEgressProbe(asLogger(logger), {
      alertWebhookUrl: WEBHOOK_URL,
      markerPath,
      fetchFn: stub.fetch,
    });

    expect(stub.webhookCallCount()).toBe(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ markerExpiry: futureExpiry }),
      expect.stringContaining('suppressed')
    );
    expect(readFileSync(markerPath, 'utf8')).toBe(String(futureExpiry));
  });

  it('expired marker: alerts again and rewrites the marker to the exact ban expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
    const logger = buildLogger();
    const stub = buildFetchStub();
    const markerPath = join(markerDir, 'marker');
    writeFileSync(markerPath, String(FAKE_NOW - 1000), 'utf8');

    await runBootEgressProbe(asLogger(logger), {
      alertWebhookUrl: WEBHOOK_URL,
      markerPath,
      fetchFn: stub.fetch,
    });

    expect(stub.webhookCallCount()).toBe(1);
    expect(readFileSync(markerPath, 'utf8')).toBe(String(FAKE_NOW + OBSERVED_BAN_RETRY_AFTER_MS));
  });

  it('200 probe: no webhook POST and no marker written — the marker records a fired ban alert, nothing else', async () => {
    const logger = buildLogger();
    const stub = buildFetchStub(() => new Response(null, { status: 200 }));
    const markerPath = join(markerDir, 'marker');

    await runBootEgressProbe(asLogger(logger), {
      alertWebhookUrl: WEBHOOK_URL,
      markerPath,
      fetchFn: stub.fetch,
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(stub.webhookCallCount()).toBe(0);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('banned with alertWebhookUrl unset: error logged, no POST, marker still written (the write precedes the sender URL check by design)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
    const logger = buildLogger();
    const stub = buildFetchStub();
    const markerPath = join(markerDir, 'marker');

    await runBootEgressProbe(asLogger(logger), { markerPath, fetchFn: stub.fetch });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(stub.webhookCallCount()).toBe(0);
    // The marker means "this ban window was already surfaced on the
    // guaranteed surface" — written even with no webhook configured, so a
    // webhook added later in the same container stays suppressed. Deliberate.
    expect(readFileSync(markerPath, 'utf8')).toBe(String(FAKE_NOW + OBSERVED_BAN_RETRY_AFTER_MS));
  });

  it('marker read/write failures are fail-open: a directory as the marker path never blocks the alert', async () => {
    const logger = buildLogger();
    const stub = buildFetchStub();
    // A DIRECTORY as markerPath: readFileSync throws (reads as "no marker")
    // and writeFileSync throws too (swallowed) — the alert must still fire.
    await expect(
      runBootEgressProbe(asLogger(logger), {
        alertWebhookUrl: WEBHOOK_URL,
        markerPath: markerDir,
        fetchFn: stub.fetch,
      })
    ).resolves.toBeUndefined();

    expect(stub.webhookCallCount()).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

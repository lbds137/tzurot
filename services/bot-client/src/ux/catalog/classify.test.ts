import { describe, it, expect } from 'vitest';
import { GatewayApiError, GatewayClientError, InfraError } from '@tzurot/clients';
import { classifyGatewayFailure } from './classify.js';
import type { MessageOutcome } from './types.js';

/** Build a GatewayResult failure arm. */
function failArm(kind: string, error = 'boom', status = 0): unknown {
  return { ok: false, kind, error, status };
}

describe('classifyGatewayFailure', () => {
  // Council-mandated truth table: every kind × every carrier → expected outcome.
  const KIND_TO_OUTCOME: [string, MessageOutcome][] = [
    ['timeout', 'uncertain'],
    ['network', 'uncertain'],
    ['schema', 'committed-unconfirmed'],
    ['http', 'failed'],
    ['config', 'failed'],
  ];

  describe('truth table: GatewayApiError carrier', () => {
    for (const [kind, outcome] of KIND_TO_OUTCOME) {
      it(`${kind} → ${outcome}`, () => {
        const err = new GatewayApiError(
          `Failed to update preset: 500 - upstream broke`,
          kind === 'http' ? 500 : 0,
          kind as never
        );
        expect(classifyGatewayFailure(err, 'preset').outcome).toBe(outcome);
      });
    }
  });

  describe('truth table: GatewayResult failure-arm carrier', () => {
    for (const [kind, outcome] of KIND_TO_OUTCOME) {
      it(`${kind} → ${outcome}`, () => {
        expect(classifyGatewayFailure(failArm(kind), 'preset').outcome).toBe(outcome);
      });
    }
  });

  describe('truth table: InfraError carrier', () => {
    for (const [kind, outcome] of KIND_TO_OUTCOME) {
      it(`${kind} → ${outcome}`, () => {
        const err = new InfraError({
          ok: false,
          kind: kind as never,
          error: 'boom',
          status: kind === 'http' ? 502 : 0,
        });
        expect(classifyGatewayFailure(err, 'preset').outcome).toBe(outcome);
      });
    }

    it('http (5xx via nullOn404) SURFACES the gateway message even though the prose wrapper matches neither regex', () => {
      const err = new InfraError({
        ok: false,
        kind: 'http',
        error: 'Service temporarily unavailable',
        status: 503,
      });
      const spec = classifyGatewayFailure(err, 'preset');
      expect(spec.text).toContain('Service temporarily unavailable');
      expect(spec.text).not.toContain('Failed to update preset'); // not the generic fallback
    });
  });

  it('GatewayClientError (4xx, no kind) → definitive rejection surfacing the gateway message', () => {
    const err = new GatewayClientError({
      ok: false,
      kind: 'http',
      error: 'A preset with that name already exists',
      status: 409,
    });
    const spec = classifyGatewayFailure(err, 'preset');
    expect(spec.outcome).toBe('failed');
    expect(spec.text).toContain('already exists');
  });

  it('http kind surfaces the gateway message from caller-thrown wrappers', () => {
    const err = new GatewayApiError('Failed to update preset: 409 - Name taken', 409, 'http');
    expect(classifyGatewayFailure(err, 'preset').text).toContain('Name taken');
  });

  it('http fail-arm surfaces the raw error field (no wrapper prefix to strip)', () => {
    const spec = classifyGatewayFailure(failArm('http', 'Name taken', 409), 'preset');
    expect(spec.text).toContain('Name taken');
  });

  it('extracts from a PLAIN Error carrying the gateway wrapper format (legacy api helpers)', () => {
    const err = new Error('Failed to update preset: 400 - contextWindowTokens exceeds the cap');
    const spec = classifyGatewayFailure(err, 'preset');
    expect(spec.outcome).toBe('failed');
    expect(spec.text).toContain('contextWindowTokens exceeds the cap');
    expect(spec.text).not.toContain('Failed to update preset: 400'); // only the clean suffix
  });

  it('preserves dashes inside the extracted gateway message', () => {
    const err = new Error('Failed to update preset: 400 - limit is 4096 - not 131072');
    expect(classifyGatewayFailure(err, 'preset').text).toContain('limit is 4096 - not 131072');
  });

  it('does not extract from a single-digit status (status-0 abort prose falls to generic)', () => {
    const spec = classifyGatewayFailure(
      new Error('Failed to update character: 0 - timeout'),
      'character'
    );
    expect(spec.text).toBe('Failed to update character. Please try again.');
  });

  it('does not extract from prose that merely contains dashes (no wrapper format)', () => {
    const spec = classifyGatewayFailure(new Error('Request timed out - after 30s'), 'preset');
    expect(spec.text).toBe('Failed to update preset. Please try again.');
  });

  it('the failedAction override rewrites the generic fallback for non-write contexts', () => {
    const spec = classifyGatewayFailure(new Error('boom'), 'message', {
      failedAction: 'process your message',
    });
    expect(spec.text).toBe('Failed to process your message. Please try again.');
  });

  it('TOTAL: unknown error shapes → generic failure, never leaking the raw message', () => {
    const inputs: unknown[] = [
      new Error('ECONNRESET at internal/stream.js:451 SECRET-INTERNAL'),
      'string error',
      null,
      undefined,
      42,
      { some: 'object' },
    ];
    for (const input of inputs) {
      const spec = classifyGatewayFailure(input, 'memory lock');
      expect(spec.outcome).toBe('failed');
      expect(spec.text).not.toContain('SECRET-INTERNAL');
      expect(spec.text).not.toContain('ECONNRESET');
      expect(spec.text).toContain('memory lock');
    }
  });

  it('never throws (totality across hostile inputs)', () => {
    const hostile: unknown[] = [Symbol('x'), () => {}, { ok: false }, { kind: 'http' }];
    for (const input of hostile) {
      expect(() => classifyGatewayFailure(input, 'x')).not.toThrow();
    }
  });

  it('threads the refresh affordance into the uncertain shape', () => {
    const err = new GatewayApiError('Failed to save: timeout', 0, 'timeout');
    expect(classifyGatewayFailure(err, 'preset', { refreshAffordance: true }).text).toContain(
      '🔄 Refresh'
    );
  });

  it('truncates oversize gateway messages instead of flooding the reply', () => {
    const huge = 'x'.repeat(3000);
    const err = new GatewayApiError(`Failed to update preset: 400 - ${huge}`, 400, 'http');
    const spec = classifyGatewayFailure(err, 'preset');
    expect(spec.text.length).toBeLessThan(2000);
    expect(spec.text.endsWith('…')).toBe(true);
  });

  it('truncates oversize messages on the fail-arm carrier too', () => {
    const spec = classifyGatewayFailure(failArm('http', 'y'.repeat(3000), 400), 'preset');
    expect(spec.text.length).toBeLessThan(2000);
    expect(spec.text.endsWith('…')).toBe(true);
  });

  it('a structurally-valid fail-arm with an off-union kind degrades to the generic failure', () => {
    // The guard only verifies `kind` is a string; without the switch default
    // this returned undefined at runtime (TS exhaustiveness masked it).
    const spec = classifyGatewayFailure(failArm('gremlin'), 'preset');
    expect(spec.outcome).toBe('failed');
    expect(spec.text).toContain('preset');
  });
});

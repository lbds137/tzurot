import { describe, it, expect } from 'vitest';
import {
  isGatewayNotReadyFailure,
  isGatewayUnreachedFailure,
  type GatewayFailure,
} from './gatewayNotReady.js';

describe('isGatewayNotReadyFailure', () => {
  it.each<[string, GatewayFailure, boolean]>([
    [
      'network transport failure',
      { ok: false, kind: 'network', error: 'fetch failed', status: 0 },
      true,
    ],
    [
      'timeout transport failure',
      { ok: false, kind: 'timeout', error: 'timed out', status: 0 },
      true,
    ],
    [
      'http 404 (unmatched route)',
      { ok: false, kind: 'http', error: 'not found', status: 404 },
      true,
    ],
    [
      'http 502 (bad gateway)',
      { ok: false, kind: 'http', error: 'bad gateway', status: 502 },
      true,
    ],
    [
      'http 503 (unavailable)',
      { ok: false, kind: 'http', error: 'unavailable', status: 503 },
      true,
    ],
    [
      'http 504 (gateway timeout)',
      { ok: false, kind: 'http', error: 'gateway timeout', status: 504 },
      true,
    ],
    [
      'http 400 (validation error)',
      { ok: false, kind: 'http', error: 'bad request', status: 400 },
      false,
    ],
    [
      'http 401 (unauthorized)',
      { ok: false, kind: 'http', error: 'unauthorized', status: 401 },
      false,
    ],
    ['http 403 (forbidden)', { ok: false, kind: 'http', error: 'forbidden', status: 403 }, false],
    ['http 409 (conflict)', { ok: false, kind: 'http', error: 'conflict', status: 409 }, false],
    [
      'http 500 (server error)',
      { ok: false, kind: 'http', error: 'server error', status: 500 },
      false,
    ],
    ['config failure', { ok: false, kind: 'config', error: 'missing base url', status: 0 }, false],
    [
      'schema failure',
      { ok: false, kind: 'schema', error: 'response did not validate', status: 0 },
      false,
    ],
  ])('%s -> %s', (_label, failure, expected) => {
    expect(isGatewayNotReadyFailure(failure)).toBe(expected);
  });
});

describe('isGatewayUnreachedFailure', () => {
  it.each<[string, GatewayFailure, boolean]>([
    [
      'network transport failure',
      { ok: false, kind: 'network', error: 'fetch failed', status: 0 },
      true,
    ],
    [
      'http 404 (unmatched route)',
      { ok: false, kind: 'http', error: 'not found', status: 404 },
      true,
    ],
    [
      'http 502 (bad gateway)',
      { ok: false, kind: 'http', error: 'bad gateway', status: 502 },
      true,
    ],
    [
      'http 503 (unavailable)',
      { ok: false, kind: 'http', error: 'unavailable', status: 503 },
      true,
    ],
    [
      'timeout transport failure',
      { ok: false, kind: 'timeout', error: 'timed out', status: 0 },
      false,
    ],
    [
      'http 504 (gateway timeout)',
      { ok: false, kind: 'http', error: 'gateway timeout', status: 504 },
      false,
    ],
    [
      'http 500 (server error)',
      { ok: false, kind: 'http', error: 'server error', status: 500 },
      false,
    ],
    ['config failure', { ok: false, kind: 'config', error: 'missing base url', status: 0 }, false],
    [
      'schema failure',
      { ok: false, kind: 'schema', error: 'response did not validate', status: 0 },
      false,
    ],
  ])('%s -> %s', (_label, failure, expected) => {
    expect(isGatewayUnreachedFailure(failure)).toBe(expected);
  });
});

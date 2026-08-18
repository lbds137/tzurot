/**
 * Compile-time guard on the client-capability split.
 *
 * `ConversationHistoryClient`'s NARROWNESS is load-bearing: api-gateway types
 * its fast pool as this, and that pool carries a blanket retry-once which is
 * safe only for idempotent single-row work. Opening a transaction on it must
 * fail to compile.
 *
 * That invariant lived only in prose and drifted the moment one consumer wanted
 * `$transaction` — the capability was added to the shared type, every fast-pool
 * guarantee silently evaporated, and nothing in CI noticed. These assertions
 * are the missing tripwire: they are checked by `typecheck:spec`, so a future
 * widening fails the build instead of a review.
 */

import { describe, it, expect } from 'vitest';
import type {
  ConversationHistoryClient,
  RawCapableConversationHistoryClient,
  TransactionalConversationHistoryClient,
} from './ConversationMessageMapper.js';

describe('client capability split', () => {
  it('does NOT expose $transaction on the plain client (fast-pool guarantee)', () => {
    const narrow = {} as ConversationHistoryClient;
    // @ts-expect-error -- $transaction must be absent here; if this stops
    // erroring, the shared type was widened and the fast pool can open a
    // transaction under blanket retry. Fix the type, never this line.
    void narrow.$transaction;
    expect(true).toBe(true);
  });

  it('exposes $transaction on the transactional client', () => {
    const wide = {} as TransactionalConversationHistoryClient;
    // No ts-expect-error: this one is SUPPOSED to compile. If the capability
    // ever disappears, this line fails the build.
    void wide.$transaction;
    expect(true).toBe(true);
  });

  it('does NOT expose $executeRaw on the plain client (fast-pool guarantee)', () => {
    const narrow = {} as ConversationHistoryClient;
    // @ts-expect-error -- $executeRaw must be absent here. The metadata
    // writers merge server-side and so ask for this capability at their own
    // signatures; if it appears on the shared type instead, the fast pool can
    // issue arbitrary SQL under blanket retry. Fix the type, never this line.
    void narrow.$executeRaw;
    expect(true).toBe(true);
  });

  it('exposes $executeRaw on the raw-capable client', () => {
    const raw = {} as RawCapableConversationHistoryClient;
    void raw.$executeRaw;
    expect(true).toBe(true);
  });

  it('keeps the raw-capable client assignable to the plain one', () => {
    const raw = {} as RawCapableConversationHistoryClient;
    const asNarrow: ConversationHistoryClient = raw;
    expect(asNarrow).toBe(raw);
  });

  it('keeps the two capabilities independent of each other', () => {
    const raw = {} as RawCapableConversationHistoryClient;
    // @ts-expect-error -- raw-SQL capability must not smuggle in transactions.
    void raw.$transaction;
    const wide = {} as TransactionalConversationHistoryClient;
    // @ts-expect-error -- and the transactional one must not smuggle in raw.
    void wide.$executeRaw;
    expect(true).toBe(true);
  });

  it('keeps the transactional client assignable to the plain one', () => {
    const wide = {} as TransactionalConversationHistoryClient;
    const asNarrow: ConversationHistoryClient = wide;
    // Widening is one-directional: everything the service does with the narrow
    // client must stay callable when a transactional client is supplied.
    expect(asNarrow).toBe(wide);
  });
});

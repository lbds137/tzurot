/**
 * Per-invocation outcome slot for command telemetry, threaded via
 * AsyncLocalStorage (the repo's first use of it).
 *
 * Why ALS and not a parameter: `renderSpec` (`ux/render/render.ts`) is the
 * universal catalog-render choke point — 335 production call sites across
 * 101 files. Threading an outcome-slot parameter through every one of those
 * call sites (and every function that calls them) is not a viable refactor
 * for one telemetry seam.
 *
 * Why not a WeakMap keyed by interaction: `renderSpec(spec, opts)` receives
 * no interaction — only a MessageSpec — so a WeakMap keyed by interaction
 * would only be consultable at the ~4 `replySpecSafe` call sites, which see
 * only the catch-all top-level error path. That's exactly the set of
 * outcomes already classified as `system_error`; it would add nothing.
 *
 * Known imprecision, accepted as a P0 fidelity limit:
 *   - `MessageOutcome`'s `failed` means "the operation definitively did not
 *     happen," and covers BOTH a user-side rejection (bad input, permission
 *     denied) and a caught gateway/infra failure rendered through the same
 *     catalog path. This seam cannot yet split user error from infra error
 *     inside that bucket.
 *   - A spec rendered into a string that is never actually delivered to
 *     Discord (e.g. the interaction died before the reply landed) still
 *     counts as a noted outcome.
 *   - `committed-unconfirmed` deliberately stays `ok`: the operation
 *     applied and only the confirmation read failed, so counting it as an
 *     error would overstate the failure rate. `uncertain` maps to
 *     `system_error`/`uncertain_write` — the write may not have happened.
 *   - The wire enum's `rate_limited` and `cancelled` members have no
 *     producer yet — reserved for emission sites that can classify them.
 *   - The slot is sticky: a noted `failed`/`uncertain` render is never reset
 *     by a later success. Safe today because every command renders those
 *     shapes terminally (verified across the call sites at authoring time),
 *     but a future NON-terminal warning render inside a command would
 *     misclassify the whole invocation — enforced by convention, not a test.
 *   - No stable error code is available here: `MessageSpec` carries no
 *     intent/catalog token (its fields are `severity, outcome, text,
 *     personaText?, icon?`), so `errorCode` stays undefined on this path.
 *     The field exists on the slot for the dispatcher's catch-path
 *     (constructor-name code) and for a future catalog-intent token.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { MessageSpec } from '../ux/catalog/types.js';

/**
 * Mutable per-invocation slot. The render seam ({@link noteRenderedOutcome})
 * writes `'user_error'` for a failed outcome and `'system_error'` (code
 * `uncertain_write`) for an uncertain one; the dispatcher's own catch block
 * also writes `'system_error'` (+ a constructor-name errorCode) directly.
 */
export interface CommandOutcomeSlot {
  outcome?: 'user_error' | 'system_error';
  errorCode?: string;
}

const storage = new AsyncLocalStorage<CommandOutcomeSlot>();

/** Run `fn` inside a fresh slot; `fn` and anything it awaits can populate
 *  the slot via {@link noteRenderedOutcome}. */
export async function runWithOutcomeSlot<T>(
  slot: CommandOutcomeSlot,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(slot, fn);
}

/**
 * Record a rendered spec against the active invocation, if any. A no-op
 * outside a command invocation (ambient message paths, tests that don't
 * wrap in {@link runWithOutcomeSlot}) — there is no slot to write into.
 */
export function noteRenderedOutcome(spec: MessageSpec): void {
  const slot = storage.getStore();
  if (slot === undefined) {
    return;
  }
  if (spec.outcome === 'failed') {
    slot.outcome = 'user_error';
  } else if (spec.outcome === 'uncertain') {
    // A write that MAY have applied (timeout/network mid-flight) is a
    // system-side reliability signal — exactly what this telemetry exists to
    // surface — never a user mistake.
    slot.outcome = 'system_error';
    slot.errorCode = 'uncertain_write';
  }
}

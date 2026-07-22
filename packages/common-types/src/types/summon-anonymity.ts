/**
 * Summon anonymity — the personal-vs-incognito distinction as a discriminated union.
 *
 * A summon is either **personal** (carries the invoking user's persona) or
 * **incognito** (anonymous — no persona, and therefore no long-term-memory
 * read/write, no context epoch, no cross-channel history, no mention-upserts).
 * Anonymity and persona-presence are the SAME fact, so they share one
 * discriminant rather than living in separate, independently-drifting fields:
 * `activePersonaId` is non-null BY TYPE in the `personal` arm. That makes
 * "incognito with a persona" and "cross-channel enabled with a null persona"
 * unrepresentable at compile time, replacing the runtime guard that previously
 * caught the drift.
 *
 * NOT to be confused with the Redis `/memory incognito` *session*
 * (`MemoryModeSession` in `./memory-modes.ts`): that is a user-toggled, time-bounded
 * "don't remember this conversation" mode checked separately at write time. This
 * union is the per-summon framing decided when a `/character` command runs.
 *
 * `isWeighIn` (read-the-room FRAMING) is deliberately NOT part of this union — it
 * is orthogonal to anonymity. A *personal weigh-in* (incognito off, weigh-in
 * framing on) is a valid, supported state, so framing stays an independent flag.
 */
export type SummonAnonymity =
  | { kind: 'personal'; activePersonaId: string; activePersonaName: string | null }
  | { kind: 'incognito' };

/**
 * Resolve the per-summon anonymity from the wire flags + the already-resolved
 * persona. This is the single home of the `incognito ?? Boolean(isWeighIn)`
 * default: `incognito` is the explicit anonymity choice; when it is unset, a
 * weigh-in framing (`isWeighIn`) implies anonymity so existing weigh-in payloads
 * stay anonymous. Every consumer switches on the returned `kind` instead of
 * re-deriving the default, which is what let the decision drift across sites.
 *
 * Fail-safe: a personal summon with no resolved persona id degrades to incognito
 * rather than constructing `{ kind: 'personal', activePersonaId: '' }` — a
 * persona-less personal summon is exactly the invalid state this union forbids.
 * Anonymity is the safe direction (no LTM/persona leak), and it's observable (the
 * response shows incognito where personal was expected), so an upstream
 * resolution bug surfaces instead of hiding behind a blank id.
 *
 * @param flags   the summon's anonymity (`incognito`) + framing (`isWeighIn`) flags
 * @param persona the resolved persona — used only to populate the `personal` arm;
 *                a missing id collapses the result to incognito (see above)
 */
export function resolveSummonAnonymity(
  flags: { incognito?: boolean; isWeighIn?: boolean },
  persona: { activePersonaId: string | null | undefined; activePersonaName: string | null }
): SummonAnonymity {
  if (flags.incognito ?? Boolean(flags.isWeighIn)) {
    return { kind: 'incognito' };
  }
  const { activePersonaId } = persona;
  if (activePersonaId === null || activePersonaId === undefined || activePersonaId.length === 0) {
    return { kind: 'incognito' };
  }
  return { kind: 'personal', activePersonaId, activePersonaName: persona.activePersonaName };
}

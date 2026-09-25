/**
 * CustomId Family Factory
 *
 * A `defineCustomIdFamily` call declares a command's whole customId surface
 * as data — a segment list per action — and derives typed `build`, `parse`,
 * and `is` helpers from it. Encoding, delimiter safety, and the 100-char
 * Discord ceiling are enforced centrally instead of per hand-written builder.
 *
 * Segment combinators live on `seg` (`seg.str`, `seg.int`, `seg.enum`,
 * `seg.codec`, `seg.optional`). Every combinator returns the same small
 * immutable `SegmentSpec` shape.
 */

import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('custom-id-family');

/**
 * Delimiter used between custom ID segments. Owned here (not in
 * `customIds.ts`, which re-exports it) because `customIds.ts` imports
 * `defineCustomIdFamily`/`seg` from this module — owning it the other way
 * around makes the two modules import each other, and whichever one a test
 * or a caller reaches first then executes its top-level code before the
 * other has finished initializing its own exports.
 */
export const CUSTOM_ID_DELIMITER = '::';

/**
 * A single positional customId segment: how to turn a value into its wire
 * string and back. `encode`/`decode` are declared with method syntax (not
 * property-arrow syntax) so `V` stays bivariant across the `extends` checks
 * `defineCustomIdFamily`'s type helpers rely on — an arrow-property makes
 * `V` invariant and breaks them.
 */
export interface SegmentSpec<
  Name extends string = string,
  V = unknown,
  Opt extends boolean = boolean,
> {
  readonly name: Name;
  readonly optional: Opt;
  /** Value → wire string. Throws only via the family builder — a value containing `::` anywhere, a value ending in `:` on a non-terminal segment (would merge with the delimiter), or the total customId exceeding the length ceiling. */
  encode(value: V): string;
  /** Wire string → value; `undefined` means REJECT (the family parse then returns null). `V` may itself include `null` — that is a valid decoded value, not a rejection. */
  decode(raw: string): V | undefined;
}

type ActionMap = Record<string, readonly SegmentSpec[]>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type SegmentValue<S> = S extends SegmentSpec<string, infer V, boolean> ? V : never;
type BuildArgs<T extends readonly SegmentSpec[]> = T extends readonly [
  infer H extends SegmentSpec,
  ...infer R extends readonly SegmentSpec[],
]
  ? H extends SegmentSpec<string, infer V, true>
    ? [value?: V, ...BuildArgs<R>]
    : [SegmentValue<H>, ...BuildArgs<R>]
  : [];
type RequiredFields<T extends readonly SegmentSpec[]> = {
  [K in keyof T as T[K] extends SegmentSpec<infer N, unknown, false> ? N : never]: SegmentValue<
    T[K]
  >;
};
type OptionalFields<T extends readonly SegmentSpec[]> = {
  [K in keyof T as T[K] extends SegmentSpec<infer N, unknown, true> ? N : never]?: SegmentValue<
    T[K]
  >;
};
type ParsedFamily<A extends ActionMap> = {
  [K in keyof A & string]: Simplify<{ action: K } & RequiredFields<A[K]> & OptionalFields<A[K]>>;
}[keyof A & string];

/** The object `defineCustomIdFamily` returns for a given prefix + action map. */
export interface CustomIdFamily<P extends string, A extends ActionMap> {
  readonly prefix: P;
  readonly build: { [K in keyof A]: (...args: BuildArgs<A[K]>) => string };
  readonly parse: (customId: string) => ParsedFamily<A> | null;
  readonly is: ((customId: string) => boolean) & { [K in keyof A]: (customId: string) => boolean };
}

// ============================================================================
// Segment combinators (`seg`)
// ============================================================================

function str<N extends string>(name: N): SegmentSpec<N, string, false> {
  return {
    name,
    optional: false,
    encode(value) {
      return value;
    },
    decode(raw) {
      return raw;
    },
  };
}

/**
 * Integer segment. Accepts any safe integer for both build and parse —
 * negative values included (a page-number `-1` for a disabled prev button
 * is a live wire value). `encode` and `decode` agree on the same bound via
 * `Number.isSafeInteger`: a decimal string outside it (e.g. one that would
 * lose precision as a float, like a 20-digit page number) is rejected
 * rather than silently rounded.
 */
function int<N extends string>(name: N): SegmentSpec<N, number, false> {
  return {
    name,
    optional: false,
    encode(value) {
      if (!Number.isSafeInteger(value)) {
        throw new Error(`Segment "${name}" requires an integer value, got: ${String(value)}`);
      }
      return String(value);
    },
    decode(raw) {
      if (!/^-?\d+$/.test(raw)) {
        return undefined;
      }
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : undefined;
    },
  };
}

function enumSeg<N extends string, V extends string>(
  name: N,
  values: readonly V[]
): SegmentSpec<N, V, false> {
  return {
    name,
    optional: false,
    encode(value) {
      if (!values.includes(value)) {
        throw new Error(`Segment "${name}" received a value outside its enum: ${String(value)}`);
      }
      return value;
    },
    decode(raw) {
      return (values as readonly string[]).includes(raw) ? (raw as V) : undefined;
    },
  };
}

function codec<N extends string, V>(
  name: N,
  codecs: { encode(v: V): string; decode(raw: string): V | undefined }
): SegmentSpec<N, V, false> {
  return {
    name,
    optional: false,
    encode(value) {
      return codecs.encode(value);
    },
    decode(raw) {
      return codecs.decode(raw);
    },
  };
}

function optionalSeg<N extends string, V>(spec: SegmentSpec<N, V, false>): SegmentSpec<N, V, true> {
  return { ...spec, optional: true };
}

/** Segment combinators for `defineCustomIdFamily` action definitions. */
export const seg = {
  str,
  int,
  enum: enumSeg,
  codec,
  optional: optionalSeg,
};

// ============================================================================
// Definition-time validation
// ============================================================================

function assertNoDelimiter(kind: string, value: string): void {
  if (value.includes(CUSTOM_ID_DELIMITER)) {
    throw new Error(`customId family ${kind} "${value}" must not contain "${CUSTOM_ID_DELIMITER}"`);
  }
}

/**
 * Segment names a parse result's plain object cannot safely hold.
 * `parseOneAction` writes `result[spec.name] = decoded` — `action` would
 * clobber the action discriminant it writes first, and `__proto__` hits the
 * inherited setter on bracket assignment (the same mechanism, and the same
 * reason, `__proto__` is a reserved ACTION name for `buildIsFn`'s
 * `perAction` object) instead of creating an own property, so
 * Discord-supplied bytes could silently reassign the result's prototype.
 */
const RESERVED_SEGMENT_NAMES = new Set(['action', '__proto__']);

function validateActionSegments(action: string, specs: readonly SegmentSpec[]): void {
  const seen = new Set<string>();
  let sawOptional = false;
  for (const spec of specs) {
    if (RESERVED_SEGMENT_NAMES.has(spec.name)) {
      throw new Error(
        `customId family action "${action}" declares reserved segment name "${spec.name}"`
      );
    }
    if (seen.has(spec.name)) {
      throw new Error(
        `customId family action "${action}" declares duplicate segment name "${spec.name}"`
      );
    }
    seen.add(spec.name);
    if (spec.optional) {
      sawOptional = true;
    } else if (sawOptional) {
      throw new Error(
        `customId family action "${action}" declares required segment "${spec.name}" after an optional segment`
      );
    }
  }
}

/**
 * `buildIsFn` builds `is` via `Object.assign(isFamily, perAction)`, assigning
 * each action name as an own property of a function object. Probed under
 * Node 24: `Object.assign(() => {}, { name: 1 })` and the `length`
 * equivalent both throw `TypeError: Cannot assign to read only property`
 * (non-writable own properties on a function), and `caller`/`arguments`
 * throw the strict-mode poison-pill accessor TypeError.
 * `prototype`/`constructor`/`toString` assign fine and are deliberately NOT
 * in this set. Pinned by customIdFamily.test.ts's reserved-action-name tests
 * (`name`/`length`/`caller`/`arguments` throw) and its `constructor`/`toString` positive test
 * (does not throw, `is.constructor` works).
 * `__proto__` is reserved for a different reason: bracket assignment on the
 * plain `perAction` object invokes the inherited setter instead of creating
 * an own property, so no predicate would be registered (probed under
 * Node 24; only a computed key reaches it, since a literal `__proto__:` key
 * never appears in `Object.entries`). Pinned by the `__proto__`
 * reserved-action-name test.
 */
const RESERVED_ACTION_NAMES = new Set(['name', 'length', 'caller', 'arguments', '__proto__']);

function validateDefinition(prefix: string, actions: ActionMap): void {
  assertNoDelimiter('prefix', prefix);
  for (const [action, specs] of Object.entries(actions)) {
    assertNoDelimiter('action', action);
    if (RESERVED_ACTION_NAMES.has(action)) {
      throw new Error(
        `customId family action name "${action}" is reserved (a Function own property or the __proto__ setter that buildIsFn cannot assign as a predicate)`
      );
    }
    validateActionSegments(action, specs);
  }
}

// ============================================================================
// build
// ============================================================================

/**
 * Validate an encoded segment value before it's joined into the wire
 * string: a `::` anywhere is rejected (pinned by the "value contains the
 * delimiter" build-time test), and — for every segment that is not the last
 * segment actually encoded in THIS build call (a trailing optional left out
 * makes the preceding segment last, not the declared last spec) — a
 * trailing single `:` is also rejected (pinned by the "non-terminal
 * segment" test), because `join` would merge it with the very next `::`
 * delimiter. Probed: `['p','act','x:','y'].join('::').split('::')` →
 * `["p","act","x",":y"]` — the colon migrates onto the next segment. A
 * leading or interior `:` round-trips fine, and a trailing `:` on the LAST
 * segment round-trips fine too (`['p','act','x','y:']` →
 * `["p","act","x","y:"]`), so it stays accepted there — the browse query
 * segment, always last, depends on it.
 */
function assertSegmentValue(
  actionLabel: string,
  spec: SegmentSpec,
  value: string,
  isLast: boolean
): void {
  if (value.includes(CUSTOM_ID_DELIMITER)) {
    throw new Error(
      `customId build for ${actionLabel} segment "${spec.name}" produced a value containing "${CUSTOM_ID_DELIMITER}"`
    );
  }
  // CUSTOM_ID_DELIMITER[0] stands for "the delimiter's char" only because
  // both chars of "::" are the same; a heterogeneous delimiter would need a
  // real suffix-overlap check.
  if (!isLast && value.endsWith(CUSTOM_ID_DELIMITER[0])) {
    throw new Error(
      `customId build for ${actionLabel} segment "${spec.name}" ends with ":" on a non-terminal segment, which would merge with the delimiter`
    );
  }
}

/**
 * The index of the last arg that will actually be encoded — the last index
 * `< length` whose value is not `undefined`. `-1` when no args are defined
 * at all (a zero-arg action, or every optional omitted). Needed because a
 * trailing optional segment left out of the build call makes the PRECEDING
 * segment the true last wire segment, even though it isn't the last entry
 * in the declared `specs` list.
 */
function lastDefinedIndex(args: readonly unknown[], length: number): number {
  for (let i = length - 1; i >= 0; i--) {
    if (args[i] !== undefined) {
      return i;
    }
  }
  return -1;
}

function buildOneAction(prefix: string, action: string, specs: readonly SegmentSpec[]) {
  const actionLabel = `${prefix}${CUSTOM_ID_DELIMITER}${action}`;
  return (...args: readonly unknown[]): string => {
    const encoded: string[] = [];
    let skippedOptional = false;
    const lastEncodedIndex = lastDefinedIndex(args, specs.length);
    for (const [index, spec] of specs.entries()) {
      const arg = args[index];
      if (arg === undefined) {
        if (!spec.optional) {
          throw new Error(
            `customId build for ${actionLabel} is missing required segment "${spec.name}"`
          );
        }
        skippedOptional = true;
        continue;
      }
      if (skippedOptional) {
        throw new Error(
          `customId build for ${actionLabel} cannot supply segment "${spec.name}" after skipping an earlier optional segment`
        );
      }
      const value = spec.encode(arg);
      assertSegmentValue(actionLabel, spec, value, index === lastEncodedIndex);
      encoded.push(value);
    }
    const customId = [prefix, action, ...encoded].join(CUSTOM_ID_DELIMITER);
    if (customId.length > DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH) {
      throw new Error(
        `customId for ${actionLabel} is ${customId.length} chars (max ${DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH})`
      );
    }
    return customId;
  };
}

function buildBuildMap<A extends ActionMap>(
  prefix: string,
  actions: A
): { [K in keyof A]: (...args: BuildArgs<A[K]>) => string } {
  const map: Record<string, (...args: readonly unknown[]) => string> = {};
  for (const [action, specs] of Object.entries(actions)) {
    map[action] = buildOneAction(prefix, action, specs);
  }
  return map as { [K in keyof A]: (...args: BuildArgs<A[K]>) => string };
}

// ============================================================================
// parse
// ============================================================================

/**
 * Decode one segment, treating a throwing `decode` exactly like a `decode`
 * that returns `undefined` (parse rejects). `raw` is Discord-supplied
 * customId content, so the log carries the prefix, action and segment name,
 * never the value.
 */
function decodeSegment(prefix: string, action: string, spec: SegmentSpec, raw: string): unknown {
  try {
    return spec.decode(raw);
  } catch {
    logger.warn({ prefix, action, segment: spec.name }, 'customId segment decode threw');
    return undefined;
  }
}

function parseOneAction(
  prefix: string,
  action: string,
  specs: readonly SegmentSpec[],
  segments: readonly string[]
): Record<string, unknown> | null {
  const requiredCount = specs.filter(spec => !spec.optional).length;
  if (segments.length > specs.length || segments.length < requiredCount) {
    return null;
  }
  const result: Record<string, unknown> = { action };
  for (const [index, spec] of specs.entries()) {
    const raw = segments[index];
    if (raw === undefined) {
      continue;
    }
    const decoded = decodeSegment(prefix, action, spec, raw);
    if (decoded === undefined) {
      return null;
    }
    result[spec.name] = decoded;
  }
  return result;
}

function buildParseFn<A extends ActionMap>(
  prefix: string,
  actions: A
): (customId: string) => ParsedFamily<A> | null {
  const prefixDelim = prefix + CUSTOM_ID_DELIMITER;
  return (customId: string): ParsedFamily<A> | null => {
    if (!customId.startsWith(prefixDelim)) {
      return null;
    }
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    const action = parts[1];
    if (action === undefined || !Object.hasOwn(actions, action)) {
      return null;
    }
    const segments = parts.slice(2);
    const result = parseOneAction(prefix, action, actions[action], segments);
    return result as ParsedFamily<A> | null;
  };
}

// ============================================================================
// is
// ============================================================================

function buildIsFn<A extends ActionMap>(
  prefix: string,
  actions: A
): ((customId: string) => boolean) & { [K in keyof A]: (customId: string) => boolean } {
  const prefixDelim = prefix + CUSTOM_ID_DELIMITER;
  const isFamily = (customId: string): boolean => customId.startsWith(prefixDelim);
  const perAction: Record<string, (customId: string) => boolean> = {};
  for (const action of Object.keys(actions)) {
    const exact = `${prefix}${CUSTOM_ID_DELIMITER}${action}`;
    const withDelim = `${exact}${CUSTOM_ID_DELIMITER}`;
    perAction[action] = (customId: string): boolean =>
      customId === exact || customId.startsWith(withDelim);
  }
  return Object.assign(isFamily, perAction) as ((customId: string) => boolean) & {
    [K in keyof A]: (customId: string) => boolean;
  };
}

// ============================================================================
// defineCustomIdFamily
// ============================================================================

/**
 * Declare a command's customId family: one prefix plus a segment list per
 * action. Throws at definition time on a malformed action map (see
 * `validateDefinition`); returns typed `build` / `parse` / `is` helpers.
 */
export function defineCustomIdFamily<P extends string, const A extends ActionMap>(
  prefix: P,
  actions: A
): CustomIdFamily<P, A> {
  validateDefinition(prefix, actions);
  return {
    prefix,
    build: buildBuildMap(prefix, actions),
    parse: buildParseFn(prefix, actions),
    is: buildIsFn(prefix, actions),
  };
}

// ============================================================================
// Presets
// ============================================================================

/** The three steps of the Tier-B destructive confirmation flow. */
export const DESTRUCTIVE_STEPS = ['confirm_button', 'cancel_button', 'modal_submit'] as const;

/** One step of the destructive confirmation flow. */
export type DestructiveStep = (typeof DESTRUCTIVE_STEPS)[number];

/** A str segment that rejects the empty string at build AND parse. */
function nonEmptyStr<N extends string>(name: N): SegmentSpec<N, string, false> {
  return codec(name, {
    encode(value: string) {
      if (value === '') {
        throw new Error(`Segment "${name}" requires a non-empty value`);
      }
      return value;
    },
    decode(raw: string) {
      return raw === '' ? undefined : raw;
    },
  });
}

/**
 * Destructive-confirmation preset: spread into any family's action map to
 * give it the shared `destructive` action —
 * `{prefix}::destructive::{step}::{operation}::{entityId?}`.
 * The step segment is named `step`, not `action`: `action` is a reserved
 * segment name (the parse result's discriminant).
 */
export function destructivePreset(): {
  readonly destructive: readonly [
    SegmentSpec<'step', DestructiveStep, false>,
    SegmentSpec<'operation', string, false>,
    SegmentSpec<'entityId', string, true>,
  ];
} {
  return {
    destructive: [
      enumSeg('step', DESTRUCTIVE_STEPS),
      nonEmptyStr('operation'),
      optionalSeg(str('entityId')),
    ],
  } as const;
}

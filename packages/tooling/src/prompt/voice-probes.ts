/**
 * Voice-probe shared types + pure helpers for the voice-consistency harness
 * (the caching epic's Phase-1→2 exit gate).
 *
 * The harness replays real conversations through competing prompt-assembly
 * arms and compares the persona's voice across them. These are the mining-side
 * primitives: personality auto-pick (most-active, spanning both protocol
 * formats), depth-stratum assignment over anchor candidates, and the probe
 * record shape the eval runners consume. Everything here is pure so it can be
 * CI-tested; DB access lives in mine-voice-probes.ts.
 */

/** Protocol storage format — the two diverge on {user} placeholder resolution. */
export type ProtocolFormat = 'json' | 'legacy' | 'none';

/**
 * Detect a personality's protocol format the way the production formatter does
 * (PersonalityFieldsFormatter.parseProtocolJson): valid JSON with the three
 * string-array fields is the JSON format; anything else non-empty is the
 * legacy XML string (which resolves {user} per-speaker at render time).
 */
export function detectProtocolFormat(raw: string | null | undefined): ProtocolFormat {
  if (raw === null || raw === undefined || raw.length === 0) {
    return 'none';
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return 'legacy';
    }
    const obj = parsed as Record<string, unknown>;
    const isStringArray = (value: unknown): boolean =>
      Array.isArray(value) && value.every(item => typeof item === 'string');
    if (
      isStringArray(obj.permissions) &&
      isStringArray(obj.characterDirectives) &&
      isStringArray(obj.formattingRules)
    ) {
      return 'json';
    }
    return 'legacy';
  } catch {
    return 'legacy';
  }
}

/**
 * Parse the `--depths` option into an ascending list of positive integers.
 * Accepts `string | number`: cac/mri coerces any digit-only option value to a
 * JS number at tokenize time (`--depths 30` arrives as the number 30), so a
 * string-only parser crashes on the most plausible single-depth invocation.
 */
export function parseDepthsOption(raw: string | number | undefined): number[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const text = String(raw).trim();
  if (text.length === 0) {
    return undefined;
  }
  const depths = text.split(',').map(part => Number(part.trim()));
  if (depths.some(depth => !Number.isInteger(depth) || depth < 1)) {
    throw new Error(`--depths must be positive integers, got: ${text}`);
  }
  // Dedupe: a repeated depth would re-run the same stratum and emit duplicate probes.
  return [...new Set(depths)];
}

/** A personality candidate for the probe set, with its activity weight. */
export interface PersonalityPick {
  id: string;
  slug: string;
  name: string;
  protocolFormat: ProtocolFormat;
  /** Assistant turns in the mining window — the activity ranking key. */
  assistantTurns: number;
}

export interface PickPersonalitiesResult {
  picked: PersonalityPick[];
  warnings: string[];
}

/**
 * Pick the `count` most-active personalities, forcing format coverage: the
 * probe set should span BOTH protocol formats (they diverge on {user}
 * resolution — a single-format sweep measures only one path). When the naive
 * top-N is single-format and the other format exists further down the ranking,
 * the lowest-activity pick is swapped for the most-active candidate of the
 * missing format. When a format simply doesn't exist among candidates, that's
 * a warning, not an error — you can't manufacture one.
 */
export function pickPersonalities(
  candidates: PersonalityPick[],
  count: number
): PickPersonalitiesResult {
  // Guard non-positive counts here, not just at the CLI: with an empty `picked`,
  // the format-coverage swap below would write picked[-1] (a stray property, not
  // an element) and still emit a misleading "swapped in" warning.
  if (count < 1) {
    return { picked: [], warnings: [] };
  }
  const warnings: string[] = [];
  const ranked = candidates
    .filter(candidate => candidate.protocolFormat !== 'none')
    .slice()
    .sort((a, b) => b.assistantTurns - a.assistantTurns || a.slug.localeCompare(b.slug));
  const picked = ranked.slice(0, count);
  if (picked.length < count) {
    warnings.push(
      `Only ${picked.length} active personalities with protocols exist — requested ${count}.`
    );
  }

  // Coverage of BOTH formats is unachievable with a single slot — and forcing
  // it there would just overwrite the most-active pick with whichever format
  // the loop processes last. Single-pick runs return the true top candidate.
  if (count < 2) {
    return { picked, warnings };
  }

  for (const format of ['json', 'legacy'] as const) {
    if (picked.some(pick => pick.protocolFormat === format)) {
      continue;
    }
    const replacement = ranked.find(candidate => candidate.protocolFormat === format);
    if (replacement === undefined) {
      warnings.push(
        `No ${format}-protocol personality exists among active candidates — the sweep covers a single format.`
      );
      continue;
    }
    // Swap out the least-active pick to make room for the missing format.
    picked[picked.length - 1] = replacement;
    warnings.push(
      `Swapped in ${replacement.slug} (${format} protocol) for format coverage over a more-active single-format pick.`
    );
  }

  return { picked, warnings };
}

/** Minimal anchor identity used for stratum assignment (content comes later). */
export interface AnchorCandidate {
  id: string;
  channelId: string;
  createdAt: Date;
}

/**
 * Assign anchor candidates to depth strata: evenly-space `depths.length ×
 * overSample` anchors across the (chronologically sorted) pool, then deal them
 * round-robin so every depth's candidates spread across the timeline rather
 * than clustering in one era. Deterministic — no RNG.
 */
export function assignDepthStrata<T>(
  sortedAnchors: T[],
  depths: number[],
  overSample: number,
  pickEvenlySpaced: (pool: T[], quota: number, buckets: number) => T[]
): Map<number, T[]> {
  const strata = new Map<number, T[]>(depths.map(depth => [depth, []]));
  if (depths.length === 0) {
    return strata;
  }
  const picked = pickEvenlySpaced(sortedAnchors, depths.length * overSample, 8);
  picked.forEach((anchor, index) => {
    const depth = depths[index % depths.length];
    strata.get(depth)?.push(anchor);
  });
  return strata;
}

/**
 * One history row in a probe — a superset of ai-worker's StructuredHistoryEntry so
 * the replay runner can hand rows straight to the chat-log serializer with
 * full speaker attribution (names are joined at mine time; the raw table
 * carries only IDs).
 */
export interface VoiceProbeHistoryEntry {
  id: string;
  discordMessageId: string[];
  role: string;
  content: string;
  /** ISO timestamp. */
  createdAt: string;
  personaId: string;
  /** preferredName ?? name — the speaker label the chat log renders for user turns. */
  personaName: string;
  personalityId: string;
  personalityName: string;
  tokenCount: number | null;
  messageMetadata: unknown;
}

/** One replay probe: a real assistant reply, its trigger, and the window before it. */
export interface VoiceProbe {
  /** The anchor (assistant reply) row id — the probe's stable identity. */
  probeId: string;
  /** How many prior turns this probe replays (the conversation-depth stratum). */
  depth: number;
  channelId: string;
  guildId: string | null;
  personality: {
    id: string;
    slug: string;
    name: string;
    protocolFormat: ProtocolFormat;
  };
  /** The user turn that prompted the reference reply. */
  trigger: VoiceProbeHistoryEntry;
  /** Exactly `depth` turns preceding the trigger, chronological. */
  priorHistory: VoiceProbeHistoryEntry[];
  /** The REAL logged reply — an authentic production sample under the old assembly
   * (validity anchor for the harness, never a comparison arm). */
  referenceReply: {
    id: string;
    content: string;
    createdAt: string;
  };
}

export interface VoiceProbeFile {
  meta: {
    env: string;
    minedAt: string;
    /** Anchors are strictly before this instant (the beta.190 prod deploy) so
     * every referenceReply is an authentic pre-restructure sample. */
    cutoff: string;
    depths: number[];
    personalities: PersonalityPick[];
    warnings: string[];
  };
  probes: VoiceProbe[];
}

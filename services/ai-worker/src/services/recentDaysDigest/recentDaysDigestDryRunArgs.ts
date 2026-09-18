/**
 * Argv parser for the operator-run digest dry-run script, kept outside
 * `scripts/` so it gets lint and a colocated test, which that directory is
 * excluded from.
 */

export type DryRunArgs =
  { ok: true; personaId: string; personalitySlug: string } | { ok: false; reason: string };

const FLAGS = {
  PERSONA: '--persona',
  PERSONALITY: '--personality',
} as const;

/**
 * Parses an argv already sliced past node + script path. Unknown tokens fail
 * loud rather than being ignored; a repeated flag takes its last value.
 */
export function parseDryRunArgs(argv: string[]): DryRunArgs {
  let personaId: string | null = null;
  let personalitySlug: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === FLAGS.PERSONA || token === FLAGS.PERSONALITY) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, reason: `missing value for ${token}` };
      }
      // Last value wins for a repeated flag.
      if (token === FLAGS.PERSONA) {
        personaId = value;
      } else {
        personalitySlug = value;
      }
      i += 1;
    } else {
      return { ok: false, reason: `unrecognized argument: ${token}` };
    }
  }

  if (personaId === null || personaId === '') {
    return { ok: false, reason: `missing ${FLAGS.PERSONA}` };
  }
  if (personalitySlug === null || personalitySlug === '') {
    return { ok: false, reason: `missing ${FLAGS.PERSONALITY}` };
  }
  return { ok: true, personaId, personalitySlug };
}

/**
 * Survey Character Field Lengths
 *
 * Read-only investigation script for the latent PersonalityCharacterFieldsSchema
 * cap bug (Session 1 Investigation Track, plan humming-singing-barto.md).
 *
 * Counts how many personalities have character fields exceeding the caps
 * currently enforced in packages/common-types/src/schemas/api/personality.ts.
 * These caps are enforced on writes (create/update Zod schemas) but not on
 * reads — so legacy data may exist in the DB that cannot be updated via the
 * normal API path.
 *
 * Output is aggregate-only: no personality names, slugs, or content is logged
 * or printed (per .claude/rules/00-critical.md PII logging rules).
 *
 * @usage pnpm ops run --env dev tsx scripts/src/db/survey-character-field-lengths.ts
 */

import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

// Caps as currently enforced in PersonalityCharacterFieldsSchema + PersonalityCreateSchema.
// DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH = 4000 (packages/common-types/src/constants/discord.ts:65)
const CAPS = {
  personalityTone: 1000,
  personalityAge: 100,
  personalityAppearance: 4000,
  personalityLikes: 4000,
  personalityDislikes: 4000,
  conversationalGoals: 4000,
  conversationalExamples: 4000,
  errorMessage: 1000,
  // Required fields from PersonalityCreateSchema (also validated on update)
  characterInfo: 4000,
  personalityTraits: 1000,
} as const;

interface FieldStats {
  field: string;
  cap: number;
  total_non_null: number;
  over_cap_count: number;
  max_length: number;
  avg_length: number;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();

  console.log('\n=== Character Field Length Survey ===\n');

  // Total personality count for context
  const totalResult = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM personalities
  `;
  const totalPersonalities = Number(totalResult[0]?.count ?? 0n);
  console.log(`Total personalities in DB: ${totalPersonalities}\n`);

  if (totalPersonalities === 0) {
    console.log('No personalities to survey. Exiting.');
    await disconnectPrisma();
    return;
  }

  // Per-field stats via a single query (more efficient than N separate queries)
  const statsResult = await prisma.$queryRaw<
    {
      field: string;
      cap: number;
      total_non_null: bigint;
      over_cap_count: bigint;
      max_length: number | null;
      avg_length: number | null;
    }[]
  >`
    SELECT 'personalityTone' AS field, 1000 AS cap,
      COUNT(personality_tone)::bigint AS total_non_null,
      COUNT(*) FILTER (WHERE char_length(personality_tone) > 1000)::bigint AS over_cap_count,
      MAX(char_length(personality_tone)) AS max_length,
      ROUND(AVG(char_length(personality_tone))) AS avg_length
      FROM personalities
    UNION ALL
    SELECT 'personalityAge', 100,
      COUNT(personality_age)::bigint,
      COUNT(*) FILTER (WHERE char_length(personality_age) > 100)::bigint,
      MAX(char_length(personality_age)),
      ROUND(AVG(char_length(personality_age)))
      FROM personalities
    UNION ALL
    SELECT 'personalityAppearance', 4000,
      COUNT(personality_appearance)::bigint,
      COUNT(*) FILTER (WHERE char_length(personality_appearance) > 4000)::bigint,
      MAX(char_length(personality_appearance)),
      ROUND(AVG(char_length(personality_appearance)))
      FROM personalities
    UNION ALL
    SELECT 'personalityLikes', 4000,
      COUNT(personality_likes)::bigint,
      COUNT(*) FILTER (WHERE char_length(personality_likes) > 4000)::bigint,
      MAX(char_length(personality_likes)),
      ROUND(AVG(char_length(personality_likes)))
      FROM personalities
    UNION ALL
    SELECT 'personalityDislikes', 4000,
      COUNT(personality_dislikes)::bigint,
      COUNT(*) FILTER (WHERE char_length(personality_dislikes) > 4000)::bigint,
      MAX(char_length(personality_dislikes)),
      ROUND(AVG(char_length(personality_dislikes)))
      FROM personalities
    UNION ALL
    SELECT 'conversationalGoals', 4000,
      COUNT(conversational_goals)::bigint,
      COUNT(*) FILTER (WHERE char_length(conversational_goals) > 4000)::bigint,
      MAX(char_length(conversational_goals)),
      ROUND(AVG(char_length(conversational_goals)))
      FROM personalities
    UNION ALL
    SELECT 'conversationalExamples', 4000,
      COUNT(conversational_examples)::bigint,
      COUNT(*) FILTER (WHERE char_length(conversational_examples) > 4000)::bigint,
      MAX(char_length(conversational_examples)),
      ROUND(AVG(char_length(conversational_examples)))
      FROM personalities
    UNION ALL
    SELECT 'errorMessage', 1000,
      COUNT(error_message)::bigint,
      COUNT(*) FILTER (WHERE char_length(error_message) > 1000)::bigint,
      MAX(char_length(error_message)),
      ROUND(AVG(char_length(error_message)))
      FROM personalities
    UNION ALL
    SELECT 'characterInfo', 4000,
      COUNT(character_info)::bigint,
      COUNT(*) FILTER (WHERE char_length(character_info) > 4000)::bigint,
      MAX(char_length(character_info)),
      ROUND(AVG(char_length(character_info)))
      FROM personalities
    UNION ALL
    SELECT 'personalityTraits', 1000,
      COUNT(personality_traits)::bigint,
      COUNT(*) FILTER (WHERE char_length(personality_traits) > 1000)::bigint,
      MAX(char_length(personality_traits)),
      ROUND(AVG(char_length(personality_traits)))
      FROM personalities
  `;

  // Count personalities with ANY over-cap field (unique rows affected)
  const anyOverResult = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM personalities
    WHERE char_length(personality_tone) > 1000
       OR char_length(personality_age) > 100
       OR char_length(personality_appearance) > 4000
       OR char_length(personality_likes) > 4000
       OR char_length(personality_dislikes) > 4000
       OR char_length(conversational_goals) > 4000
       OR char_length(conversational_examples) > 4000
       OR char_length(error_message) > 1000
       OR char_length(character_info) > 4000
       OR char_length(personality_traits) > 1000
  `;
  const anyOverCount = Number(anyOverResult[0]?.count ?? 0n);

  // Format the per-field stats table
  console.log('Per-field stats (fields with any over-cap rows are flagged with !):');
  console.log('');
  const header = `${'Field'.padEnd(24)} ${'Cap'.padStart(6)} ${'Non-null'.padStart(10)} ${'Over Cap'.padStart(10)} ${'Max Len'.padStart(10)} ${'Avg Len'.padStart(10)}`;
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of statsResult) {
    const overCount = Number(row.over_cap_count);
    const flag = overCount > 0 ? '!' : ' ';
    const line = [
      `${flag} ${row.field.padEnd(22)}`,
      String(row.cap).padStart(6),
      String(Number(row.total_non_null)).padStart(10),
      String(overCount).padStart(10),
      String(row.max_length ?? '-').padStart(10),
      String(row.avg_length ?? '-').padStart(10),
    ].join(' ');
    console.log(line);
  }

  console.log('');
  console.log(
    `Unique personalities with at least one over-cap field: ${anyOverCount} of ${totalPersonalities} (${((anyOverCount / totalPersonalities) * 100).toFixed(1)}%)`
  );

  // Emit JSON at the end for easy copy-paste into BACKLOG.md
  console.log('\n--- JSON summary ---');
  console.log(
    JSON.stringify(
      {
        totalPersonalities,
        uniquePersonalitiesWithOverCapField: anyOverCount,
        perField: statsResult.map(
          (r): FieldStats => ({
            field: r.field,
            cap: r.cap,
            total_non_null: Number(r.total_non_null),
            over_cap_count: Number(r.over_cap_count),
            max_length: r.max_length ?? 0,
            avg_length: r.avg_length ?? 0,
          })
        ),
      },
      null,
      2
    )
  );

  await disconnectPrisma();
}

main().catch(async (e: unknown) => {
  console.error('Survey failed:', e);
  await disconnectPrisma();
  process.exit(1);
});

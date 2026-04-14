#!/usr/bin/env tsx
/**
 * Data migration: heal default personas whose name/preferredName was baked
 * with the raw Discord snowflake instead of the user's Discord username.
 *
 * Background:
 * The api-gateway's getOrCreateInternalUser() helper previously called
 * UserService.getOrCreateUser(discordUserId, discordUserId), passing the
 * Discord snowflake as both the Discord ID and the username. Users created
 * via that path (NSFW verify, persona override list, etc.) got personas with
 * snowflake-as-name. Later, User.username was upgraded to the real username
 * by runMaintenanceTasks, but Persona.name + preferredName were never touched.
 *
 * This migration heals those records in a single pass. Target criteria:
 *   - persona.name matches /^\d{17,19}$/ (Discord snowflake pattern)
 *   - OR persona.preferredName matches the same pattern
 *   - AND the persona's owner.username is NOT a snowflake (real username exists)
 *
 * Preservation:
 *   - If preferredName differs from name AND doesn't look like a snowflake,
 *     we treat it as user-customized and leave it alone.
 *   - content is not touched (users can edit it themselves later).
 *
 * Usage:
 *   # Dry-run (ALWAYS do this first — inspects candidates without mutating):
 *   DRY_RUN=1 pnpm ops run --env prod --force tsx scripts/migrations/heal-persona-snowflake-names.ts
 *
 *   # Real run (after dry-run review):
 *   pnpm ops run --env prod --force tsx scripts/migrations/heal-persona-snowflake-names.ts
 *
 * Dry-run is controlled by the DRY_RUN env variable rather than a CLI flag,
 * because flags get consumed by the `ops run` wrapper (cac framework) before
 * reaching the script. Env vars survive the wrapper hop cleanly.
 */

import { getPrismaClient } from '../../packages/common-types/src/services/prisma.js';

const SNOWFLAKE_PATTERN = /^\d{17,19}$/;

const prisma = getPrismaClient();

interface HealCandidate {
  personaId: string;
  currentName: string;
  currentPreferredName: string | null;
  newName: string;
  newPreferredName: string | null;
  ownerUsername: string;
  ownerDiscordId: string;
  reason: string;
}

async function main(): Promise<void> {
  // DRY_RUN env var (not a CLI flag — flags get swallowed by `ops run` wrapper).
  // Accept "1", "true", "yes" (case-insensitive) as truthy.
  const dryRunRaw = process.env.DRY_RUN ?? '';
  const dryRun = ['1', 'true', 'yes'].includes(dryRunRaw.toLowerCase());

  console.log(`\n🩹 Healing persona snowflake names${dryRun ? ' (DRY RUN)' : ''}...\n`);

  const personas = await prisma.persona.findMany({
    select: {
      id: true,
      name: true,
      preferredName: true,
      ownerId: true,
      owner: {
        select: {
          discordId: true,
          username: true,
          defaultPersonaId: true,
        },
      },
    },
    take: 10_000,
  });

  const candidates: HealCandidate[] = [];

  for (const p of personas) {
    if (p.owner === null) continue;
    // Skip if owner's username is also still a snowflake — can't heal without
    // a trustworthy reference name. These should be resolved separately
    // (typically auto-heals when the user interacts via Discord).
    if (SNOWFLAKE_PATTERN.test(p.owner.username)) continue;

    const nameIsSnowflake = SNOWFLAKE_PATTERN.test(p.name);
    const preferredIsSnowflake =
      p.preferredName !== null && SNOWFLAKE_PATTERN.test(p.preferredName);

    if (!nameIsSnowflake && !preferredIsSnowflake) continue;

    const newName = nameIsSnowflake ? p.owner.username : p.name;
    // Only overwrite preferredName if it's also a snowflake (don't clobber
    // a user-customized preferredName even if name was broken).
    const newPreferredName = preferredIsSnowflake ? p.owner.username : p.preferredName;

    candidates.push({
      personaId: p.id,
      currentName: p.name,
      currentPreferredName: p.preferredName,
      newName,
      newPreferredName,
      ownerUsername: p.owner.username,
      ownerDiscordId: p.owner.discordId,
      reason:
        nameIsSnowflake && preferredIsSnowflake
          ? 'both'
          : nameIsSnowflake
            ? 'name'
            : 'preferredName',
    });
  }

  console.log(`📊 Total personas scanned: ${personas.length}`);
  console.log(`🎯 Healing candidates:     ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log('✅ No broken personas found. Nothing to do.\n');
    await prisma.$disconnect();
    return;
  }

  console.log('Candidates:');
  for (const c of candidates) {
    console.log(
      `  ${c.personaId.slice(0, 8)}... (${c.ownerUsername}) | fixing ${c.reason}: name "${c.currentName}" → "${c.newName}" | preferredName ${JSON.stringify(c.currentPreferredName)} → ${JSON.stringify(c.newPreferredName)}`
    );
  }

  if (dryRun) {
    console.log('\n(--dry-run) No changes applied.\n');
    await prisma.$disconnect();
    return;
  }

  console.log('\n✍️  Applying updates...\n');

  let healed = 0;
  for (const c of candidates) {
    await prisma.persona.update({
      where: { id: c.personaId },
      data: {
        name: c.newName,
        preferredName: c.newPreferredName,
      },
    });
    healed++;
  }

  console.log(`✅ Healed ${healed} / ${candidates.length} personas.\n`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

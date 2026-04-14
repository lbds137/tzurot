#!/usr/bin/env tsx
/**
 * Scope-and-state query for the persona-name-placeholder bug.
 *
 * Produces three numbers that shape the fix plan:
 *   1. How many personas have name matching Discord snowflake pattern (/^\d{17,19}$/)
 *   2. How many personas have preferredName null (triggers activePersonaName-undefined path)
 *   3. How many personas have name != owner.username (divergence indicator)
 *
 * Also dumps Lila's persona state for comparison with laranthras.
 */

import { getPrismaClient } from '@tzurot/common-types';

const prisma = getPrismaClient();

async function main(): Promise<void> {
  const snowflakeRegex = /^\d{17,19}$/;

  // Pull every default persona with its owner. Bounded — personas table is small.
  const allPersonas = await prisma.persona.findMany({
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
    take: 10000,
  });

  const defaultPersonas = allPersonas.filter(p => p.owner?.defaultPersonaId === p.id);

  const snowflakeName = defaultPersonas.filter(p => snowflakeRegex.test(p.name));
  const nullPreferredName = defaultPersonas.filter(p => p.preferredName === null);
  const snowflakePreferred = defaultPersonas.filter(
    p => p.preferredName !== null && snowflakeRegex.test(p.preferredName)
  );
  const nameDivergentFromUsername = defaultPersonas.filter(
    p => p.owner !== null && p.name !== p.owner.username
  );

  console.log('\n=== Scope of persona-name placeholder bug (prod) ===\n');
  console.log(`Total personas:                         ${allPersonas.length}`);
  console.log(`Default personas (one per user):        ${defaultPersonas.length}`);
  console.log();
  console.log(`Default personas with name matching a snowflake (/^\\d{17,19}$/):`);
  console.log(`  → ${snowflakeName.length} / ${defaultPersonas.length}`);
  console.log();
  console.log(`Default personas with preferredName === null:`);
  console.log(`  → ${nullPreferredName.length} / ${defaultPersonas.length}`);
  console.log();
  console.log(`Default personas with preferredName matching a snowflake:`);
  console.log(`  → ${snowflakePreferred.length} / ${defaultPersonas.length}`);
  console.log();
  console.log(`Default personas where persona.name !== owner.username:`);
  console.log(`  → ${nameDivergentFromUsername.length} / ${defaultPersonas.length}`);

  console.log('\n=== Temporal analysis of affected personas ===\n');
  // Re-fetch with timestamps for the snowflake-named subset
  const affectedIds = snowflakeName.map(p => p.id);
  const affected = await prisma.persona.findMany({
    where: { id: { in: affectedIds } },
    select: {
      id: true,
      name: true,
      createdAt: true,
      ownerId: true,
      owner: { select: { discordId: true, username: true, createdAt: true, updatedAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const p of affected) {
    const userCreated = p.owner?.createdAt.toISOString() ?? '(unknown)';
    const personaCreated = p.createdAt.toISOString();
    const gap =
      p.owner !== null
        ? Math.round((p.createdAt.getTime() - p.owner.createdAt.getTime()) / 1000)
        : null;
    const userUpdated = p.owner?.updatedAt.toISOString() ?? '(unknown)';
    console.log(
      `  ${personaCreated} persona | owner="${p.owner?.username}" (${p.owner?.discordId}) | user_created=${userCreated} | user_updated=${userUpdated} | gap=${gap}s`
    );
  }

  console.log('\n=== Temporal buckets ===\n');
  const monthBuckets = new Map<string, number>();
  for (const p of affected) {
    const bucket = p.createdAt.toISOString().slice(0, 7); // YYYY-MM
    monthBuckets.set(bucket, (monthBuckets.get(bucket) ?? 0) + 1);
  }
  for (const [month, count] of Array.from(monthBuckets.entries()).sort()) {
    console.log(`  ${month}: ${count} affected personas created`);
  }

  console.log('\n=== First and last affected persona ===\n');
  if (affected.length > 0) {
    const first = affected[0];
    const last = affected[affected.length - 1];
    console.log(
      `  First broken persona: ${first.createdAt.toISOString()} (owner: ${first.owner?.username})`
    );
    console.log(
      `  Last broken persona:  ${last.createdAt.toISOString()} (owner: ${last.owner?.username})`
    );
  }

  console.log('\n=== Done ===\n');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});

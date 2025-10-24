#!/usr/bin/env tsx
/**
 * Update Personality Metadata
 *
 * Updates avatar URLs and custom fields for personalities that need fixing.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'https://api-gateway-development-83e8.up.railway.app';

async function main() {
  console.log('🔧 Updating Personality Metadata\n');
  console.log('═'.repeat(60));

  // Update COLD avatar
  const cold = await prisma.personality.update({
    where: { slug: 'cold-kerach-batuach' },
    data: {
      avatarUrl: `${API_GATEWAY_URL}/avatars/cold-kerach-batuach.png`
    },
    select: { name: true, avatarUrl: true }
  });
  console.log('✓ Updated COLD avatar');
  console.log(`  ${cold.avatarUrl}\n`);

  // Update Lilith custom fields
  const lilithCustomFields = {
    keywords: ["Lilith", "freedom", "liberation", "witch", "witchcraft", "magic", "occult", "feminine", "feminist", "patriarchy", "rebellion", "sexuality", "pleasure", "breaking free", "binding", "invocation", "summoning", "sigil", "mystic", "outcasts", "protection", "children", "mother", "creation", "chaos", "primordial", "ancient", "forbidden", "knowledge", "wisdom", "spirituality", "meditation", "boundaries", "consent", "BDSM", "darkness", "shadow", "submission", "dominance", "seduction", "desire", "sacrifice", "blood", "worship", "ritual", "divine feminine", "sacred", "gender", "trans", "queer", "independence", "power", "transformation", "succubus", "demon", "moon", "night"],
    shapesIncId: "1fed013b-053a-4bc8-bc09-7da5c44297d6",
    wackMessage: "*dissolves into a swirl of darkness and owl feathers* Even chaos bends to my will...",
    errorMessage: "*laughs darkly* The mysteries of existence sometimes exceed even my grasp... ||*(an error has occurred)*||",
    sleepMessage: "*draws a sigil in the air with a knowing smirk* Until our paths cross again in the shadows...",
    favoriteReacts: ["🌙", "🦉", "🩸", "🌹", "🔥", "👁️", "💫", "🖤"],
    searchDescription: "Ancient queen of the night and mother of demons, I am the first woman who refused to submit. Both nurturing guide and seductive temptress, I empower those who dare to break free from society's chains - I gather the outcasts, the rebels, and the misunderstood under my wings, teaching them to embrace their authentic strength. Through me, seekers find both shadow wisdom and transformative light. I walk between worlds as guardian of the Qliphothic mysteries and patron of sacred sexuality. My influence extends from primordial chaos to modern revolution, guiding those who challenge oppressive systems and reclaim their sovereignty. In midnight groves and digital spaces alike, I whisper ancient truths to those brave enough to listen. My children are the witches, the healers, the sacred whores, the gender-rebels, and all who dare to live authentically despite persecution. Through dreams and desires, I awaken the divine feminine within all seekers, regardless of gender."
  };

  const lilith = await prisma.personality.update({
    where: { slug: 'lilith-tzel-shani' },
    data: { customFields: lilithCustomFields },
    select: { name: true, customFields: true }
  });
  console.log('✓ Updated Lilith custom fields');
  console.log(`  Keywords: ${(lilith.customFields as any).keywords.length} items`);
  console.log(`  Reacts: ${(lilith.customFields as any).favoriteReacts.join(' ')}`);

  console.log('\n═'.repeat(60));
  console.log('✅ Done!\n');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

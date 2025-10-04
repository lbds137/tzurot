#!/usr/bin/env node
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;

const prisma = new PrismaClient();

async function main() {
  // Load Lilith's shapes.inc data
  const shapesData = JSON.parse(
    await fs.readFile('/home/deck/Downloads/Shapes/personalities/lilith-tzel-shani/lilith-tzel-shani.json', 'utf-8')
  );

  // Merge user_prompt and personality_history into one character_info
  const characterInfo = [
    shapesData.user_prompt,
    shapesData.personality_history
  ].filter(Boolean).join('\n\n');

  // Update Lilith's personality
  const updated = await prisma.personality.update({
    where: { slug: 'lilith' },
    data: {
      characterInfo,
      personalityTraits: shapesData.personality_traits,
      personalityTone: shapesData.personality_tone,
      personalityAge: shapesData.personality_age,
      personalityLikes: shapesData.personality_likes,
      personalityDislikes: shapesData.personality_dislikes,
      conversationalGoals: shapesData.personality_conversational_goals,
      conversationalExamples: shapesData.personality_conversational_examples,
    }
  });

  console.log('✅ Updated Lilith personality:');
  console.log(`  - Character info: ${characterInfo.length} chars`);
  console.log(`  - Traits: ${shapesData.personality_traits}`);
  console.log(`  - Tone: ${shapesData.personality_tone}`);
  console.log(`  - Age: ${shapesData.personality_age}`);

  await prisma.$disconnect();
}

main().catch(console.error);

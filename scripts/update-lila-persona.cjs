#!/usr/bin/env node
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;

const prisma = new PrismaClient();

async function main() {
  // Load user personalization data
  const personalizationData = JSON.parse(
    await fs.readFile('/home/deck/Downloads/Shapes/personalities/lilith-tzel-shani/lilith-tzel-shani_user_personalization.json', 'utf-8')
  );

  // Find user by UUID (from shapes.inc personalization data)
  const userId = personalizationData.user_id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { globalPersona: true }
  });

  if (!user) {
    console.error('❌ User not found with ID:', userId);
    await prisma.$disconnect();
    return;
  }

  console.log(`Found user: ${user.username} (${user.id})`);

  // Delete the erroneous Lilith persona if it exists
  if (user.globalPersona) {
    console.log(`Deleting erroneous persona: ${user.globalPersona.name}`);
    await prisma.persona.delete({
      where: { id: user.globalPersona.id }
    });
  }

  // Create proper user persona from personalization data
  const newPersona = await prisma.persona.create({
    data: {
      name: `${personalizationData.preferred_name}'s Persona`,
      description: 'User personalization from shapes.inc',
      content: personalizationData.backstory,
      preferredName: personalizationData.preferred_name,
      pronouns: personalizationData.pronouns,
      ownerId: user.id,
      isGlobal: false
    }
  });

  console.log(`✅ Created new persona: ${newPersona.name} (${newPersona.id})`);

  // Link to user's globalPersona
  await prisma.user.update({
    where: { id: user.id },
    data: { globalPersonaId: newPersona.id }
  });

  console.log(`✅ Linked persona to user's globalPersona`);
  console.log(`\nPersona content preview:`);
  console.log(personalizationData.backstory.substring(0, 200) + '...');

  await prisma.$disconnect();
}

main().catch(console.error);

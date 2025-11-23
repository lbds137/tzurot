require('dotenv').config();
const {
  QdrantMemoryService,
} = require('../../packages/common-types/dist/services/QdrantMemoryService.js');

async function test() {
  console.log('🧪 Testing Memory Retrieval with Persona-Scoped Collections\n');

  const memoryService = new QdrantMemoryService();

  // Use Lila's persona ID (has 3392 memories)
  const personaId = '3bd86394-20d8-5992-8201-e621856e9087';
  const userId = 'e64fcc09-e4db-5902-b1c9-5750141e3bf2'; // Lila's user ID
  const personalityId = 'c296b337-4e67-5337-99a3-4ca105cbbd68'; // Lilith personality

  console.log(
    'Test 1: Search without personalityId filter (should return memories from all personalities in persona)'
  );
  const results1 = await memoryService.searchMemories(
    personaId,
    'Lila talked about work and her anxieties',
    { userId, limit: 5, scoreThreshold: 0.3 }
  );
  console.log(`  ✓ Found ${results1.length} memories`);
  if (results1.length > 0) {
    console.log(`  ✓ Sample memory:`);
    console.log(`    - personaId: ${results1[0].metadata.personaId}`);
    console.log(`    - personalityId: ${results1[0].metadata.personalityId}`);
    console.log(`    - personalityName: ${results1[0].metadata.personalityName}`);
    console.log(`    - content preview: ${results1[0].content.substring(0, 80)}...`);
  }

  console.log('\nTest 2: Search WITH personalityId filter (should only return Lilith memories)');
  const results2 = await memoryService.searchMemories(personaId, 'Lila office work', {
    userId,
    personalityId,
    limit: 5,
    scoreThreshold: 0.3,
  });
  console.log(`  ✓ Found ${results2.length} memories`);
  if (results2.length > 0) {
    const allMatchPersonality = results2.every(m => m.metadata.personalityId === personalityId);
    console.log(`  ${allMatchPersonality ? '✓' : '✗'} All results match personalityId filter`);
    console.log(`  ✓ Sample memory:`);
    console.log(`    - personalityName: ${results2[0].metadata.personalityName}`);
    console.log(`    - content preview: ${results2[0].content.substring(0, 80)}...`);
  }

  console.log('\nTest 3: Verify persona collection naming');
  const hasMemories = await memoryService.hasMemories(personaId);
  console.log(`  ${hasMemories ? '✓' : '✗'} Persona ${personaId} has memories`);

  console.log('\n✅ All tests completed!');
}

test().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

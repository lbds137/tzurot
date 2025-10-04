#!/usr/bin/env node
/**
 * Shapes.inc Data Ingestion Script
 *
 * Ingests shapes.inc personality data into:
 * - PostgreSQL (personalities, personas, system prompts, LLM configs, users)
 * - Qdrant (long-term memories with embeddings)
 *
 * Usage:
 *   node scripts/ingest-shapes-inc.js <personality-folder>
 *
 * Example:
 *   node scripts/ingest-shapes-inc.js tzurot-legacy/data/personalities/lilith-tzel-shani
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { v5: uuidv5 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { createQdrantClient, ensureCollection, upsertMemories } = require('./lib/qdrant.cjs');
const { OpenAI } = require('openai');

const prisma = new PrismaClient();

// Namespace UUID for generating deterministic UUIDs from personality IDs
const NAMESPACE_PERSONALITY = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Load shapes.inc personality data files
 */
async function loadShapesIncData(personalityDir) {
  const baseName = path.basename(personalityDir);
  const files = {
    config: path.join(personalityDir, `${baseName}.json`),
    memories: path.join(personalityDir, `${baseName}_memories.json`),
    chatHistory: path.join(personalityDir, `${baseName}_chat_history.json`),
    knowledge: path.join(personalityDir, `${baseName}_knowledge.json`),
    userPersonalization: path.join(personalityDir, `${baseName}_user_personalization.json`),
  };

  const data = {};

  // Load main config (required)
  data.config = JSON.parse(await fs.readFile(files.config, 'utf-8'));

  // Load optional files
  for (const [key, file] of Object.entries(files)) {
    if (key === 'config') continue;
    try {
      const content = await fs.readFile(file, 'utf-8');
      data[key] = JSON.parse(content);
    } catch (error) {
      console.log(`⚠ ${key} file not found, skipping`);
      data[key] = null;
    }
  }

  return data;
}

/**
 * Create or get user from database
 * Note: shapes.inc uses UUIDs for user_id, but we need Discord snowflake IDs
 * For now, using a hardcoded Discord ID for the owner
 * TODO: Make this configurable via CLI argument for bot integration
 */
async function ensureUser(userId, username, discordId = '278863839632818186') {
  return await prisma.user.upsert({
    where: { id: userId },
    update: { username, discordId },
    create: {
      id: userId,
      discordId,
      username,
    },
  });
}

/**
 * Create reusable Persona from user_prompt
 */
async function createPersona(config, ownerId) {
  const personaName = `${config.name} Default Persona`;
  const personaId = uuidv5(`${config.id}-persona`, NAMESPACE_PERSONALITY);

  return await prisma.persona.upsert({
    where: { id: personaId },
    update: {
      name: personaName,
      content: config.user_prompt || '',
      description: 'Imported from shapes.inc',
    },
    create: {
      id: personaId,
      name: personaName,
      content: config.user_prompt || '',
      description: 'Imported from shapes.inc',
      ownerId,
      isGlobal: false,
    },
  });
}

/**
 * Create reusable System Prompt from jailbreak
 */
async function createSystemPrompt(config) {
  const promptName = `${config.name} System Prompt`;
  const promptId = uuidv5(`${config.id}-prompt`, NAMESPACE_PERSONALITY);

  return await prisma.systemPrompt.upsert({
    where: { id: promptId },
    update: {
      name: promptName,
      content: config.jailbreak || '',
    },
    create: {
      id: promptId,
      name: promptName,
      content: config.jailbreak || '',
      description: 'Imported from shapes.inc',
      isDefault: false,
    },
  });
}

/**
 * Create reusable LLM Config from engine_* settings
 */
async function createLlmConfig(config) {
  const configName = `${config.name} LLM Config`;
  const llmConfigId = uuidv5(`${config.id}-llm`, NAMESPACE_PERSONALITY);

  return await prisma.llmConfig.upsert({
    where: { id: llmConfigId },
    update: {
      name: configName,
      model: config.engine_model || 'gpt-4',
      temperature: config.engine_temperature ? parseFloat(config.engine_temperature) : null,
      topP: config.engine_top_p ? parseFloat(config.engine_top_p) : null,
      frequencyPenalty: config.engine_frequency_penalty
        ? parseFloat(config.engine_frequency_penalty)
        : null,
      presencePenalty: config.engine_presence_penalty
        ? parseFloat(config.engine_presence_penalty)
        : null,
      maxTokens: config.engine_max_tokens ? parseInt(config.engine_max_tokens) : null,
    },
    create: {
      id: llmConfigId,
      name: configName,
      model: config.engine_model || 'gpt-4',
      temperature: config.engine_temperature ? parseFloat(config.engine_temperature) : null,
      topP: config.engine_top_p ? parseFloat(config.engine_top_p) : null,
      frequencyPenalty: config.engine_frequency_penalty
        ? parseFloat(config.engine_frequency_penalty)
        : null,
      presencePenalty: config.engine_presence_penalty
        ? parseFloat(config.engine_presence_penalty)
        : null,
      maxTokens: config.engine_max_tokens ? parseInt(config.engine_max_tokens) : null,
      description: 'Imported from shapes.inc',
      isDefault: false,
    },
  });
}

/**
 * Create Personality entity
 */
async function createPersonality(config, systemPromptId, llmConfigId) {
  return await prisma.personality.upsert({
    where: { id: config.id },
    update: {
      name: config.name,
      displayName: config.display_name || config.name,
      slug: config.name.toLowerCase().replace(/\s+/g, '-'),
      avatarUrl: config.avatar || null,
      systemPromptId,
      llmConfigId,
      memoryEnabled: true,
      contextWindowSize: config.stm_window || 20,
    },
    create: {
      id: config.id,
      name: config.name,
      displayName: config.display_name || config.name,
      slug: config.name.toLowerCase().replace(/\s+/g, '-'),
      avatarUrl: config.avatar || null,
      systemPromptId,
      llmConfigId,
      memoryEnabled: true,
      contextWindowSize: config.stm_window || 20,
    },
  });
}

/**
 * Link user as personality owner
 */
async function createPersonalityOwner(personalityId, userId) {
  return await prisma.personalityOwner.upsert({
    where: {
      personalityId_userId: {
        personalityId,
        userId,
      },
    },
    update: {},
    create: {
      personalityId,
      userId,
      role: 'owner',
    },
  });
}

/**
 * Generate embeddings for memory text using OpenAI
 */
async function generateEmbedding(text) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Ingest memories into Qdrant
 */
async function ingestMemories(memories, personalityId, personalityName) {
  if (!memories || memories.length === 0) {
    console.log('No memories to ingest');
    return;
  }

  const qdrant = createQdrantClient();
  const collectionName = `personality-${personalityId}`;

  // Ensure collection exists
  await ensureCollection(qdrant, collectionName, 1536);

  console.log(`Processing ${memories.length} memories...`);

  // Filter out deleted memories
  const activeMemories = memories.filter(m => !m.deleted);
  console.log(`Found ${activeMemories.length} active memories`);

  // Process in batches to avoid rate limits
  const batchSize = 10;
  let processed = 0;

  for (let i = 0; i < activeMemories.length; i += batchSize) {
    const batch = activeMemories.slice(i, i + batchSize);
    const memoryPoints = [];

    for (const memory of batch) {
      try {
        // Generate embedding for the memory summary
        const embedding = await generateEmbedding(memory.result);

        // Convert memory ID to valid UUID (shapes.inc uses "uuid/uuid" format)
        const validId = uuidv5(memory.id, NAMESPACE_PERSONALITY);

        // Convert timestamp to Unix milliseconds (integer)
        // shapes.inc stores timestamps as Unix seconds (float)
        const createdAt = memory.metadata?.created_at
          ? Math.floor(memory.metadata.created_at * 1000)  // Convert seconds to milliseconds
          : Date.now();

        memoryPoints.push({
          id: validId,
          vector: embedding,
          payload: {
            personalityId,
            personalityName,
            summaryType: memory.summary_type,
            content: memory.result,
            metadata: memory.metadata,
            createdAt, // Unix timestamp in milliseconds (integer)
            channelId: memory.metadata?.discord_channel_id,
            guildId: memory.metadata?.discord_guild_id,
            messageIds: memory.metadata?.msg_ids,
            senders: memory.senders,
          },
        });

        processed++;
        if (processed % 10 === 0) {
          console.log(`  Processed ${processed}/${activeMemories.length} memories...`);
        }
      } catch (error) {
        console.error(`Failed to process memory ${memory.id}:`, error.message);
      }
    }

    // Upsert batch to Qdrant
    if (memoryPoints.length > 0) {
      await upsertMemories(qdrant, collectionName, memoryPoints);
    }

    // Rate limit: wait 1 second between batches
    if (i + batchSize < activeMemories.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`✓ Ingested ${processed} memories into Qdrant collection "${collectionName}"`);
}

/**
 * Main ingestion workflow
 */
async function main() {
  const personalityDir = process.argv[2];

  if (!personalityDir) {
    console.error('Usage: node scripts/ingest-shapes-inc.js <personality-folder>');
    console.error('Example: node scripts/ingest-shapes-inc.js tzurot-legacy/data/personalities/lilith-tzel-shani');
    process.exit(1);
  }

  console.log(`\n🔄 Loading shapes.inc data from: ${personalityDir}\n`);

  // Load all data files
  const data = await loadShapesIncData(personalityDir);
  const config = data.config;

  console.log(`Personality: ${config.name} (${config.id})`);

  // Handle user_id - it can be a single ID or array in shapes.inc
  const userIds = Array.isArray(config.user_id) ? config.user_id : [config.user_id];
  console.log(`Owners: ${userIds.join(', ')}\n`);

  // 1. Ensure user exists (use first user as primary owner)
  console.log('📝 Creating/updating user...');
  const user = await ensureUser(userIds[0], 'shapes.inc import');
  console.log(`✓ User: ${user.id}\n`);

  // 2. Create reusable templates
  console.log('📝 Creating reusable templates...');
  const persona = await createPersona(config, user.id);
  console.log(`✓ Persona: ${persona.name}`);

  const systemPrompt = await createSystemPrompt(config);
  console.log(`✓ System Prompt: ${systemPrompt.name}`);

  const llmConfig = await createLlmConfig(config);
  console.log(`✓ LLM Config: ${llmConfig.name}\n`);

  // 3. Create personality
  console.log('📝 Creating personality...');
  const personality = await createPersonality(config, systemPrompt.id, llmConfig.id);
  console.log(`✓ Personality: ${personality.name} (${personality.id})\n`);

  // 4. Link ownership
  console.log('📝 Setting up ownership...');
  await createPersonalityOwner(personality.id, user.id);
  console.log(`✓ Owner linked\n`);

  // 5. Ingest memories into Qdrant
  if (data.memories && process.env.OPENAI_API_KEY) {
    console.log('📝 Ingesting memories into Qdrant...');
    await ingestMemories(data.memories, personality.id, personality.name);
  } else if (!process.env.OPENAI_API_KEY) {
    console.log('⚠ OPENAI_API_KEY not set, skipping memory ingestion');
    console.log('  (Memories require embeddings from OpenAI)\n');
  }

  console.log('✅ Ingestion complete!\n');
  console.log('Summary:');
  console.log(`  - Personality: ${personality.name}`);
  console.log(`  - Persona: ${persona.name}`);
  console.log(`  - System Prompt: ${systemPrompt.name}`);
  console.log(`  - LLM Config: ${llmConfig.name}`);
  if (data.memories) {
    const activeCount = data.memories.filter(m => !m.deleted).length;
    console.log(`  - Memories: ${activeCount} active (${data.memories.length} total)`);
  }
}

main()
  .catch(error => {
    console.error('❌ Ingestion failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Personality Import CLI
 *
 * Orchestrates the complete import of a personality from shapes.inc backup
 * to Tzurot v3, including:
 * - Personality configuration (PostgreSQL)
 * - Avatar download and storage
 * - LTM memories (Qdrant)
 * - UUID mapping and orphan handling
 *
 * Usage:
 *   pnpm import-personality cold-kerach-batuach --dry-run
 *   pnpm import-personality cold-kerach-batuach
 *   pnpm import-personality cold-kerach-batuach --memories-only
 *   pnpm import-personality cold-kerach-batuach --force
 */

import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAI } from 'openai';
import { PersonalityMapper } from './PersonalityMapper.js';
import { AvatarDownloader } from './AvatarDownloader.js';
import { MemoryImporter } from './MemoryImporter.js';
import type {
  ShapesIncPersonalityConfig,
  ShapesIncMemory,
  PersonalityImportResult,
  MemoryImportResult,
} from './types.js';
import { getConfig } from '@tzurot/common-types';

const config = getConfig();

// Constants
const LEGACY_DATA_PATH = 'tzurot-legacy/data/personalities';
const AVATAR_STORAGE_DIR = '/data/avatars';
const API_GATEWAY_URL = config.API_GATEWAY_URL || 'http://localhost:3000';

interface ImportOptions {
  slug: string;
  dryRun: boolean;
  memoriesOnly: boolean;
  force: boolean;
  skipMemories: boolean;
}

class PersonalityImportCLI {
  private prisma: PrismaClient;
  private qdrant: QdrantClient;
  private openai: OpenAI;
  private mapper: PersonalityMapper;
  private avatarDownloader: AvatarDownloader;

  constructor() {
    this.prisma = new PrismaClient();
    this.qdrant = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY,
    });
    this.openai = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
    });
    this.mapper = new PersonalityMapper();
    this.avatarDownloader = new AvatarDownloader({
      storageDir: AVATAR_STORAGE_DIR,
      baseUrl: API_GATEWAY_URL,
    });
  }

  /**
   * Main import flow
   */
  async import(options: ImportOptions): Promise<void> {
    console.log('\n🚀 Tzurot Personality Import Tool');
    console.log('═'.repeat(80));
    console.log(`\nPersonality: ${options.slug}`);
    console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);
    console.log(`Memories only: ${options.memoriesOnly}`);
    console.log(`Force overwrite: ${options.force}`);
    console.log('');

    try {
      // Step 1: Load and validate shapes.inc data
      console.log('Step 1: Loading shapes.inc data\n');
      const shapesData = await this.loadShapesData(options.slug);
      console.log(`✅ Loaded ${options.slug} data:`);
      console.log(`  Config: ${JSON.stringify(this.mapper.summarize(shapesData.config), null, 2)}`);
      console.log(`  Memories: ${shapesData.memories.length}`);
      console.log(`  Chat messages: ${shapesData.chatHistory?.length || 0}`);
      console.log('');

      // Step 2: Import personality (unless memories-only mode)
      let personalityResult: PersonalityImportResult | null = null;
      if (!options.memoriesOnly) {
        console.log('Step 2: Importing personality configuration\n');
        personalityResult = await this.importPersonality(
          shapesData.config,
          options
        );
        console.log(`✅ Personality imported: ${personalityResult.v3PersonalityId}`);
        console.log(`  Avatar: ${personalityResult.avatarUrl}`);
        console.log('');
      } else {
        // Memories-only mode: look up existing personality
        console.log('Step 2: Looking up existing personality\n');
        const existing = await this.prisma.personality.findUnique({
          where: { slug: options.slug },
        });

        if (!existing) {
          throw new Error(`Personality ${options.slug} not found. Run full import first.`);
        }

        console.log(`✅ Found existing personality: ${existing.id}`);
        console.log('');
      }

      // Step 3: Import memories (unless skip-memories flag)
      if (!options.skipMemories && shapesData.memories.length > 0) {
        console.log('Step 3: Importing memories\n');

        const personality = personalityResult
          ? { id: personalityResult.v3PersonalityId, name: shapesData.config.name }
          : await this.prisma.personality.findUnique({
              where: { slug: options.slug },
              select: { id: true, name: true },
            });

        if (!personality) {
          throw new Error('Personality not found for memory import');
        }

        const memoryResult = await this.importMemories(
          shapesData.memories,
          personality.id,
          personality.name,
          options
        );

        console.log(`✅ Memory import complete:`);
        console.log(`  Imported: ${memoryResult.imported}`);
        console.log(`  Legacy Personas Created: ${memoryResult.legacyPersonasCreated}`);
        console.log(`  Failed: ${memoryResult.failed}`);
        if (memoryResult.errors.length > 0) {
          console.log(`  Errors:`);
          memoryResult.errors.forEach(e => {
            console.log(`    ${e.memoryId}: ${e.error}`);
          });
        }
        console.log('');
      }

      // Done!
      console.log('═'.repeat(80));
      if (options.dryRun) {
        console.log('✅ DRY RUN COMPLETE - No changes were made');
      } else {
        console.log('✅ IMPORT COMPLETE');
      }
      console.log('═'.repeat(80));
      console.log('');

    } catch (error) {
      console.error('\n❌ Import failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Load shapes.inc data from legacy backup
   */
  private async loadShapesData(slug: string): Promise<{
    config: ShapesIncPersonalityConfig;
    memories: ShapesIncMemory[];
    chatHistory?: any[];
  }> {
    const basePath = path.join(process.cwd(), LEGACY_DATA_PATH, slug);

    // Load config
    const configPath = path.join(basePath, `${slug}.json`);
    const configRaw = await fs.readFile(configPath, 'utf-8');
    const config: ShapesIncPersonalityConfig = JSON.parse(configRaw);

    // Validate config
    const validation = this.mapper.validate(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(', ')}`);
    }

    // Load memories
    const memoriesPath = path.join(basePath, `${slug}_memories.json`);
    let memories: ShapesIncMemory[] = [];
    try {
      const memoriesRaw = await fs.readFile(memoriesPath, 'utf-8');
      memories = JSON.parse(memoriesRaw);

      // Validate memories
      const memoryValidation = MemoryImporter.validate(memories);
      if (!memoryValidation.valid) {
        throw new Error(`Invalid memories: ${memoryValidation.errors.join(', ')}`);
      }
    } catch (error) {
      console.warn('  ⚠️  No memories file found or invalid');
    }

    // Load chat history (optional, for LTM regeneration)
    const chatHistoryPath = path.join(basePath, `${slug}_chat_history.json`);
    let chatHistory: any[] = [];
    try {
      const chatHistoryRaw = await fs.readFile(chatHistoryPath, 'utf-8');
      chatHistory = JSON.parse(chatHistoryRaw);
    } catch (error) {
      // Chat history is optional
    }

    return { config, memories, chatHistory };
  }

  /**
   * Import personality to PostgreSQL
   */
  private async importPersonality(
    config: ShapesIncPersonalityConfig,
    options: ImportOptions
  ): Promise<PersonalityImportResult> {
    // Map to v3 format
    const v3Data = this.mapper.map(config);

    if (options.dryRun) {
      console.log('[DRY RUN] Would create personality:', v3Data.personality.name);
      return {
        v3PersonalityId: 'dry-run-id',
        shapesPersonalityId: config.id,
        name: v3Data.personality.name,
        slug: v3Data.personality.slug,
        systemPromptId: 'dry-run-system-prompt-id',
        llmConfigId: 'dry-run-llm-config-id',
        defaultLinkId: 'dry-run-link-id',
        avatarPath: '/data/avatars/dry-run.png',
        avatarUrl: `${API_GATEWAY_URL}/avatars/dry-run.png`,
      };
    }

    // Check if personality already exists
    const existing = await this.prisma.personality.findUnique({
      where: { slug: v3Data.personality.slug },
    });

    if (existing && !options.force) {
      throw new Error(
        `Personality ${v3Data.personality.slug} already exists. Use --force to overwrite.`
      );
    }

    // Download avatar
    console.log('  Downloading avatar...');
    const avatarResult = await this.avatarDownloader.download(
      config.avatar,
      config.username
    );

    if (!avatarResult.success) {
      console.warn(`  ⚠️  Avatar download failed: ${avatarResult.error}`);
      console.warn(`     Using fallback`);
    } else {
      console.log(`  ✅ Avatar saved: ${avatarResult.localPath}`);
    }

    // Create in database (wrapped in transaction)
    const result = await this.prisma.$transaction(async (tx) => {
      // Create system prompt
      const systemPrompt = await tx.systemPrompt.create({
        data: v3Data.systemPrompt,
      });

      // Create LLM config
      const llmConfig = await tx.llmConfig.create({
        data: v3Data.llmConfig,
      });

      // Create or update personality
      const personality = existing
        ? await tx.personality.update({
            where: { id: existing.id },
            data: {
              ...v3Data.personality,
              avatarUrl: avatarResult.publicUrl || v3Data.personality.avatarUrl,
              systemPromptId: systemPrompt.id,
            },
          })
        : await tx.personality.create({
            data: {
              ...v3Data.personality,
              avatarUrl: avatarResult.publicUrl || v3Data.personality.avatarUrl,
              systemPromptId: systemPrompt.id,
            },
          });

      // Create default config link
      const defaultLink = await tx.personalityDefaultConfig.upsert({
        where: { personalityId: personality.id },
        create: {
          personalityId: personality.id,
          llmConfigId: llmConfig.id,
        },
        update: {
          llmConfigId: llmConfig.id,
        },
      });

      return {
        v3PersonalityId: personality.id,
        shapesPersonalityId: config.id,
        name: personality.name,
        slug: personality.slug,
        systemPromptId: systemPrompt.id,
        llmConfigId: llmConfig.id,
        defaultLinkId: defaultLink.personalityId,
        avatarPath: avatarResult.localPath || '',
        avatarUrl: avatarResult.publicUrl || v3Data.personality.avatarUrl,
      };
    });

    return result;
  }

  /**
   * Import memories to Qdrant
   *
   * Memories are imported to legacy persona collections: persona-legacy-{shapesUserId}
   * This preserves the original shapes.inc structure and allows easy migration later.
   */
  private async importMemories(
    memories: ShapesIncMemory[],
    personalityId: string,
    personalityName: string,
    options: ImportOptions
  ): Promise<MemoryImportResult> {
    // Create memory importer
    const memoryImporter = new MemoryImporter({
      personalityId,
      personalityName,
      qdrant: this.qdrant,
      openai: this.openai,
      dryRun: options.dryRun,
    });

    // Import to legacy collections
    const result = await memoryImporter.importMemories(memories);

    return result;
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  // Parse args
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Usage: pnpm import-personality <slug> [options]

Arguments:
  slug                 Personality slug (e.g., cold-kerach-batuach)

Options:
  --dry-run           Parse and validate without making changes
  --memories-only     Skip personality import, only import memories
  --force             Overwrite existing personality
  --skip-memories     Import personality but skip memories

Examples:
  pnpm import-personality cold-kerach-batuach --dry-run
  pnpm import-personality cold-kerach-batuach
  pnpm import-personality cold-kerach-batuach --memories-only
  pnpm import-personality cold-kerach-batuach --force
    `);
    process.exit(0);
  }

  const slug = args[0];
  const options: ImportOptions = {
    slug,
    dryRun: args.includes('--dry-run'),
    memoriesOnly: args.includes('--memories-only'),
    force: args.includes('--force'),
    skipMemories: args.includes('--skip-memories'),
  };

  const cli = new PersonalityImportCLI();
  await cli.import(options);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

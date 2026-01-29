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
 *   pnpm import-personality <slug> --owner-id <uuid> [options]
 *
 * Examples:
 *   pnpm import-personality cold-kerach-batuach --owner-id abc-123 --dry-run
 *   pnpm import-personality cold-kerach-batuach --owner-id abc-123
 *   pnpm import-personality cold-kerach-batuach --owner-id abc-123 --memories-only
 *   pnpm import-personality cold-kerach-batuach --owner-id abc-123 --force
 */

import fs from 'fs/promises';
import path from 'path';
import { getPrismaClient, type PrismaClient } from '@tzurot/common-types';
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
const UUID_MAPPINGS_PATH = 'scripts/uuid-mappings.json';

interface ImportOptions {
  slug: string;
  dryRun: boolean;
  memoriesOnly: boolean;
  force: boolean;
  skipMemories: boolean;
  skipExisting: boolean;
  ownerId: string; // Owner's internal user ID (all entities require an owner)
}

interface UUIDMappingData {
  newUserId?: string;
  discordId: string;
  note?: string;
}

interface UUIDMappingsFile {
  mappings: Record<string, UUIDMappingData>;
}

class PersonalityImportCLI {
  private prisma: PrismaClient;
  private qdrant: QdrantClient;
  private openai: OpenAI;
  private mapper: PersonalityMapper;
  private avatarDownloader: AvatarDownloader;
  private uuidMappings: Map<string, UUIDMappingData>;

  constructor() {
    this.prisma = getPrismaClient();
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
    this.uuidMappings = new Map();
  }

  /**
   * Load UUID mappings from scripts/uuid-mappings.json
   */
  private async loadUUIDMappings(): Promise<void> {
    try {
      const mappingsPath = path.join(process.cwd(), UUID_MAPPINGS_PATH);
      const mappingsRaw = await fs.readFile(mappingsPath, 'utf-8');
      const mappingsFile: UUIDMappingsFile = JSON.parse(mappingsRaw);

      // Convert to Map for easy lookup
      for (const [shapesUuid, data] of Object.entries(mappingsFile.mappings)) {
        this.uuidMappings.set(shapesUuid, data);
      }

      console.log(`✅ Loaded ${this.uuidMappings.size} UUID mappings`);
    } catch (error) {
      console.warn(
        '⚠️  No UUID mappings file found - all memories will be stored in legacy collections'
      );
    }
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
      // Load UUID mappings first
      await this.loadUUIDMappings();
      console.log('');

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
        personalityResult = await this.importPersonality(shapesData.config, options);
        console.log(`✅ Personality imported: ${personalityResult.v3PersonalityId}`);
        console.log(`  Note: Avatar URL preserved in customFields`);
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
        console.log(`  Total Imported: ${memoryResult.imported}`);
        console.log(`  Migrated to V3: ${memoryResult.migratedToV3} (known users)`);
        console.log(`  Legacy Collections: ${memoryResult.legacyPersonasCreated} (unknown users)`);
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
   * Load avatar as raw bytes from legacy data
   */
  private async loadAvatarBytes(slug: string): Promise<Buffer | null> {
    try {
      // Load metadata to find the avatar filename
      const metadataPath = path.join(process.cwd(), 'tzurot-legacy/data/avatars/metadata.json');
      const metadataRaw = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataRaw);

      if (!metadata[slug]) {
        return null; // No avatar for this personality
      }

      const filename = metadata[slug].localFilename;
      const avatarPath = path.join(process.cwd(), 'tzurot-legacy/data/avatars/images', filename);

      // Read the PNG file as raw bytes
      const buffer = await fs.readFile(avatarPath);

      const sizeKB = (buffer.length / 1024).toFixed(2);
      console.log(`  Loaded avatar: ${filename} (${sizeKB} KB)`);

      return buffer;
    } catch (error: any) {
      console.warn(`  ⚠️  Could not load avatar: ${error.message}`);
      return null;
    }
  }

  /**
   * Import personality to PostgreSQL
   * Uses global default system prompt and LLM config instead of creating new ones
   */
  private async importPersonality(
    config: ShapesIncPersonalityConfig,
    options: ImportOptions
  ): Promise<PersonalityImportResult> {
    // Map to v3 format
    const v3Data = this.mapper.map(config, options.ownerId);

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

    // Look up global defaults
    console.log('  Looking up global defaults (system prompt + LLM config)...');
    const defaultSystemPrompt = await this.prisma.systemPrompt.findFirst({
      where: { isDefault: true },
    });

    if (!defaultSystemPrompt) {
      throw new Error('No default system prompt found! Please create one with isDefault=true');
    }

    const defaultLlmConfig = await this.prisma.llmConfig.findFirst({
      where: { isDefault: true, isGlobal: true },
    });

    if (!defaultLlmConfig) {
      throw new Error(
        'No default LLM config found! Please create one with isDefault=true and isGlobal=true'
      );
    }

    console.log(`  Using system prompt: ${defaultSystemPrompt.name}`);
    console.log(`  Using LLM config: ${defaultLlmConfig.name}`);

    // Load avatar as raw bytes from legacy data
    const avatarBytes = await this.loadAvatarBytes(v3Data.personality.slug);

    // Create in database (wrapped in transaction)
    const result = await this.prisma.$transaction(async tx => {
      // Create or update personality (using global defaults)
      const personality = existing
        ? await tx.personality.update({
            where: { id: existing.id },
            data: {
              ...v3Data.personality,
              systemPromptId: defaultSystemPrompt.id,
              avatarData: avatarBytes || existing.avatarData, // Preserve existing if no new avatar
            },
          })
        : await tx.personality.create({
            data: {
              ...v3Data.personality,
              systemPromptId: defaultSystemPrompt.id,
              avatarData: avatarBytes,
            },
          });

      // Create default config link (using global default LLM config)
      const defaultLink = await tx.personalityDefaultConfig.upsert({
        where: { personalityId: personality.id },
        create: {
          personalityId: personality.id,
          llmConfigId: defaultLlmConfig.id,
        },
        update: {
          llmConfigId: defaultLlmConfig.id,
        },
      });

      return {
        v3PersonalityId: personality.id,
        shapesPersonalityId: config.id,
        name: personality.name,
        slug: personality.slug,
        systemPromptId: defaultSystemPrompt.id,
        llmConfigId: defaultLlmConfig.id,
        defaultLinkId: defaultLink.personalityId,
        // Avatar info preserved in customFields for reference
      };
    });

    return result;
  }

  /**
   * Import memories to Qdrant
   *
   * HYBRID APPROACH:
   * - Known users (in uuid-mappings.json) → Auto-migrate to v3 personas
   * - Unknown users → Store in legacy-{shapesUserId} collections
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
      prisma: this.prisma,
      uuidMappings: this.uuidMappings,
      qdrant: this.qdrant,
      openai: this.openai,
      dryRun: options.dryRun,
      skipExisting: options.skipExisting,
    });

    // Import with hybrid approach
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
Usage: pnpm import-personality <slug> --owner-id <uuid> [options]

Arguments:
  slug                 Personality slug (e.g., cold-kerach-batuach)

Required:
  --owner-id <uuid>   Owner's internal user ID (all entities require an owner)

Options:
  --dry-run           Parse and validate without making changes
  --memories-only     Skip personality import, only import memories
  --force             Overwrite existing personality
  --skip-memories     Import personality but skip memories
  --skip-existing     Skip memories that already exist in Qdrant (saves OpenAI credits)

Examples:
  pnpm import-personality cold-kerach-batuach --owner-id abc-123 --dry-run
  pnpm import-personality cold-kerach-batuach --owner-id abc-123
  pnpm import-personality cold-kerach-batuach --owner-id abc-123 --memories-only
  pnpm import-personality cold-kerach-batuach --owner-id abc-123 --force
  pnpm import-personality lila-ani-tzuratech --owner-id abc-123 --memories-only --skip-existing
    `);
    process.exit(0);
  }

  const slug = args[0];

  // Parse required owner-id argument
  const ownerIdIndex = args.indexOf('--owner-id');
  const ownerId = ownerIdIndex !== -1 ? args[ownerIdIndex + 1] : undefined;

  if (!ownerId) {
    console.error('Error: --owner-id <uuid> is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(ownerId)) {
    console.error(`Error: Invalid UUID format: ${ownerId}`);
    console.error('Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    process.exit(1);
  }

  const options: ImportOptions = {
    slug,
    dryRun: args.includes('--dry-run'),
    memoriesOnly: args.includes('--memories-only'),
    force: args.includes('--force'),
    skipMemories: args.includes('--skip-memories'),
    skipExisting: args.includes('--skip-existing'),
    ownerId,
  };

  const cli = new PersonalityImportCLI();
  await cli.import(options);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

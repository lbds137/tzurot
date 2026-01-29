/**
 * Bulk Import Script for v2 Personalities
 *
 * Imports all personalities from tzurot-legacy/data/personalities
 * Skips duplicates with same display names (keeps tzel shani and kokhav shenafal versions)
 *
 * Usage:
 *   pnpm tsx scripts/import-personality/bulk-import.ts --owner-id <uuid> [--dry-run] [--force]
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

// Utility: Sleep for rate limiting
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Constants
const LEGACY_DATA_PATH = 'tzurot-legacy/data/personalities';
const AVATAR_STORAGE_DIR = '/data/avatars';
const API_GATEWAY_URL = config.API_GATEWAY_URL || 'http://localhost:3000';
const UUID_MAPPINGS_PATH = 'scripts/uuid-mappings.json';

// Personalities with duplicate display names that need unique mention names
// These will get modified names for tagging but keep original displayName for Discord
const DUPLICATE_NAME_OVERRIDES: Record<string, { name: string; displayName: string }> = {
  'lilith-sheda-khazra-le-khof-avud': {
    name: 'Lilith Morningstar', // Unique name for @mentions
    displayName: 'Lilith', // Display name shown in Discord
  },
  'lucifer-seraph-ha-lev-nafal': {
    name: 'Lucifer Morningstar', // Unique name for @mentions
    displayName: 'Lucifer', // Display name shown in Discord
  },
};

interface BulkImportOptions {
  dryRun: boolean;
  force: boolean;
  skipMemories: boolean;
  skipExisting: boolean;
  delayMs: number; // Delay between personality imports to avoid overwhelming Qdrant
  memoryDelayMs: number; // Delay between individual memory imports (default: 200ms)
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

interface ImportSummary {
  total: number;
  skipped: number;
  successful: number;
  failed: number;
  results: {
    slug: string;
    status: 'skipped' | 'success' | 'error';
    reason?: string;
    name?: string;
  }[];
}

class BulkPersonalityImporter {
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

      console.log(`✅ Loaded ${this.uuidMappings.size} UUID mappings\n`);
    } catch (error) {
      console.warn(
        '⚠️  No UUID mappings file found - all memories will be stored in legacy collections\n'
      );
    }
  }

  /**
   * Get list of all personality slugs to import
   */
  private async getPersonalitySlugs(): Promise<string[]> {
    const personalitiesDir = path.join(process.cwd(), LEGACY_DATA_PATH);
    const entries = await fs.readdir(personalitiesDir, { withFileTypes: true });

    const slugs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const slug = entry.name;
        const configPath = path.join(personalitiesDir, slug, `${slug}.json`);

        // Check if personality config exists
        try {
          await fs.access(configPath);
          slugs.push(slug);
        } catch {
          console.warn(`⚠️  Skipping ${slug} - no config file found`);
        }
      }
    }

    return slugs.sort();
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
   * Import a single personality
   */
  private async importOne(
    slug: string,
    options: BulkImportOptions
  ): Promise<{ status: 'success' | 'error'; reason?: string; name?: string }> {
    try {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Importing: ${slug}`);
      console.log('='.repeat(80));

      // Load shapes.inc data
      const basePath = path.join(process.cwd(), LEGACY_DATA_PATH, slug);
      const configPath = path.join(basePath, `${slug}.json`);
      const configRaw = await fs.readFile(configPath, 'utf-8');
      const shapesConfig: ShapesIncPersonalityConfig = JSON.parse(configRaw);

      // Validate config
      const validation = this.mapper.validate(shapesConfig);
      if (!validation.valid) {
        throw new Error(`Invalid config: ${validation.errors.join(', ')}`);
      }

      console.log(`✅ Loaded ${slug} (${shapesConfig.name})`);

      // Map to v3 format
      const v3Data = this.mapper.map(shapesConfig, options.ownerId);

      // Apply name overrides for duplicates (unique mention name, but same display name)
      if (DUPLICATE_NAME_OVERRIDES[slug]) {
        const override = DUPLICATE_NAME_OVERRIDES[slug];
        console.log(
          `  Applying name override: "${v3Data.personality.name}" → "${override.name}" (display: "${override.displayName}")`
        );
        v3Data.personality.name = override.name;
        v3Data.personality.displayName = override.displayName;
      }

      if (options.dryRun) {
        console.log('[DRY RUN] Would create personality:', v3Data.personality.name);
        return { status: 'success', name: shapesConfig.name };
      }

      // Check if personality already exists
      const existing = await this.prisma.personality.findUnique({
        where: { slug: v3Data.personality.slug },
      });

      if (existing && !options.force) {
        console.log(
          `⚠️  Personality ${v3Data.personality.slug} already exists (use --force to overwrite)`
        );
        return { status: 'success', reason: 'already exists', name: shapesConfig.name };
      }

      // Look up global defaults
      console.log('Looking up global defaults...');
      const defaultSystemPrompt = await this.prisma.systemPrompt.findFirst({
        where: { isDefault: true },
      });

      if (!defaultSystemPrompt) {
        throw new Error('No default system prompt found');
      }

      const defaultLlmConfig = await this.prisma.llmConfig.findFirst({
        where: { isDefault: true, isGlobal: true },
      });

      if (!defaultLlmConfig) {
        throw new Error('No default LLM config found');
      }

      console.log(`  System prompt: ${defaultSystemPrompt.name}`);
      console.log(`  LLM config: ${defaultLlmConfig.name}`);

      // Load avatar as raw bytes
      const avatarBytes = await this.loadAvatarBytes(slug);

      // Create in database
      const result = await this.prisma.$transaction(async tx => {
        // Create or update personality
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

        // Create default config link
        await tx.personalityDefaultConfig.upsert({
          where: { personalityId: personality.id },
          create: {
            personalityId: personality.id,
            llmConfigId: defaultLlmConfig.id,
          },
          update: {
            llmConfigId: defaultLlmConfig.id,
          },
        });

        return personality;
      });

      console.log(`✅ Successfully imported: ${result.name} (ID: ${result.id})`);

      // Import memories if not skipped
      if (!options.skipMemories) {
        const memoriesPath = path.join(basePath, `${slug}_memories.json`);
        try {
          await fs.access(memoriesPath);
          const memoriesRaw = await fs.readFile(memoriesPath, 'utf-8');
          const memories: ShapesIncMemory[] = JSON.parse(memoriesRaw);

          console.log(`\nImporting ${memories.length} memories...`);

          const memoryImporter = new MemoryImporter({
            personalityId: result.id,
            personalityName: result.name,
            prisma: this.prisma,
            uuidMappings: this.uuidMappings,
            qdrant: this.qdrant,
            openai: this.openai,
            dryRun: options.dryRun,
            skipExisting: options.skipExisting,
            memoryDelayMs: options.memoryDelayMs,
          });

          const memoryResult = await memoryImporter.importMemories(memories);

          console.log(`✅ Memory import complete:`);
          console.log(`  Imported: ${memoryResult.imported}`);
          console.log(`  Migrated to V3: ${memoryResult.migratedToV3}`);
          console.log(`  Legacy Collections: ${memoryResult.legacyPersonasCreated}`);
          console.log(`  Failed: ${memoryResult.failed}`);
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            console.warn(`⚠️  Could not import memories: ${error.message}`);
          } else {
            console.log('No memories file found (skipping)');
          }
        }
      }

      return { status: 'success', name: shapesConfig.name };
    } catch (error: any) {
      console.error(`❌ Failed to import ${slug}:`, error.message);
      return { status: 'error', reason: error.message };
    }
  }

  /**
   * Main bulk import
   */
  async bulkImport(options: BulkImportOptions): Promise<void> {
    console.log('\n🚀 Tzurot Bulk Personality Import');
    console.log('═'.repeat(80));
    console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);
    console.log(`Force overwrite: ${options.force}`);
    console.log(`Skip memories: ${options.skipMemories}\n`);

    // Load UUID mappings
    await this.loadUUIDMappings();

    // Get all personality slugs
    console.log('Scanning for personalities...');
    const allSlugs = await this.getPersonalitySlugs();
    console.log(`Found ${allSlugs.length} personalities\n`);

    const slugsToImport = allSlugs;
    const duplicatesWithOverrides = allSlugs.filter(slug => DUPLICATE_NAME_OVERRIDES[slug]);

    if (duplicatesWithOverrides.length > 0) {
      console.log(
        `Found ${duplicatesWithOverrides.length} personalities with duplicate display names (will use unique mention names):`
      );
      duplicatesWithOverrides.forEach(slug => {
        const override = DUPLICATE_NAME_OVERRIDES[slug];
        console.log(`  - ${slug} → @${override.name} (shows as "${override.displayName}")`);
      });
      console.log('');
    }

    console.log(`Importing ${slugsToImport.length} personalities...\n`);

    const summary: ImportSummary = {
      total: allSlugs.length,
      skipped: 0,
      successful: 0,
      failed: 0,
      results: [],
    };

    // Import each personality
    for (let i = 0; i < slugsToImport.length; i++) {
      const slug = slugsToImport[i];
      const result = await this.importOne(slug, options);
      summary.results.push({
        slug,
        status: result.status,
        reason: result.reason,
        name: result.name,
      });

      if (result.status === 'success') {
        summary.successful++;
      } else {
        summary.failed++;
      }

      // Add delay between imports to avoid overwhelming Qdrant (except after last one)
      if (options.delayMs > 0 && i < slugsToImport.length - 1) {
        console.log(`⏸️  Waiting ${options.delayMs}ms before next personality...\n`);
        await sleep(options.delayMs);
      }
    }

    // Print summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 BULK IMPORT SUMMARY');
    console.log('═'.repeat(80));
    console.log(`Total personalities: ${summary.total}`);
    console.log(`✅ Successful: ${summary.successful}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`\nPersonalities with unique mention names: ${duplicatesWithOverrides.length}`);

    if (summary.failed > 0) {
      console.log('\nFailed imports:');
      summary.results
        .filter(r => r.status === 'error')
        .forEach(r => console.log(`  - ${r.slug}: ${r.reason}`));
    }

    console.log('═'.repeat(80) + '\n');

    await this.prisma.$disconnect();
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  // Parse args
  if (args.includes('--help')) {
    console.log(`
Usage: pnpm tsx scripts/import-personality/bulk-import.ts --owner-id <uuid> [options]

Required:
  --owner-id <uuid>  Owner's internal user ID (all entities require an owner)

Options:
  --dry-run          Parse and validate without making changes
  --force            Overwrite existing personalities
  --skip-memories    Import personalities but skip memories
  --skip-existing    Skip memories that already exist in Qdrant (saves OpenAI credits)
  --delay <ms>       Delay in milliseconds between personality imports (default: 2000)
                     Use 0 to disable delays. Higher values reduce Qdrant load.
  --memory-delay <ms> Delay in milliseconds between individual memory imports (default: 200)
                     Prevents overwhelming Qdrant with rapid-fire upserts.

Examples:
  pnpm tsx scripts/import-personality/bulk-import.ts --owner-id abc-123 --dry-run
  pnpm tsx scripts/import-personality/bulk-import.ts --owner-id abc-123
  pnpm tsx scripts/import-personality/bulk-import.ts --owner-id abc-123 --force
  pnpm tsx scripts/import-personality/bulk-import.ts --owner-id abc-123 --skip-memories
  pnpm tsx scripts/import-personality/bulk-import.ts --owner-id abc-123 --force --skip-existing
  pnpm tsx scripts/import-personality/bulk-import.ts --owner-id abc-123 --force --skip-existing --delay 5000
    `);
    process.exit(0);
  }

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

  // Parse delay arguments
  const delayIndex = args.indexOf('--delay');
  const delayMs =
    delayIndex !== -1 && args[delayIndex + 1] ? parseInt(args[delayIndex + 1], 10) : 2000; // Default 2 second delay

  const memoryDelayIndex = args.indexOf('--memory-delay');
  const memoryDelayMs =
    memoryDelayIndex !== -1 && args[memoryDelayIndex + 1]
      ? parseInt(args[memoryDelayIndex + 1], 10)
      : 200; // Default 200ms delay between memories

  const options: BulkImportOptions = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    skipMemories: args.includes('--skip-memories'),
    skipExisting: args.includes('--skip-existing'),
    delayMs,
    memoryDelayMs,
    ownerId,
  };

  const importer = new BulkPersonalityImporter();
  await importer.bulkImport(options);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

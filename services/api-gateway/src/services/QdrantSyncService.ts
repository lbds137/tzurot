/**
 * Qdrant Sync Service
 * Performs bidirectional synchronization between dev and prod Qdrant instances
 * using last-write-wins strategy based on metadata timestamps
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('qdrant-sync');

interface SyncResult {
  stats: Record<string, { devToProd: number; prodToDev: number; conflicts: number }>;
  warnings: string[];
  totalPoints: number;
  totalCollections: number;
}

interface SyncOptions {
  dryRun: boolean;
}

/**
 * Qdrant point structure returned from scroll API
 * Based on Qdrant REST API response format
 */
interface QdrantPoint {
  id: string | number;
  vector: number[] | Record<string, number[]> | Record<string, unknown>;
  payload?: Record<string, unknown>;
}

/**
 * Extract timestamp from point metadata
 * Uses createdAt field in milliseconds (same as QdrantMemoryService)
 */
function getPointTimestamp(point: QdrantPoint): number {
  const payload = point.payload;
  const createdAt = payload?.createdAt;

  if (typeof createdAt === 'number') {
    return createdAt;
  }

  // Fallback: use current time (will be considered "newest")
  logger.warn({ pointId: point.id }, 'Point missing createdAt timestamp, using current time');
  return Date.now();
}

export class QdrantSyncService {
  private devClient: QdrantClient;
  private prodClient: QdrantClient;

  constructor(devQdrantUrl: string, devQdrantApiKey: string | undefined, prodQdrantUrl: string, prodQdrantApiKey: string | undefined) {
    this.devClient = new QdrantClient({
      url: devQdrantUrl,
      apiKey: devQdrantApiKey || undefined, // Convert empty string to undefined
      timeout: 300000, // 5 minutes for TCP proxy stability
    });

    this.prodClient = new QdrantClient({
      url: prodQdrantUrl,
      apiKey: prodQdrantApiKey || undefined, // Convert empty string to undefined
      timeout: 300000, // 5 minutes for TCP proxy stability
    });
  }

  /**
   * Perform bidirectional Qdrant synchronization
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    logger.info({ dryRun: options.dryRun }, '[Sync] Starting Qdrant sync');

    const stats: Record<string, { devToProd: number; prodToDev: number; conflicts: number }> = {};
    const warnings: string[] = [];
    let totalPoints = 0;

    // Get all collections from both instances
    const devCollections = await this.listCollections(this.devClient);
    const prodCollections = await this.listCollections(this.prodClient);

    // Combine unique collection names
    const allCollections = new Set([...devCollections, ...prodCollections]);
    logger.info({ totalCollections: allCollections.size }, '[Sync] Found collections to sync');

    // Sync each collection
    for (const collectionName of allCollections) {
      logger.info({ collection: collectionName }, '[Sync] Syncing collection');

      const collectionStats = await this.syncCollection(
        collectionName,
        devCollections.includes(collectionName),
        prodCollections.includes(collectionName),
        options.dryRun
      );

      stats[collectionName] = collectionStats;
      totalPoints += collectionStats.devToProd + collectionStats.prodToDev;

      if (collectionStats.conflicts > 0) {
        warnings.push(
          `${collectionName}: ${collectionStats.conflicts} conflicts resolved using last-write-wins`
        );
      }
    }

    logger.info({ stats, totalPoints }, '[Sync] Qdrant sync complete');

    return {
      stats,
      warnings,
      totalPoints,
      totalCollections: allCollections.size,
    };
  }

  /**
   * Re-enable indexing on all collections after bulk import
   * Call this after sync() completes to trigger index building
   * Sets indexing_threshold to 20000 (standard value) which triggers indexing of existing points
   */
  async enableIndexing(): Promise<void> {
    logger.info('[Sync] Re-enabling indexing on all collections');

    const devCollections = await this.listCollections(this.devClient);

    for (const collectionName of devCollections) {
      try {
        await this.devClient.updateCollection(collectionName, {
          optimizers_config: {
            indexing_threshold: 20000, // Restore indexing - will trigger background indexing of all existing points
          },
        });

        logger.info({ collection: collectionName }, '[Sync] Indexing re-enabled, background indexing will begin');
      } catch (error) {
        logger.error({ err: error, collection: collectionName }, '[Sync] Failed to enable indexing');
      }
    }

    logger.info('[Sync] Indexing re-enabled on all collections. Qdrant will build indexes in background.');
  }

  /**
   * List all collection names from a Qdrant instance
   */
  private async listCollections(client: QdrantClient): Promise<string[]> {
    try {
      const response = await client.getCollections();
      return response.collections.map(c => c.name);
    } catch (error) {
      logger.error({ err: error }, 'Failed to list collections');
      return [];
    }
  }

  /**
   * Sync a single collection
   */
  private async syncCollection(
    collectionName: string,
    existsInDev: boolean,
    existsInProd: boolean,
    dryRun: boolean
  ): Promise<{ devToProd: number; prodToDev: number; conflicts: number }> {
    let devToProd = 0;
    let prodToDev = 0;
    let conflicts = 0;

    // Handle collections that only exist in one environment
    if (!existsInDev && existsInProd) {
      // Collection only in prod - copy entire collection to dev
      logger.info({ collection: collectionName }, '[Sync] Collection only exists in prod, copying to dev');

      if (!dryRun) {
        await this.copyCollection(this.prodClient, this.devClient, collectionName);
      }

      const prodCount = await this.getPointCount(this.prodClient, collectionName);
      prodToDev = prodCount;

      return { devToProd, prodToDev, conflicts };
    }

    if (existsInDev && !existsInProd) {
      // Collection only in dev - copy entire collection to prod
      logger.info({ collection: collectionName }, '[Sync] Collection only exists in dev, copying to prod');

      if (!dryRun) {
        await this.copyCollection(this.devClient, this.prodClient, collectionName);
      }

      const devCount = await this.getPointCount(this.devClient, collectionName);
      devToProd = devCount;

      return { devToProd, prodToDev, conflicts };
    }

    // Collection exists in both - check if either is empty first
    const devCount = await this.getPointCount(this.devClient, collectionName);
    const prodCount = await this.getPointCount(this.prodClient, collectionName);

    // Optimization: if one side is empty, use fast streaming copyCollection instead of slow comparison
    if (devCount === 0 && prodCount > 0) {
      logger.info({ collection: collectionName, prodCount }, '[Sync] Dev empty, prod has points - using fast copy');
      if (!dryRun) {
        // Delete empty collection in dev and recreate with streaming copy
        await this.devClient.deleteCollection(collectionName);
        await this.copyCollection(this.prodClient, this.devClient, collectionName);
      }
      return { devToProd: 0, prodToDev: prodCount, conflicts: 0 };
    }

    if (prodCount === 0 && devCount > 0) {
      logger.info({ collection: collectionName, devCount }, '[Sync] Prod empty, dev has points - using fast copy');
      if (!dryRun) {
        // Delete empty collection in prod and recreate with streaming copy
        await this.prodClient.deleteCollection(collectionName);
        await this.copyCollection(this.devClient, this.prodClient, collectionName);
      }
      return { devToProd: devCount, prodToDev: 0, conflicts: 0 };
    }

    // Both have points - do full bidirectional comparison
    logger.info({ collection: collectionName, devCount, prodCount }, '[Sync] Both have points, comparing');

    // Fetch all points from both collections
    const devPoints = await this.fetchAllPoints(this.devClient, collectionName);
    const prodPoints = await this.fetchAllPoints(this.prodClient, collectionName);

    // Build maps by point ID for efficient lookup
    const devMap = new Map(devPoints.map(p => [String(p.id), p]));
    const prodMap = new Map(prodPoints.map(p => [String(p.id), p]));

    // Find points that need syncing
    const allIds = new Set([...devMap.keys(), ...prodMap.keys()]);

    for (const pointId of allIds) {
      const devPoint = devMap.get(pointId);
      const prodPoint = prodMap.get(pointId);

      if (!devPoint && prodPoint) {
        // Point only in prod - copy to dev
        if (!dryRun) {
          await this.upsertPoint(this.devClient, collectionName, prodPoint);
        }
        prodToDev++;
      } else if (devPoint && !prodPoint) {
        // Point only in dev - copy to prod
        if (!dryRun) {
          await this.upsertPoint(this.prodClient, collectionName, devPoint);
        }
        devToProd++;
      } else if (devPoint && prodPoint) {
        // Point exists in both - compare timestamps
        const devTime = getPointTimestamp(devPoint);
        const prodTime = getPointTimestamp(prodPoint);

        if (devTime > prodTime) {
          // Dev is newer
          if (!dryRun) {
            await this.upsertPoint(this.prodClient, collectionName, devPoint);
          }
          devToProd++;
          conflicts++;
        } else if (prodTime > devTime) {
          // Prod is newer
          if (!dryRun) {
            await this.upsertPoint(this.devClient, collectionName, prodPoint);
          }
          prodToDev++;
          conflicts++;
        }
        // If timestamps equal, no sync needed
      }
    }

    return { devToProd, prodToDev, conflicts };
  }

  /**
   * Get total point count for a collection
   */
  private async getPointCount(client: QdrantClient, collectionName: string): Promise<number> {
    try {
      const collection = await client.getCollection(collectionName);
      return collection.points_count || 0;
    } catch (error) {
      logger.error({ err: error, collection: collectionName }, 'Failed to get point count');
      return 0;
    }
  }

  /**
   * Copy an entire collection from source to destination using streaming pipeline
   * This approach avoids loading all points into memory and uses async upserts
   */
  private async copyCollection(
    sourceClient: QdrantClient,
    destClient: QdrantClient,
    collectionName: string
  ): Promise<void> {
    try {
      // Get collection config from source
      const sourceCollection = await sourceClient.getCollection(collectionName);

      // Create collection in destination with same config
      // BUT: Disable indexing during bulk import for better performance
      const config = {
        vectors: sourceCollection.config.params.vectors,
        optimizers_config: {
          ...sourceCollection.config.optimizer_config,
          indexing_threshold: 0, // Explicitly disable indexing during import
        },
        hnsw_config: {
          on_disk: true, // Store index on disk to save memory
        },
        shard_number: sourceCollection.config.params.shard_number,
      };
      await destClient.createCollection(collectionName, config as Parameters<typeof destClient.createCollection>[1]);

      logger.info({ collection: collectionName }, '[Sync] Created collection in destination');

      // Use streaming pipeline: fetch batch → upsert batch → repeat
      // This avoids loading all points into memory
      let offset: unknown;
      let totalCopied = 0;
      const batchSize = 50; // Smaller batches to avoid TCP proxy timeouts

      while (true) {
        // Fetch batch
        const response = await sourceClient.scroll(collectionName, {
          limit: batchSize,
          offset: offset as string | number | undefined,
          with_payload: true,
          with_vector: true,
        });

        if (!response.points || response.points.length === 0) {
          break;
        }

        // Upsert batch immediately (wait:false = async background indexing)
        await destClient.upsert(collectionName, {
          // wait:false is default - async background indexing, no blocking
          points: response.points.map(p => ({
            id: p.id,
            vector: p.vector as number[],
            payload: p.payload,
          })),
        });

        totalCopied += response.points.length;
        logger.info(
          { collection: collectionName, copied: totalCopied },
          '[Sync] Copied points batch'
        );

        // Check if there are more points
        if (!response.next_page_offset) {
          break;
        }

        offset = response.next_page_offset;
      }

      logger.info({ collection: collectionName, pointsCopied: totalCopied }, '[Sync] Collection copy complete');

    } catch (error) {
      logger.error({ err: error, collection: collectionName }, 'Failed to copy collection');
      throw error;
    }
  }

  /**
   * Fetch all points from a collection using scroll API
   */
  private async fetchAllPoints(client: QdrantClient, collectionName: string): Promise<QdrantPoint[]> {
    const allPoints: QdrantPoint[] = [];
    let offset: unknown;

    try {
      // Scroll through all points in batches
      while (true) {
        const response = await client.scroll(collectionName, {
          limit: 100,
          offset: offset as string | number | undefined,
          with_payload: true,
          with_vector: true,
        });

        if (!response.points || response.points.length === 0) {
          break;
        }

        // Cast response points to our QdrantPoint type
        allPoints.push(...response.points as unknown as QdrantPoint[]);

        // Check if there are more points
        if (!response.next_page_offset) {
          break;
        }

        offset = response.next_page_offset;
      }

      logger.debug({ collection: collectionName, pointCount: allPoints.length }, '[Sync] Fetched all points');

      return allPoints;

    } catch (error) {
      // If collection doesn't exist, return empty array
      if ((error as { status?: number }).status === 404) {
        return [];
      }

      logger.error({ err: error, collection: collectionName }, 'Failed to fetch points');
      throw error;
    }
  }

  /**
   * Upsert a single point into a collection
   * Points returned from scroll() have the exact structure needed for upsert()
   * Uses wait:false (default) for async background indexing
   * Used during bidirectional sync when comparing individual points
   */
  private async upsertPoint(
    client: QdrantClient,
    collectionName: string,
    point: QdrantPoint
  ): Promise<void> {
    try {
      await client.upsert(collectionName, {
        // wait:false is default - async background indexing, no blocking
        points: [{
          id: point.id,
          vector: point.vector as number[],
          payload: point.payload,
        }],
      });

    } catch (error) {
      logger.error({ err: error, collection: collectionName, pointId: point.id }, 'Failed to upsert point');
      throw error;
    }
  }
}

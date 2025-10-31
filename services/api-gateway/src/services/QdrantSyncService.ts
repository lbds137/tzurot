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
      timeout: 120000, // 2 minutes for bulk operations
    });

    this.prodClient = new QdrantClient({
      url: prodQdrantUrl,
      apiKey: prodQdrantApiKey || undefined, // Convert empty string to undefined
      timeout: 120000, // 2 minutes for bulk operations
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

    // Collection exists in both - sync points
    logger.info({ collection: collectionName }, '[Sync] Collection exists in both, comparing points');

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
   * Copy an entire collection from source to destination
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
      // Note: We're passing the collection config exactly as Qdrant returns it
      const config = {
        vectors: sourceCollection.config.params.vectors,
        optimizers_config: sourceCollection.config.optimizer_config,
        shard_number: sourceCollection.config.params.shard_number,
      };
      await destClient.createCollection(collectionName, config as Parameters<typeof destClient.createCollection>[1]);

      logger.info({ collection: collectionName }, '[Sync] Created collection in destination');

      // Copy all points
      const points = await this.fetchAllPoints(sourceClient, collectionName);

      if (points.length > 0) {
        // Batch upsert (Qdrant supports up to 100 points per request)
        const batchSize = 100;
        for (let i = 0; i < points.length; i += batchSize) {
          const batch = points.slice(i, i + batchSize);
          await this.upsertPointsBatch(destClient, collectionName, batch);

          logger.info(
            { collection: collectionName, progress: `${Math.min(i + batchSize, points.length)}/${points.length}` },
            '[Sync] Copied points batch'
          );
        }
      }

      logger.info({ collection: collectionName, pointsCopied: points.length }, '[Sync] Collection copy complete');

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
   */
  private async upsertPoint(
    client: QdrantClient,
    collectionName: string,
    point: QdrantPoint
  ): Promise<void> {
    try {
      await client.upsert(collectionName, {
        wait: false, // Don't wait for disk sync (prevents timeouts)
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

  /**
   * Upsert multiple points in batch
   * Points returned from scroll() have the exact structure needed for upsert()
   */
  private async upsertPointsBatch(
    client: QdrantClient,
    collectionName: string,
    points: QdrantPoint[]
  ): Promise<void> {
    try {
      await client.upsert(collectionName, {
        wait: false, // Don't wait for disk sync on bulk imports (prevents timeouts)
        points: points.map(p => ({
          id: p.id,
          vector: p.vector as number[],
          payload: p.payload,
        })),
      });

    } catch (error) {
      logger.error({ err: error, collection: collectionName, pointCount: points.length }, 'Failed to upsert points batch');
      throw error;
    }
  }
}

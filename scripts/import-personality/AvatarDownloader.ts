/**
 * AvatarDownloader - Downloads and stores personality avatars
 *
 * Downloads avatars from shapes.inc and stores them in Railway volume
 * for self-hosting. Prevents broken avatars when shapes.inc shuts down.
 */

import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';

export interface AvatarDownloadResult {
  success: boolean;
  localPath: string | null; // /data/avatars/slug.ext
  publicUrl: string | null; // https://api-gateway.railway.app/avatars/slug.ext
  error: string | null;
  usedFallback: boolean;
}

export class AvatarDownloader {
  private storageDir: string;
  private baseUrl: string;

  constructor(
    options: {
      storageDir?: string;
      baseUrl?: string;
    } = {}
  ) {
    this.storageDir = options.storageDir || '/data/avatars';
    this.baseUrl = options.baseUrl || process.env.API_GATEWAY_URL || 'http://localhost:3000';
  }

  /**
   * Download avatar from shapes.inc and store locally
   */
  async download(shapesAvatarUrl: string, slug: string): Promise<AvatarDownloadResult> {
    try {
      // Ensure storage directory exists
      await fs.mkdir(this.storageDir, { recursive: true });

      // Attempt to download from shapes.inc
      const response = await fetch(shapesAvatarUrl, {
        headers: {
          'User-Agent': 'Tzurot/3.0 (Avatar Import Tool)',
        },
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Determine file extension from content-type
      const contentType = response.headers.get('content-type');
      const ext = this.getExtensionFromContentType(contentType);

      // Save to local storage
      const filename = `${slug}.${ext}`;
      const filepath = path.join(this.storageDir, filename);

      // Stream response to file
      if (!response.body) {
        throw new Error('Response body is null');
      }

      await pipeline(response.body as unknown as Readable, createWriteStream(filepath));

      // Verify file was written
      const stats = await fs.stat(filepath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      // Generate public URL
      const publicUrl = `${this.baseUrl}/avatars/${filename}`;

      return {
        success: true,
        localPath: filepath,
        publicUrl,
        error: null,
        usedFallback: false,
      };
    } catch (error) {
      // Download failed - use fallback
      return this.useFallback(slug, error as Error);
    }
  }

  /**
   * Use fallback avatar when download fails
   */
  private async useFallback(slug: string, originalError: Error): Promise<AvatarDownloadResult> {
    try {
      // Create a simple text-based avatar as fallback
      // In production, you might want to use an identicon library or default image
      const fallbackFilename = 'default.png';
      const fallbackPath = path.join(this.storageDir, fallbackFilename);

      // Check if default avatar exists
      try {
        await fs.access(fallbackPath);
        // Default exists, use it
        return {
          success: true,
          localPath: fallbackPath,
          publicUrl: `${this.baseUrl}/avatars/${fallbackFilename}`,
          error: `Original download failed: ${originalError.message}`,
          usedFallback: true,
        };
      } catch {
        // Default doesn't exist either
        return {
          success: false,
          localPath: null,
          publicUrl: null,
          error: `Download failed and no default avatar found: ${originalError.message}`,
          usedFallback: false,
        };
      }
    } catch (fallbackError) {
      return {
        success: false,
        localPath: null,
        publicUrl: null,
        error: `Download failed: ${originalError.message}. Fallback failed: ${(fallbackError as Error).message}`,
        usedFallback: false,
      };
    }
  }

  /**
   * Get file extension from content-type header
   */
  private getExtensionFromContentType(contentType: string | null): string {
    if (!contentType) return 'png'; // Default to PNG

    if (contentType.includes('image/png')) return 'png';
    if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) return 'jpg';
    if (contentType.includes('image/gif')) return 'gif';
    if (contentType.includes('image/webp')) return 'webp';
    if (contentType.includes('image/svg')) return 'svg';

    return 'png'; // Default fallback
  }

  /**
   * Check if avatar already exists locally
   */
  async exists(
    slug: string
  ): Promise<{ exists: boolean; path: string | null; url: string | null }> {
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

    for (const ext of extensions) {
      const filename = `${slug}.${ext}`;
      const filepath = path.join(this.storageDir, filename);

      try {
        await fs.access(filepath);
        return {
          exists: true,
          path: filepath,
          url: `${this.baseUrl}/avatars/${filename}`,
        };
      } catch {
        // File doesn't exist, continue checking
      }
    }

    return { exists: false, path: null, url: null };
  }

  /**
   * Delete avatar from local storage
   */
  async delete(slug: string): Promise<boolean> {
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

    let deleted = false;
    for (const ext of extensions) {
      const filename = `${slug}.${ext}`;
      const filepath = path.join(this.storageDir, filename);

      try {
        await fs.unlink(filepath);
        deleted = true;
      } catch {
        // File doesn't exist or couldn't be deleted, continue
      }
    }

    return deleted;
  }

  /**
   * List all downloaded avatars
   */
  async list(): Promise<Array<{ slug: string; filename: string; size: number }>> {
    try {
      const files = await fs.readdir(this.storageDir);
      const avatars = [];

      for (const filename of files) {
        const filepath = path.join(this.storageDir, filename);
        const stats = await fs.stat(filepath);

        if (stats.isFile()) {
          const slug = path.parse(filename).name;
          avatars.push({
            slug,
            filename,
            size: stats.size,
          });
        }
      }

      return avatars;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // Directory doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Get storage directory stats
   */
  async getStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    storageDir: string;
  }> {
    const files = await this.list();
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    return {
      totalFiles: files.length,
      totalSize,
      storageDir: this.storageDir,
    };
  }
}

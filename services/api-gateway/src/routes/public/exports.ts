/**
 * Public Export Download Route
 *
 * GET /exports/:token - Download a completed export file
 *
 * Public endpoint (no auth required). The lookup handle is a random,
 * unguessable `downloadToken` — NOT the export job `id`, which is a
 * deterministic uuidv5 over (userId, source, format) and therefore computable
 * offline from a user's Discord ID. Using the job ID here would let anyone who
 * knows a target's Discord ID download their export; the random token closes
 * that. Returns the export file with appropriate Content-Type/Disposition.
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { isExportDownloadToken } from '@tzurot/common-types/utils/exportDownloadToken';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getParam } from '../../utils/requestParams.js';

const logger = createLogger('exports-download');

export function createExportsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/:token', async (req: Request, res: Response) => {
    const token = getParam(req.params.token);

    if (token === undefined || !isExportDownloadToken(token)) {
      res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid export download token' });
      return;
    }

    try {
      const job = await prisma.exportJob.findUnique({
        where: { downloadToken: token },
        select: {
          // id is the deterministic job UUID — safe to log; the token is not.
          id: true,
          fileContent: true,
          fileData: true,
          fileName: true,
          fileSizeBytes: true,
          status: true,
          format: true,
          expiresAt: true,
        },
      });

      if (job === null) {
        res.status(StatusCodes.NOT_FOUND).json({ error: 'Export not found' });
        return;
      }

      // Check expiry first — an expired job is gone regardless of status
      if (job.expiresAt < new Date()) {
        res.status(StatusCodes.GONE).json({ error: 'Export has expired' });
        return;
      }

      // A completed job carries exactly one payload column: fileData for
      // binary formats (ZIP), fileContent for text formats.
      if (job.status !== 'completed' || (job.fileContent === null && job.fileData === null)) {
        res.status(StatusCodes.NOT_FOUND).json({
          error: job.status === 'failed' ? 'Export failed' : 'Export not ready yet',
          status: job.status,
        });
        return;
      }

      const body =
        job.fileData !== null
          ? Buffer.from(job.fileData)
          : Buffer.from(job.fileContent ?? '', 'utf8');
      let contentType: string;
      let defaultExtension: string;
      if (job.fileData !== null) {
        contentType = 'application/zip';
        defaultExtension = 'zip';
      } else if (job.format === 'markdown') {
        contentType = 'text/markdown; charset=utf-8';
        defaultExtension = 'md';
      } else {
        contentType = 'application/json; charset=utf-8';
        defaultExtension = 'json';
      }
      const fileName = job.fileName ?? `export.${defaultExtension}`;

      res.setHeader('Content-Type', contentType);
      // RFC 5987: filename* for UTF-8 percent-encoding,
      // filename= fallback with ASCII-safe chars for legacy browsers
      const safeName = fileName.replace(/[^\w\-.]/g, '_');
      const encodedName = encodeURIComponent(fileName);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`
      );
      res.setHeader('Content-Length', String(body.length));

      res.status(StatusCodes.OK).send(body);

      logger.info({ jobId: job.id, fileName, fileSizeBytes: job.fileSizeBytes }, 'File downloaded');
    } catch (error) {
      // The token is a capability — never log it, even on error.
      logger.error({ err: error }, 'Download error');
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Download failed' });
    }
  });

  return router;
}

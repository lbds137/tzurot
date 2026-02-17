/**
 * Public Export Download Route
 *
 * GET /exports/:jobId - Download a completed export file
 *
 * Public endpoint (no auth required). The UUID serves as an unguessable token.
 * Returns the export file content with appropriate Content-Type and Content-Disposition.
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, isUuidFormat } from '@tzurot/common-types';
import { getParam } from '../../utils/requestParams.js';

const logger = createLogger('exports-download');

export function createExportsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/:jobId', async (req: Request, res: Response) => {
    const jobId = getParam(req.params.jobId);

    if (jobId === undefined || !isUuidFormat(jobId)) {
      res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid export job ID' });
      return;
    }

    try {
      const job = await prisma.exportJob.findUnique({
        where: { id: jobId },
        select: {
          fileContent: true,
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

      if (job.status !== 'completed' || job.fileContent === null) {
        res.status(StatusCodes.NOT_FOUND).json({
          error: job.status === 'failed' ? 'Export failed' : 'Export not ready yet',
          status: job.status,
        });
        return;
      }

      if (job.expiresAt < new Date()) {
        res.status(StatusCodes.GONE).json({ error: 'Export has expired' });
        return;
      }

      const contentType =
        job.format === 'markdown'
          ? 'text/markdown; charset=utf-8'
          : 'application/json; charset=utf-8';
      const fileName = job.fileName ?? `export.${job.format === 'markdown' ? 'md' : 'json'}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(fileName)}"`
      );
      if (job.fileSizeBytes !== null) {
        res.setHeader('Content-Length', String(job.fileSizeBytes));
      }

      res.status(StatusCodes.OK).send(job.fileContent);

      logger.info(
        { jobId, fileName, fileSizeBytes: job.fileSizeBytes },
        '[Exports] File downloaded'
      );
    } catch (error) {
      logger.error({ err: error, jobId }, '[Exports] Download error');
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Download failed' });
    }
  });

  return router;
}

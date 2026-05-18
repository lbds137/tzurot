import type { RequestHandler } from 'express';

// Opt specific routes into CORP cross-origin; do NOT mount globally (helmet's same-origin default is the right posture for everything else).
export const allowCrossOriginEmbedding: RequestHandler = (_req, res, next) => {
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
};

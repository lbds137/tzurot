/**
 * CORS Middleware
 *
 * Handles Cross-Origin Resource Sharing headers for the API Gateway.
 */

import type { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';

interface CorsConfig {
  origins: string[];
}

/**
 * Create CORS middleware with configurable origins
 */
export function createCorsMiddleware(config: CorsConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (origin !== undefined && config.origins.includes('*')) {
      res.header('Access-Control-Allow-Origin', origin);
    } else if (origin !== undefined && config.origins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.sendStatus(StatusCodes.OK);
      return;
    }

    next();
  };
}

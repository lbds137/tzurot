/**
 * Tests for the CORP-loosening middleware.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { allowCrossOriginEmbedding } from './crossOriginResource.js';

describe('allowCrossOriginEmbedding', () => {
  it('should set Cross-Origin-Resource-Policy: cross-origin on the response', async () => {
    const app = express();
    app.get('/test', allowCrossOriginEmbedding, (_req, res) => {
      res.send('ok');
    });

    const response = await request(app).get('/test');

    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('should override helmet defaults when mounted after them', async () => {
    // Reproduces the production wiring: helmet sets CORP same-origin
    // globally, then the per-route middleware overrides for specific
    // routes. The override-wins pattern is the whole point.
    const app = express();
    app.use(helmet());
    app.get('/media', allowCrossOriginEmbedding, (_req, res) => {
      res.send('ok');
    });
    app.get('/other', (_req, res) => {
      res.send('ok');
    });

    const mediaResponse = await request(app).get('/media');
    const otherResponse = await request(app).get('/other');

    expect(mediaResponse.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(otherResponse.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('should call next() so the response handler still runs', async () => {
    const app = express();
    app.get('/test', allowCrossOriginEmbedding, (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});

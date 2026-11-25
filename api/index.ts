import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { createApiApp } from '../server/app.js';

let cachedApp: Express | null = null;

function getApp(): Express {
  if (!cachedApp) {
    cachedApp = createApiApp().app;
  }
  return cachedApp;
}

function restoreRewrittenApiUrl(req: IncomingMessage) {
  const rawUrl = req.url || '/api';
  const parsed = new URL(rawUrl, 'https://talentgrade.local');
  const rewritePath = parsed.searchParams.get('__path');

  if (rewritePath && rewritePath.startsWith('/api')) {
    parsed.searchParams.delete('__path');
    const remainingQuery = parsed.searchParams.toString();
    const cleanPath = rewritePath.replace(/^\/+/, '/');
    req.url = remainingQuery ? `${cleanPath}?${remainingQuery}` : cleanPath;
    return;
  }

  const originalHeader = req.headers['x-vercel-original-url'];
  const originalUrl = Array.isArray(originalHeader) ? originalHeader[0] : originalHeader;
  if (
    typeof originalUrl === 'string' &&
    originalUrl.startsWith('/api/') &&
    !originalUrl.startsWith('/api/index') &&
    (parsed.pathname === '/api/index' || parsed.pathname === '/api')
  ) {
    req.url = originalUrl;
  }
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    restoreRewrittenApiUrl(req);
    const app = getApp();
    return app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
  } catch (err) {
    console.error('Unhandled API handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Internal server error handling API request' }));
    }
  }
}

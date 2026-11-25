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

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const app = getApp();
  return app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
}

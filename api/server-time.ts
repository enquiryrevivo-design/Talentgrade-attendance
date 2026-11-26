import type { IncomingMessage, ServerResponse } from 'http';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';

const FALLBACK_FIREBASE_PROJECT_ID = 'gen-lang-client-0264117228';

let cachedAdminAuth: Auth | null = null;
function getAdminAuth(): Auth {
  if (cachedAdminAuth) return cachedAdminAuth;
  const projectId = (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    FALLBACK_FIREBASE_PROJECT_ID
  ).trim();
  const adminApp = getApps().length ? getApp() : initializeApp({ projectId });
  cachedAdminAuth = getAuth(adminApp);
  return cachedAdminAuth;
}

function resolveTimezoneParts(date: Date, timeZone: string): {
  localDate: string;
  localHHmm: string;
  localMinutesOfDay: number;
} {
  let validTz = 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(date);
    validTz = timeZone;
  } catch {
    validTz = 'Asia/Kolkata';
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hourNum = Number(getPart('hour')) % 24;
  const minNum = Number(getPart('minute'));
  const hh = String(hourNum).padStart(2, '0');
  const mm = String(minNum).padStart(2, '0');

  return {
    localDate: `${year}-${month}-${day}`,
    localHHmm: `${hh}:${mm}`,
    localMinutesOfDay: hourNum * 60 + minNum,
  };
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendJson(res, 401, { error: 'Unauthorized: Missing bearer token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (decoded.firebase?.sign_in_provider === 'anonymous') {
      sendJson(res, 403, { error: 'Forbidden: Anonymous authentication is not permitted' });
      return;
    }
  } catch (err) {
    const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
    console.error('Token verification failed on /api/server-time:', code || err);
    if (code === 'auth/id-token-expired') {
      sendJson(res, 401, { error: 'Session token expired. Retrying...', code: 'TOKEN_EXPIRED' });
      return;
    }
    if (code === 'auth/id-token-revoked') {
      sendJson(res, 401, { error: 'Session was revoked. Please sign in again.', code: 'TOKEN_REVOKED' });
      return;
    }
    if (code === 'auth/user-disabled') {
      sendJson(res, 403, { error: 'Account disabled in Firebase Authentication.', code: 'USER_DISABLED' });
      return;
    }
    sendJson(res, 401, { error: 'Unauthorized: Invalid or expired session token', code: 'INVALID_TOKEN' });
    return;
  }

  try {
    const parsedUrl = new URL(req.url || '/api/server-time', 'https://talentgrade.local');
    const tzParam = parsedUrl.searchParams.get('tz');
    const tz = tzParam && tzParam.trim() ? tzParam.trim() : 'Asia/Kolkata';

    const now = new Date();
    const resolved = resolveTimezoneParts(now, tz);

    sendJson(res, 200, {
      iso: now.toISOString(),
      epochMs: now.getTime(),
      timezone: tz,
      ...resolved,
    });
  } catch (err) {
    console.error('Server-time computation error:', err);
    sendJson(res, 500, { error: 'Failed to compute authoritative server time' });
  }
}

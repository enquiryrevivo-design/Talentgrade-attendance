import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken, Auth } from 'firebase-admin/auth';
import {
  assertCurrencyAllowedForCompany,
  formatPayslipPdfFilename,
  normalizeCompanyId,
  resolveCompanyProfile,
  SettingsLikeForCompanies,
} from '../shared/companyConfig.js';
import { PayslipPdfInput, renderPayslipPdfBuffer } from './payslipPdf.js';

const BOOTSTRAPPED_ADMIN_EMAIL = 'enquiry.revivo@gmail.com';
const FALLBACK_FIREBASE_PROJECT_ID = 'gen-lang-client-0264117228';
const FALLBACK_FIRESTORE_DATABASE_ID = 'ai-studio-8571b2ef-56ab-4f5a-9f14-103ac191cd0a';
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveFirebaseConfig(): { projectId: string; databaseId: string } {
  const envProjectId = (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const envDbId = (process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIRESTORE_DATABASE_ID || '').trim();

  let fileProjectId = '';
  let fileDbId = '';
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(__dirname, '..', 'firebase-applet-config.json'),
    path.resolve(__dirname, '..', '..', 'firebase-applet-config.json'),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
          projectId?: string;
          firestoreDatabaseId?: string;
        };
        if (parsed.projectId && !fileProjectId) fileProjectId = parsed.projectId;
        if (parsed.firestoreDatabaseId && !fileDbId) fileDbId = parsed.firestoreDatabaseId;
      }
    } catch {
      // Ignore unreadable candidate and try next
    }
  }

  return {
    projectId: envProjectId || fileProjectId || FALLBACK_FIREBASE_PROJECT_ID,
    databaseId: envDbId || fileDbId || FALLBACK_FIRESTORE_DATABASE_ID,
  };
}

let cachedAdminAuth: Auth | null = null;
function getAdminAuth(): Auth {
  if (cachedAdminAuth) return cachedAdminAuth;
  // Starter Tier compliant: initialize firebase-admin ONLY for ID token verification
  const adminApp = getApps().length
    ? getApp()
    : initializeApp({ projectId: resolveFirebaseConfig().projectId });
  cachedAdminAuth = getAuth(adminApp);
  return cachedAdminAuth;
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

interface FirestoreRestValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number | string;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FirestoreRestValue[] };
  mapValue?: { fields?: Record<string, FirestoreRestValue> };
}

function decodeFirestoreValue(val: FirestoreRestValue | undefined): unknown {
  if (!val || typeof val !== 'object') return undefined;
  if ('stringValue' in val) return val.stringValue ?? '';
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    const arr = val.arrayValue?.values || [];
    return arr.map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function decodeFirestoreDocument(docJson: unknown): Record<string, unknown> | null {
  if (!docJson || typeof docJson !== 'object') return null;
  const fields = (docJson as { fields?: Record<string, FirestoreRestValue> }).fields;
  if (!fields || typeof fields !== 'object') return null;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    result[k] = decodeFirestoreValue(v);
  }
  const name = (docJson as { name?: string }).name;
  if (typeof name === 'string' && name.includes('/')) {
    result.id = name.split('/').pop();
  }
  return result;
}

async function fetchFirestoreDocument(
  collectionPath: string,
  documentId: string,
  bearerToken: string
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const { projectId, databaseId } = resolveFirebaseConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(
    collectionPath
  )}/${encodeURIComponent(documentId)}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  if (!resp.ok) {
    return { ok: false, status: resp.status, data: null };
  }

  const rawJson = await resp.json().catch(() => null);
  return {
    ok: true,
    status: 200,
    data: decodeFirestoreDocument(rawJson),
  };
}

class PayloadTooLargeError extends Error {}
class InvalidJsonError extends Error {}

async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const existingBody = (req as IncomingMessage & { body?: unknown }).body;
  if (existingBody && typeof existingBody === 'object' && !Buffer.isBuffer(existingBody)) {
    return existingBody as Record<string, unknown>;
  }
  if (typeof existingBody === 'string') {
    try {
      const parsed = JSON.parse(existingBody);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      throw new InvalidJsonError('Malformed JSON payload');
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        reject(new PayloadTooLargeError('Request payload exceeds maximum allowed size.'));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new InvalidJsonError('Malformed JSON payload'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function isValidSafeDocId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

function sanitizeLogoDataUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2 * 1024 * 1024) return undefined;
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function toPayslipPayload(raw: Record<string, unknown>): PayslipPdfInput['payslip'] {
  return {
    employeeName: String(raw.employeeName || '').trim(),
    employeeCode: raw.employeeCode ? String(raw.employeeCode) : undefined,
    designation: raw.designation ? String(raw.designation) : undefined,
    department: raw.department ? String(raw.department) : undefined,
    companyId: raw.companyId ? String(raw.companyId) : undefined,
    companyName: raw.companyName ? String(raw.companyName) : undefined,
    companyAddress: raw.companyAddress ? String(raw.companyAddress) : undefined,
    companyLogoAssetId: raw.companyLogoAssetId ? String(raw.companyLogoAssetId) : undefined,
    companyOverridden: Boolean(raw.companyOverridden),
    generatedAtIso: raw.generatedAtIso ? String(raw.generatedAtIso) : undefined,
    location: raw.location ? String(raw.location) : undefined,
    currency: raw.currency ? String(raw.currency) : undefined,
    month: String(raw.month || '').trim(),
    basicSalary: Number(raw.basicSalary || 0),
    hra: Number(raw.hra || 0),
    otherEarnings: Array.isArray(raw.otherEarnings)
      ? (raw.otherEarnings as Array<{ label?: string; amount?: number }>)
      : [],
    bonus: Number(raw.bonus || 0),
    deductions: Array.isArray(raw.deductions)
      ? (raw.deductions as Array<{ label?: string; amount?: number }>)
      : [],
    professionalTax: Number(raw.professionalTax || 0),
    grossEarnings: Number(raw.grossEarnings || 0),
    totalDeductions: Number(raw.totalDeductions || 0),
    netSalary: Number(raw.netSalary || 0),
    workingDaysInMonth:
      typeof raw.workingDaysInMonth === 'number' ? raw.workingDaysInMonth : undefined,
    presentDays: typeof raw.presentDays === 'number' ? raw.presentDays : undefined,
    leaveDays: typeof raw.leaveDays === 'number' ? raw.leaveDays : undefined,
    status: raw.status ? String(raw.status) : undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
  };
}

export async function handlePayslipPdfRequest(
  req: IncomingMessage & { authUser?: DecodedIdToken; bearerToken?: string; body?: unknown },
  res: ServerResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let authUser: DecodedIdToken | undefined = req.authUser;
  let bearerToken: string | undefined = req.bearerToken;

  if (!authUser || !bearerToken) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      sendJson(res, 401, { error: 'Authentication expired. Please sign in again.' });
      return;
    }
    bearerToken = authHeader.slice('Bearer '.length).trim();
    try {
      const decoded = await getAdminAuth().verifyIdToken(bearerToken);
      if (decoded.firebase?.sign_in_provider === 'anonymous') {
        sendJson(res, 403, { error: 'You do not have permission to access this payslip.' });
        return;
      }
      authUser = decoded;
    } catch (err) {
      const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
      console.error('Payslip PDF token verification failed:', code || 'invalid_token');
      if (code === 'auth/user-disabled') {
        sendJson(res, 403, { error: 'Account disabled in Firebase Authentication.' });
        return;
      }
      sendJson(res, 401, {
        error: 'Authentication expired. Please sign in again.',
        code: code === 'auth/id-token-expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      });
      return;
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: 'Payslip request payload is too large.' });
      return;
    }
    if (err instanceof InvalidJsonError) {
      sendJson(res, 400, { error: 'Invalid payslip request payload.' });
      return;
    }
    console.error('Payslip PDF body read failed');
    sendJson(res, 400, { error: 'Unable to read payslip request.' });
    return;
  }

  const clientPayslip =
    body.payslip && typeof body.payslip === 'object'
      ? (body.payslip as Record<string, unknown>)
      : null;
  const clientCompany =
    body.company && typeof body.company === 'object'
      ? (body.company as SettingsLikeForCompanies & { companyId?: string; currency?: string })
      : null;
  const safeLogoDataUrl = sanitizeLogoDataUrl(body.logoDataUrl);

  if (!clientPayslip) {
    sendJson(res, 400, { error: 'Invalid payslip payload' });
    return;
  }

  try {
    const isBootstrappedSuperAdmin =
      (authUser.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL &&
      authUser.email_verified === true;

    const [roleRes, settingsRes] = await Promise.all([
      isBootstrappedSuperAdmin
        ? Promise.resolve({ ok: true, status: 200, data: { role: 'super_admin', status: 'Active' } as Record<string, unknown> })
        : fetchFirestoreDocument('roles', authUser.uid, bearerToken).catch(() => ({
            ok: false,
            status: 500,
            data: null,
          })),
      fetchFirestoreDocument('companySettings', 'main', bearerToken).catch(() => ({
        ok: false,
        status: 500,
        data: null,
      })),
    ]);

    const roleDoc = roleRes.data;
    const callerRole = isBootstrappedSuperAdmin
      ? 'super_admin'
      : typeof roleDoc?.role === 'string'
      ? roleDoc.role
      : '';
    const callerStatus = isBootstrappedSuperAdmin
      ? 'Active'
      : typeof roleDoc?.status === 'string'
      ? roleDoc.status
      : '';

    if (!callerRole || callerStatus !== 'Active') {
      sendJson(res, 403, { error: 'You do not have permission to access this payslip.' });
      return;
    }

    const authoritativeCompanySettings =
      (settingsRes.ok && settingsRes.data
        ? (settingsRes.data as SettingsLikeForCompanies & {
            teamLeaderPermissions?: { canViewSalary?: boolean };
            companyId?: string;
            currency?: string;
          })
        : null) || clientCompany;

    let authoritativePayslipRaw: Record<string, unknown> | null = null;

    if (callerRole === 'super_admin') {
      if (clientPayslip.employeeName && clientPayslip.month) {
        authoritativePayslipRaw = clientPayslip;
      } else if (isValidSafeDocId(clientPayslip.id)) {
        const recordRes = await fetchFirestoreDocument('payrollRecords', clientPayslip.id, bearerToken);
        if (!recordRes.ok) {
          sendJson(
            res,
            recordRes.status === 404 ? 404 : recordRes.status === 403 ? 403 : 500,
            {
              error:
                recordRes.status === 404
                  ? 'Payslip not found.'
                  : recordRes.status === 403
                  ? 'You do not have permission to access this payslip.'
                  : 'Unable to generate PDF.',
            }
          );
          return;
        }
        authoritativePayslipRaw = recordRes.data;
      }
    } else {
      // Non-Super-Admin callers MUST fetch and authorize an existing Firestore payrollRecord
      if (!isValidSafeDocId(clientPayslip.id)) {
        sendJson(res, 404, { error: 'Payslip not found.' });
        return;
      }

      const recordRes = await fetchFirestoreDocument('payrollRecords', clientPayslip.id, bearerToken);
      if (!recordRes.ok || !recordRes.data) {
        sendJson(
          res,
          recordRes.status === 404 ? 404 : recordRes.status === 403 ? 403 : 500,
          {
            error:
              recordRes.status === 404
                ? 'Payslip not found.'
                : recordRes.status === 403
                ? 'You do not have permission to access this payslip.'
                : 'Unable to generate PDF.',
          }
        );
        return;
      }

      const record = recordRes.data;
      const isOwnPublishedPayslip =
        record.employeeUid === authUser.uid && record.status === 'Published';

      if (!isOwnPublishedPayslip) {
        const tlCanViewSalary =
          callerRole === 'team_leader' &&
          Boolean(
            (
              authoritativeCompanySettings as {
                teamLeaderPermissions?: { canViewSalary?: boolean };
              } | null
            )?.teamLeaderPermissions?.canViewSalary
          );

        if (!tlCanViewSalary) {
          sendJson(res, 403, { error: 'You do not have permission to access this payslip.' });
          return;
        }

        const callerEmpId = typeof roleDoc?.employeeId === 'string' ? roleDoc.employeeId : '';
        if (!isValidSafeDocId(callerEmpId)) {
          sendJson(res, 403, { error: 'You do not have permission to access this payslip.' });
          return;
        }
        const callerEmpRes = await fetchFirestoreDocument('employees', callerEmpId, bearerToken);
        if (!callerEmpRes.ok || !callerEmpRes.data) {
          sendJson(res, 403, { error: 'You do not have permission to access this payslip.' });
          return;
        }
        const callerCompanyId = normalizeCompanyId(
          typeof callerEmpRes.data.companyId === 'string' ? callerEmpRes.data.companyId : undefined
        );
        const targetCompanyId = normalizeCompanyId(
          typeof record.companyId === 'string' ? record.companyId : undefined
        );
        if (callerCompanyId !== targetCompanyId) {
          sendJson(res, 403, { error: 'You do not have permission to access this payslip.' });
          return;
        }
      }

      authoritativePayslipRaw = record;
    }

    if (
      !authoritativePayslipRaw ||
      !authoritativePayslipRaw.employeeName ||
      !authoritativePayslipRaw.month
    ) {
      sendJson(res, 400, { error: 'Invalid payslip payload' });
      return;
    }

    const payslipInput = toPayslipPayload(authoritativePayslipRaw);

    const resolvedCompany = resolveCompanyProfile(
      payslipInput.companyId || clientCompany?.companyId,
      authoritativeCompanySettings,
      {
        companyId: payslipInput.companyId ? normalizeCompanyId(payslipInput.companyId) : undefined,
        companyName: payslipInput.companyName,
        companyAddress: payslipInput.companyAddress,
        companyLogoAssetId: payslipInput.companyLogoAssetId,
        companyOverridden: payslipInput.companyOverridden,
      }
    );

    try {
      assertCurrencyAllowedForCompany(
        resolvedCompany.companyId,
        payslipInput.currency ||
          resolvedCompany.defaultCurrency ||
          authoritativeCompanySettings?.currency ||
          'INR'
      );
    } catch (currencyErr) {
      sendJson(res, 400, {
        error:
          currencyErr instanceof Error
            ? currencyErr.message
            : 'Invalid payslip currency for assigned company',
      });
      return;
    }

    const pdfBuffer = await renderPayslipPdfBuffer({
      payslip: payslipInput,
      company: authoritativeCompanySettings,
      logoDataUrl: safeLogoDataUrl,
    });

    const downloadFilename = formatPayslipPdfFilename(payslipInput);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${downloadFilename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(pdfBuffer);
  } catch (err) {
    const safeMsg = err instanceof Error ? err.message : 'Unknown PDF error';
    console.error('Payslip PDF generation error:', {
      uidPrefix: authUser?.uid ? authUser.uid.slice(0, 6) : 'unknown',
      message: safeMsg,
    });
    sendJson(res, 500, { error: 'Unable to generate PDF.' });
  }
}

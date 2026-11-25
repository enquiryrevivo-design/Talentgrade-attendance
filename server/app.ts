import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken, Auth } from 'firebase-admin/auth';
import {
  computeEmployeeLeaveAccrualPlan,
  EngineApprovedLeaveInput,
  EngineEmployeeInput,
  LeaveLedgerEntry,
  normalizeLeavePolicyConfig,
} from '../shared/leaveAccrualEngine.js';
import {
  EngineCelebrationProfileInput,
  evaluateCelebrationsWindow,
  normalizeCelebrationSettings,
} from '../shared/celebrationEngine.js';
import {
  computeRegularizedAttendanceMetrics,
  RegularizationRequestType,
  resolveSafeTimezone,
  validateRegularizationPayload,
} from '../shared/regularizationEngine.js';
import { SmartAttendanceReminderService } from './pushScheduler.js';

const BOOTSTRAPPED_ADMIN_EMAIL = 'enquiry.revivo@gmail.com';
const FALLBACK_FIREBASE_PROJECT_ID = 'gen-lang-client-0264117228';
const FALLBACK_FIRESTORE_DATABASE_ID = 'ai-studio-8571b2ef-56ab-4f5a-9f14-103ac191cd0a';
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
      // Fall through to next candidate / fallback
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
  // Initialize Firebase Admin ONLY for ID token verification (works on Starter Tier without IAM)
  const adminApp = getApps().length
    ? getApp()
    : initializeApp({ projectId: resolveFirebaseConfig().projectId });
  cachedAdminAuth = getAuth(adminApp);
  return cachedAdminAuth;
}

interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken;
  bearerToken?: string;
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing bearer token' });
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (decoded.firebase?.sign_in_provider === 'anonymous') {
      return res.status(403).json({ error: 'Forbidden: Anonymous authentication is not permitted' });
    }
    req.authUser = decoded;
    req.bearerToken = token;
    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token' });
  }
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

export function createApiApp() {
  const app = express();
  let reminderServiceInstance: SmartAttendanceReminderService | null = null;
  const getReminderService = () => {
    if (!reminderServiceInstance) {
      reminderServiceInstance = new SmartAttendanceReminderService();
    }
    return reminderServiceInstance;
  };

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => {
      const forwarded = req.headers['x-forwarded-for'];
      const firstForwarded = Array.isArray(forwarded)
        ? forwarded[0]
        : typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : '';
      return req.ip || firstForwarded || 'unknown';
    },
    message: { error: 'Too many requests. Please wait a moment and try again.' },
  });
  app.use('/api/', apiLimiter);

  // Authoritative server timestamp endpoint with per-employee IANA timezone calculation
  app.get('/api/server-time', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const now = new Date();
    const tz = typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : 'Asia/Kolkata';
    const resolved = resolveTimezoneParts(now, tz);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({
      iso: now.toISOString(),
      epochMs: now.getTime(),
      timezone: tz,
      ...resolved,
    });
  });

  // Scoped first-login password-change completion endpoint.
  // Resolves the employee document strictly from the verified Firebase UID (never trusting client employeeId)
  // and updates only mustChangePassword=false + server updatedAt, ensuring roles/{uid} exists if missing.
  app.post('/api/auth/complete-password-change', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser?.uid;
    const bearerToken = req.bearerToken;
    if (!uid || !bearerToken) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required.' });
    }

    try {
      const { projectId, databaseId } = resolveFirebaseConfig();
      const dbRootUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents`;

      type FirestoreFieldMap = Record<string, { stringValue?: string; booleanValue?: boolean }>;
      type RunQueryHit = { document?: { name?: string; fields?: FirestoreFieldMap } };

      const queryByField = async (fieldPath: string, value: string) => {
        const resp = await fetch(`${dbRootUrl}:runQuery`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bearerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'employees' }],
              where: {
                fieldFilter: {
                  field: { fieldPath },
                  op: 'EQUAL',
                  value: { stringValue: value },
                },
              },
              limit: 1,
            },
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`Firestore employee lookup failed (${resp.status}): ${text.slice(0, 200)}`);
        }
        const rows = (await resp.json()) as RunQueryHit[];
        return rows.find((r) => r.document?.name)?.document || null;
      };

      let empDoc = await queryByField('uid', uid);
      if (!empDoc && req.authUser?.email_verified === true && req.authUser?.email) {
        empDoc = await queryByField('email', req.authUser.email.toLowerCase());
      }

      if (!empDoc || !empDoc.name) {
        return res.status(404).json({ error: 'Employee profile not found for this authenticated account.' });
      }

      const employeeDocId = empDoc.name.split('/').pop() || '';
      const fields = empDoc.fields || {};
      const docUid = fields.uid?.stringValue || '';
      const docStatus = fields.status?.stringValue || '';
      const docRole = fields.role?.stringValue || 'employee';
      const docEmail = (fields.email?.stringValue || req.authUser?.email || '').toLowerCase();

      if (docStatus !== 'Active') {
        return res.status(403).json({
          error: `Account is marked as ${docStatus || 'Inactive'}. Contact your Super Admin.`,
        });
      }

      if (docUid && docUid !== uid) {
        return res.status(403).json({
          error: 'Forbidden: Authenticated user does not own this employee profile.',
        });
      }

      const updateFields: Record<string, { stringValue?: string; booleanValue?: boolean }> = {
        mustChangePassword: { booleanValue: false },
      };
      const fieldPaths = ['mustChangePassword'];
      if (!docUid && req.authUser?.email_verified === true) {
        updateFields.uid = { stringValue: uid };
        fieldPaths.push('uid');
      }

      const writes: Array<Record<string, unknown>> = [
        {
          update: {
            name: empDoc.name,
            fields: updateFields,
          },
          updateMask: { fieldPaths },
          updateTransforms: [
            {
              fieldPath: 'updatedAt',
              setToServerValue: 'REQUEST_TIME',
            },
          ],
          currentDocument: { exists: true },
        },
      ];

      // Ensure roles/{uid} exists for subsequent self-service reads/writes if it was omitted
      const roleCheckResp = await fetch(`${dbRootUrl}/roles/${encodeURIComponent(uid)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      if (!roleCheckResp.ok && roleCheckResp.status !== 404) {
        console.warn('Role existence check returned unexpected status:', roleCheckResp.status);
      }
      const boundedRoleEmail = docEmail.slice(0, 120);
      if (roleCheckResp.status === 404 && boundedRoleEmail.length >= 3 && employeeDocId) {
        writes.push({
          update: {
            name: `${dbRootUrl.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '')}/roles/${encodeURIComponent(uid)}`,
            fields: {
              uid: { stringValue: uid },
              email: { stringValue: boundedRoleEmail },
              role: { stringValue: docRole },
              employeeId: { stringValue: employeeDocId },
              status: { stringValue: 'Active' },
            },
          },
          updateTransforms: [
            {
              fieldPath: 'updatedAt',
              setToServerValue: 'REQUEST_TIME',
            },
          ],
          currentDocument: { exists: false },
        });
      }

      const commitResp = await fetch(`${dbRootUrl}:commit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ writes }),
      });

      if (!commitResp.ok) {
        const errText = await commitResp.text().catch(() => '');
        console.error('Complete password change commit failed:', commitResp.status, errText);
        return res.status(commitResp.status === 403 ? 403 : 500).json({
          error: 'Could not finalize password change in Firestore.',
        });
      }

      res.json({
        ok: true,
        employeeId: employeeDocId,
        uid,
        mustChangePassword: false,
      });
    } catch (err) {
      console.error('Error completing first-login password change:', err);
      res.status(500).json({ error: 'Failed to finalize password change status.' });
    }
  });

  // Server-side Leave Accrual & Policy Engine (authoritative server clock)
  app.post('/api/leave/accrual/compute', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        employees,
        policy,
        existingLedger,
        approvedLeaves,
        actor,
        isNewEmployeeInit,
      } = req.body || {};

      if (!Array.isArray(employees)) {
        return res.status(400).json({ error: 'employees array is required' });
      }

      const normalizedPolicy = normalizeLeavePolicyConfig(policy);
      const ledgerList: LeaveLedgerEntry[] = Array.isArray(existingLedger) ? existingLedger : [];
      const approvedList: EngineApprovedLeaveInput[] = Array.isArray(approvedLeaves) ? approvedLeaves : [];
      const referenceNow = new Date();
      const actorUid = String(actor?.uid || req.authUser?.uid || 'system');
      const actorName = String(actor?.name || req.authUser?.email || 'System Engine');

      const plans = (employees as EngineEmployeeInput[]).map((emp) =>
        computeEmployeeLeaveAccrualPlan({
          employee: emp,
          policy: normalizedPolicy,
          existingLedger: ledgerList,
          approvedLeaves: approvedList,
          referenceNow,
          actorUid,
          actorName,
          isNewEmployeeInit: Boolean(isNewEmployeeInit),
        })
      );

      res.json({
        serverTimeIso: referenceNow.toISOString(),
        policy: normalizedPolicy,
        plans,
      });
    } catch (err) {
      console.error('Error computing leave accruals:', err);
      res.status(500).json({ error: 'Failed to compute leave accruals on server' });
    }
  });

  // Server-side Birthday & Work Anniversary Evaluation (authoritative server clock & company timezone)
  app.post('/api/celebrations/evaluate', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { profiles, celebrationSettings, companyName, lookbackDays, lookaheadDays } = req.body || {};
      if (!Array.isArray(profiles)) {
        return res.status(400).json({ error: 'profiles array is required' });
      }
      const normalized = normalizeCelebrationSettings(celebrationSettings);
      const result = evaluateCelebrationsWindow({
        profiles: profiles as EngineCelebrationProfileInput[],
        settings: normalized,
        companyName: typeof companyName === 'string' && companyName.trim() ? companyName.trim() : 'TalentGrade',
        referenceNow: new Date(),
        lookbackDays: typeof lookbackDays === 'number' ? Math.min(31, Math.max(0, lookbackDays)) : 7,
        lookaheadDays:
          typeof lookaheadDays === 'number'
            ? Math.min(365, Math.max(0, lookaheadDays))
            : normalized.upcomingWindowDays,
      });

      res.json({
        serverTimeIso: new Date().toISOString(),
        settings: normalized,
        ...result,
      });
    } catch (err) {
      console.error('Error evaluating celebrations:', err);
      res.status(500).json({ error: 'Failed to evaluate celebrations on server' });
    }
  });

  // Server-side Attendance Regularization Validation (authoritative server clock & employee timezone)
  app.post('/api/attendance/regularization/validate', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { date, requestType, requestedPunchIn, requestedPunchOut, reason, timezone } = req.body || {};
      const safeTz = resolveSafeTimezone(typeof timezone === 'string' ? timezone : 'Asia/Kolkata');
      const now = new Date();
      const resolved = resolveTimezoneParts(now, safeTz);

      const validation = validateRegularizationPayload({
        date: typeof date === 'string' ? date : '',
        todayInTimezone: resolved.localDate,
        requestType: requestType as RegularizationRequestType,
        requestedPunchIn: typeof requestedPunchIn === 'string' ? requestedPunchIn : '',
        requestedPunchOut: typeof requestedPunchOut === 'string' ? requestedPunchOut : '',
        reason: typeof reason === 'string' ? reason : '',
      });

      if (!validation.valid) {
        return res.status(400).json({
          valid: false,
          error: validation.error,
          todayDate: resolved.localDate,
          timezone: safeTz,
        });
      }

      res.json({
        valid: true,
        serverTimeIso: now.toISOString(),
        todayDate: resolved.localDate,
        timezone: safeTz,
        normalizedPunchIn: validation.normalizedPunchIn,
        normalizedPunchOut: validation.normalizedPunchOut,
        normalizedReason: validation.normalizedReason,
      });
    } catch (err) {
      console.error('Error validating attendance regularization:', err);
      res.status(500).json({ error: 'Failed to validate attendance regularization request' });
    }
  });

  // Server-side Attendance Regularization Approval Metrics Calculation
  app.post('/api/attendance/regularization/compute-approval', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        date,
        timezone,
        requestedPunchIn,
        requestedPunchOut,
        existingPunchInIso,
        existingPunchOutIso,
        schedule,
      } = req.body || {};

      if (typeof date !== 'string' || !date) {
        return res.status(400).json({ valid: false, error: 'Attendance date is required.' });
      }

      const safeTz = resolveSafeTimezone(
        typeof timezone === 'string' && timezone
          ? timezone
          : typeof schedule?.timezone === 'string'
          ? schedule.timezone
          : 'Asia/Kolkata'
      );

      const rawGrace = Number(schedule?.gracePeriodMinutes ?? 15);
      const rawHalf = Number(schedule?.halfDayMinHours ?? 4);
      const rawFull = Number(schedule?.fullDayMinHours ?? 8);

      const computed = computeRegularizedAttendanceMetrics({
        date,
        timeZone: safeTz,
        requestedPunchIn: typeof requestedPunchIn === 'string' ? requestedPunchIn : '',
        requestedPunchOut: typeof requestedPunchOut === 'string' ? requestedPunchOut : '',
        existingPunchInIso: typeof existingPunchInIso === 'string' ? existingPunchInIso : undefined,
        existingPunchOutIso: typeof existingPunchOutIso === 'string' ? existingPunchOutIso : undefined,
        schedule: {
          timezone: safeTz,
          officeStartTime: typeof schedule?.officeStartTime === 'string' ? schedule.officeStartTime : '09:30',
          gracePeriodMinutes: Number.isFinite(rawGrace) ? rawGrace : 15,
          halfDayMinHours: Number.isFinite(rawHalf) ? rawHalf : 4,
          fullDayMinHours: Number.isFinite(rawFull) ? rawFull : 8,
        },
      });

      res.json({
        valid: true,
        serverTimeIso: new Date().toISOString(),
        computed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid regularization approval metrics';
      res.status(400).json({ valid: false, error: msg });
    }
  });

  // Server-side PDF Payslip Generation (TalentGrade Black & Crimson Identity, Unicode NotoSans font for ₹)
  app.post('/api/payslips/pdf', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { payslip, company, logoDataUrl } = req.body || {};
      if (!payslip || !payslip.employeeName || !payslip.month) {
        return res.status(400).json({ error: 'Invalid payslip payload' });
      }

      const { renderPayslipPdfBuffer } = await import('./payslipPdf.js');
      const pdfBuffer = await renderPayslipPdfBuffer({ payslip, company, logoDataUrl });
      const safeCode = String(payslip.employeeCode || 'EMP').replace(/[^a-zA-Z0-9_-]/g, '');
      const safeMonth = String(payslip.month || 'month').replace(/[^0-9-]/g, '');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="TalentGrade_Payslip_${safeCode}_${safeMonth}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('Error generating PDF payslip:', err);
      res.status(500).json({ error: 'Failed to generate PDF payslip' });
    }
  });

  // =========================================================================
  // SMART ATTENDANCE REMINDERS — WEB PUSH & BACKGROUND SCHEDULER APIs
  // =========================================================================
  const isVerifiedSuperAdmin = async (
    authUser?: DecodedIdToken,
    bearerToken?: string
  ): Promise<boolean> => {
    if (!authUser) return false;
    if (
      (authUser.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL &&
      authUser.email_verified === true
    ) {
      return true;
    }

    // Verify caller's authoritative roles/{uid} document via Firestore REST API using caller's Bearer token
    // so promoted Super Admins stay verified across Vercel serverless cold starts.
    if (bearerToken && authUser.uid) {
      try {
        const { projectId, databaseId } = resolveFirebaseConfig();
        const roleUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/roles/${encodeURIComponent(authUser.uid)}`;
        const resp = await fetch(roleUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${bearerToken}` },
        });
        if (resp.ok) {
          const docJson = (await resp.json()) as {
            fields?: {
              role?: { stringValue?: string };
              status?: { stringValue?: string };
            };
          };
          if (
            docJson.fields?.role?.stringValue === 'super_admin' &&
            docJson.fields?.status?.stringValue === 'Active'
          ) {
            return true;
          }
        }
      } catch (err) {
        console.warn('Firestore REST Super Admin role check warning:', err);
      }
    }

    const snap = getReminderService().getStateSnapshot();
    return Object.values(snap.employees).some(
      (e) => e.uid === authUser.uid && e.role === 'super_admin' && e.status === 'Active'
    );
  };

  // Expose ONLY the VAPID public key to authenticated users (private key stays strictly server-side)
  app.get('/api/push/vapid-public-key', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ publicKey: getReminderService().getPublicVapidKey() });
  });

  // Register or refresh a Web Push subscription for the authenticated employee
  app.post('/api/push/subscribe', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });

      const { employeeId, subscription, deviceLabel, employeeSnapshot } = req.body || {};
      const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint.trim() : '';
      const p256dh = typeof subscription?.keys?.p256dh === 'string' ? subscription.keys.p256dh.trim() : '';
      const authKey = typeof subscription?.keys?.auth === 'string' ? subscription.keys.auth.trim() : '';

      if (!endpoint || (!endpoint.startsWith('https://') && !endpoint.startsWith('http://localhost'))) {
        return res.status(400).json({ error: 'Valid HTTPS push endpoint is required.' });
      }
      if (!p256dh || !authKey) {
        return res.status(400).json({ error: 'Push encryption keys (p256dh, auth) are required.' });
      }

      const safeEmpId =
        typeof employeeId === 'string' && employeeId.trim() ? employeeId.trim().slice(0, 128) : uid;

      const record = getReminderService().registerSubscription({
        employeeId: safeEmpId,
        employeeUid: uid,
        endpoint,
        keys: { p256dh, auth: authKey },
        expirationTime:
          typeof subscription?.expirationTime === 'number' ? subscription.expirationTime : null,
        deviceLabel: typeof deviceLabel === 'string' ? deviceLabel : 'Browser Device',
        employeeSnapshot:
          employeeSnapshot && typeof employeeSnapshot === 'object' ? employeeSnapshot : undefined,
      });

      res.json({
        ok: true,
        subscription: {
          id: record.id,
          employeeId: record.employeeId,
          deviceLabel: record.deviceLabel,
          status: record.status,
          updatedAtIso: record.updatedAtIso,
        },
      });
    } catch (err) {
      console.error('Error registering push subscription:', err);
      res.status(500).json({ error: 'Failed to register push subscription' });
    }
  });

  // Unsubscribe specific device or disable all push notifications for authenticated employee
  app.post('/api/push/unsubscribe', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });

      const { endpoint, subscriptionId, disableAllForUser } = req.body || {};
      const deactivated = getReminderService().deactivateSubscription({
        employeeUid: uid,
        endpoint: typeof endpoint === 'string' ? endpoint : undefined,
        subscriptionId: typeof subscriptionId === 'string' ? subscriptionId : undefined,
        disableAllForUser: Boolean(disableAllForUser),
      });
      res.json({ ok: true, deactivated });
    } catch (err) {
      console.error('Error unsubscribing push subscription:', err);
      res.status(500).json({ error: 'Failed to unsubscribe push notifications' });
    }
  });

  // Sync employee schedule, attendance state, leaves, and (for Super Admin) company reminder rules
  app.post('/api/reminders/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });

      const callerIsAdmin = await isVerifiedSuperAdmin(req.authUser, req.bearerToken);
      const { company, employees, attendanceRecords, approvedLeaves } = req.body || {};
      const service = getReminderService();

      service.syncClientSnapshot({
        callerUid: uid,
        callerIsAdmin,
        company: callerIsAdmin && company && typeof company === 'object' ? company : undefined,
        employees: Array.isArray(employees) ? employees : undefined,
        attendanceRecords: Array.isArray(attendanceRecords) ? attendanceRecords : undefined,
        approvedLeaves: Array.isArray(approvedLeaves) ? approvedLeaves : undefined,
      });

      const userSubs = service.getSubscriptionsForUser(uid).map((s) => ({
        id: s.id,
        endpoint: s.endpoint,
        deviceLabel: s.deviceLabel,
        status: s.status,
        updatedAtIso: s.updatedAtIso,
        lastFailureReason: s.lastFailureReason,
      }));

      res.json({
        ok: true,
        subscriptions: userSubs,
        overview: callerIsAdmin ? service.getOverviewMetrics() : undefined,
      });
    } catch (err) {
      console.error('Error syncing reminder state:', err);
      res.status(500).json({ error: 'Failed to synchronize reminder state' });
    }
  });

  // Update authenticated employee's own Smart Attendance Reminder preferences
  app.post('/api/reminders/preferences', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });

      const { employeeId, preferences } = req.body || {};
      const safeEmpId =
        typeof employeeId === 'string' && employeeId.trim() ? employeeId.trim().slice(0, 128) : uid;

      const updated = getReminderService().updateEmployeePreferences({
        employeeId: safeEmpId,
        employeeUid: uid,
        preferences: preferences && typeof preferences === 'object' ? preferences : {},
      });
      res.json({ ok: true, preferences: updated });
    } catch (err) {
      console.error('Error updating employee reminder preferences:', err);
      res.status(500).json({ error: 'Failed to update reminder preferences' });
    }
  });

  // Retrieve reminder delivery history & subscription status (self for employees, company-wide for Super Admin)
  app.get('/api/reminders/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });

      const callerIsAdmin = await isVerifiedSuperAdmin(req.authUser, req.bearerToken);
      const scope = req.query.scope === 'all' && callerIsAdmin ? 'all' : 'self';
      const limitCount = Number(req.query.limit || 150);
      const service = getReminderService();

      const logs = service.getHistory({
        callerUid: uid,
        callerIsAdmin: scope === 'all',
        limitCount: Number.isFinite(limitCount) ? limitCount : 150,
      });

      const subscriptions = service.getSubscriptionsForUser(uid).map((s) => ({
        id: s.id,
        endpoint: s.endpoint,
        deviceLabel: s.deviceLabel,
        status: s.status,
        updatedAtIso: s.updatedAtIso,
        lastFailureReason: s.lastFailureReason,
      }));

      res.json({
        logs,
        subscriptions,
        overview: callerIsAdmin ? service.getOverviewMetrics() : undefined,
      });
    } catch (err) {
      console.error('Error fetching reminder history:', err);
      res.status(500).json({ error: 'Failed to load reminder history' });
    }
  });

  // Trigger a genuine test Web Push notification to the signed-in employee's active browser subscription(s)
  app.post('/api/reminders/test-self', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });

      const result = await getReminderService().sendTestNotification(uid);
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test push notification failed';
      res.status(400).json({ ok: false, error: msg });
    }
  });

  // Super Admin manual evaluation cycle trigger
  app.post('/api/reminders/run-now', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (!(await isVerifiedSuperAdmin(req.authUser, req.bearerToken))) {
      return res.status(403).json({ error: 'Forbidden: Super Admin access required' });
    }
    try {
      const service = getReminderService();
      const result = await service.processDueAttendanceReminders(new Date());
      res.json({
        ok: true,
        ...result,
        overview: service.getOverviewMetrics(),
      });
    } catch (err) {
      console.error('Error executing manual reminder run:', err);
      res.status(500).json({ error: 'Failed to run attendance reminder cycle' });
    }
  });

  return { app, getReminderService };
}

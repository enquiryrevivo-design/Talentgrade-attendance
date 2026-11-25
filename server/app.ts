import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { renderPayslipPdfBuffer } from './payslipPdf.ts';
import {
  computeEmployeeLeaveAccrualPlan,
  EngineApprovedLeaveInput,
  EngineEmployeeInput,
  LeaveLedgerEntry,
  normalizeLeavePolicyConfig,
} from '../shared/leaveAccrualEngine.ts';
import {
  EngineCelebrationProfileInput,
  evaluateCelebrationsWindow,
  normalizeCelebrationSettings,
} from '../shared/celebrationEngine.ts';
import {
  computeRegularizedAttendanceMetrics,
  RegularizationRequestType,
  resolveSafeTimezone,
  validateRegularizationPayload,
} from '../shared/regularizationEngine.ts';
import { SmartAttendanceReminderService } from './pushScheduler.ts';

const BOOTSTRAPPED_ADMIN_EMAIL = 'enquiry.revivo@gmail.com';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFirebaseConfig(): { projectId: string } {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(__dirname, '..', 'firebase-applet-config.json'),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { projectId: string };
    }
  }
  if (process.env.FIREBASE_PROJECT_ID) {
    return { projectId: process.env.FIREBASE_PROJECT_ID };
  }
  throw new Error('firebase-applet-config.json not found');
}

const firebaseConfig = loadFirebaseConfig();

// Initialize Firebase Admin ONLY for ID token verification (works on Starter Tier without IAM)
const adminApp = getApps().length
  ? getApp()
  : initializeApp({ projectId: firebaseConfig.projectId });
const adminAuth = getAuth(adminApp);

interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken;
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing bearer token' });
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.email_verified) {
      return res.status(403).json({ error: 'Forbidden: Email verification required' });
    }
    req.authUser = decoded;
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
  const reminderService = new SmartAttendanceReminderService();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' },
  });
  app.use('/api/', apiLimiter);

  // Authoritative server timestamp endpoint with per-employee IANA timezone calculation
  app.get('/api/server-time', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const now = new Date();
    const tz = typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : 'Asia/Kolkata';
    const resolved = resolveTimezoneParts(now, tz);
    res.json({
      iso: now.toISOString(),
      epochMs: now.getTime(),
      timezone: tz,
      ...resolved,
    });
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
          gracePeriodMinutes: Number(schedule?.gracePeriodMinutes ?? 15),
          halfDayMinHours: Number(schedule?.halfDayMinHours ?? 4),
          fullDayMinHours: Number(schedule?.fullDayMinHours ?? 8),
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
  const isVerifiedSuperAdmin = (authUser?: DecodedIdToken): boolean => {
    if (!authUser) return false;
    if ((authUser.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL) return true;
    const snap = reminderService.getStateSnapshot();
    return Object.values(snap.employees).some(
      (e) => e.uid === authUser.uid && e.role === 'super_admin' && e.status === 'Active'
    );
  };

  // Expose ONLY the VAPID public key to authenticated users (private key stays strictly server-side)
  app.get('/api/push/vapid-public-key', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ publicKey: reminderService.getPublicVapidKey() });
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

      const record = reminderService.registerSubscription({
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
      const deactivated = reminderService.deactivateSubscription({
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
  app.post('/api/reminders/sync', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });

      const callerIsAdmin = isVerifiedSuperAdmin(req.authUser);
      const { company, employees, attendanceRecords, approvedLeaves } = req.body || {};

      reminderService.syncClientSnapshot({
        callerUid: uid,
        callerIsAdmin,
        company: callerIsAdmin && company && typeof company === 'object' ? company : undefined,
        employees: Array.isArray(employees) ? employees : undefined,
        attendanceRecords: Array.isArray(attendanceRecords) ? attendanceRecords : undefined,
        approvedLeaves: Array.isArray(approvedLeaves) ? approvedLeaves : undefined,
      });

      const userSubs = reminderService.getSubscriptionsForUser(uid).map((s) => ({
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
        overview: callerIsAdmin ? reminderService.getOverviewMetrics() : undefined,
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

      const updated = reminderService.updateEmployeePreferences({
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
  app.get('/api/reminders/history', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });

      const callerIsAdmin = isVerifiedSuperAdmin(req.authUser);
      const scope = req.query.scope === 'all' && callerIsAdmin ? 'all' : 'self';
      const limitCount = Number(req.query.limit || 150);

      const logs = reminderService.getHistory({
        callerUid: uid,
        callerIsAdmin: scope === 'all',
        limitCount: Number.isFinite(limitCount) ? limitCount : 150,
      });

      const subscriptions = reminderService.getSubscriptionsForUser(uid).map((s) => ({
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
        overview: callerIsAdmin ? reminderService.getOverviewMetrics() : undefined,
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

      const result = await reminderService.sendTestNotification(uid);
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test push notification failed';
      res.status(400).json({ ok: false, error: msg });
    }
  });

  // Super Admin manual evaluation cycle trigger
  app.post('/api/reminders/run-now', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (!isVerifiedSuperAdmin(req.authUser)) {
      return res.status(403).json({ error: 'Forbidden: Super Admin access required' });
    }
    try {
      const result = await reminderService.processDueAttendanceReminders(new Date());
      res.json({
        ok: true,
        ...result,
        overview: reminderService.getOverviewMetrics(),
      });
    } catch (err) {
      console.error('Error executing manual reminder run:', err);
      res.status(500).json({ error: 'Failed to run attendance reminder cycle' });
    }
  });

  return { app, reminderService };
}

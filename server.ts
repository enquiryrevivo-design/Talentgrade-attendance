import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { renderPayslipPdfBuffer } from './server/payslipPdf.ts';
import {
  computeEmployeeLeaveAccrualPlan,
  EngineApprovedLeaveInput,
  EngineEmployeeInput,
  LeaveLedgerEntry,
  normalizeLeavePolicyConfig,
} from './shared/leaveAccrualEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Currency & date formatting handled in server/payslipPdf.ts with Unicode NotoSans fonts

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

async function startServer() {
  const app = express();
  const PORT = 3000;

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

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TalentGrade HR server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

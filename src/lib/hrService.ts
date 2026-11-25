import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import { db, auth, firebaseConfig, handleFirestoreError, OperationType } from './firebase';
import {
  AttendanceCorrection,
  AttendancePhoto,
  AttendanceRecord,
  AttendanceStatus,
  AuditLog,
  CompanySettings,
  Department,
  Employee,
  EmployeeSalary,
  EmployeeStatus,
  LeaveApplication,
  LeaveLedgerEntry,
  LeavePolicyConfig,
  LeaveStatus,
  LeaveType,
  MediaAsset,
  PayrollRecord,
  PayrollStatus,
  SalaryLineItem,
  UserRole,
} from '../types/hr';
import {
  calculateCasualLeaveEligibilityDate,
  DEFAULT_LEAVE_POLICY,
  EmployeeAccrualPlan,
  EmployeeLeaveComputedSummary,
  getLocalTodayInTimezone,
  isValidIsoDate,
  makeAccrualDocId,
  normalizeLeavePolicyConfig,
  round2,
} from '../../shared/leaveAccrualEngine';
import {
  DEFAULT_CELEBRATION_SETTINGS,
  extractMonthDayFromDate,
  normalizeCelebrationSettings,
} from '../../shared/celebrationEngine';
import {
  DEFAULT_ATTENDANCE_REMINDER_SETTINGS,
  normalizeAttendanceReminderSettings,
} from '../../shared/attendanceReminderEngine';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'enquiry.revivo@gmail.com';

export const LOCATION_PRESETS: Record<
  string,
  { location: string; timezone: string; currency: 'INR' | 'AED'; workingDays: number[] }
> = {
  India: {
    location: 'India',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    workingDays: [1, 2, 3, 4, 5],
  },
  'Dubai, UAE': {
    location: 'Dubai, UAE',
    timezone: 'Asia/Dubai',
    currency: 'AED',
    workingDays: [1, 2, 3, 4, 5],
  },
};

export function getEffectiveSchedule(emp: Employee, settings: CompanySettings) {
  const loc = emp.location || 'India';
  const preset = LOCATION_PRESETS[loc] || LOCATION_PRESETS.India;
  return {
    location: loc,
    timezone: emp.timezone || preset.timezone,
    currency: emp.currency || preset.currency || settings.currency || 'INR',
    officeStartTime: emp.officeStartTime || settings.officeStartTime || '09:30',
    officeEndTime: emp.officeEndTime || settings.officeEndTime || '18:30',
    gracePeriodMinutes:
      typeof emp.gracePeriodMinutes === 'number' ? emp.gracePeriodMinutes : settings.gracePeriodMinutes ?? 15,
    halfDayMinHours:
      typeof emp.halfDayMinHours === 'number' ? emp.halfDayMinHours : settings.halfDayMinHours ?? 4,
    fullDayMinHours:
      typeof emp.fullDayMinHours === 'number' ? emp.fullDayMinHours : settings.fullDayMinHours ?? 8,
    workingDays:
      Array.isArray(emp.workingDays) && emp.workingDays.length > 0
        ? emp.workingDays
        : settings.workingDays || [1, 2, 3, 4, 5],
  };
}

export function getTodayInTimezone(timezone = 'Asia/Kolkata'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback
  }
  return new Date().toISOString().slice(0, 10);
}

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function cleanObject<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export function formatTimeDisplay(iso?: string, timezone?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

export function formatDurationMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return '0h 0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function formatMoney(amount: number, currency = 'INR'): string {
  const code = (currency || 'INR').toUpperCase();
  const val = Number(amount || 0);
  if (code === 'INR') {
    const num = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
    return `₹${num}`;
  }
  if (code === 'AED') {
    const num = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
    return `د.إ ${num}`;
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  } catch {
    return `${code} ${val.toFixed(2)}`;
  }
}

export function countDaysInclusive(startDate: string, endDate: string): number {
  const s = new Date(`${startDate}T00:00:00Z`);
  const e = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}

export function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const s = new Date(`${startDate}T00:00:00Z`);
  const e = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return dates;
  const cur = new Date(s);
  let guard = 0;
  while (cur <= e && guard < 180) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard++;
  }
  return dates;
}

export async function compressImageFile(file: File, maxDim = 512): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file.');
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process image.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

export async function writeAuditLog(params: {
  actor: Employee;
  action: string;
  entityType: string;
  entityId: string;
  previousValues?: Record<string, unknown>;
  updatedValues?: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  const id = makeSafeId('audit');
  try {
    await setDoc(
      doc(db, 'auditLogs', id),
      cleanObject({
        actorUid: params.actor.uid || auth.currentUser?.uid || 'system',
        actorName: params.actor.fullName,
        actorRole: params.actor.role,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        previousValues: params.previousValues,
        updatedValues: params.updatedValues,
        summary: params.summary.slice(0, 500),
        createdAt: serverTimestamp(),
      })
    );
  } catch (err) {
    console.error('Audit log write error:', err);
  }
}

export async function getCompanySettings(): Promise<CompanySettings | null> {
  try {
    const snap = await getDoc(doc(db, 'companySettings', 'main'));
    if (!snap.exists()) return null;
    return snap.data() as CompanySettings;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'companySettings/main');
  }
}

export async function saveCompanySettings(
  settings: Omit<CompanySettings, 'updatedAt' | 'updatedBy'>,
  actor: Employee
): Promise<void> {
  try {
    const existing = await getCompanySettings();
    await setDoc(
      doc(db, 'companySettings', 'main'),
      cleanObject({
        ...settings,
        celebrationSettings: normalizeCelebrationSettings(settings.celebrationSettings),
        attendanceReminders: normalizeAttendanceReminderSettings(settings.attendanceReminders),
        locations: settings.locations || ['India', 'Dubai, UAE'],
        supportedCurrencies: settings.supportedCurrencies || ['INR', 'AED'],
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      })
    );
    await writeAuditLog({
      actor,
      action: 'UPDATE_COMPANY_SETTINGS',
      entityType: 'CompanySettings',
      entityId: 'main',
      previousValues: existing ? { companyName: existing.companyName, officeStartTime: existing.officeStartTime } : undefined,
      updatedValues: { companyName: settings.companyName, officeStartTime: settings.officeStartTime },
      summary: `${actor.fullName} updated TalentGrade company settings and attendance rules.`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'companySettings/main');
  }
}

export async function getDepartments(): Promise<Department[]> {
  try {
    const snap = await getDocs(collection(db, 'departments'));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Department, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'departments');
  }
}

export async function createDepartment(name: string, code: string, actor: Employee): Promise<Department> {
  const id = makeSafeId('dept');
  try {
    const payload = {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'departments', id), payload);
    await writeAuditLog({
      actor,
      action: 'CREATE_DEPARTMENT',
      entityType: 'Department',
      entityId: id,
      updatedValues: { name: payload.name, code: payload.code },
      summary: `Created department ${payload.name} (${payload.code})`,
    });
    return { id, name: payload.name, code: payload.code };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `departments/${id}`);
  }
}

export async function deleteDepartment(deptId: string, deptName: string, actor: Employee): Promise<void> {
  try {
    await deleteDoc(doc(db, 'departments', deptId));
    await writeAuditLog({
      actor,
      action: 'DELETE_DEPARTMENT',
      entityType: 'Department',
      entityId: deptId,
      previousValues: { name: deptName },
      summary: `Deleted department ${deptName}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `departments/${deptId}`);
  }
}

export async function bootstrapCompanyAndAdmin(user: User): Promise<{
  employee: Employee;
  settings: CompanySettings;
}> {
  const email = (user.email || '').toLowerCase();
  const today = getTodayInTimezone('Asia/Kolkata');

  let settings = await getCompanySettings();
  if (!settings) {
    const defaultSettings: Omit<CompanySettings, 'updatedAt'> = {
      companyName: 'TalentGrade',
      companyAddress: 'India & Dubai, UAE Operations',
      companyPhone: '',
      companyEmail: email,
      companyWebsite: 'https://talentgrade.io',
      taxId: '',
      locations: ['India', 'Dubai, UAE'],
      supportedCurrencies: ['INR', 'AED'],
      officeStartTime: '09:30',
      officeEndTime: '18:30',
      gracePeriodMinutes: 15,
      halfDayMinHours: 4,
      fullDayMinHours: 8,
      workingDays: [1, 2, 3, 4, 5],
      holidays: [],
      defaultSickLeave: 12,
      defaultCasualLeave: 12,
      leavePolicy: DEFAULT_LEAVE_POLICY,
      celebrationSettings: DEFAULT_CELEBRATION_SETTINGS,
      attendanceReminders: DEFAULT_ATTENDANCE_REMINDER_SETTINGS,
      currency: 'INR',
      teamLeaderPermissions: {
        canViewAllEmployees: true,
        canEditAttendance: false,
        canApproveCorrections: true,
        canApproveLeaves: true,
        canViewSalary: false,
      },
      updatedBy: user.uid,
    };
    await setDoc(doc(db, 'companySettings', 'main'), {
      ...defaultSettings,
      updatedAt: serverTimestamp(),
    });
    settings = defaultSettings;
  } else if (
    settings.companyName === 'Meridian Internal Operations' ||
    !settings.leavePolicy ||
    !settings.celebrationSettings ||
    !settings.attendanceReminders
  ) {
    // Non-destructive upgrade: preserve all existing settings and add defaults if missing
    const upgraded: Omit<CompanySettings, 'updatedAt'> = {
      ...settings,
      companyName:
        settings.companyName === 'Meridian Internal Operations' ? 'TalentGrade' : settings.companyName,
      locations: settings.locations || ['India', 'Dubai, UAE'],
      supportedCurrencies: settings.supportedCurrencies || ['INR', 'AED'],
      currency: settings.currency === 'USD' ? 'INR' : settings.currency,
      leavePolicy: normalizeLeavePolicyConfig(settings.leavePolicy),
      celebrationSettings: normalizeCelebrationSettings(settings.celebrationSettings),
      attendanceReminders: normalizeAttendanceReminderSettings(settings.attendanceReminders),
      updatedBy: user.uid,
    };
    await setDoc(doc(db, 'companySettings', 'main'), cleanObject({
      ...upgraded,
      updatedAt: serverTimestamp(),
    }));
    settings = upgraded;
  }

  // Ensure default departments exist
  const existingDepts = await getDocs(collection(db, 'departments'));
  if (existingDepts.empty) {
    const defaults = [
      { id: 'dept_eng', name: 'Engineering', code: 'ENG' },
      { id: 'dept_ops', name: 'Operations', code: 'OPS' },
      { id: 'dept_hr', name: 'People & Finance', code: 'HRF' },
      { id: 'dept_sales', name: 'Sales & Growth', code: 'SLS' },
    ];
    for (const d of defaults) {
      await setDoc(doc(db, 'departments', d.id), {
        name: d.name,
        code: d.code,
        createdAt: serverTimestamp(),
      });
    }
  }

  // Create or preserve existing Super Admin employee doc without resetting custom edits
  const empId = 'emp_super_admin';
  const empSnap = await getDoc(doc(db, 'employees', empId));
  let employee: Employee;
  if (!empSnap.exists()) {
    const policy = normalizeLeavePolicyConfig(settings.leavePolicy);
    const newEmp: Omit<Employee, 'id' | 'createdAt' | 'updatedAt'> = {
      uid: user.uid,
      employeeCode: 'TG-001',
      fullName: user.displayName || 'Super Admin',
      email,
      phone: '',
      emergencyContact: '',
      role: 'super_admin',
      department: 'People & Finance',
      designation: 'Super Admin',
      joiningDate: today,
      status: 'Active',
      location: 'India',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      sickLeaveBalance: policy.sickLeaveMonthlyRate,
      casualLeaveBalance: policy.casualLeaveEligibilityMonths === 0 ? policy.casualLeaveMonthlyRate : 0,
      carryForwardBalance: 0,
      leavePolicyMigrated: true,
      leaveLastSyncedMonth: today.slice(0, 7),
      leaveLastResetYear: Number(today.slice(0, 4)),
      clEligibilityDate: calculateCasualLeaveEligibilityDate(today, policy.casualLeaveEligibilityMonths),
      mustChangePassword: false,
      failedLoginAttempts: 0,
    };
    await setDoc(doc(db, 'employees', empId), {
      ...newEmp,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    employee = { id: empId, ...newEmp };
  } else {
    employee = { id: empSnap.id, ...(empSnap.data() as Omit<Employee, 'id'>) };
    if (employee.uid !== user.uid) {
      await updateDoc(doc(db, 'employees', empId), {
        uid: user.uid,
        updatedAt: serverTimestamp(),
      });
      employee.uid = user.uid;
    }
  }

  await setDoc(doc(db, 'roles', user.uid), {
    uid: user.uid,
    email,
    role: 'super_admin',
    employeeId: empId,
    status: 'Active',
    updatedAt: serverTimestamp(),
  });

  return { employee, settings };
}

export async function resolveEmployeeSession(user: User): Promise<{
  employee: Employee | null;
  settings: CompanySettings | null;
  errorReason?: string;
}> {
  const email = (user.email || '').toLowerCase();

  try {
    const byUidSnap = await getDocs(query(collection(db, 'employees'), where('uid', '==', user.uid)));
    let emp: Employee | null = null;
    if (!byUidSnap.empty) {
      const d = byUidSnap.docs[0];
      emp = { id: d.id, ...(d.data() as Omit<Employee, 'id'>) };
    } else if (email && user.emailVerified) {
      const byEmailSnap = await getDocs(query(collection(db, 'employees'), where('email', '==', email)));
      if (!byEmailSnap.empty) {
        const d = byEmailSnap.docs[0];
        emp = { id: d.id, ...(d.data() as Omit<Employee, 'id'>) };
      }
    }

    if (!emp && email === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified) {
      const boot = await bootstrapCompanyAndAdmin(user);
      return { employee: boot.employee, settings: boot.settings };
    }

    if (!emp) {
      const safeSettings = await getCompanySettings().catch(() => null);
      return {
        employee: null,
        settings: safeSettings,
        errorReason: user.emailVerified
          ? 'Your email is not registered in the TalentGrade employee directory. Please ask your Super Admin to create your account.'
          : 'Your account profile could not be linked. Please sign in with the credentials provided by your Super Admin or use Company Google Sign-In.',
      };
    }

    if (emp.status !== 'Active') {
      const safeSettings = await getCompanySettings().catch(() => null);
      return {
        employee: null,
        settings: safeSettings,
        errorReason: `Your account is currently marked as ${emp.status}. Access has been disabled by administration.`,
      };
    }

    if (emp.lockedUntil && new Date(emp.lockedUntil) > new Date()) {
      const safeSettings = await getCompanySettings().catch(() => null);
      return {
        employee: null,
        settings: safeSettings,
        errorReason: 'Account temporarily locked due to repeated failed sign-in attempts. Contact your Super Admin.',
      };
    }

    // Link UID & sync roles/{uid} on first verified login if employee doc was pre-created without UID
    if (emp.uid !== user.uid) {
      await updateDoc(doc(db, 'employees', emp.id), {
        uid: user.uid,
        failedLoginAttempts: 0,
        updatedAt: serverTimestamp(),
      });
      emp.uid = user.uid;
    }

    const roleSnap = await getDoc(doc(db, 'roles', user.uid));
    if (!roleSnap.exists()) {
      await setDoc(doc(db, 'roles', user.uid), {
        uid: user.uid,
        email: email || emp.email,
        role: emp.role,
        employeeId: emp.id,
        status: emp.status,
        updatedAt: serverTimestamp(),
      });
    }

    let settings = await getCompanySettings();
    if (
      email === BOOTSTRAPPED_ADMIN_EMAIL &&
      user.emailVerified &&
      (!settings || settings.companyName === 'Meridian Internal Operations')
    ) {
      const boot = await bootstrapCompanyAndAdmin(user);
      settings = boot.settings;
    }

    return { employee: emp, settings };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'employees/session');
  }
}

export async function fetchServerTime(timezone = 'Asia/Kolkata'): Promise<{
  iso: string;
  epochMs: number;
  timezone: string;
  localDate: string;
  localHHmm: string;
  localMinutesOfDay: number;
  clockOffsetMs: number;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const requestClock = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch(`/api/server-time?tz=${encodeURIComponent(timezone)}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  };

  let res = await requestClock(false);
  if (res.status === 401) {
    res = await requestClock(true);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let serverDetail = '';
    if (contentType.includes('application/json')) {
      const errBody = await res.json().catch(() => null);
      if (errBody && typeof errBody.error === 'string') {
        serverDetail = errBody.error;
      }
    }
    console.error('Server clock sync failed:', res.status, serverDetail);
    throw new Error(
      serverDetail
        ? `Could not synchronize server clock for attendance (${res.status}: ${serverDetail}).`
        : `Could not synchronize server clock for attendance (HTTP ${res.status}).`
    );
  }

  if (!contentType.includes('application/json')) {
    throw new Error('Could not synchronize server clock for attendance (unexpected server response).');
  }

  const data = (await res.json()) as {
    iso?: unknown;
    epochMs?: unknown;
    timezone?: unknown;
    localDate?: unknown;
    localHHmm?: unknown;
    localMinutesOfDay?: unknown;
  };

  if (
    typeof data?.iso !== 'string' ||
    typeof data?.epochMs !== 'number' ||
    !Number.isFinite(data.epochMs) ||
    typeof data?.localDate !== 'string' ||
    typeof data?.localHHmm !== 'string' ||
    typeof data?.localMinutesOfDay !== 'number' ||
    !Number.isFinite(data.localMinutesOfDay)
  ) {
    throw new Error('Could not synchronize server clock for attendance (invalid timestamp payload).');
  }

  return {
    iso: data.iso,
    epochMs: data.epochMs,
    timezone: typeof data.timezone === 'string' && data.timezone ? data.timezone : timezone,
    localDate: data.localDate,
    localHHmm: data.localHHmm,
    localMinutesOfDay: data.localMinutesOfDay,
    clockOffsetMs: data.epochMs - Date.now(),
  };
}

export async function fetchAllEmployees(
  currentEmployee: Employee,
  canViewAll = true
): Promise<Employee[]> {
  try {
    const byId = new Map<string, Employee>();
    if (
      currentEmployee.role === 'super_admin' ||
      (currentEmployee.role === 'team_leader' && canViewAll)
    ) {
      const snap = await getDocs(collection(db, 'employees'));
      snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...(d.data() as Omit<Employee, 'id'>) }));
    } else if (currentEmployee.role === 'team_leader') {
      const [selfSnap, teamSnap] = await Promise.all([
        getDocs(query(collection(db, 'employees'), where('uid', '==', currentEmployee.uid))),
        getDocs(query(collection(db, 'employees'), where('managerUid', '==', currentEmployee.uid))),
      ]);
      selfSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...(d.data() as Omit<Employee, 'id'>) }));
      teamSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...(d.data() as Omit<Employee, 'id'>) }));
    } else {
      const snap = await getDocs(
        query(collection(db, 'employees'), where('uid', '==', currentEmployee.uid))
      );
      snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...(d.data() as Omit<Employee, 'id'>) }));
    }
    return Array.from(byId.values()).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'employees');
  }
}

export async function createEmployeeAccount(
  input: {
    employeeCode: string;
    fullName: string;
    email: string;
    phone: string;
    emergencyContact: string;
    role: UserRole;
    department: string;
    designation: string;
    joiningDate: string;
    dateOfBirth?: string;
    location: string;
    timezone: string;
    currency: string;
    officeStartTime?: string;
    officeEndTime?: string;
    gracePeriodMinutes?: number;
    halfDayMinHours?: number;
    fullDayMinHours?: number;
    workingDays?: number[];
    profilePhotoAssetId?: string;
    managerUid?: string;
    sickLeaveBalance: number;
    casualLeaveBalance: number;
    carryForwardBalance: number;
    clEligibilityDate?: string;
    clEligibilityCustom?: boolean;
    temporaryPassword?: string;
    mustChangePassword: boolean;
  },
  actor: Employee,
  options?: { leavePolicy?: LeavePolicyConfig }
): Promise<{ employee: Employee; authProvisioned: boolean; note?: string }> {
  const id = makeSafeId('emp');
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Please enter a valid corporate email address.');
  }
  if (!input.employeeCode.trim() || !input.fullName.trim()) {
    throw new Error('Employee code and full name are required.');
  }
  if (!isValidIsoDate(input.joiningDate)) {
    throw new Error('Joining date must be in YYYY-MM-DD format.');
  }

  const rawSl = Number(input.sickLeaveBalance);
  const rawCl = Number(input.casualLeaveBalance);
  const rawCf = Number(input.carryForwardBalance);
  if (!Number.isFinite(rawSl) || !Number.isFinite(rawCl) || !Number.isFinite(rawCf)) {
    throw new Error('Leave balances must be valid finite numbers.');
  }

  const initialSl = round2(rawSl);
  const initialCl = round2(rawCl);
  const initialCf = Math.max(0, round2(rawCf));
  if (initialSl < -60 || initialSl > 365 || initialCl < -60 || initialCl > 365 || initialCf > 365) {
    throw new Error('Leave balances must be valid numbers between -60 and 365.');
  }

  const tempPassword = input.temporaryPassword?.trim() || '';
  if (tempPassword.length > 0 && tempPassword.length < 6) {
    throw new Error('Temporary password must be at least 6 characters long.');
  }

  const normalizedDob = input.dateOfBirth?.trim() || undefined;
  const birthdayMonthDay = extractMonthDayFromDate(normalizedDob);
  const policy = normalizeLeavePolicyConfig(options?.leavePolicy);
  const defaultClEligibilityDate = calculateCasualLeaveEligibilityDate(
    input.joiningDate,
    policy.casualLeaveEligibilityMonths
  );
  const hasCustomClEligibility = Boolean(
    input.clEligibilityCustom && isValidIsoDate(input.clEligibilityDate)
  );
  const clEligibilityDate = hasCustomClEligibility
    ? input.clEligibilityDate!.trim()
    : defaultClEligibilityDate;
  const todayLocal = getTodayInTimezone(input.timezone || 'Asia/Kolkata');
  const currentMonth = todayLocal.slice(0, 7);
  const currentYear = Number(todayLocal.slice(0, 4)) || new Date().getUTCFullYear();

  try {
    const existingSnap = await getDocs(query(collection(db, 'employees'), where('email', '==', normalizedEmail)));
    if (!existingSnap.empty) {
      throw new Error('An employee account with this email already exists.');
    }

    // 1. Provision Firebase Auth login FIRST so we receive the authoritative UID before writing Firestore documents atomically.
    let provisionedUid = '';
    let authProvisioned = false;
    let note: string | undefined;

    if (tempPassword.length >= 6) {
      const secondaryName = `secondary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const secondaryApp = initializeApp(firebaseConfig, secondaryName);
      try {
        const secondaryAuth = getAuth(secondaryApp);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, tempPassword);
        provisionedUid = cred.user.uid;
        authProvisioned = true;
        await signOut(secondaryAuth).catch(() => {});
      } catch (authErr: unknown) {
        const code = (authErr as { code?: string })?.code || '';
        if (code === 'auth/email-already-in-use') {
          throw new Error(
            'A Firebase Authentication account with this email already exists. Clear the temporary password field so the employee signs in via Google Sign-In or password reset.'
          );
        }
        if (code === 'auth/weak-password') {
          throw new Error('Temporary password is too weak for Firebase Authentication. Use at least 6 strong characters.');
        }
        if (code === 'auth/invalid-email') {
          throw new Error('The work email format was rejected by Firebase Authentication.');
        }
        if (code === 'auth/operation-not-allowed') {
          note =
            'Employee profile saved. They can sign in immediately with Google Sign-In. (To enable Email/Password login, enable Email/Password provider in Firebase Console.)';
        } else {
          throw new Error(
            authErr instanceof Error
              ? `Could not provision Firebase Authentication login: ${authErr.message}`
              : 'Could not provision Firebase Authentication login.'
          );
        }
      } finally {
        await deleteApp(secondaryApp).catch(() => {});
      }
    }

    const empData = cleanObject({
      uid: provisionedUid,
      employeeCode: input.employeeCode.trim().toUpperCase(),
      fullName: input.fullName.trim(),
      email: normalizedEmail,
      phone: input.phone.trim(),
      emergencyContact: input.emergencyContact.trim(),
      role: input.role,
      department: input.department,
      designation: input.designation.trim(),
      joiningDate: input.joiningDate,
      dateOfBirth: normalizedDob,
      birthdayMonthDay,
      status: 'Active' as EmployeeStatus,
      location: input.location || 'India',
      timezone: input.timezone || 'Asia/Kolkata',
      currency: input.currency || 'INR',
      officeStartTime: input.officeStartTime || undefined,
      officeEndTime: input.officeEndTime || undefined,
      gracePeriodMinutes:
        typeof input.gracePeriodMinutes === 'number' && Number.isFinite(input.gracePeriodMinutes)
          ? input.gracePeriodMinutes
          : undefined,
      halfDayMinHours:
        typeof input.halfDayMinHours === 'number' && Number.isFinite(input.halfDayMinHours)
          ? input.halfDayMinHours
          : undefined,
      fullDayMinHours:
        typeof input.fullDayMinHours === 'number' && Number.isFinite(input.fullDayMinHours)
          ? input.fullDayMinHours
          : undefined,
      workingDays: input.workingDays && input.workingDays.length > 0 ? input.workingDays : undefined,
      profilePhotoAssetId: input.profilePhotoAssetId || undefined,
      managerUid: input.managerUid || undefined,
      sickLeaveBalance: initialSl,
      casualLeaveBalance: initialCl,
      carryForwardBalance: initialCf,
      leavePolicyMigrated: true,
      leaveBaselineMonth: currentMonth,
      leaveLastSyncedMonth: currentMonth,
      leaveLastResetYear: currentYear,
      clEligibilityDate,
      clEligibilityCustom: hasCustomClEligibility ? true : undefined,
      mustChangePassword: input.mustChangePassword,
      failedLoginAttempts: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const actorUid = auth.currentUser?.uid || actor.uid || 'system';
    const actorName = (actor.fullName || actor.email || 'Super Admin').trim().slice(0, 120);
    const empName = (empData.fullName || 'Employee').trim().slice(0, 120);
    const joiningMonth = isValidIsoDate(input.joiningDate) ? input.joiningDate.slice(0, 7) : currentMonth;

    // 2. Atomically write employee, roles/{uid} (if Auth provisioned), initial SL/CL ledger entries, and celebration profile.
    const batch = writeBatch(db);
    batch.set(doc(db, 'employees', id), empData);

    if (provisionedUid) {
      batch.set(doc(db, 'roles', provisionedUid), {
        uid: provisionedUid,
        email: normalizedEmail,
        role: input.role,
        employeeId: id,
        status: 'Active',
        updatedAt: serverTimestamp(),
      });
    }

    const isDefaultCurrentMonthSl =
      joiningMonth === currentMonth &&
      input.joiningDate <= todayLocal &&
      policy.sickLeaveMonthlyRate > 0 &&
      initialSl === round2(policy.sickLeaveMonthlyRate);

    const slLedgerId = isDefaultCurrentMonthSl
      ? makeAccrualDocId(id, 'SL', currentMonth)
      : `init_${id}_SL`.replace(/[^a-zA-Z0-9_-]/g, '');

    batch.set(
      doc(db, 'leaveLedger', slLedgerId),
      cleanObject({
        employeeId: id,
        employeeUid: provisionedUid,
        employeeEmail: normalizedEmail,
        employeeName: empName,
        leaveType: 'SL',
        entryType: isDefaultCurrentMonthSl ? 'monthly_accrual' : 'opening_balance',
        month: currentMonth,
        year: currentYear,
        amount: initialSl,
        balanceBefore: 0,
        balanceAfter: initialSl,
        source: isDefaultCurrentMonthSl ? 'accrual_engine' : 'admin_manual',
        reason: isDefaultCurrentMonthSl
          ? `Monthly Sick Leave accrual for ${currentMonth}`
          : `Initial Sick Leave balance (${initialSl}d) configured on onboarding by ${actorName}`,
        createdBy: actorUid,
        createdByName: actorName,
        createdAt: serverTimestamp(),
      })
    );

    const isDefaultCurrentMonthCl =
      clEligibilityDate.slice(0, 7) === currentMonth &&
      todayLocal >= clEligibilityDate &&
      policy.casualLeaveMonthlyRate > 0 &&
      initialCl === round2(policy.casualLeaveMonthlyRate);

    const clLedgerId = isDefaultCurrentMonthCl
      ? makeAccrualDocId(id, 'CL', currentMonth)
      : `init_${id}_CL`.replace(/[^a-zA-Z0-9_-]/g, '');

    batch.set(
      doc(db, 'leaveLedger', clLedgerId),
      cleanObject({
        employeeId: id,
        employeeUid: provisionedUid,
        employeeEmail: normalizedEmail,
        employeeName: empName,
        leaveType: 'CL',
        entryType: isDefaultCurrentMonthCl ? 'monthly_accrual' : 'opening_balance',
        month: currentMonth,
        year: currentYear,
        amount: initialCl,
        balanceBefore: 0,
        balanceAfter: initialCl,
        source: isDefaultCurrentMonthCl ? 'accrual_engine' : 'admin_manual',
        reason: isDefaultCurrentMonthCl
          ? `Monthly Casual Leave accrual for ${currentMonth}`
          : `Initial Casual Leave balance (${initialCl}d) configured on onboarding by ${actorName}`,
        createdBy: actorUid,
        createdByName: actorName,
        createdAt: serverTimestamp(),
      })
    );

    batch.set(
      doc(db, 'celebrationProfiles', id),
      cleanObject({
        employeeId: id,
        employeeUid: provisionedUid,
        fullName: empData.fullName,
        department: empData.department,
        designation: empData.designation,
        location: empData.location,
        status: empData.status,
        role: empData.role,
        profilePhotoAssetId: empData.profilePhotoAssetId,
        birthdayMonthDay,
        joiningDate: empData.joiningDate,
        updatedAt: serverTimestamp(),
      })
    );

    await batch.commit();

    await writeAuditLog({
      actor,
      action: 'CREATE_EMPLOYEE',
      entityType: 'Employee',
      entityId: id,
      updatedValues: {
        employeeCode: empData.employeeCode,
        fullName: empData.fullName,
        email: normalizedEmail,
        role: input.role,
        location: empData.location,
        currency: empData.currency,
        clEligibilityDate,
        authProvisioned,
      },
      summary: `Created employee account for ${empData.fullName} (${empData.employeeCode}) in ${empData.location} (${empData.currency})`,
    });

    return {
      employee: { id, ...(empData as Omit<Employee, 'id'>) },
      authProvisioned,
      note,
    };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('already exists') ||
        err.message.includes('Firebase Authentication') ||
        err.message.includes('valid') ||
        err.message.includes('required'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `employees/${id}`);
  }
}

export async function updateEmployeeProfile(
  employeeId: string,
  updates: Partial<Employee>,
  actor: Employee,
  options?: { clearScheduleOverrides?: boolean; leavePolicy?: LeavePolicyConfig }
): Promise<void> {
  try {
    const empRef = doc(db, 'employees', employeeId);
    const snap = await getDoc(empRef);
    if (!snap.exists()) throw new Error('Employee record not found');
    const prev = snap.data() as Employee;

    const nextJoining = updates.joiningDate || prev.joiningDate;
    const policyEligibilityMonths = normalizeLeavePolicyConfig(options?.leavePolicy).casualLeaveEligibilityMonths;
    const computedEligibility =
      updates.joiningDate && updates.joiningDate !== prev.joiningDate && !updates.clEligibilityCustom && !prev.clEligibilityCustom
        ? calculateCasualLeaveEligibilityDate(updates.joiningDate, policyEligibilityMonths)
        : undefined;

    const safeUpdates: Record<string, unknown> = cleanObject({
      ...updates,
      ...(computedEligibility ? { clEligibilityDate: computedEligibility } : {}),
      email: updates.email ? updates.email.trim().toLowerCase() : undefined,
      updatedAt: serverTimestamp(),
    });
    delete safeUpdates.id;
    delete safeUpdates.createdAt;

    if (updates.clEligibilityCustom && isValidIsoDate(updates.clEligibilityDate)) {
      safeUpdates.clEligibilityCustom = true;
      safeUpdates.clEligibilityDate = updates.clEligibilityDate.trim();
    } else if ('clEligibilityCustom' in updates && updates.clEligibilityCustom === false) {
      safeUpdates.clEligibilityCustom = deleteField();
      safeUpdates.clEligibilityDate = calculateCasualLeaveEligibilityDate(
        nextJoining,
        policyEligibilityMonths
      );
    }

    if ('sickLeaveBalance' in safeUpdates) {
      const sl = Number(safeUpdates.sickLeaveBalance);
      if (!Number.isFinite(sl) || sl < -60 || sl > 365) {
        throw new Error('Sick leave balance must be between -60 and 365.');
      }
      safeUpdates.sickLeaveBalance = round2(sl);
    }
    if ('casualLeaveBalance' in safeUpdates) {
      const cl = Number(safeUpdates.casualLeaveBalance);
      if (!Number.isFinite(cl) || cl < -60 || cl > 365) {
        throw new Error('Casual leave balance must be between -60 and 365.');
      }
      safeUpdates.casualLeaveBalance = round2(cl);
    }
    if ('carryForwardBalance' in safeUpdates) {
      const cf = Number(safeUpdates.carryForwardBalance);
      if (!Number.isFinite(cf) || cf < 0 || cf > 365) {
        throw new Error('Carry-forward leave balance must be between 0 and 365.');
      }
      safeUpdates.carryForwardBalance = Math.max(0, round2(cf));
    }
    if ('gracePeriodMinutes' in safeUpdates && safeUpdates.gracePeriodMinutes !== undefined) {
      const g = Number(safeUpdates.gracePeriodMinutes);
      if (!Number.isFinite(g) || g < 0 || g > 180) delete safeUpdates.gracePeriodMinutes;
    }
    if ('halfDayMinHours' in safeUpdates && safeUpdates.halfDayMinHours !== undefined) {
      const h = Number(safeUpdates.halfDayMinHours);
      if (!Number.isFinite(h) || h < 1 || h > 12) delete safeUpdates.halfDayMinHours;
    }
    if ('fullDayMinHours' in safeUpdates && safeUpdates.fullDayMinHours !== undefined) {
      const f = Number(safeUpdates.fullDayMinHours);
      if (!Number.isFinite(f) || f < 1 || f > 16) delete safeUpdates.fullDayMinHours;
    }

    if ('dateOfBirth' in updates) {
      const dobTrimmed = typeof updates.dateOfBirth === 'string' ? updates.dateOfBirth.trim() : '';
      if (dobTrimmed) {
        const md = extractMonthDayFromDate(dobTrimmed);
        safeUpdates.dateOfBirth = dobTrimmed;
        if (md) {
          safeUpdates.birthdayMonthDay = md;
        } else {
          safeUpdates.birthdayMonthDay = deleteField();
        }
      } else {
        safeUpdates.dateOfBirth = deleteField();
        safeUpdates.birthdayMonthDay = deleteField();
      }
    }

    if (options?.clearScheduleOverrides) {
      safeUpdates.officeStartTime = deleteField();
      safeUpdates.officeEndTime = deleteField();
      safeUpdates.gracePeriodMinutes = deleteField();
      safeUpdates.halfDayMinHours = deleteField();
      safeUpdates.fullDayMinHours = deleteField();
      safeUpdates.workingDays = deleteField();
    }

    await updateDoc(empRef, safeUpdates);

    // Sync privacy-safe celebration profile projection
    try {
      const nextBirthdayMonthDay =
        'dateOfBirth' in updates
          ? extractMonthDayFromDate(typeof updates.dateOfBirth === 'string' ? updates.dateOfBirth.trim() : '')
          : prev.birthdayMonthDay || extractMonthDayFromDate(prev.dateOfBirth);
      const nextPhotoId =
        'profilePhotoAssetId' in updates ? updates.profilePhotoAssetId : prev.profilePhotoAssetId;

      await setDoc(
        doc(db, 'celebrationProfiles', employeeId),
        cleanObject({
          employeeId,
          employeeUid: updates.uid ?? prev.uid ?? '',
          fullName: updates.fullName ?? prev.fullName,
          department: updates.department ?? prev.department,
          designation: updates.designation ?? prev.designation,
          location: updates.location ?? prev.location ?? 'India',
          status: updates.status ?? prev.status,
          role: updates.role ?? prev.role,
          profilePhotoAssetId: nextPhotoId || undefined,
          birthdayMonthDay: nextBirthdayMonthDay || undefined,
          joiningDate: updates.joiningDate ?? prev.joiningDate,
          updatedAt: serverTimestamp(),
        })
      );
    } catch (celErr) {
      console.warn('Celebration profile sync skipped:', celErr);
    }

    // Keep immutable leaveLedger synchronized when Super Admin directly edits SL/CL balances in profile
    const actorUid = auth.currentUser?.uid || actor.uid || 'system';
    const actorName = (actor.fullName || actor.email || 'Super Admin').trim().slice(0, 120);
    const todayLocal = getTodayInTimezone(updates.timezone || prev.timezone || 'Asia/Kolkata');
    const currentMonth = todayLocal.slice(0, 7);
    const currentYear = Number(todayLocal.slice(0, 4)) || new Date().getUTCFullYear();
    const empEmail = (updates.email || prev.email || `${employeeId}@talentgrade.local`).trim().toLowerCase().slice(0, 120);
    const empName = (updates.fullName || prev.fullName || 'Employee').trim().slice(0, 120);

    if (
      actor.role === 'super_admin' &&
      typeof updates.sickLeaveBalance === 'number' &&
      Number.isFinite(updates.sickLeaveBalance) &&
      round2(updates.sickLeaveBalance) !== round2(prev.sickLeaveBalance)
    ) {
      const prevSl = round2(prev.sickLeaveBalance);
      const nextSl = round2(updates.sickLeaveBalance);
      const delta = round2(nextSl - prevSl);
      await setDoc(
        doc(db, 'leaveLedger', makeSafeId('adj_prof_sl')),
        cleanObject({
          employeeId,
          employeeUid: updates.uid || prev.uid || '',
          employeeEmail: empEmail,
          employeeName: empName,
          leaveType: 'SL',
          entryType: 'admin_adjustment',
          month: currentMonth,
          year: currentYear,
          amount: delta,
          balanceBefore: prevSl,
          balanceAfter: nextSl,
          source: 'admin_manual',
          reason: `Profile Sick Leave balance adjusted from ${prevSl} to ${nextSl}`,
          createdBy: actorUid,
          createdByName: actorName,
          createdAt: serverTimestamp(),
        })
      );
    }

    if (
      actor.role === 'super_admin' &&
      typeof updates.casualLeaveBalance === 'number' &&
      Number.isFinite(updates.casualLeaveBalance) &&
      round2(updates.casualLeaveBalance) !== round2(prev.casualLeaveBalance)
    ) {
      const prevCl = round2(prev.casualLeaveBalance);
      const nextCl = round2(updates.casualLeaveBalance);
      const delta = round2(nextCl - prevCl);
      await setDoc(
        doc(db, 'leaveLedger', makeSafeId('adj_prof_cl')),
        cleanObject({
          employeeId,
          employeeUid: updates.uid || prev.uid || '',
          employeeEmail: empEmail,
          employeeName: empName,
          leaveType: 'CL',
          entryType: 'admin_adjustment',
          month: currentMonth,
          year: currentYear,
          amount: delta,
          balanceBefore: prevCl,
          balanceAfter: nextCl,
          source: 'admin_manual',
          reason: `Profile Casual Leave balance adjusted from ${prevCl} to ${nextCl}`,
          createdBy: actorUid,
          createdByName: actorName,
          createdAt: serverTimestamp(),
        })
      );
    }

    const targetUid = updates.uid || prev.uid;
    if (targetUid && (updates.role || updates.status)) {
      await setDoc(doc(db, 'roles', targetUid), {
        uid: targetUid,
        email: updates.email ? updates.email.toLowerCase() : prev.email,
        role: updates.role || prev.role,
        employeeId,
        status: updates.status || prev.status,
        updatedAt: serverTimestamp(),
      });
    }

    await writeAuditLog({
      actor,
      action: 'UPDATE_EMPLOYEE',
      entityType: 'Employee',
      entityId: employeeId,
      previousValues: {
        role: prev.role,
        status: prev.status,
        location: prev.location || 'India',
        currency: prev.currency || 'INR',
        sickLeaveBalance: prev.sickLeaveBalance,
        casualLeaveBalance: prev.casualLeaveBalance,
      },
      updatedValues: cleanObject({
        role: updates.role,
        status: updates.status,
        location: updates.location,
        currency: updates.currency,
        sickLeaveBalance: updates.sickLeaveBalance,
        casualLeaveBalance: updates.casualLeaveBalance,
      }),
      summary: `Updated employee ${prev.fullName} (${prev.employeeCode})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `employees/${employeeId}`);
  }
}

export async function completeFirstLoginPasswordChangeInApp(employee: Employee): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('No active authenticated session.');

  const callEndpoint = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch('/api/auth/complete-password-change', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({}),
    });
  };

  let shouldFallbackToClientFirestore = false;
  try {
    let res = await callEndpoint(true);
    if (res.status === 401) {
      res = await callEndpoint(true);
    }

    const contentType = res.headers.get('content-type') || '';
    if (res.ok) {
      if (contentType.includes('application/json')) {
        const body = (await res.json().catch(() => null)) as { ok?: boolean; employeeId?: string } | null;
        if (body?.employeeId) return body.employeeId;
      }
      return employee.id;
    }

    // If API endpoint isn't hosted in this environment (e.g., static preview returning HTML 404), fall back safely
    if (res.status === 404 && !contentType.includes('application/json')) {
      shouldFallbackToClientFirestore = true;
    } else {
      let detail = '';
      if (contentType.includes('application/json')) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        if (errBody && typeof errBody.error === 'string') {
          detail = errBody.error;
        }
      }
      throw new Error(detail || `Could not finalize password change (HTTP ${res.status}).`);
    }
  } catch (err: unknown) {
    // Network/transport failure when API server isn't reachable -> allow scoped client Firestore update
    if (err instanceof TypeError) {
      shouldFallbackToClientFirestore = true;
    } else if (!shouldFallbackToClientFirestore) {
      throw err;
    }
  }

  let targetEmployeeId = employee.id;
  try {
    if (!targetEmployeeId || employee.uid !== user.uid) {
      const byUidSnap = await getDocs(query(collection(db, 'employees'), where('uid', '==', user.uid), limit(1)));
      if (!byUidSnap.empty) {
        targetEmployeeId = byUidSnap.docs[0].id;
      }
    }
    if (!targetEmployeeId) {
      throw new Error('Employee profile not found for this authenticated account.');
    }

    await updateDoc(doc(db, 'employees', targetEmployeeId), {
      mustChangePassword: false,
      updatedAt: serverTimestamp(),
    });

    // Ensure roles/{uid} exists so subsequent app features (selfie, attendance, leave) succeed
    try {
      const roleRef = doc(db, 'roles', user.uid);
      const roleSnap = await getDoc(roleRef);
      if (!roleSnap.exists()) {
        await setDoc(roleRef, {
          uid: user.uid,
          email: (employee.email || user.email || '').trim().toLowerCase().slice(0, 120),
          role: employee.role,
          employeeId: targetEmployeeId,
          status: employee.status,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (roleErr) {
      console.warn('Role sync skipped after password change:', roleErr);
    }

    return targetEmployeeId;
  } catch (fsErr) {
    handleFirestoreError(fsErr, OperationType.UPDATE, `employees/${targetEmployeeId || 'unknown'}`);
  }
}

export async function punchIn(params: {
  employee: Employee;
  settings: CompanySettings;
  photoDataUrl: string;
  lat: number;
  lng: number;
  accuracy: number;
}): Promise<AttendanceRecord> {
  const schedule = getEffectiveSchedule(params.employee, params.settings);
  const serverClock = await fetchServerTime(schedule.timezone);
  const dateStr = serverClock.localDate;
  const recordId = `${params.employee.id}_${dateStr}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const photoId = makeSafeId('photo_in');

  // Compute late status using authoritative server clock in employee's configured timezone + employee schedule
  const [startH, startM] = schedule.officeStartTime.split(':').map(Number);
  const officeStartMinutes = startH * 60 + startM;
  const diffMinutes = serverClock.localMinutesOfDay - officeStartMinutes;
  const isLate = diffMinutes > (schedule.gracePeriodMinutes || 0);
  const lateByMinutes = isLate ? Math.max(1, diffMinutes) : 0;

  try {
    await setDoc(
      doc(db, 'attendancePhotos', photoId),
      cleanObject({
        employeeId: params.employee.id,
        employeeUid: params.employee.uid,
        managerUid: params.employee.managerUid,
        attendanceRecordId: recordId,
        punchType: 'in',
        date: dateStr,
        capturedAt: serverTimestamp(),
        mimeType: 'image/jpeg',
        dataUrl: params.photoDataUrl,
      })
    );

    const createdRecord = await runTransaction(db, async (tx) => {
      const recRef = doc(db, 'attendanceRecords', recordId);
      const existingSnap = await tx.get(recRef);
      if (existingSnap.exists() && existingSnap.data().punchInTime) {
        throw new Error('You have already punched in today.');
      }

      const punchFields = cleanObject({
        timezone: schedule.timezone,
        punchInTime: serverClock.iso,
        punchInLat: Number.isFinite(params.lat) ? params.lat : 0,
        punchInLng: Number.isFinite(params.lng) ? params.lng : 0,
        punchInAccuracy: Number.isFinite(params.accuracy) ? Math.round(params.accuracy) : 0,
        punchInPhotoId: photoId,
        workingMinutes: 0,
        status: (isLate ? 'Late' : 'Present') as AttendanceStatus,
        isLate,
        lateByMinutes,
        updatedAt: serverTimestamp(),
      });

      if (existingSnap.exists()) {
        tx.update(recRef, punchFields);
        const existingData = existingSnap.data() as Omit<AttendanceRecord, 'id'>;
        return { id: recordId, ...existingData, ...(punchFields as Partial<AttendanceRecord>) };
      }

      const payload = cleanObject({
        employeeId: params.employee.id,
        employeeUid: params.employee.uid,
        employeeName: params.employee.fullName,
        department: params.employee.department,
        managerUid: params.employee.managerUid,
        date: dateStr,
        ...punchFields,
        createdAt: serverTimestamp(),
      });

      tx.set(recRef, payload);
      return { id: recordId, ...(payload as Omit<AttendanceRecord, 'id'>) };
    });

    return createdRecord;
  } catch (err) {
    if (err instanceof Error && err.message.includes('already punched in')) throw err;
    handleFirestoreError(err, OperationType.WRITE, `attendanceRecords/${recordId}`);
  }
}

export async function punchOut(params: {
  employee: Employee;
  settings: CompanySettings;
  recordId: string;
  photoDataUrl: string;
  lat: number;
  lng: number;
  accuracy: number;
}): Promise<AttendanceRecord> {
  const schedule = getEffectiveSchedule(params.employee, params.settings);
  const serverClock = await fetchServerTime(schedule.timezone);
  const photoId = makeSafeId('photo_out');

  try {
    await setDoc(
      doc(db, 'attendancePhotos', photoId),
      cleanObject({
        employeeId: params.employee.id,
        employeeUid: params.employee.uid,
        managerUid: params.employee.managerUid,
        attendanceRecordId: params.recordId,
        punchType: 'out',
        date: serverClock.localDate,
        capturedAt: serverTimestamp(),
        mimeType: 'image/jpeg',
        dataUrl: params.photoDataUrl,
      })
    );

    const updatedRecord = await runTransaction(db, async (tx) => {
      const recRef = doc(db, 'attendanceRecords', params.recordId);
      const snap = await tx.get(recRef);
      if (!snap.exists() || !snap.data().punchInTime) {
        throw new Error('Cannot punch out without an active punch-in record.');
      }
      const prev = snap.data() as AttendanceRecord;
      if (prev.punchOutTime) {
        throw new Error('You have already punched out for this shift.');
      }

      const inMs = new Date(prev.punchInTime || serverClock.iso).getTime();
      const outMs = new Date(serverClock.iso).getTime();
      const rawMinutes =
        Number.isFinite(inMs) && Number.isFinite(outMs) ? Math.round((outMs - inMs) / 60000) : 0;
      const workingMinutes = Math.max(0, Math.min(1440, Number.isFinite(rawMinutes) ? rawMinutes : 0));
      const fullDayMin = (schedule.fullDayMinHours || 8) * 60;

      let nextStatus: AttendanceStatus = prev.isLate ? 'Late' : 'Present';
      if (workingMinutes < fullDayMin) {
        nextStatus = 'Half Day';
      }

      const safeLat = Number.isFinite(params.lat) ? params.lat : 0;
      const safeLng = Number.isFinite(params.lng) ? params.lng : 0;
      const safeAcc = Number.isFinite(params.accuracy) ? Math.round(params.accuracy) : 0;

      tx.update(recRef, {
        punchOutTime: serverClock.iso,
        punchOutLat: safeLat,
        punchOutLng: safeLng,
        punchOutAccuracy: safeAcc,
        punchOutPhotoId: photoId,
        workingMinutes,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      return {
        ...prev,
        id: params.recordId,
        punchOutTime: serverClock.iso,
        punchOutLat: safeLat,
        punchOutLng: safeLng,
        punchOutAccuracy: safeAcc,
        punchOutPhotoId: photoId,
        workingMinutes,
        status: nextStatus,
      };
    });

    return updatedRecord;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('Cannot punch out') || err.message.includes('already punched out'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `attendanceRecords/${params.recordId}`);
  }
}

export async function fetchAttendanceRecords(
  employee: Employee,
  monthPrefix?: string,
  canViewAll = true
): Promise<AttendanceRecord[]> {
  try {
    const byId = new Map<string, AttendanceRecord>();
    if (
      employee.role === 'super_admin' ||
      (employee.role === 'team_leader' && canViewAll)
    ) {
      const snap = await getDocs(
        query(collection(db, 'attendanceRecords'), orderBy('date', 'desc'), limit(500))
      );
      snap.docs.forEach((d) =>
        byId.set(d.id, { id: d.id, ...(d.data() as Omit<AttendanceRecord, 'id'>) })
      );
    } else if (employee.role === 'team_leader') {
      const [selfSnap, teamSnap] = await Promise.all([
        getDocs(query(collection(db, 'attendanceRecords'), where('employeeUid', '==', employee.uid))),
        getDocs(query(collection(db, 'attendanceRecords'), where('managerUid', '==', employee.uid))),
      ]);
      selfSnap.docs.forEach((d) =>
        byId.set(d.id, { id: d.id, ...(d.data() as Omit<AttendanceRecord, 'id'>) })
      );
      teamSnap.docs.forEach((d) =>
        byId.set(d.id, { id: d.id, ...(d.data() as Omit<AttendanceRecord, 'id'>) })
      );
    } else {
      const snap = await getDocs(
        query(collection(db, 'attendanceRecords'), where('employeeUid', '==', employee.uid))
      );
      snap.docs.forEach((d) =>
        byId.set(d.id, { id: d.id, ...(d.data() as Omit<AttendanceRecord, 'id'>) })
      );
    }
    let rows = Array.from(byId.values());
    if (monthPrefix) {
      rows = rows.filter((r) => r.date.startsWith(monthPrefix));
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'attendanceRecords');
  }
}

export async function fetchAttendancePhoto(photoId: string): Promise<AttendancePhoto | null> {
  try {
    const snap = await getDoc(doc(db, 'attendancePhotos', photoId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<AttendancePhoto, 'id'>) };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `attendancePhotos/${photoId}`);
  }
}

export async function deleteAttendancePhoto(photoId: string, actor: Employee): Promise<void> {
  try {
    await deleteDoc(doc(db, 'attendancePhotos', photoId));
    await writeAuditLog({
      actor,
      action: 'DELETE_ATTENDANCE_PHOTO',
      entityType: 'AttendancePhoto',
      entityId: photoId,
      summary: `Deleted stored attendance photograph ${photoId}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `attendancePhotos/${photoId}`);
  }
}

export async function uploadMediaAsset(params: {
  ownerUid: string;
  assetType: 'company_logo' | 'profile_photo' | 'attachment';
  fileName: string;
  mimeType: string;
  dataUrl: string;
}): Promise<string> {
  const id = makeSafeId('asset');
  try {
    await setDoc(doc(db, 'mediaAssets', id), {
      ownerUid: params.ownerUid,
      assetType: params.assetType,
      fileName: params.fileName.slice(0, 160),
      mimeType: params.mimeType.slice(0, 80),
      dataUrl: params.dataUrl,
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `mediaAssets/${id}`);
  }
}

export async function fetchMediaAsset(assetId: string): Promise<MediaAsset | null> {
  if (!assetId) return null;
  try {
    const snap = await getDoc(doc(db, 'mediaAssets', assetId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<MediaAsset, 'id'>) };
  } catch (err) {
    console.warn('Media asset fetch warning:', err);
    return null;
  }
}

export async function editAttendanceDirectly(params: {
  employee: Employee;
  date: string;
  punchInHHmm: string;
  punchOutHHmm: string;
  status: AttendanceStatus;
  notes: string;
  actor: Employee;
}): Promise<void> {
  const recordId = `${params.employee.id}_${params.date}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const punchInIso = params.punchInHHmm ? `${params.date}T${params.punchInHHmm}:00` : undefined;
  const punchOutIso = params.punchOutHHmm ? `${params.date}T${params.punchOutHHmm}:00` : undefined;

  let workingMinutes = 0;
  if (punchInIso && punchOutIso) {
    const diff = (new Date(punchOutIso).getTime() - new Date(punchInIso).getTime()) / 60000;
    workingMinutes = Number.isFinite(diff) ? Math.max(0, Math.min(1440, Math.round(diff))) : 0;
  }

  try {
    const prevSnap = await getDoc(doc(db, 'attendanceRecords', recordId));
    const prev = prevSnap.exists() ? (prevSnap.data() as AttendanceRecord) : null;

    await setDoc(
      doc(db, 'attendanceRecords', recordId),
      cleanObject({
        employeeId: params.employee.id,
        employeeUid: params.employee.uid || prev?.employeeUid || params.employee.id,
        employeeName: params.employee.fullName,
        department: params.employee.department,
        managerUid: params.employee.managerUid,
        date: params.date,
        timezone: params.employee.timezone || 'Asia/Kolkata',
        punchInTime: punchInIso || prev?.punchInTime,
        punchInLat: prev?.punchInLat,
        punchInLng: prev?.punchInLng,
        punchInAccuracy: prev?.punchInAccuracy,
        punchInPhotoId: prev?.punchInPhotoId,
        punchOutTime: punchOutIso || prev?.punchOutTime,
        punchOutLat: prev?.punchOutLat,
        punchOutLng: prev?.punchOutLng,
        punchOutAccuracy: prev?.punchOutAccuracy,
        punchOutPhotoId: prev?.punchOutPhotoId,
        workingMinutes,
        status: params.status,
        isLate: params.status === 'Late',
        lateByMinutes: prev?.lateByMinutes || 0,
        notes: params.notes.slice(0, 500),
        createdAt: prev?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await writeAuditLog({
      actor: params.actor,
      action: 'EDIT_ATTENDANCE',
      entityType: 'AttendanceRecord',
      entityId: recordId,
      previousValues: prev
        ? { status: prev.status, punchInTime: prev.punchInTime || '', punchOutTime: prev.punchOutTime || '', workingMinutes: prev.workingMinutes }
        : { status: 'None' },
      updatedValues: {
        status: params.status,
        punchInTime: punchInIso || '',
        punchOutTime: punchOutIso || '',
        workingMinutes,
      },
      summary: `Edited attendance for ${params.employee.fullName} on ${params.date} (${params.status})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `attendanceRecords/${recordId}`);
  }
}

export async function submitAttendanceCorrection(params: {
  employee: Employee;
  date: string;
  requestedPunchIn: string;
  requestedPunchOut: string;
  reason: string;
  attachmentAssetId?: string;
}): Promise<void> {
  const id = makeSafeId('corr');
  const recordId = `${params.employee.id}_${params.date}`.replace(/[^a-zA-Z0-9_-]/g, '');
  try {
    await setDoc(
      doc(db, 'attendanceCorrections', id),
      cleanObject({
        employeeId: params.employee.id,
        employeeUid: params.employee.uid,
        employeeName: params.employee.fullName,
        department: params.employee.department,
        managerUid: params.employee.managerUid,
        date: params.date,
        attendanceRecordId: recordId,
        requestedPunchIn: params.requestedPunchIn,
        requestedPunchOut: params.requestedPunchOut,
        reason: params.reason.trim().slice(0, 500),
        attachmentAssetId: params.attachmentAssetId,
        status: 'Pending',
        createdAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `attendanceCorrections/${id}`);
  }
}

export async function fetchAttendanceCorrections(employee: Employee): Promise<AttendanceCorrection[]> {
  try {
    const q =
      employee.role === 'super_admin' || employee.role === 'team_leader'
        ? query(collection(db, 'attendanceCorrections'), orderBy('createdAt', 'desc'), limit(200))
        : query(collection(db, 'attendanceCorrections'), where('employeeUid', '==', employee.uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AttendanceCorrection, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'attendanceCorrections');
  }
}

export async function reviewAttendanceCorrection(params: {
  correction: AttendanceCorrection;
  decision: 'Approved' | 'Rejected';
  comment: string;
  actor: Employee;
  settings: CompanySettings;
}): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const corrRef = doc(db, 'attendanceCorrections', params.correction.id);
      const corrSnap = await tx.get(corrRef);
      if (!corrSnap.exists()) throw new Error('Correction request not found');
      const corrData = corrSnap.data() as AttendanceCorrection;
      if (corrData.status !== 'Pending') {
        throw new Error('This correction request has already been reviewed.');
      }

      const recRef = doc(db, 'attendanceRecords', corrData.attendanceRecordId);
      const recSnap = await tx.get(recRef);

      tx.update(corrRef, cleanObject({
        status: params.decision,
        reviewedBy: params.actor.uid,
        reviewedByName: params.actor.fullName,
        reviewComment: params.comment.trim().slice(0, 500),
        reviewedAt: serverTimestamp(),
      }));

      if (params.decision === 'Approved') {
        const punchInIso = `${corrData.date}T${corrData.requestedPunchIn}:00`;
        const punchOutIso = `${corrData.date}T${corrData.requestedPunchOut}:00`;
        const workingMinutes = Math.max(
          0,
          Math.min(1440, Math.round((new Date(punchOutIso).getTime() - new Date(punchInIso).getTime()) / 60000))
        );
        const fullDayMin = (params.settings.fullDayMinHours || 8) * 60;
        const nextStatus: AttendanceStatus = workingMinutes >= fullDayMin ? 'Present' : 'Half Day';

        const prevRec = recSnap.exists() ? (recSnap.data() as AttendanceRecord) : null;
        tx.set(
          recRef,
          cleanObject({
            employeeId: corrData.employeeId,
            employeeUid: corrData.employeeUid,
            employeeName: corrData.employeeName,
            department: corrData.department,
            managerUid: corrData.managerUid,
            date: corrData.date,
            timezone: prevRec?.timezone || 'Asia/Kolkata',
            punchInTime: punchInIso,
            punchInLat: prevRec?.punchInLat,
            punchInLng: prevRec?.punchInLng,
            punchInAccuracy: prevRec?.punchInAccuracy,
            punchInPhotoId: prevRec?.punchInPhotoId,
            punchOutTime: punchOutIso,
            punchOutLat: prevRec?.punchOutLat,
            punchOutLng: prevRec?.punchOutLng,
            punchOutAccuracy: prevRec?.punchOutAccuracy,
            punchOutPhotoId: prevRec?.punchOutPhotoId,
            workingMinutes,
            status: nextStatus,
            isLate: false,
            lateByMinutes: 0,
            notes: `Correction approved: ${params.comment || corrData.reason}`.slice(0, 500),
            createdAt: prevRec?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    });

    await writeAuditLog({
      actor: params.actor,
      action: `CORRECTION_${params.decision.toUpperCase()}`,
      entityType: 'AttendanceCorrection',
      entityId: params.correction.id,
      previousValues: { status: 'Pending' },
      updatedValues: {
        status: params.decision,
        requestedPunchIn: params.correction.requestedPunchIn,
        requestedPunchOut: params.correction.requestedPunchOut,
      },
      summary: `${params.decision} attendance correction for ${params.correction.employeeName} (${params.correction.date})`,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('already been reviewed')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `attendanceCorrections/${params.correction.id}`);
  }
}

export async function applyForLeave(params: {
  employee: Employee;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  attachmentAssetId?: string;
}): Promise<void> {
  const id = makeSafeId('leave');
  try {
    await setDoc(
      doc(db, 'leaveApplications', id),
      cleanObject({
        employeeId: params.employee.id,
        employeeUid: params.employee.uid,
        employeeName: params.employee.fullName,
        department: params.employee.department,
        managerUid: params.employee.managerUid,
        leaveType: params.leaveType,
        startDate: params.startDate,
        endDate: params.endDate,
        days: params.days,
        reason: params.reason.trim().slice(0, 500),
        attachmentAssetId: params.attachmentAssetId,
        status: 'Pending' as LeaveStatus,
        balanceDeducted: false,
        deductedAmount: 0,
        createdAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `leaveApplications/${id}`);
  }
}

export async function fetchLeaveApplications(employee: Employee): Promise<LeaveApplication[]> {
  try {
    const q =
      employee.role === 'super_admin' || employee.role === 'team_leader'
        ? query(collection(db, 'leaveApplications'), orderBy('createdAt', 'desc'), limit(300))
        : query(collection(db, 'leaveApplications'), where('employeeUid', '==', employee.uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeaveApplication, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'leaveApplications');
  }
}

export async function cancelPendingLeave(leaveId: string, actor: Employee): Promise<void> {
  try {
    await updateDoc(doc(db, 'leaveApplications', leaveId), {
      status: 'Cancelled',
    });
    await writeAuditLog({
      actor,
      action: 'CANCEL_LEAVE',
      entityType: 'LeaveApplication',
      entityId: leaveId,
      previousValues: { status: 'Pending' },
      updatedValues: { status: 'Cancelled' },
      summary: `${actor.fullName} cancelled pending leave application ${leaveId}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `leaveApplications/${leaveId}`);
  }
}

export async function reviewLeaveApplication(params: {
  leave: LeaveApplication;
  decision: 'Approved' | 'Rejected' | 'Cancelled';
  comment: string;
  actor: Employee;
}): Promise<void> {
  const actorUid = auth.currentUser?.uid || params.actor.uid;
  try {
    await runTransaction(db, async (tx) => {
      const leaveRef = doc(db, 'leaveApplications', params.leave.id);
      const leaveSnap = await tx.get(leaveRef);
      if (!leaveSnap.exists()) throw new Error('Leave application not found');
      const current = leaveSnap.data() as LeaveApplication;

      const empRef = doc(db, 'employees', current.employeeId);
      const empSnap = await tx.get(empRef);
      if (!empSnap.exists()) throw new Error('Employee record not found');
      const emp = empSnap.data() as Employee;

      // Perform all reads BEFORE any writes in the Firestore transaction
      const dedId = `ded_${params.leave.id}`.replace(/[^a-zA-Z0-9_-]/g, '');
      const dedRef = doc(db, 'leaveLedger', dedId);
      const revId = `rev_${params.leave.id}`.replace(/[^a-zA-Z0-9_-]/g, '');
      const revRef = doc(db, 'leaveLedger', revId);

      const dedSnap =
        params.decision === 'Approved' && !current.balanceDeducted && (current.leaveType === 'SL' || current.leaveType === 'CL')
          ? await tx.get(dedRef)
          : null;
      const revSnap =
        params.decision === 'Cancelled' &&
        current.status === 'Approved' &&
        current.balanceDeducted &&
        current.deductedAmount > 0 &&
        (current.leaveType === 'SL' || current.leaveType === 'CL')
          ? await tx.get(revRef)
          : null;

      const leaveDates =
        params.decision === 'Approved' ? enumerateDates(current.startDate, current.endDate) : [];
      const existingAttSnaps =
        leaveDates.length > 0
          ? await Promise.all(
              leaveDates.map((dateStr) => {
                const recId = `${current.employeeId}_${dateStr}`.replace(/[^a-zA-Z0-9_-]/g, '');
                return tx.get(doc(db, 'attendanceRecords', recId));
              })
            )
          : [];

      const leaveMonth =
        current.startDate && current.startDate.length >= 7
          ? current.startDate.slice(0, 7)
          : getTodayInTimezone(emp.timezone || 'Asia/Kolkata').slice(0, 7);
      const leaveYear = Number(leaveMonth.slice(0, 4)) || new Date().getUTCFullYear();
      const empEmail = (emp.email || `${current.employeeId}@talentgrade.local`).trim().toLowerCase().slice(0, 120);
      const empName = (current.employeeName || emp.fullName || 'Employee').trim().slice(0, 120);
      const actorName = (params.actor.fullName || params.actor.email || 'Admin').trim().slice(0, 120);
      const targetEmployeeUid = current.employeeUid || emp.uid || current.employeeId;

      if (params.decision === 'Approved') {
        if (current.status !== 'Pending') {
          throw new Error('Only pending applications can be approved.');
        }
        let deductedAmount = 0;
        let balanceDeducted = false;

        if (!current.balanceDeducted && (current.leaveType === 'SL' || current.leaveType === 'CL')) {
          deductedAmount = current.days;
          balanceDeducted = true;
          const prevBal = round2(
            current.leaveType === 'SL' ? emp.sickLeaveBalance : emp.casualLeaveBalance
          );
          const nextBal = round2(prevBal - deductedAmount);

          if (current.leaveType === 'SL') {
            tx.update(empRef, {
              sickLeaveBalance: nextBal,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.update(empRef, {
              casualLeaveBalance: nextBal,
              updatedAt: serverTimestamp(),
            });
          }

          if (dedSnap && !dedSnap.exists()) {
            tx.set(
              dedRef,
              cleanObject({
                employeeId: current.employeeId,
                employeeUid: targetEmployeeUid,
                employeeEmail: empEmail,
                employeeName: empName,
                leaveType: current.leaveType,
                entryType: 'approved_deduction',
                month: leaveMonth,
                year: leaveYear,
                amount: round2(-deductedAmount),
                balanceBefore: prevBal,
                balanceAfter: nextBal,
                source: 'leave_approval',
                referenceId: params.leave.id,
                reason: `Approved ${current.leaveType} leave (${current.startDate} to ${current.endDate}, ${deductedAmount}d)`,
                createdBy: actorUid,
                createdByName: actorName,
                createdAt: serverTimestamp(),
              })
            );
          }
        }

        tx.update(leaveRef, cleanObject({
          status: 'Approved',
          balanceDeducted,
          deductedAmount,
          reviewedBy: params.actor.uid,
          reviewedByName: actorName,
          reviewComment: params.comment.trim().slice(0, 500),
          reviewedAt: serverTimestamp(),
        }));

        leaveDates.forEach((dateStr, idx) => {
          const recId = `${current.employeeId}_${dateStr}`.replace(/[^a-zA-Z0-9_-]/g, '');
          const recRef = doc(db, 'attendanceRecords', recId);
          const existingSnap = existingAttSnaps[idx];
          const existingCreatedAt = existingSnap?.exists() ? existingSnap.data()?.createdAt : undefined;
          tx.set(
            recRef,
            cleanObject({
              employeeId: current.employeeId,
              employeeUid: targetEmployeeUid,
              employeeName: empName,
              department: current.department || emp.department || 'Operations',
              managerUid: current.managerUid,
              date: dateStr,
              timezone: emp.timezone || 'Asia/Kolkata',
              workingMinutes: 0,
              status: 'Leave' as AttendanceStatus,
              isLate: false,
              lateByMinutes: 0,
              notes: `Approved ${current.leaveType} leave`,
              createdAt: existingCreatedAt || serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          );
        });
      } else if (params.decision === 'Rejected') {
        if (current.status !== 'Pending') {
          throw new Error('Only pending applications can be rejected.');
        }
        tx.update(leaveRef, cleanObject({
          status: 'Rejected',
          balanceDeducted: false,
          deductedAmount: 0,
          reviewedBy: params.actor.uid,
          reviewedByName: actorName,
          reviewComment: params.comment.trim().slice(0, 500),
          reviewedAt: serverTimestamp(),
        }));
      } else if (params.decision === 'Cancelled') {
        if (current.status === 'Approved' && current.balanceDeducted && current.deductedAmount > 0) {
          const prevBal = round2(
            current.leaveType === 'SL' ? emp.sickLeaveBalance : emp.casualLeaveBalance
          );
          const restoredBal = round2(prevBal + current.deductedAmount);

          if (current.leaveType === 'SL') {
            tx.update(empRef, {
              sickLeaveBalance: restoredBal,
              updatedAt: serverTimestamp(),
            });
          } else if (current.leaveType === 'CL') {
            tx.update(empRef, {
              casualLeaveBalance: restoredBal,
              updatedAt: serverTimestamp(),
            });
          }

          if (revSnap && !revSnap.exists()) {
            tx.set(
              revRef,
              cleanObject({
                employeeId: current.employeeId,
                employeeUid: targetEmployeeUid,
                employeeEmail: empEmail,
                employeeName: empName,
                leaveType: current.leaveType,
                entryType: 'leave_reversal',
                month: leaveMonth,
                year: leaveYear,
                amount: round2(current.deductedAmount),
                balanceBefore: prevBal,
                balanceAfter: restoredBal,
                source: 'leave_reversal',
                referenceId: params.leave.id,
                reason: `Reversed approved ${current.leaveType} leave (${current.startDate} to ${current.endDate}, +${current.deductedAmount}d restored)`,
                createdBy: actorUid,
                createdByName: actorName,
                createdAt: serverTimestamp(),
              })
            );
          }
        }
        tx.update(leaveRef, cleanObject({
          status: 'Cancelled',
          balanceDeducted: false,
          deductedAmount: 0,
          reviewedBy: params.actor.uid,
          reviewedByName: params.actor.fullName,
          reviewComment: params.comment.trim().slice(0, 500),
          reviewedAt: serverTimestamp(),
        }));
      }
    });

    await writeAuditLog({
      actor: params.actor,
      action: `LEAVE_${params.decision.toUpperCase()}`,
      entityType: 'LeaveApplication',
      entityId: params.leave.id,
      previousValues: { status: params.leave.status },
      updatedValues: { status: params.decision },
      summary: `${params.decision} ${params.leave.leaveType} leave (${params.leave.days}d) for ${params.leave.employeeName}`,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Only pending')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `leaveApplications/${params.leave.id}`);
  }
}

export async function fetchEmployeeSalary(employeeId: string): Promise<EmployeeSalary | null> {
  try {
    const snap = await getDoc(doc(db, 'employeeSalaries', employeeId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<EmployeeSalary, 'id'>) };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `employeeSalaries/${employeeId}`);
  }
}

export async function fetchAllSalaries(): Promise<EmployeeSalary[]> {
  try {
    const snap = await getDocs(collection(db, 'employeeSalaries'));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmployeeSalary, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'employeeSalaries');
  }
}

export async function saveEmployeeSalary(
  params: {
    employee: Employee;
    currency?: string;
    basicSalary: number;
    hra: number;
    otherEarnings: SalaryLineItem[];
    deductions: SalaryLineItem[];
    professionalTax: number;
    defaultBonus: number;
  },
  actor: Employee
): Promise<EmployeeSalary> {
  const basicSalary = Number(params.basicSalary);
  const hra = Number(params.hra);
  const professionalTax = Number(params.professionalTax);
  const defaultBonus = Number(params.defaultBonus);
  if (
    !Number.isFinite(basicSalary) ||
    !Number.isFinite(hra) ||
    !Number.isFinite(professionalTax) ||
    !Number.isFinite(defaultBonus) ||
    basicSalary < 0 ||
    hra < 0 ||
    professionalTax < 0 ||
    defaultBonus < 0
  ) {
    throw new Error('Salary fields must be valid non-negative numbers.');
  }

  const safeOtherEarnings = params.otherEarnings.slice(0, 15).map((item) => ({
    label: String(item.label || '').trim().slice(0, 80),
    amount: Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 ? Number(item.amount) : 0,
  }));
  const safeDeductions = params.deductions.slice(0, 15).map((item) => ({
    label: String(item.label || '').trim().slice(0, 80),
    amount: Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 ? Number(item.amount) : 0,
  }));

  const gross =
    basicSalary +
    hra +
    defaultBonus +
    safeOtherEarnings.reduce((sum, i) => sum + i.amount, 0);
  const totalDed =
    professionalTax +
    safeDeductions.reduce((sum, i) => sum + i.amount, 0);
  const netSalary = gross - totalDed;
  const currency = params.currency || params.employee.currency || 'INR';

  const payload = {
    employeeId: params.employee.id,
    employeeUid: params.employee.uid || '',
    currency,
    basicSalary,
    hra,
    otherEarnings: safeOtherEarnings,
    deductions: safeDeductions,
    professionalTax,
    defaultBonus,
    netSalary,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };

  try {
    await setDoc(doc(db, 'employeeSalaries', params.employee.id), payload);
    await writeAuditLog({
      actor,
      action: 'UPDATE_SALARY_CONFIG',
      entityType: 'EmployeeSalary',
      entityId: params.employee.id,
      updatedValues: { currency, basicSalary: payload.basicSalary, netSalary: payload.netSalary },
      summary: `Updated salary configuration for ${params.employee.fullName} (Net: ${currency} ${netSalary})`,
    });
    return { id: params.employee.id, ...payload };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `employeeSalaries/${params.employee.id}`);
  }
}

export async function fetchPayrollRecords(
  employee: Employee,
  canViewSalary = false
): Promise<PayrollRecord[]> {
  try {
    let q;
    if (employee.role === 'super_admin' || (employee.role === 'team_leader' && canViewSalary)) {
      q = query(collection(db, 'payrollRecords'), orderBy('month', 'desc'));
    } else {
      q = query(
        collection(db, 'payrollRecords'),
        where('employeeUid', '==', employee.uid),
        where('status', '==', 'Published')
      );
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PayrollRecord, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'payrollRecords');
  }
}

export async function savePayrollRecord(
  params: {
    employee: Employee;
    month: string;
    currency?: string;
    basicSalary: number;
    hra: number;
    otherEarnings: SalaryLineItem[];
    bonus: number;
    deductions: SalaryLineItem[];
    professionalTax: number;
    workingDaysInMonth: number;
    presentDays: number;
    leaveDays: number;
    status: PayrollStatus;
    notes?: string;
    revisionReason?: string;
  },
  actor: Employee
): Promise<PayrollRecord> {
  const id = `${params.employee.id}_${params.month}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const basicSalary = Number(params.basicSalary);
  const hra = Number(params.hra);
  const bonus = Number(params.bonus);
  const professionalTax = Number(params.professionalTax);
  const workingDaysInMonth = Number(params.workingDaysInMonth);
  const presentDays = Number(params.presentDays);
  const leaveDays = Number(params.leaveDays);

  if (
    !Number.isFinite(basicSalary) ||
    !Number.isFinite(hra) ||
    !Number.isFinite(bonus) ||
    !Number.isFinite(professionalTax) ||
    !Number.isFinite(workingDaysInMonth) ||
    !Number.isFinite(presentDays) ||
    !Number.isFinite(leaveDays) ||
    basicSalary < 0 ||
    hra < 0 ||
    bonus < 0 ||
    professionalTax < 0 ||
    workingDaysInMonth < 0 ||
    workingDaysInMonth > 31 ||
    presentDays < 0 ||
    presentDays > 31 ||
    leaveDays < 0 ||
    leaveDays > 31
  ) {
    throw new Error('Payroll monetary and attendance day values must be valid finite numbers.');
  }

  const safeOtherEarnings = params.otherEarnings.slice(0, 15).map((item) => ({
    label: String(item.label || '').trim().slice(0, 80),
    amount: Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 ? Number(item.amount) : 0,
  }));
  const safeDeductions = params.deductions.slice(0, 15).map((item) => ({
    label: String(item.label || '').trim().slice(0, 80),
    amount: Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 ? Number(item.amount) : 0,
  }));

  const grossEarnings =
    basicSalary +
    hra +
    bonus +
    safeOtherEarnings.reduce((s, x) => s + x.amount, 0);
  const totalDeductions =
    professionalTax +
    safeDeductions.reduce((s, x) => s + x.amount, 0);
  const netSalary = grossEarnings - totalDeductions;
  const currency = params.currency || params.employee.currency || 'INR';

  try {
    const existingSnap = await getDoc(doc(db, 'payrollRecords', id));
    const prev = existingSnap.exists() ? (existingSnap.data() as PayrollRecord) : null;

    if (prev && prev.status !== 'Draft' && !params.revisionReason?.trim()) {
      throw new Error('A revision reason is required to modify finalized or published payroll.');
    }

    const payload = cleanObject({
      employeeId: params.employee.id,
      employeeUid: params.employee.uid || '',
      employeeName: params.employee.fullName,
      employeeCode: params.employee.employeeCode,
      designation: params.employee.designation,
      department: params.employee.department,
      location: params.employee.location || 'India',
      currency,
      month: params.month,
      basicSalary,
      hra,
      otherEarnings: safeOtherEarnings,
      bonus,
      deductions: safeDeductions,
      professionalTax,
      grossEarnings,
      totalDeductions,
      netSalary,
      workingDaysInMonth,
      presentDays,
      leaveDays,
      status: params.status,
      notes: params.notes?.trim().slice(0, 500) || undefined,
      createdBy: prev?.createdBy || actor.uid,
      createdAt: prev?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: params.status === 'Published' ? serverTimestamp() : prev?.publishedAt,
    });

    await setDoc(doc(db, 'payrollRecords', id), payload);

    await writeAuditLog({
      actor,
      action: prev ? `PAYROLL_UPDATE_${params.status.toUpperCase()}` : `PAYROLL_CREATE_${params.status.toUpperCase()}`,
      entityType: 'PayrollRecord',
      entityId: id,
      previousValues: prev ? { status: prev.status, netSalary: prev.netSalary, currency: prev.currency || 'INR' } : undefined,
      updatedValues: { status: params.status, netSalary, currency, revisionReason: params.revisionReason || '' },
      summary: `${params.status} payroll for ${params.employee.fullName} (${params.month}) · Net ${currency} ${netSalary}${params.revisionReason ? ` · Reason: ${params.revisionReason}` : ''}`,
    });

    return { id, ...(payload as Omit<PayrollRecord, 'id'>) };
  } catch (err) {
    if (err instanceof Error && err.message.includes('revision reason')) throw err;
    handleFirestoreError(err, OperationType.WRITE, `payrollRecords/${id}`);
  }
}

export async function generatePayslipPdfBlob(payslip: PayrollRecord, settings: CompanySettings | null): Promise<Blob> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  let logoDataUrl: string | undefined;
  if (settings?.logoAssetId) {
    const logoAsset = await fetchMediaAsset(settings.logoAssetId);
    logoDataUrl = logoAsset?.dataUrl;
  }

  const sendRequest = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch('/api/payslips/pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        payslip,
        company: settings,
        logoDataUrl,
      }),
    });
  };

  let res = await sendRequest(false);
  if (res.status === 401) {
    res = await sendRequest(true);
  }

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const errBody = await res.json().catch(() => null);
      if (errBody && typeof errBody.error === 'string') {
        throw new Error(errBody.error);
      }
    }
    throw new Error(`Failed to generate payslip PDF (HTTP ${res.status})`);
  }
  return res.blob();
}

export async function fetchLeaveLedger(currentEmployee: Employee): Promise<LeaveLedgerEntry[]> {
  try {
    const byId = new Map<string, LeaveLedgerEntry>();
    const email = (currentEmployee.email || '').trim().toLowerCase();

    if (currentEmployee.role === 'super_admin' || currentEmployee.role === 'team_leader') {
      const snap = await getDocs(
        query(collection(db, 'leaveLedger'), orderBy('month', 'desc'), limit(500))
      );
      snap.docs.forEach((d) =>
        byId.set(d.id, { id: d.id, ...(d.data() as Omit<LeaveLedgerEntry, 'id'>) })
      );
    } else {
      const queries = [
        query(collection(db, 'leaveLedger'), where('employeeUid', '==', currentEmployee.uid)),
      ];
      if (auth.currentUser?.emailVerified && email) {
        queries.push(query(collection(db, 'leaveLedger'), where('employeeEmail', '==', email)));
      }
      const snaps = await Promise.all(queries.map((q) => getDocs(q)));
      for (const snap of snaps) {
        snap.docs.forEach((d) =>
          byId.set(d.id, { id: d.id, ...(d.data() as Omit<LeaveLedgerEntry, 'id'>) })
        );
      }
    }

    return Array.from(byId.values()).sort((a, b) => {
      const cmp = b.month.localeCompare(a.month);
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'leaveLedger');
  }
}

export async function computeLeaveAccrualsOnServer(params: {
  employees: Employee[];
  policy?: LeavePolicyConfig | null;
  existingLedger: LeaveLedgerEntry[];
  approvedLeaves: LeaveApplication[];
  actor: Employee;
  isNewEmployeeInit?: boolean;
}): Promise<{
  serverTimeIso: string;
  policy: LeavePolicyConfig;
  plans: EmployeeAccrualPlan[];
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const sendRequest = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch('/api/leave/accrual/compute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        employees: params.employees,
        policy: normalizeLeavePolicyConfig(params.policy),
        existingLedger: params.existingLedger,
        approvedLeaves: params.approvedLeaves.filter((l) => l.status === 'Approved'),
        actor: { uid: user.uid, name: params.actor.fullName },
        isNewEmployeeInit: Boolean(params.isNewEmployeeInit),
      }),
    });
  };

  let res = await sendRequest(false);
  if (res.status === 401) {
    res = await sendRequest(true);
  }

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const errBody = await res.json().catch(() => null);
      if (errBody && typeof errBody.error === 'string') {
        throw new Error(errBody.error);
      }
    }
    throw new Error(`Failed to compute leave accruals from server (HTTP ${res.status})`);
  }
  return res.json();
}

export async function runServerLeaveAccrualSync(params: {
  actor: Employee;
  employees: Employee[];
  settings: CompanySettings;
  existingLedger: LeaveLedgerEntry[];
  leaves: LeaveApplication[];
}): Promise<{
  serverTimeIso: string;
  plans: EmployeeAccrualPlan[];
  committedEntriesCount: number;
  updatedEmployeesCount: number;
}> {
  const computed = await computeLeaveAccrualsOnServer({
    employees: params.employees,
    policy: params.settings.leavePolicy,
    existingLedger: params.existingLedger,
    approvedLeaves: params.leaves,
    actor: params.actor,
  });

  let committedEntriesCount = 0;
  let updatedEmployeesCount = 0;

  if (params.actor.role !== 'super_admin') {
    return {
      serverTimeIso: computed.serverTimeIso,
      plans: computed.plans,
      committedEntriesCount: 0,
      updatedEmployeesCount: 0,
    };
  }

  const actorUid = auth.currentUser?.uid || params.actor.uid || 'system';
  const actorName = (params.actor.fullName || params.actor.email || 'Super Admin').trim().slice(0, 120);
  const syncErrors: string[] = [];

  for (const plan of computed.plans) {
    if (!plan.hasChanges) continue;

    try {
      const committed = await runTransaction(db, async (tx) => {
        const empRef = doc(db, 'employees', plan.employeeId);
        const empSnap = await tx.get(empRef);
        if (!empSnap.exists()) return { entries: 0, updated: false };

        const ledgerReads = await Promise.all(
          plan.newLedgerEntries.map((entry) => tx.get(doc(db, 'leaveLedger', entry.id)))
        );

        const missingEntries = plan.newLedgerEntries.filter((_, idx) => !ledgerReads[idx].exists());
        const currentEmp = empSnap.data() as Employee;
        const needsEmpUpdate =
          missingEntries.length > 0 ||
          round2(currentEmp.sickLeaveBalance) !== round2(plan.employeeUpdates.sickLeaveBalance) ||
          round2(currentEmp.casualLeaveBalance) !== round2(plan.employeeUpdates.casualLeaveBalance) ||
          round2(currentEmp.carryForwardBalance) !== round2(plan.employeeUpdates.carryForwardBalance) ||
          !currentEmp.leavePolicyMigrated ||
          currentEmp.leaveBaselineMonth !== plan.employeeUpdates.leaveBaselineMonth ||
          currentEmp.leaveLastSyncedMonth !== plan.employeeUpdates.leaveLastSyncedMonth ||
          currentEmp.leaveLastResetYear !== plan.employeeUpdates.leaveLastResetYear ||
          currentEmp.clEligibilityDate !== plan.employeeUpdates.clEligibilityDate;

        if (!needsEmpUpdate && missingEntries.length === 0) {
          return { entries: 0, updated: false };
        }

        for (const entry of missingEntries) {
          const { id: entryDocId, ...entryFields } = entry;
          const ledgerRef = doc(db, 'leaveLedger', entryDocId);
          tx.set(
            ledgerRef,
            cleanObject({
              ...entryFields,
              employeeId: plan.employeeId,
              employeeUid: entryFields.employeeUid || currentEmp.uid || '',
              employeeEmail: (entryFields.employeeEmail || currentEmp.email || `${plan.employeeId}@talentgrade.local`)
                .trim()
                .toLowerCase()
                .slice(0, 120),
              employeeName: (entryFields.employeeName || currentEmp.fullName || 'Employee').trim().slice(0, 120),
              amount: round2(entryFields.amount),
              balanceBefore:
                typeof entryFields.balanceBefore === 'number' ? round2(entryFields.balanceBefore) : undefined,
              balanceAfter:
                typeof entryFields.balanceAfter === 'number' ? round2(entryFields.balanceAfter) : undefined,
              year: Number(entryFields.year) || new Date().getUTCFullYear(),
              createdBy: actorUid,
              createdByName: actorName,
              createdAt: serverTimestamp(),
            } as unknown as Record<string, unknown>)
          );
        }

        if (needsEmpUpdate) {
          tx.update(
            empRef,
            cleanObject({
              ...plan.employeeUpdates,
              updatedAt: serverTimestamp(),
            })
          );
        }

        return { entries: missingEntries.length, updated: needsEmpUpdate };
      });

      committedEntriesCount += committed.entries;
      if (committed.updated) updatedEmployeesCount += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Accrual transaction failed for ${plan.employeeId}:`, err);
      syncErrors.push(`${plan.employeeId}: ${msg}`);
    }
  }

  if (committedEntriesCount > 0) {
    await writeAuditLog({
      actor: params.actor,
      action: 'SYNC_LEAVE_ACCRUALS',
      entityType: 'LeaveLedger',
      entityId: 'accrual_sync',
      updatedValues: {
        committedEntriesCount,
        updatedEmployeesCount,
        serverTimeIso: computed.serverTimeIso,
      },
      summary: `Synchronized ${committedEntriesCount} leave policy ledger entry/entries across ${updatedEmployeesCount} employee(s).`,
    });
  }

  if (syncErrors.length > 0) {
    throw new Error(`Leave accrual sync failed for ${syncErrors.length} employee(s): ${syncErrors[0]}`);
  }

  return {
    serverTimeIso: computed.serverTimeIso,
    plans: computed.plans,
    committedEntriesCount,
    updatedEmployeesCount,
  };
}

export async function adjustEmployeeLeaveBalance(params: {
  targetEmployee: Employee;
  leaveType: 'SL' | 'CL';
  delta: number;
  targetBalance?: number;
  reason: string;
  actor: Employee;
  carryForwardDelta?: number;
}): Promise<void> {
  if (!params.reason.trim()) {
    throw new Error('A reason is required for manual leave adjustments.');
  }
  const hasTarget = typeof params.targetBalance === 'number' && Number.isFinite(params.targetBalance);
  const inputDelta = Number(params.delta);
  if (!hasTarget && !Number.isFinite(inputDelta)) {
    throw new Error('Adjustment amount must be a valid number.');
  }
  const cfDelta =
    typeof params.carryForwardDelta === 'number' && Number.isFinite(params.carryForwardDelta)
      ? round2(params.carryForwardDelta)
      : 0;

  if (!hasTarget && round2(inputDelta) === 0 && cfDelta === 0) {
    throw new Error('Adjustment amount cannot be zero.');
  }

  const actorUid = auth.currentUser?.uid || params.actor.uid || 'system';
  const actorName = (params.actor.fullName || params.actor.email || 'Super Admin').trim().slice(0, 120);
  const todayLocal = getTodayInTimezone(params.targetEmployee.timezone || 'Asia/Kolkata');
  const currentMonth = todayLocal.slice(0, 7);
  const currentYear = Number(todayLocal.slice(0, 4)) || new Date().getUTCFullYear();
  const empEmail = (params.targetEmployee.email || `${params.targetEmployee.id}@talentgrade.local`)
    .trim()
    .toLowerCase()
    .slice(0, 120);
  const ledgerId = makeSafeId('adj');

  try {
    let previousVal = 0;
    let nextVal = 0;
    let appliedDelta = 0;

    await runTransaction(db, async (tx) => {
      const empRef = doc(db, 'employees', params.targetEmployee.id);
      const empSnap = await tx.get(empRef);
      if (!empSnap.exists()) throw new Error('Employee record not found');
      const emp = empSnap.data() as Employee;

      previousVal = round2(
        params.leaveType === 'SL' ? emp.sickLeaveBalance : emp.casualLeaveBalance
      );
      nextVal = hasTarget
        ? round2(params.targetBalance!)
        : round2(previousVal + inputDelta);
      appliedDelta = round2(nextVal - previousVal);

      if (appliedDelta === 0 && cfDelta === 0) {
        throw new Error('New balance equals the current balance; no change required.');
      }
      if (nextVal < -60 || nextVal > 365) {
        throw new Error('Resulting leave balance must be between -60 and 365 days.');
      }

      const nextCf =
        cfDelta !== 0
          ? Math.max(0, round2(Number(emp.carryForwardBalance ?? 0) + cfDelta))
          : Math.max(0, round2(Number(emp.carryForwardBalance ?? 0)));

      if (params.leaveType === 'SL') {
        tx.update(empRef, {
          sickLeaveBalance: nextVal,
          carryForwardBalance: nextCf,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(empRef, {
          casualLeaveBalance: nextVal,
          carryForwardBalance: nextCf,
          updatedAt: serverTimestamp(),
        });
      }

      if (appliedDelta !== 0) {
        const empName = (emp.fullName || params.targetEmployee.fullName || 'Employee').trim().slice(0, 120);
        tx.set(
          doc(db, 'leaveLedger', ledgerId),
          cleanObject({
            employeeId: snapIdOrFallback(empSnap.id, params.targetEmployee.id),
            employeeUid: emp.uid || '',
            employeeEmail: (emp.email || empEmail).trim().toLowerCase().slice(0, 120),
            employeeName: empName,
            leaveType: params.leaveType,
            entryType: 'admin_adjustment',
            month: currentMonth,
            year: currentYear,
            amount: appliedDelta,
            balanceBefore: previousVal,
            balanceAfter: nextVal,
            source: 'admin_manual',
            reason: params.reason.trim().slice(0, 500),
            createdBy: actorUid,
            createdByName: actorName,
            createdAt: serverTimestamp(),
          })
        );
      }
    });

    await writeAuditLog({
      actor: params.actor,
      action: 'ADJUST_LEAVE_BALANCE',
      entityType: 'Employee',
      entityId: params.targetEmployee.id,
      previousValues: { [params.leaveType]: previousVal },
      updatedValues: { [params.leaveType]: nextVal, delta: appliedDelta, reason: params.reason.trim() },
      summary: `Adjusted ${params.leaveType} balance for ${params.targetEmployee.fullName} by ${appliedDelta > 0 ? `+${appliedDelta}` : appliedDelta} (${previousVal} -> ${nextVal}). Reason: ${params.reason.trim()}`,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('no change') || err.message.includes('between -60'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `employees/${params.targetEmployee.id}`);
  }
}

function snapIdOrFallback(snapId: string | undefined, fallbackId: string): string {
  return (snapId && snapId.trim()) || fallbackId;
}

export async function resolveMigrationVariance(params: {
  targetEmployee: Employee;
  action: 'align' | 'dismiss';
  settings: CompanySettings;
  existingLedger: LeaveLedgerEntry[];
  leaves: LeaveApplication[];
  actor: Employee;
}): Promise<void> {
  const empRef = doc(db, 'employees', params.targetEmployee.id);
  const actorUid = auth.currentUser?.uid || params.actor.uid || 'system';
  const actorName = (params.actor.fullName || params.actor.email || 'Super Admin').trim().slice(0, 120);

  try {
    if (params.action === 'dismiss') {
      await updateDoc(empRef, {
        leaveMigrationNote: deleteField(),
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog({
        actor: params.actor,
        action: 'DISMISS_LEAVE_MIGRATION_NOTE',
        entityType: 'Employee',
        entityId: params.targetEmployee.id,
        summary: `Preserved existing leave balance for ${params.targetEmployee.fullName} and cleared migration variance notice.`,
      });
      return;
    }

    const computed = await computeLeaveAccrualsOnServer({
      employees: [params.targetEmployee],
      policy: params.settings.leavePolicy,
      existingLedger: params.existingLedger,
      approvedLeaves: params.leaves,
      actor: params.actor,
    });
    const summary: EmployeeLeaveComputedSummary | undefined = computed.plans[0]?.summary;
    if (!summary) return;

    const targetSl = round2(Math.max(0, summary.policyExpectedSlToDate - summary.slUsedThisYear));
    const targetCl = round2(Math.max(0, summary.policyExpectedClToDate - summary.clUsedTotal));

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(empRef);
      if (!snap.exists()) throw new Error('Employee not found');
      const emp = snap.data() as Employee;
      const empId = snapIdOrFallback(snap.id, params.targetEmployee.id);
      const prevSl = round2(Number(emp.sickLeaveBalance ?? 0));
      const prevCl = round2(Number(emp.casualLeaveBalance ?? 0));
      const slDelta = round2(targetSl - prevSl);
      const clDelta = round2(targetCl - prevCl);
      const empEmail = (emp.email || params.targetEmployee.email || `${empId}@talentgrade.local`)
        .trim()
        .toLowerCase()
        .slice(0, 120);
      const empName = (emp.fullName || params.targetEmployee.fullName || 'Employee').trim().slice(0, 120);
      const syncYear = Number(summary.currentYear) || new Date().getUTCFullYear();

      tx.update(empRef, {
        sickLeaveBalance: targetSl,
        casualLeaveBalance: targetCl,
        leaveMigrationNote: deleteField(),
        updatedAt: serverTimestamp(),
      });

      if (slDelta !== 0) {
        tx.set(
          doc(db, 'leaveLedger', makeSafeId('adj_mig_sl')),
          cleanObject({
            employeeId: empId,
            employeeUid: emp.uid || '',
            employeeEmail: empEmail,
            employeeName: empName,
            leaveType: 'SL',
            entryType: 'admin_adjustment',
            month: summary.currentMonth,
            year: syncYear,
            amount: slDelta,
            balanceBefore: prevSl,
            balanceAfter: targetSl,
            source: 'admin_manual',
            reason: `Aligned legacy Sick Leave balance to TalentGrade policy (${prevSl} -> ${targetSl})`,
            createdBy: actorUid,
            createdByName: actorName,
            createdAt: serverTimestamp(),
          })
        );
      }
      if (clDelta !== 0) {
        tx.set(
          doc(db, 'leaveLedger', makeSafeId('adj_mig_cl')),
          cleanObject({
            employeeId: empId,
            employeeUid: emp.uid || '',
            employeeEmail: empEmail,
            employeeName: empName,
            leaveType: 'CL',
            entryType: 'admin_adjustment',
            month: summary.currentMonth,
            year: syncYear,
            amount: clDelta,
            balanceBefore: prevCl,
            balanceAfter: targetCl,
            source: 'admin_manual',
            reason: `Aligned legacy Casual Leave balance to TalentGrade policy (${prevCl} -> ${targetCl})`,
            createdBy: actorUid,
            createdByName: actorName,
            createdAt: serverTimestamp(),
          })
        );
      }
    });

    await writeAuditLog({
      actor: params.actor,
      action: 'ALIGN_LEAVE_POLICY_BALANCE',
      entityType: 'Employee',
      entityId: params.targetEmployee.id,
      previousValues: {
        sickLeaveBalance: params.targetEmployee.sickLeaveBalance,
        casualLeaveBalance: params.targetEmployee.casualLeaveBalance,
      },
      updatedValues: { sickLeaveBalance: targetSl, casualLeaveBalance: targetCl },
      summary: `Aligned ${params.targetEmployee.fullName} leave balances to TalentGrade policy (SL ${targetSl}, CL ${targetCl}).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `employees/${params.targetEmployee.id}`);
  }
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  try {
    const snap = await getDocs(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(200)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLog, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'auditLogs');
  }
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

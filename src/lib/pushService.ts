import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  AttendanceRecord,
  AttendanceReminderLog,
  CompanySettings,
  DEFAULT_EMPLOYEE_REMINDER_PREFERENCES,
  Employee,
  EmployeeReminderPreferences,
  LeaveApplication,
  PushSubscriptionStatus,
} from '../types/hr';
import {
  normalizeAttendanceReminderSettings,
  normalizeEmployeeReminderPreferences,
} from '../../shared/attendanceReminderEngine';
import { cleanObject } from './hrService';

export type ReminderSetupState =
  | 'unsupported'
  | 'denied'
  | 'not_enabled'
  | 'permission_granted_needs_sub'
  | 'subscription_expired'
  | 'active';

export interface ServerSubscriptionSummary {
  id: string;
  endpoint: string;
  deviceLabel: string;
  status: PushSubscriptionStatus;
  updatedAtIso: string;
  lastFailureReason?: string;
}

export interface ReminderOverviewMetrics {
  enabled: boolean;
  activeEmployeesCount: number;
  subscribedEmployeesCount: number;
  activeDeviceSubscriptions: number;
  expiredDeviceSubscriptions: number;
  sentToday: number;
  failedToday: number;
  lastRunIso: string | null;
}

export interface ReminderBrowserInspection {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  state: ReminderSetupState;
  isStandalonePwa: boolean;
  currentDeviceSubscribed: boolean;
  currentEndpoint?: string;
  activeDeviceCount: number;
  expiredDeviceCount: number;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in first.');
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    window.isSecureContext
  );
}

export function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;
  const standaloneMatch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = Boolean((window.navigator as { standalone?: boolean }).standalone);
  return standaloneMatch || iosStandalone;
}

export function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser Device';
  const ua = navigator.userAgent || '';
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Chrome/') && !ua.includes('Edg/')
    ? 'Chrome'
    : ua.includes('Firefox/')
    ? 'Firefox'
    : ua.includes('Safari/') && !ua.includes('Chrome/')
    ? 'Safari'
    : 'Browser';

  const platform = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
    ? 'Android'
    : /Mac OS X/i.test(ua)
    ? 'macOS'
    : /Windows/i.test(ua)
    ? 'Windows'
    : /Linux/i.test(ua)
    ? 'Linux'
    : 'Device';

  return `${browser}${isInstalledPwa() ? ' PWA' : ''} on ${platform}`;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }

  let existing = await navigator.serviceWorker.getRegistration();
  if (!existing) {
    try {
      existing = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch {
      existing = await navigator.serviceWorker.register('/sw-push.js', { scope: '/' });
    }
  }

  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((_, reject) =>
      setTimeout(() => reject(new Error('Service worker activation timed out.')), 8000)
    ),
  ]);
  return ready;
}

export async function inspectReminderBrowserState(
  serverSubscriptions: ServerSubscriptionSummary[],
  prefs?: EmployeeReminderPreferences
): Promise<ReminderBrowserInspection> {
  const isStandalonePwa = isInstalledPwa();
  const normalizedPrefs = normalizeEmployeeReminderPreferences(prefs);

  if (!isPushSupported()) {
    return {
      supported: false,
      permission: 'unsupported',
      state: 'unsupported',
      isStandalonePwa,
      currentDeviceSubscribed: false,
      activeDeviceCount: 0,
      expiredDeviceCount: 0,
    };
  }

  const permission = Notification.permission;
  const activeSubs = serverSubscriptions.filter((s) => s.status === 'active');
  const expiredSubs = serverSubscriptions.filter((s) => s.status === 'expired');

  let browserSub: PushSubscription | null = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.pushManager) {
      browserSub = await reg.pushManager.getSubscription();
    }
  } catch {
    browserSub = null;
  }

  const currentEndpoint = browserSub?.endpoint;
  const matchingServerSub = currentEndpoint
    ? serverSubscriptions.find((s) => s.endpoint === currentEndpoint)
    : undefined;
  const currentDeviceSubscribed = Boolean(
    browserSub && (!matchingServerSub || matchingServerSub.status === 'active')
  );

  let state: ReminderSetupState = 'not_enabled';
  if (permission === 'denied') {
    state = 'denied';
  } else if (permission === 'default') {
    state = 'not_enabled';
  } else if (!normalizedPrefs.pushEnabled) {
    state = 'not_enabled';
  } else if (matchingServerSub?.status === 'expired' || (!currentDeviceSubscribed && expiredSubs.length > 0 && activeSubs.length === 0)) {
    state = 'subscription_expired';
  } else if (currentDeviceSubscribed && activeSubs.length > 0) {
    state = 'active';
  } else if (activeSubs.length > 0 && !browserSub) {
    // Active on another device, this browser hasn't subscribed yet
    state = 'permission_granted_needs_sub';
  } else {
    state = 'permission_granted_needs_sub';
  }

  return {
    supported: true,
    permission,
    state,
    isStandalonePwa,
    currentDeviceSubscribed,
    currentEndpoint,
    activeDeviceCount: activeSubs.length,
    expiredDeviceCount: expiredSubs.length,
  };
}

function buildEmployeeServerSnapshot(employee: Employee) {
  return {
    id: employee.id,
    uid: employee.uid,
    fullName: employee.fullName,
    role: employee.role,
    department: employee.department,
    location: employee.location || 'India',
    status: employee.status,
    timezone: employee.timezone,
    officeStartTime: employee.officeStartTime,
    officeEndTime: employee.officeEndTime,
    gracePeriodMinutes: employee.gracePeriodMinutes,
    workingDays: employee.workingDays,
    reminderPreferences: normalizeEmployeeReminderPreferences(employee.reminderPreferences),
  };
}

export async function enableAttendancePushReminders(params: {
  employee: Employee;
  forceResubscribe?: boolean;
}): Promise<{
  permission: NotificationPermission;
  preferences: EmployeeReminderPreferences;
  subscriptionId?: string;
}> {
  if (!isPushSupported()) {
    throw new Error('This browser does not support Web Push notifications.');
  }

  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    return {
      permission,
      preferences: normalizeEmployeeReminderPreferences(params.employee.reminderPreferences),
    };
  }
  if (permission !== 'granted') {
    return {
      permission,
      preferences: normalizeEmployeeReminderPreferences(params.employee.reminderPreferences),
    };
  }

  const headers = await getAuthHeaders();
  const keyResp = await fetch('/api/push/vapid-public-key', {
    method: 'GET',
    headers,
  });
  if (!keyResp.ok) {
    const errData = await keyResp.json().catch(() => ({}));
    throw new Error(errData.error || 'Could not load notification encryption key.');
  }
  const { publicKey } = (await keyResp.json()) as { publicKey: string };
  if (!publicKey) {
    throw new Error('Server VAPID public key is unavailable.');
  }

  const reg = await ensureServiceWorkerRegistration();
  let browserSub = await reg.pushManager.getSubscription();
  if (params.forceResubscribe && browserSub) {
    await browserSub.unsubscribe().catch(() => {});
    browserSub = null;
  }

  if (!browserSub) {
    const appServerKey = urlBase64ToUint8Array(publicKey);
    browserSub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey.buffer as ArrayBuffer,
    });
  }

  const subJson = browserSub.toJSON();
  const endpoint = subJson.endpoint || browserSub.endpoint;
  const p256dh = subJson.keys?.p256dh || '';
  const authKey = subJson.keys?.auth || '';
  if (!endpoint || !p256dh || !authKey) {
    throw new Error('Browser produced an incomplete push subscription.');
  }

  const deviceLabel = getDeviceLabel();
  const nextPrefs: EmployeeReminderPreferences = {
    ...normalizeEmployeeReminderPreferences(params.employee.reminderPreferences),
    pushEnabled: true,
    updatedAtIso: new Date().toISOString(),
  };

  const regResp = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      employeeId: params.employee.id,
      deviceLabel,
      subscription: {
        endpoint,
        expirationTime: browserSub.expirationTime ?? null,
        keys: { p256dh, auth: authKey },
      },
      employeeSnapshot: {
        ...buildEmployeeServerSnapshot(params.employee),
        reminderPreferences: nextPrefs,
      },
    }),
  });

  if (!regResp.ok) {
    const errData = await regResp.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to register device push subscription.');
  }
  const regData = (await regResp.json()) as { subscription?: { id: string } };
  const subId = regData.subscription?.id || `sub_${params.employee.uid}_${Date.now()}`;

  // Mirror owner-only subscription metadata and employee preference into Firestore
  const nowIso = new Date().toISOString();
  await Promise.allSettled([
    setDoc(
      doc(db, 'pushSubscriptions', subId),
      cleanObject({
        employeeId: params.employee.id,
        employeeUid: params.employee.uid,
        endpoint,
        keys: { p256dh, auth: authKey },
        expirationTime: browserSub.expirationTime ?? null,
        deviceLabel,
        status: 'active',
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      })
    ),
    updateDoc(doc(db, 'employees', params.employee.id), {
      reminderPreferences: nextPrefs,
      updatedAt: serverTimestamp(),
    }),
  ]);

  return {
    permission,
    preferences: nextPrefs,
    subscriptionId: subId,
  };
}

export async function disableAttendancePushReminders(params: {
  employee: Employee;
  thisDeviceOnly?: boolean;
}): Promise<EmployeeReminderPreferences> {
  const headers = await getAuthHeaders();
  let endpoint: string | undefined;

  if (isPushSupported()) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
      }
    } catch {
      // Safe fallback
    }
  }

  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      endpoint,
      disableAllForUser: !params.thisDeviceOnly,
    }),
  });

  const nextPrefs: EmployeeReminderPreferences = {
    ...normalizeEmployeeReminderPreferences(params.employee.reminderPreferences),
    pushEnabled: Boolean(params.thisDeviceOnly),
    updatedAtIso: new Date().toISOString(),
  };

  if (!params.thisDeviceOnly) {
    await updateDoc(doc(db, 'employees', params.employee.id), {
      reminderPreferences: nextPrefs,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  return nextPrefs;
}

export async function saveEmployeeReminderPreferences(params: {
  employee: Employee;
  preferences: Partial<EmployeeReminderPreferences>;
}): Promise<EmployeeReminderPreferences> {
  const nextPrefs: EmployeeReminderPreferences = {
    ...DEFAULT_EMPLOYEE_REMINDER_PREFERENCES,
    ...normalizeEmployeeReminderPreferences(params.employee.reminderPreferences),
    ...params.preferences,
    updatedAtIso: new Date().toISOString(),
  };

  await updateDoc(doc(db, 'employees', params.employee.id), {
    reminderPreferences: nextPrefs,
    updatedAt: serverTimestamp(),
  });

  const headers = await getAuthHeaders();
  await fetch('/api/reminders/preferences', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      employeeId: params.employee.id,
      preferences: nextPrefs,
    }),
  });

  return nextPrefs;
}

export async function syncReminderSnapshotToServer(params: {
  employee: Employee;
  settings: CompanySettings | null;
  employees?: Employee[];
  attendanceRecords?: AttendanceRecord[];
  approvedLeaves?: LeaveApplication[];
}): Promise<{
  subscriptions: ServerSubscriptionSummary[];
  overview?: ReminderOverviewMetrics;
}> {
  const headers = await getAuthHeaders();
  const isAdmin = params.employee.role === 'super_admin';

  const employeePayload =
    isAdmin && Array.isArray(params.employees) && params.employees.length > 0
      ? params.employees.map(buildEmployeeServerSnapshot)
      : [buildEmployeeServerSnapshot(params.employee)];

  const attPayload = Array.isArray(params.attendanceRecords)
    ? params.attendanceRecords.slice(0, 400).map((r) => ({
        employeeId: r.employeeId,
        date: r.date,
        punchInTime: r.punchInTime,
        punchOutTime: r.punchOutTime,
        status: r.status,
      }))
    : undefined;

  const leavePayload = Array.isArray(params.approvedLeaves)
    ? params.approvedLeaves
        .filter((l) => l.status === 'Approved')
        .slice(0, 300)
        .map((l) => ({
          employeeId: l.employeeId,
          status: l.status,
          startDate: l.startDate,
          endDate: l.endDate,
        }))
    : undefined;

  const companyPayload =
    isAdmin && params.settings
      ? {
          companyName: params.settings.companyName || 'TalentGrade',
          officeStartTime: params.settings.officeStartTime || '09:30',
          officeEndTime: params.settings.officeEndTime || '18:30',
          gracePeriodMinutes: params.settings.gracePeriodMinutes ?? 15,
          workingDays: params.settings.workingDays || [1, 2, 3, 4, 5],
          holidays: params.settings.holidays || [],
          attendanceReminders: normalizeAttendanceReminderSettings(
            params.settings.attendanceReminders
          ),
        }
      : undefined;

  const res = await fetch('/api/reminders/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      company: companyPayload,
      employees: employeePayload,
      attendanceRecords: attPayload,
      approvedLeaves: leavePayload,
    }),
  });

  if (!res.ok) {
    return { subscriptions: [] };
  }
  return (await res.json()) as {
    subscriptions: ServerSubscriptionSummary[];
    overview?: ReminderOverviewMetrics;
  };
}

export async function fetchReminderHistoryAndStatus(
  scope: 'self' | 'all' = 'self',
  limit = 150
): Promise<{
  logs: AttendanceReminderLog[];
  subscriptions: ServerSubscriptionSummary[];
  overview?: ReminderOverviewMetrics;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/reminders/history?scope=${scope}&limit=${limit}`, {
    method: 'GET',
    headers,
  });
  if (!res.ok) {
    throw new Error('Could not load attendance reminder history.');
  }
  return (await res.json()) as {
    logs: AttendanceReminderLog[];
    subscriptions: ServerSubscriptionSummary[];
    overview?: ReminderOverviewMetrics;
  };
}

export async function sendTestAttendancePush(): Promise<{
  sent: number;
  expired: number;
  failed: number;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/reminders/test-self', {
    method: 'POST',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Could not send test push notification.');
  }
  return data as { sent: number; expired: number; failed: number };
}

export async function triggerAdminReminderRunNow(): Promise<{
  evaluatedEmployees: number;
  candidatesFound: number;
  sent: number;
  expired: number;
  failed: number;
  overview?: ReminderOverviewMetrics;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/reminders/run-now', {
    method: 'POST',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to run attendance reminder evaluation.');
  }
  return data;
}

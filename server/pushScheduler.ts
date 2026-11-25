import fs from 'fs';
import path from 'path';
import * as webPush from 'web-push';
import {
  AttendanceReminderLog,
  AttendanceReminderSettings,
  DEFAULT_ATTENDANCE_REMINDER_SETTINGS,
  EmployeeReminderPreferences,
  PushSubscriptionRecord,
  ReminderAttendanceSnapshot,
  ReminderCompanySnapshot,
  ReminderEmployeeSnapshot,
  ReminderLeaveSnapshot,
  evaluateDueRemindersForEmployee,
  normalizeAttendanceReminderSettings,
  normalizeEmployeeReminderPreferences,
  resolveSafeReminderTimezone,
  resolveEmployeeTimezoneParts,
} from '../shared/attendanceReminderEngine.ts';

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PersistedReminderState {
  company: ReminderCompanySnapshot;
  employees: Record<string, ReminderEmployeeSnapshot>;
  subscriptions: Record<string, PushSubscriptionRecord>;
  attendanceRecords: Record<string, ReminderAttendanceSnapshot>;
  approvedLeaves: Record<string, ReminderLeaveSnapshot>;
  logs: AttendanceReminderLog[];
  lastRunIso?: string;
}

export type PushTransportFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
) => Promise<{ statusCode?: number }>;

const DEFAULT_STATE: PersistedReminderState = {
  company: {
    companyName: 'TalentGrade',
    officeStartTime: '09:30',
    officeEndTime: '18:30',
    gracePeriodMinutes: 15,
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    attendanceReminders: { ...DEFAULT_ATTENDANCE_REMINDER_SETTINGS },
  },
  employees: {},
  subscriptions: {},
  attendanceRecords: {},
  approvedLeaves: {},
  logs: [],
};

function makeLogId(prefix = 'rem'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function makeSubscriptionId(employeeUid: string, endpoint: string): string {
  // Deterministic safe ID per user + endpoint so refreshes update cleanly without duplicates
  let hash = 2166136261;
  const input = `${employeeUid}::${endpoint}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  const safeUid = employeeUid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'usr';
  return `sub_${safeUid}_${hex}`;
}

export class SmartAttendanceReminderService {
  private dataDir: string;
  private vapidFile: string;
  private stateFile: string;
  private vapidKeys: VapidKeyPair;
  private state: PersistedReminderState;
  private timer: NodeJS.Timeout | null = null;
  private runningCycle = false;
  private transport: PushTransportFn;

  constructor(options?: { dataDir?: string; transport?: PushTransportFn }) {
    const preferredDir =
      options?.dataDir ||
      (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
        ? path.join('/tmp', 'talentgrade-data')
        : path.resolve(process.cwd(), '.data'));

    let resolvedDir = preferredDir;
    try {
      fs.mkdirSync(resolvedDir, { recursive: true });
    } catch {
      resolvedDir = path.join('/tmp', 'talentgrade-data');
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    this.dataDir = resolvedDir;
    this.vapidFile = path.join(this.dataDir, 'vapid.json');
    this.stateFile = path.join(this.dataDir, 'reminder-state.json');

    this.vapidKeys = this.loadOrCreateVapidKeys();
    webPush.setVapidDetails(
      this.vapidKeys.subject,
      this.vapidKeys.publicKey,
      this.vapidKeys.privateKey
    );

    this.transport =
      options?.transport ||
      ((sub, payload) =>
        webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload,
          { TTL: 3600 }
        ));

    this.state = this.loadState();
  }

  private loadOrCreateVapidKeys(): VapidKeyPair {
    const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
    const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
    const envSubj = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:hr@talentgrade.io';

    if (envPub && envPriv) {
      return { publicKey: envPub, privateKey: envPriv, subject: envSubj };
    }

    if (fs.existsSync(this.vapidFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.vapidFile, 'utf-8')) as Partial<VapidKeyPair>;
        if (parsed.publicKey && parsed.privateKey) {
          return {
            publicKey: parsed.publicKey,
            privateKey: parsed.privateKey,
            subject: parsed.subject || envSubj,
          };
        }
      } catch {
        // Fall through to regenerate
      }
    }

    const generated = webPush.generateVAPIDKeys();
    const pair: VapidKeyPair = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      subject: envSubj,
    };
    const tmp = `${this.vapidFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(pair, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.vapidFile);
    return pair;
  }

  private loadState(): PersistedReminderState {
    if (!fs.existsSync(this.stateFile)) {
      return structuredClone(DEFAULT_STATE);
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')) as Partial<PersistedReminderState>;
      return {
        company: parsed.company
          ? {
              ...DEFAULT_STATE.company,
              ...parsed.company,
              attendanceReminders: normalizeAttendanceReminderSettings(
                parsed.company.attendanceReminders
              ),
            }
          : structuredClone(DEFAULT_STATE.company),
        employees: parsed.employees || {},
        subscriptions: parsed.subscriptions || {},
        attendanceRecords: parsed.attendanceRecords || {},
        approvedLeaves: parsed.approvedLeaves || {},
        logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-2000) : [],
        lastRunIso: parsed.lastRunIso,
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  private persistState() {
    if (this.state.logs.length > 2000) {
      this.state.logs = this.state.logs.slice(-2000);
    }
    const tmp = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.stateFile);
  }

  getPublicVapidKey(): string {
    return this.vapidKeys.publicKey;
  }

  getStateSnapshot(): PersistedReminderState {
    return this.state;
  }

  getSubscriptionsForUser(employeeUid: string): PushSubscriptionRecord[] {
    return Object.values(this.state.subscriptions).filter((s) => s.employeeUid === employeeUid);
  }

  registerSubscription(params: {
    employeeId: string;
    employeeUid: string;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    expirationTime?: number | null;
    deviceLabel: string;
    employeeSnapshot?: Partial<ReminderEmployeeSnapshot>;
  }): PushSubscriptionRecord {
    const nowIso = new Date().toISOString();
    const id = makeSubscriptionId(params.employeeUid, params.endpoint);
    const existing = this.state.subscriptions[id];

    const record: PushSubscriptionRecord = {
      id,
      employeeId: params.employeeId,
      employeeUid: params.employeeUid,
      endpoint: params.endpoint,
      keys: {
        p256dh: params.keys.p256dh,
        auth: params.keys.auth,
      },
      expirationTime: params.expirationTime ?? null,
      deviceLabel: (params.deviceLabel || 'Browser Device').slice(0, 120),
      status: 'active',
      createdAtIso: existing?.createdAtIso || nowIso,
      updatedAtIso: nowIso,
    };

    this.state.subscriptions[id] = record;

    // Ensure employee snapshot exists & reflects push enabled
    if (params.employeeSnapshot || this.state.employees[params.employeeId]) {
      const prevEmp = this.state.employees[params.employeeId];
      this.state.employees[params.employeeId] = {
        id: params.employeeId,
        uid: params.employeeUid,
        fullName: params.employeeSnapshot?.fullName || prevEmp?.fullName || 'Employee',
        role: params.employeeSnapshot?.role || prevEmp?.role || 'employee',
        department: params.employeeSnapshot?.department || prevEmp?.department || 'Operations',
        location: params.employeeSnapshot?.location || prevEmp?.location || 'India',
        status: params.employeeSnapshot?.status || prevEmp?.status || 'Active',
        timezone: params.employeeSnapshot?.timezone || prevEmp?.timezone,
        officeStartTime: params.employeeSnapshot?.officeStartTime ?? prevEmp?.officeStartTime,
        officeEndTime: params.employeeSnapshot?.officeEndTime ?? prevEmp?.officeEndTime,
        gracePeriodMinutes: params.employeeSnapshot?.gracePeriodMinutes ?? prevEmp?.gracePeriodMinutes,
        workingDays: params.employeeSnapshot?.workingDays ?? prevEmp?.workingDays,
        reminderPreferences: {
          ...normalizeEmployeeReminderPreferences(prevEmp?.reminderPreferences),
          ...(params.employeeSnapshot?.reminderPreferences || {}),
          pushEnabled: true,
          updatedAtIso: nowIso,
        },
      };
    }

    this.persistState();
    return record;
  }

  deactivateSubscription(params: {
    employeeUid: string;
    endpoint?: string;
    subscriptionId?: string;
    disableAllForUser?: boolean;
  }): number {
    const nowIso = new Date().toISOString();
    let count = 0;

    for (const sub of Object.values(this.state.subscriptions)) {
      if (sub.employeeUid !== params.employeeUid) continue;
      if (
        params.disableAllForUser ||
        (params.endpoint && sub.endpoint === params.endpoint) ||
        (params.subscriptionId && sub.id === params.subscriptionId)
      ) {
        sub.status = 'inactive';
        sub.updatedAtIso = nowIso;
        count += 1;
      }
    }

    if (params.disableAllForUser) {
      for (const emp of Object.values(this.state.employees)) {
        if (emp.uid === params.employeeUid) {
          emp.reminderPreferences = {
            ...normalizeEmployeeReminderPreferences(emp.reminderPreferences),
            pushEnabled: false,
            updatedAtIso: nowIso,
          };
        }
      }
    }

    if (count > 0 || params.disableAllForUser) {
      this.persistState();
    }
    return count;
  }

  updateEmployeePreferences(params: {
    employeeId: string;
    employeeUid: string;
    preferences: Partial<EmployeeReminderPreferences>;
  }): EmployeeReminderPreferences {
    const existing = this.state.employees[params.employeeId];
    const nextPrefs: EmployeeReminderPreferences = {
      ...normalizeEmployeeReminderPreferences(existing?.reminderPreferences),
      ...params.preferences,
      updatedAtIso: new Date().toISOString(),
    };
    if (existing && existing.uid === params.employeeUid) {
      existing.reminderPreferences = nextPrefs;
      this.persistState();
    }
    return nextPrefs;
  }

  syncClientSnapshot(params: {
    callerUid: string;
    callerIsAdmin: boolean;
    company?: Partial<ReminderCompanySnapshot>;
    employees?: ReminderEmployeeSnapshot[];
    attendanceRecords?: ReminderAttendanceSnapshot[];
    approvedLeaves?: ReminderLeaveSnapshot[];
  }) {
    if (params.callerIsAdmin && params.company) {
      this.state.company = {
        ...this.state.company,
        ...params.company,
        attendanceReminders: normalizeAttendanceReminderSettings(
          params.company.attendanceReminders ?? this.state.company.attendanceReminders
        ),
      };
    }

    if (Array.isArray(params.employees)) {
      for (const emp of params.employees) {
        if (!emp || !emp.id) continue;
        if (!params.callerIsAdmin && emp.uid !== params.callerUid) continue;
        const prev = this.state.employees[emp.id];
        this.state.employees[emp.id] = {
          ...prev,
          ...emp,
          reminderPreferences: normalizeEmployeeReminderPreferences(
            emp.reminderPreferences ?? prev?.reminderPreferences
          ),
        };
      }
    }

    if (Array.isArray(params.attendanceRecords)) {
      for (const rec of params.attendanceRecords) {
        if (!rec || !rec.employeeId || !rec.date) continue;
        const targetEmp = this.state.employees[rec.employeeId];
        if (!params.callerIsAdmin && targetEmp && targetEmp.uid !== params.callerUid) continue;
        const key = `${rec.employeeId}_${rec.date}`;
        this.state.attendanceRecords[key] = rec;
      }
    }

    if (Array.isArray(params.approvedLeaves)) {
      for (const lv of params.approvedLeaves) {
        if (!lv || !lv.employeeId || !lv.startDate || !lv.endDate) continue;
        const targetEmp = this.state.employees[lv.employeeId];
        if (!params.callerIsAdmin && targetEmp && targetEmp.uid !== params.callerUid) continue;
        const key = `${lv.employeeId}_${lv.startDate}_${lv.endDate}`;
        this.state.approvedLeaves[key] = lv;
      }
    }

    // Prune stale attendance/leaves older than 45 days to keep snapshot compact
    const cutoffDate = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
    for (const [k, rec] of Object.entries(this.state.attendanceRecords)) {
      if (rec.date < cutoffDate) delete this.state.attendanceRecords[k];
    }
    for (const [k, lv] of Object.entries(this.state.approvedLeaves)) {
      if (lv.endDate < cutoffDate || lv.status !== 'Approved') delete this.state.approvedLeaves[k];
    }

    this.persistState();
  }

  getHistory(params: { callerUid: string; callerIsAdmin: boolean; limitCount?: number }): AttendanceReminderLog[] {
    const max = Math.min(500, Math.max(1, params.limitCount || 150));
    const filtered = params.callerIsAdmin
      ? this.state.logs
      : this.state.logs.filter((l) => l.employeeUid === params.callerUid);
    return [...filtered].reverse().slice(0, max);
  }

  getOverviewMetrics() {
    const allSubs = Object.values(this.state.subscriptions);
    const activeSubs = allSubs.filter((s) => s.status === 'active');
    const expiredSubs = allSubs.filter((s) => s.status === 'expired');
    const uniqueSubscribedEmployees = new Set(activeSubs.map((s) => s.employeeId)).size;
    const activeEmployeesCount = Object.values(this.state.employees).filter(
      (e) => e.status === 'Active'
    ).length;

    const todayUtc = new Date().toISOString().slice(0, 10);
    const sentToday = this.state.logs.filter(
      (l) => l.status === 'sent' && l.sentAtIso.startsWith(todayUtc)
    ).length;
    const failedToday = this.state.logs.filter(
      (l) => (l.status === 'failed' || l.status === 'expired') && l.sentAtIso.startsWith(todayUtc)
    ).length;

    return {
      enabled: normalizeAttendanceReminderSettings(this.state.company.attendanceReminders).enabled,
      activeEmployeesCount,
      subscribedEmployeesCount: uniqueSubscribedEmployees,
      activeDeviceSubscriptions: activeSubs.length,
      expiredDeviceSubscriptions: expiredSubs.length,
      sentToday,
      failedToday,
      lastRunIso: this.state.lastRunIso || null,
    };
  }

  async sendTestNotification(employeeUid: string): Promise<{
    sent: number;
    expired: number;
    failed: number;
    logs: AttendanceReminderLog[];
  }> {
    const emp = Object.values(this.state.employees).find((e) => e.uid === employeeUid);
    const activeSubs = Object.values(this.state.subscriptions).filter(
      (s) => s.employeeUid === employeeUid && s.status === 'active'
    );

    if (activeSubs.length === 0) {
      throw new Error('No active browser push subscription found for your account.');
    }

    const now = new Date();
    const tz = resolveSafeReminderTimezone(emp?.timezone, emp?.location);
    const { localDate } = resolveEmployeeTimezoneParts(now, tz);
    const payload = JSON.stringify({
      title: 'TalentGrade · Smart Attendance Reminders Active',
      body: 'Browser push notifications are working properly on this device. Clicking opens Attendance directly.',
      url: '/?page=attendance&action=punch&reminder=test',
      tag: `tg_att_test_${employeeUid}`,
      reminderType: 'punch_in',
      attendanceDate: localDate,
    });

    let sent = 0;
    let expired = 0;
    let failed = 0;
    const createdLogs: AttendanceReminderLog[] = [];

    for (const sub of activeSubs) {
      const logEntry: AttendanceReminderLog = {
        id: makeLogId('rem_test'),
        dedupKey: `${emp?.id || employeeUid}_${localDate}_test_${Date.now()}`,
        employeeId: emp?.id || employeeUid,
        employeeUid,
        employeeName: emp?.fullName || 'TalentGrade Employee',
        department: emp?.department || 'Operations',
        location: emp?.location || 'India',
        reminderType: 'punch_in',
        attendanceDate: localDate,
        timezone: tz,
        title: 'TalentGrade · Smart Attendance Reminders Active',
        body: 'Test browser push notification triggered by user.',
        url: '/?page=attendance&action=punch&reminder=test',
        status: 'sent',
        reason: 'Manual self-test push',
        subscriptionId: sub.id,
        deviceLabel: sub.deviceLabel,
        sentAtIso: now.toISOString(),
      };

      try {
        await this.transport(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload
        );
        sent += 1;
      } catch (err: unknown) {
        const statusCode = Number((err as { statusCode?: number })?.statusCode || 0);
        const msg = err instanceof Error ? err.message : 'Push delivery failed';
        if (statusCode === 404 || statusCode === 410) {
          sub.status = 'expired';
          sub.lastFailureReason = `Push service returned HTTP ${statusCode} (subscription expired)`;
          sub.updatedAtIso = now.toISOString();
          logEntry.status = 'expired';
          logEntry.failureDetail = sub.lastFailureReason;
          expired += 1;
        } else {
          logEntry.status = 'failed';
          logEntry.failureDetail = msg.slice(0, 240);
          failed += 1;
        }
      }

      this.state.logs.push(logEntry);
      createdLogs.push(logEntry);
    }

    this.persistState();
    return { sent, expired, failed, logs: createdLogs };
  }

  async processDueAttendanceReminders(now = new Date()): Promise<{
    evaluatedEmployees: number;
    candidatesFound: number;
    sent: number;
    expired: number;
    failed: number;
    createdLogs: AttendanceReminderLog[];
  }> {
    if (this.runningCycle) {
      return {
        evaluatedEmployees: 0,
        candidatesFound: 0,
        sent: 0,
        expired: 0,
        failed: 0,
        createdLogs: [],
      };
    }

    this.runningCycle = true;
    try {
      const employeesList = Object.values(this.state.employees);
      const attendanceList = Object.values(this.state.attendanceRecords);
      const leavesList = Object.values(this.state.approvedLeaves);
      const allSubs = Object.values(this.state.subscriptions);

      let candidatesFound = 0;
      let sent = 0;
      let expired = 0;
      let failed = 0;
      const createdLogs: AttendanceReminderLog[] = [];

      for (const emp of employeesList) {
        const empActiveSubs = allSubs.filter(
          (s) => s.employeeUid === emp.uid && s.status === 'active'
        );

        const candidates = evaluateDueRemindersForEmployee({
          employee: emp,
          company: this.state.company,
          attendanceRecords: attendanceList,
          approvedLeaves: leavesList,
          existingLogs: this.state.logs,
          activeSubscriptionCount: empActiveSubs.length,
          now,
        });

        for (const candidate of candidates) {
          candidatesFound += 1;
          // Double-check strict dedupKey guard across logs before delivering
          const alreadyProcessed = this.state.logs.some(
            (l) => l.dedupKey === candidate.dedupKey && (l.status === 'sent' || l.status === 'failed')
          );
          if (alreadyProcessed) continue;

          const payload = JSON.stringify({
            title: candidate.title,
            body: candidate.body,
            url: candidate.url,
            tag: candidate.tag,
            reminderType: candidate.reminderType,
            attendanceDate: candidate.attendanceDate,
          });

          for (const sub of empActiveSubs) {
            const logEntry: AttendanceReminderLog = {
              id: makeLogId('rem'),
              dedupKey: candidate.dedupKey,
              employeeId: candidate.employeeId,
              employeeUid: candidate.employeeUid,
              employeeName: candidate.employeeName,
              department: candidate.department,
              location: candidate.location,
              reminderType: candidate.reminderType,
              attendanceDate: candidate.attendanceDate,
              timezone: candidate.timezone,
              title: candidate.title,
              body: candidate.body,
              url: candidate.url,
              status: 'sent',
              reason: 'Scheduled attendance reminder',
              subscriptionId: sub.id,
              deviceLabel: sub.deviceLabel,
              sentAtIso: now.toISOString(),
            };

            try {
              await this.transport(
                { endpoint: sub.endpoint, keys: sub.keys },
                payload
              );
              sent += 1;
            } catch (err: unknown) {
              const statusCode = Number((err as { statusCode?: number })?.statusCode || 0);
              const msg = err instanceof Error ? err.message : 'Push delivery error';
              if (statusCode === 404 || statusCode === 410) {
                sub.status = 'expired';
                sub.lastFailureReason = `Push service returned HTTP ${statusCode} (expired)`;
                sub.updatedAtIso = now.toISOString();
                logEntry.status = 'expired';
                logEntry.failureDetail = sub.lastFailureReason;
                expired += 1;
              } else {
                logEntry.status = 'failed';
                logEntry.failureDetail = msg.slice(0, 240);
                failed += 1;
              }
            }

            this.state.logs.push(logEntry);
            createdLogs.push(logEntry);
          }
        }
      }

      this.state.lastRunIso = now.toISOString();
      this.persistState();

      return {
        evaluatedEmployees: employeesList.length,
        candidatesFound,
        sent,
        expired,
        failed,
        createdLogs,
      };
    } finally {
      this.runningCycle = false;
    }
  }

  startScheduler(intervalMs = 30_000) {
    if (this.timer) return;
    // Run shortly after boot, then continuously on interval even when no portal tabs are open
    setTimeout(() => {
      void this.processDueAttendanceReminders().catch((err) => {
        console.error('Initial attendance reminder tick error:', err);
      });
    }, 3000);

    this.timer = setInterval(() => {
      void this.processDueAttendanceReminders().catch((err) => {
        console.error('Scheduled attendance reminder tick error:', err);
      });
    }, intervalMs);
  }

  stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

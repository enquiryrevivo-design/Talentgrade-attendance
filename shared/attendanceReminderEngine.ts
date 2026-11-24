export type ReminderType =
  | 'punch_in'
  | 'missed_punch_in'
  | 'punch_out'
  | 'missed_punch_out';

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  punch_in: 'Punch-In Reminder',
  missed_punch_in: 'Missed Punch-In Follow-Up',
  punch_out: 'Punch-Out Reminder',
  missed_punch_out: 'Missed Punch-Out Follow-Up',
};

export interface AttendanceReminderSettings {
  enabled: boolean;
  punchInEnabled: boolean;
  punchOutEnabled: boolean;
  punchInOffsetMinutes: number; // Relative to officeStartTime (-60..120)
  punchInFollowUpDelayMinutes: number; // Minutes after officeStartTime (5..240)
  punchOutOffsetMinutes: number; // Relative to officeEndTime (-60..120)
  punchOutFollowUpDelayMinutes: number; // Minutes after officeEndTime (5..240)
  sendPunchOutIfNotPunchedIn: boolean;
  maxRemindersPerEvent: number; // 1 or 2 (initial + follow-up)
  maxRemindersPerDay: number; // 1..6
  targetDepartments: string[]; // Empty = all departments
  targetLocations: string[]; // Empty = all locations
  targetRoles: Array<'super_admin' | 'team_leader' | 'employee'>; // Empty = all roles
}

export interface EmployeeReminderPreferences {
  pushEnabled: boolean;
  punchInReminders: boolean;
  punchOutReminders: boolean;
  updatedAtIso?: string;
}

export type PushSubscriptionStatus = 'active' | 'expired' | 'inactive';

export interface PushSubscriptionRecord {
  id: string;
  employeeId: string;
  employeeUid: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime?: number | null;
  deviceLabel: string;
  status: PushSubscriptionStatus;
  createdAtIso: string;
  updatedAtIso: string;
  lastFailureReason?: string;
}

export type ReminderDeliveryStatus = 'sent' | 'failed' | 'expired' | 'skipped';

export interface AttendanceReminderLog {
  id: string;
  dedupKey: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department: string;
  location: string;
  reminderType: ReminderType;
  attendanceDate: string; // YYYY-MM-DD
  timezone: string;
  title: string;
  body: string;
  url: string;
  status: ReminderDeliveryStatus;
  reason?: string;
  subscriptionId?: string;
  deviceLabel?: string;
  failureDetail?: string;
  sentAtIso: string;
}

export interface ReminderEmployeeSnapshot {
  id: string;
  uid: string;
  fullName: string;
  role: 'super_admin' | 'team_leader' | 'employee';
  department: string;
  location?: string;
  status: 'Active' | 'Inactive' | 'Resigned' | 'Terminated';
  timezone?: string;
  officeStartTime?: string;
  officeEndTime?: string;
  gracePeriodMinutes?: number;
  workingDays?: number[];
  reminderPreferences?: EmployeeReminderPreferences;
}

export interface ReminderCompanySnapshot {
  companyName: string;
  officeStartTime: string;
  officeEndTime: string;
  gracePeriodMinutes: number;
  workingDays: number[];
  holidays?: Array<{ date: string; name: string }>;
  attendanceReminders?: AttendanceReminderSettings;
}

export interface ReminderAttendanceSnapshot {
  employeeId: string;
  date: string;
  punchInTime?: string;
  punchOutTime?: string;
  status?: string;
}

export interface ReminderLeaveSnapshot {
  employeeId: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface DueReminderCandidate {
  dedupKey: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department: string;
  location: string;
  reminderType: ReminderType;
  attendanceDate: string;
  timezone: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

export const DEFAULT_ATTENDANCE_REMINDER_SETTINGS: AttendanceReminderSettings = {
  enabled: true,
  punchInEnabled: true,
  punchOutEnabled: true,
  punchInOffsetMinutes: 0,
  punchInFollowUpDelayMinutes: 20,
  punchOutOffsetMinutes: -5,
  punchOutFollowUpDelayMinutes: 20,
  sendPunchOutIfNotPunchedIn: false,
  maxRemindersPerEvent: 2,
  maxRemindersPerDay: 4,
  targetDepartments: [],
  targetLocations: [],
  targetRoles: [],
};

export const DEFAULT_EMPLOYEE_REMINDER_PREFERENCES: EmployeeReminderPreferences = {
  pushEnabled: true,
  punchInReminders: true,
  punchOutReminders: true,
};

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export function normalizeAttendanceReminderSettings(
  raw?: Partial<AttendanceReminderSettings> | null
): AttendanceReminderSettings {
  const src = raw || {};
  const allowedRoles = new Set(['super_admin', 'team_leader', 'employee']);
  return {
    enabled: src.enabled ?? DEFAULT_ATTENDANCE_REMINDER_SETTINGS.enabled,
    punchInEnabled: src.punchInEnabled ?? DEFAULT_ATTENDANCE_REMINDER_SETTINGS.punchInEnabled,
    punchOutEnabled: src.punchOutEnabled ?? DEFAULT_ATTENDANCE_REMINDER_SETTINGS.punchOutEnabled,
    punchInOffsetMinutes: clampInt(
      src.punchInOffsetMinutes,
      DEFAULT_ATTENDANCE_REMINDER_SETTINGS.punchInOffsetMinutes,
      -60,
      120
    ),
    punchInFollowUpDelayMinutes: clampInt(
      src.punchInFollowUpDelayMinutes,
      DEFAULT_ATTENDANCE_REMINDER_SETTINGS.punchInFollowUpDelayMinutes,
      5,
      240
    ),
    punchOutOffsetMinutes: clampInt(
      src.punchOutOffsetMinutes,
      DEFAULT_ATTENDANCE_REMINDER_SETTINGS.punchOutOffsetMinutes,
      -60,
      120
    ),
    punchOutFollowUpDelayMinutes: clampInt(
      src.punchOutFollowUpDelayMinutes,
      DEFAULT_ATTENDANCE_REMINDER_SETTINGS.punchOutFollowUpDelayMinutes,
      5,
      240
    ),
    sendPunchOutIfNotPunchedIn: Boolean(
      src.sendPunchOutIfNotPunchedIn ?? DEFAULT_ATTENDANCE_REMINDER_SETTINGS.sendPunchOutIfNotPunchedIn
    ),
    maxRemindersPerEvent: clampInt(
      src.maxRemindersPerEvent,
      DEFAULT_ATTENDANCE_REMINDER_SETTINGS.maxRemindersPerEvent,
      1,
      2
    ),
    maxRemindersPerDay: clampInt(
      src.maxRemindersPerDay,
      DEFAULT_ATTENDANCE_REMINDER_SETTINGS.maxRemindersPerDay,
      1,
      6
    ),
    targetDepartments: Array.isArray(src.targetDepartments)
      ? src.targetDepartments.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
      : [],
    targetLocations: Array.isArray(src.targetLocations)
      ? src.targetLocations.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
      : [],
    targetRoles: Array.isArray(src.targetRoles)
      ? src.targetRoles.filter(
          (r): r is 'super_admin' | 'team_leader' | 'employee' =>
            typeof r === 'string' && allowedRoles.has(r)
        )
      : [],
  };
}

export function normalizeEmployeeReminderPreferences(
  raw?: Partial<EmployeeReminderPreferences> | null
): EmployeeReminderPreferences {
  const src = raw || {};
  return {
    pushEnabled: src.pushEnabled ?? DEFAULT_EMPLOYEE_REMINDER_PREFERENCES.pushEnabled,
    punchInReminders: src.punchInReminders ?? DEFAULT_EMPLOYEE_REMINDER_PREFERENCES.punchInReminders,
    punchOutReminders: src.punchOutReminders ?? DEFAULT_EMPLOYEE_REMINDER_PREFERENCES.punchOutReminders,
    updatedAtIso: typeof src.updatedAtIso === 'string' ? src.updatedAtIso : undefined,
  };
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function resolveSafeReminderTimezone(timezone?: string, location?: string): string {
  const fallback = location === 'Dubai, UAE' ? 'Asia/Dubai' : 'Asia/Kolkata';
  const candidate = timezone && timezone.trim() ? timezone.trim() : fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
}

export function resolveEmployeeTimezoneParts(
  now: Date,
  timeZone: string
): {
  localDate: string;
  localHHmm: string;
  localMinutesOfDay: number;
  dayOfWeek: number;
} {
  const safeTz = resolveSafeReminderTimezone(timeZone);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(now);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hour = Number(getPart('hour')) % 24;
  const minute = Number(getPart('minute'));
  const weekdayStr = getPart('weekday');
  const dayOfWeek = WEEKDAY_MAP[weekdayStr] ?? new Date(`${year}-${month}-${day}T00:00:00Z`).getUTCDay();

  return {
    localDate: `${year}-${month}-${day}`,
    localHHmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    localMinutesOfDay: hour * 60 + minute,
    dayOfWeek,
  };
}

export function parseHHmmMinutes(hhmm: string | undefined, fallbackMinutes: number): number {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return fallbackMinutes;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return fallbackMinutes;
  }
  return h * 60 + m;
}

export function evaluateDueRemindersForEmployee(params: {
  employee: ReminderEmployeeSnapshot;
  company: ReminderCompanySnapshot;
  attendanceRecords: ReminderAttendanceSnapshot[];
  approvedLeaves: ReminderLeaveSnapshot[];
  existingLogs: Array<{
    dedupKey: string;
    employeeId: string;
    attendanceDate: string;
    reminderType: ReminderType;
    status: ReminderDeliveryStatus;
  }>;
  activeSubscriptionCount: number;
  now: Date;
}): DueReminderCandidate[] {
  const {
    employee,
    company,
    attendanceRecords,
    approvedLeaves,
    existingLogs,
    activeSubscriptionCount,
    now,
  } = params;

  const settings = normalizeAttendanceReminderSettings(company.attendanceReminders);
  if (!settings.enabled) return [];
  if (employee.status !== 'Active' || !employee.uid) return [];
  if (activeSubscriptionCount <= 0) return [];

  const empLoc = employee.location || 'India';
  if (settings.targetDepartments.length > 0 && !settings.targetDepartments.includes(employee.department)) {
    return [];
  }
  if (settings.targetLocations.length > 0 && !settings.targetLocations.includes(empLoc)) {
    return [];
  }
  if (settings.targetRoles.length > 0 && !settings.targetRoles.includes(employee.role)) {
    return [];
  }

  const empPrefs = normalizeEmployeeReminderPreferences(employee.reminderPreferences);
  if (!empPrefs.pushEnabled) return [];

  const tz = resolveSafeReminderTimezone(employee.timezone, empLoc);
  const { localDate, localMinutesOfDay, dayOfWeek } = resolveEmployeeTimezoneParts(now, tz);

  const effectiveWorkingDays =
    Array.isArray(employee.workingDays) && employee.workingDays.length > 0
      ? employee.workingDays
      : company.workingDays || [1, 2, 3, 4, 5];

  if (!effectiveWorkingDays.includes(dayOfWeek)) {
    return [];
  }

  if (Array.isArray(company.holidays) && company.holidays.some((h) => h.date === localDate)) {
    return [];
  }

  const isOnApprovedLeave = approvedLeaves.some(
    (l) =>
      l.employeeId === employee.id &&
      l.status === 'Approved' &&
      l.startDate <= localDate &&
      l.endDate >= localDate
  );
  if (isOnApprovedLeave) {
    return [];
  }

  const record = attendanceRecords.find(
    (r) => r.employeeId === employee.id && r.date === localDate
  );
  if (
    record &&
    (record.status === 'Leave' || record.status === 'Holiday' || record.status === 'Weekly Off')
  ) {
    return [];
  }

  const logsToday = existingLogs.filter(
    (l) =>
      l.employeeId === employee.id &&
      l.attendanceDate === localDate &&
      (l.status === 'sent' || l.status === 'failed')
  );
  const sentOrAttemptedCount = logsToday.filter((l) => l.status === 'sent').length;
  if (sentOrAttemptedCount >= settings.maxRemindersPerDay) {
    return [];
  }

  const hasSentOrAttemptedType = (type: ReminderType) =>
    logsToday.some((l) => l.reminderType === type);

  const effectiveStartStr = employee.officeStartTime || company.officeStartTime || '09:30';
  const effectiveEndStr = employee.officeEndTime || company.officeEndTime || '18:30';
  const startMinutes = parseHHmmMinutes(effectiveStartStr, 9 * 60 + 30);
  const endMinutesRaw = parseHHmmMinutes(effectiveEndStr, 18 * 60 + 30);
  const endMinutes = endMinutesRaw > startMinutes ? endMinutesRaw : startMinutes + 8 * 60;
  const graceMinutes =
    typeof employee.gracePeriodMinutes === 'number'
      ? employee.gracePeriodMinutes
      : company.gracePeriodMinutes ?? 15;

  const firstName = employee.fullName.trim().split(/\s+/)[0] || employee.fullName;
  const due: DueReminderCandidate[] = [];
  let remainingDailyQuota = settings.maxRemindersPerDay - sentOrAttemptedCount;

  // 1. Punch-In & Missed Punch-In Evaluation
  if (
    remainingDailyQuota > 0 &&
    settings.punchInEnabled &&
    empPrefs.punchInReminders &&
    !record?.punchInTime
  ) {
    const punchInStart = Math.max(0, startMinutes + settings.punchInOffsetMinutes);
    const punchOutWindowStart = Math.max(
      punchInStart + 10,
      endMinutes + Math.min(0, settings.punchOutOffsetMinutes)
    );
    const punchInCutoff = Math.min(endMinutes - 1, punchOutWindowStart - 1);
    const punchInFollowUp = Math.min(
      punchInCutoff,
      Math.max(
        punchInStart + 5,
        startMinutes + Math.max(graceMinutes, settings.punchInFollowUpDelayMinutes)
      )
    );

    if (
      settings.maxRemindersPerEvent >= 2 &&
      localMinutesOfDay >= punchInFollowUp &&
      localMinutesOfDay <= punchInCutoff &&
      !hasSentOrAttemptedType('missed_punch_in')
    ) {
      due.push({
        dedupKey: `${employee.id}_${localDate}_missed_punch_in`,
        employeeId: employee.id,
        employeeUid: employee.uid,
        employeeName: employee.fullName,
        department: employee.department,
        location: empLoc,
        reminderType: 'missed_punch_in',
        attendanceDate: localDate,
        timezone: tz,
        title: 'TalentGrade · Missed Punch-In Reminder',
        body: `Hi ${firstName}, your ${effectiveStartStr} shift has started and you haven't punched in yet. Please punch in now or submit Attendance Regularization if needed.`,
        url: '/?page=attendance&action=punch&reminder=missed_punch_in',
        tag: `tg_att_${employee.id}_${localDate}_missed_punch_in`,
      });
      remainingDailyQuota -= 1;
    } else if (
      localMinutesOfDay >= punchInStart &&
      localMinutesOfDay <= punchInCutoff &&
      !hasSentOrAttemptedType('punch_in') &&
      !hasSentOrAttemptedType('missed_punch_in')
    ) {
      due.push({
        dedupKey: `${employee.id}_${localDate}_punch_in`,
        employeeId: employee.id,
        employeeUid: employee.uid,
        employeeName: employee.fullName,
        department: employee.department,
        location: empLoc,
        reminderType: 'punch_in',
        attendanceDate: localDate,
        timezone: tz,
        title: 'TalentGrade · Time to Punch In',
        body: `Good morning, ${firstName}! Your shift begins at ${effectiveStartStr}. Open Attendance in the TalentGrade Workforce Portal to record your punch-in.`,
        url: '/?page=attendance&action=punch&reminder=punch_in',
        tag: `tg_att_${employee.id}_${localDate}_punch_in`,
      });
      remainingDailyQuota -= 1;
    }
  }

  // 2. Punch-Out & Missed Punch-Out Evaluation
  const eligibleForPunchOut =
    Boolean(record?.punchInTime) || settings.sendPunchOutIfNotPunchedIn;

  if (
    remainingDailyQuota > 0 &&
    settings.punchOutEnabled &&
    empPrefs.punchOutReminders &&
    !record?.punchOutTime &&
    eligibleForPunchOut
  ) {
    const punchOutStart = Math.max(0, endMinutes + settings.punchOutOffsetMinutes);
    const punchOutFollowUp = Math.min(
      1430,
      Math.max(punchOutStart + 5, endMinutes + settings.punchOutFollowUpDelayMinutes)
    );
    const punchOutCutoff = Math.min(1439, punchOutFollowUp + 240);

    if (
      settings.maxRemindersPerEvent >= 2 &&
      localMinutesOfDay >= punchOutFollowUp &&
      localMinutesOfDay <= punchOutCutoff &&
      !hasSentOrAttemptedType('missed_punch_out')
    ) {
      due.push({
        dedupKey: `${employee.id}_${localDate}_missed_punch_out`,
        employeeId: employee.id,
        employeeUid: employee.uid,
        employeeName: employee.fullName,
        department: employee.department,
        location: empLoc,
        reminderType: 'missed_punch_out',
        attendanceDate: localDate,
        timezone: tz,
        title: 'TalentGrade · Missed Punch-Out Reminder',
        body: `Hi ${firstName}, your ${effectiveEndStr} shift has ended and your punch-out is still pending. Please punch out now or submit Attendance Regularization.`,
        url: '/?page=attendance&action=punch&reminder=missed_punch_out',
        tag: `tg_att_${employee.id}_${localDate}_missed_punch_out`,
      });
      remainingDailyQuota -= 1;
    } else if (
      localMinutesOfDay >= punchOutStart &&
      localMinutesOfDay <= punchOutCutoff &&
      !hasSentOrAttemptedType('punch_out') &&
      !hasSentOrAttemptedType('missed_punch_out')
    ) {
      due.push({
        dedupKey: `${employee.id}_${localDate}_punch_out`,
        employeeId: employee.id,
        employeeUid: employee.uid,
        employeeName: employee.fullName,
        department: employee.department,
        location: empLoc,
        reminderType: 'punch_out',
        attendanceDate: localDate,
        timezone: tz,
        title: 'TalentGrade · Punch-Out Reminder',
        body: `Shift wrap-up (${effectiveEndStr}), ${firstName}: Remember to punch out in the TalentGrade Workforce Portal before finishing your workday.`,
        url: '/?page=attendance&action=punch&reminder=punch_out',
        tag: `tg_att_${employee.id}_${localDate}_punch_out`,
      });
    }
  }

  return due;
}

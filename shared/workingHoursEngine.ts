import type { CompanySettings, Employee, AttendanceRecord, AttendanceCorrection, AttendanceStatus } from '../src/types/hr';
import { getLocalTodayForTimezone, isValidDateStr, resolveSafeTimezone, utcIsoToLocalHHmm } from './regularizationEngine';

export type WorkingHoursRangePreset = '7d' | '30d' | 'month' | 'custom';

export interface DailyWorkingHoursPoint {
  date: string;
  dayShort: string;
  label: string;
  isScheduledWorkingDay: boolean;
  isHoliday: boolean;
  hasRecord: boolean;
  hasValidDuration: boolean;
  isIncompletePunch: boolean;
  isMissingAttendance: boolean;
  punchInTime?: string;
  punchOutTime?: string;
  punchInHHmm: string;
  punchOutHHmm: string;
  workingMinutes: number;
  workingHours: number;
  status: AttendanceStatus | 'Missing' | 'Weekend' | 'Holiday';
  isLate: boolean;
  lateByMinutes: number;
  source: 'attendance' | 'approved_regularization' | 'none';
}

export interface WeeklyWorkingHoursBucket {
  weekStart: string;
  weekEnd: string;
  label: string;
  totalMinutes: number;
  totalHours: number;
  averageDailyHours: number;
  daysWorked: number;
  lateArrivals: number;
  missingRecords: number;
  incompleteRecords: number;
}

export interface MonthlyWorkingHoursBucket {
  month: string; // YYYY-MM
  label: string;
  totalMinutes: number;
  totalHours: number;
  averageDailyHours: number;
  daysWorked: number;
  lateArrivals: number;
  missingRecords: number;
  incompleteRecords: number;
}

export interface WorkingHoursDayExtremum {
  date: string;
  minutes: number;
  hours: number;
}

export interface WorkingHoursAnalyticsSummary {
  startDate: string;
  endDate: string;
  timezone: string;
  totalMinutes: number;
  totalHours: number;
  averageDailyMinutes: number;
  averageDailyHours: number;
  workingDaysRecorded: number;
  scheduledWorkingDays: number;
  highestDay: WorkingHoursDayExtremum | null;
  lowestDay: WorkingHoursDayExtremum | null;
  lateArrivalsCount: number;
  missingAttendanceCount: number;
  incompleteRecordsCount: number;
}

export interface WorkingHoursAnalyticsResult {
  summary: WorkingHoursAnalyticsSummary;
  daily: DailyWorkingHoursPoint[];
  weekly: WeeklyWorkingHoursBucket[];
  monthly: MonthlyWorkingHoursBucket[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function addDaysUtc(dateStr: string, deltaDays: number): string {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return dateStr;
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function enumerateDateRange(startDate: string, endDate: string, maxDays = 366): string[] {
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate) || endDate < startDate) {
    return [];
  }
  const out: string[] = [];
  let cur = startDate;
  let guard = 0;
  while (cur <= endDate && guard < maxDays) {
    out.push(cur);
    cur = addDaysUtc(cur, 1);
    guard++;
  }
  return out;
}

function getMondayOfWeek(dateStr: string): string {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  const dow = dt.getUTCDay(); // 0 Sun ... 6 Sat
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  return addDaysUtc(dateStr, diffToMon);
}

function formatDayShort(dateStr: string): string {
  const dt = new Date(`${dateStr}T12:00:00Z`);
  return dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function formatShortDateLabel(dateStr: string): string {
  const dt = new Date(`${dateStr}T12:00:00Z`);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m) return monthStr;
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatMinutesAsHoursLabel(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export function resolveAnalyticsDateRange(
  preset: WorkingHoursRangePreset,
  todayStr: string,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string } {
  const safeToday = isValidDateStr(todayStr) ? todayStr : new Date().toISOString().slice(0, 10);
  if (preset === '7d') {
    return { startDate: addDaysUtc(safeToday, -6), endDate: safeToday };
  }
  if (preset === '30d') {
    return { startDate: addDaysUtc(safeToday, -29), endDate: safeToday };
  }
  if (preset === 'month') {
    return { startDate: `${safeToday.slice(0, 7)}-01`, endDate: safeToday };
  }
  const s = isValidDateStr(customStart || '') ? customStart! : addDaysUtc(safeToday, -29);
  const e = isValidDateStr(customEnd || '') ? customEnd! : safeToday;
  if (e < s) {
    return { startDate: e, endDate: s };
  }
  // Cap custom span at 366 days for responsive SVG rendering & accurate analytics
  const maxEnd = addDaysUtc(s, 365);
  return { startDate: s, endDate: e > maxEnd ? maxEnd : e };
}

/**
 * Strictly computes working minutes from punch-in and punch-out timestamps.
 * Returns null if either timestamp is missing, invalid, or punch-out <= punch-in.
 */
export function computeStrictPunchDurationMinutes(
  punchInIso?: string,
  punchOutIso?: string
): number | null {
  if (!punchInIso || !punchOutIso) return null;
  const inMs = new Date(punchInIso).getTime();
  const outMs = new Date(punchOutIso).getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) {
    return null;
  }
  const diffMin = Math.round((outMs - inMs) / 60000);
  if (!Number.isFinite(diffMin) || diffMin <= 0 || diffMin > 1440) {
    return null;
  }
  return diffMin;
}

export interface BuildWorkingHoursAnalyticsInput {
  employee: Employee;
  records: AttendanceRecord[];
  settings: CompanySettings;
  startDate: string;
  endDate: string;
  approvedCorrections?: AttendanceCorrection[];
  referenceNow?: Date;
}

export function buildWorkingHoursAnalytics(
  input: BuildWorkingHoursAnalyticsInput
): WorkingHoursAnalyticsResult {
  const { employee, records, settings, startDate, endDate } = input;
  const timezone = resolveSafeTimezone(employee.timezone || 'Asia/Kolkata');
  const todayInTz = getLocalTodayForTimezone(timezone, input.referenceNow || new Date());
  const workingDays =
    Array.isArray(employee.workingDays) && employee.workingDays.length > 0
      ? employee.workingDays
      : Array.isArray(settings.workingDays) && settings.workingDays.length > 0
        ? settings.workingDays
        : [1, 2, 3, 4, 5];

  const holidayDates = new Set(
    (settings.holidays || []).map((h) => h.date).filter((d) => isValidDateStr(d))
  );

  // Index attendance records belonging strictly to this employee by date
  const recordByDate = new Map<string, AttendanceRecord>();
  for (const r of records) {
    if (r.employeeId !== employee.id) continue;
    if (!isValidDateStr(r.date)) continue;
    recordByDate.set(r.date, r);
  }

  // Only consider explicitly Approved regularizations that produced valid punch-in & punch-out times
  const approvedByDate = new Map<string, AttendanceCorrection>();
  if (Array.isArray(input.approvedCorrections)) {
    for (const c of input.approvedCorrections) {
      if (c.employeeId !== employee.id) continue;
      if (c.status !== 'Approved') continue;
      if (!isValidDateStr(c.date)) continue;
      if (c.appliedChanges?.punchInTime && c.appliedChanges?.punchOutTime) {
        approvedByDate.set(c.date, c);
      }
    }
  }

  const dates = enumerateDateRange(startDate, endDate, 366);
  const daily: DailyWorkingHoursPoint[] = [];

  for (const date of dates) {
    const dt = new Date(`${date}T12:00:00Z`);
    const dow = dt.getUTCDay();
    const isScheduledWorkingDay = workingDays.includes(dow);
    const isHoliday = holidayDates.has(date);

    const rec = recordByDate.get(date);
    const approvedCorr = approvedByDate.get(date);

    let punchInTime = rec?.punchInTime;
    let punchOutTime = rec?.punchOutTime;
    let source: DailyWorkingHoursPoint['source'] = rec ? 'attendance' : 'none';

    // If an approved regularization exists with valid timestamps and the main attendance record
    // lacks valid punch-in/out (e.g. legacy sync delay), apply only the Approved correction timestamps
    if (
      approvedCorr?.appliedChanges &&
      (!punchInTime || !punchOutTime || rec?.status === 'Incomplete Attendance')
    ) {
      const corrDuration = computeStrictPunchDurationMinutes(
        approvedCorr.appliedChanges.punchInTime,
        approvedCorr.appliedChanges.punchOutTime
      );
      if (corrDuration !== null) {
        punchInTime = approvedCorr.appliedChanges.punchInTime;
        punchOutTime = approvedCorr.appliedChanges.punchOutTime;
        source = 'approved_regularization';
      }
    }

    const recTz = resolveSafeTimezone(rec?.timezone || timezone);
    const strictMinutes =
      rec?.status === 'Incomplete Attendance' || rec?.status === 'Absent' || rec?.status === 'Leave'
        ? source === 'approved_regularization'
          ? computeStrictPunchDurationMinutes(punchInTime, punchOutTime)
          : null
        : computeStrictPunchDurationMinutes(punchInTime, punchOutTime);

    const hasValidDuration = strictMinutes !== null && strictMinutes > 0;
    const isIncompletePunch = Boolean(
      (punchInTime && !punchOutTime) || rec?.status === 'Incomplete Attendance'
    );

    const afterJoining = !isValidDateStr(employee.joiningDate) || date >= employee.joiningDate;
    const isPastOrToday = date <= todayInTz;

    const isMissingAttendance = Boolean(
      afterJoining &&
        isPastOrToday &&
        isScheduledWorkingDay &&
        !isHoliday &&
        (!rec || rec.status === 'Absent') &&
        !hasValidDuration &&
        !isIncompletePunch
    );

    let effectiveStatus: DailyWorkingHoursPoint['status'];
    if (rec) {
      if (source === 'approved_regularization' && approvedCorr?.appliedChanges?.status) {
        effectiveStatus = approvedCorr.appliedChanges.status;
      } else {
        effectiveStatus = rec.status;
      }
    } else if (isHoliday) {
      effectiveStatus = 'Holiday';
    } else if (!isScheduledWorkingDay) {
      effectiveStatus = 'Weekend';
    } else if (isMissingAttendance) {
      effectiveStatus = 'Missing';
    } else {
      effectiveStatus = 'Absent';
    }

    const workingMinutes = hasValidDuration ? strictMinutes! : 0;
    const workingHours = round2(workingMinutes / 60);
    const isLate = Boolean(
      (rec?.isLate || rec?.status === 'Late') &&
        effectiveStatus !== 'Leave' &&
        effectiveStatus !== 'Absent'
    );

    daily.push({
      date,
      dayShort: formatDayShort(date),
      label: formatShortDateLabel(date),
      isScheduledWorkingDay,
      isHoliday,
      hasRecord: Boolean(rec),
      hasValidDuration,
      isIncompletePunch,
      isMissingAttendance,
      punchInTime,
      punchOutTime,
      punchInHHmm: punchInTime ? utcIsoToLocalHHmm(punchInTime, recTz) : '',
      punchOutHHmm: punchOutTime ? utcIsoToLocalHHmm(punchOutTime, recTz) : '',
      workingMinutes,
      workingHours,
      status: effectiveStatus,
      isLate,
      lateByMinutes: isLate ? Math.max(0, Number(rec?.lateByMinutes || 0)) : 0,
      source,
    });
  }

  // Summary metrics (strictly over valid completed work records)
  const validDays = daily.filter((d) => d.hasValidDuration);
  const totalMinutes = validDays.reduce((sum, d) => sum + d.workingMinutes, 0);
  const workingDaysRecorded = validDays.length;
  const averageDailyMinutes =
    workingDaysRecorded > 0 ? Math.round(totalMinutes / workingDaysRecorded) : 0;

  let highestDay: WorkingHoursDayExtremum | null = null;
  let lowestDay: WorkingHoursDayExtremum | null = null;
  for (const d of validDays) {
    if (!highestDay || d.workingMinutes > highestDay.minutes) {
      highestDay = { date: d.date, minutes: d.workingMinutes, hours: d.workingHours };
    }
    if (!lowestDay || d.workingMinutes < lowestDay.minutes) {
      lowestDay = { date: d.date, minutes: d.workingMinutes, hours: d.workingHours };
    }
  }

  const scheduledWorkingDays = daily.filter(
    (d) =>
      d.isScheduledWorkingDay &&
      !d.isHoliday &&
      (!isValidDateStr(employee.joiningDate) || d.date >= employee.joiningDate) &&
      d.date <= todayInTz
  ).length;

  // Weekly aggregation
  const weekMap = new Map<string, DailyWorkingHoursPoint[]>();
  for (const d of daily) {
    const wk = getMondayOfWeek(d.date);
    const list = weekMap.get(wk) || [];
    list.push(d);
    weekMap.set(wk, list);
  }
  const weekly: WeeklyWorkingHoursBucket[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, pts]) => {
      const weekEnd = addDaysUtc(weekStart, 6);
      const valid = pts.filter((p) => p.hasValidDuration);
      const wkMins = valid.reduce((s, p) => s + p.workingMinutes, 0);
      const wkDays = valid.length;
      return {
        weekStart,
        weekEnd,
        label: `${formatShortDateLabel(weekStart)} – ${formatShortDateLabel(weekEnd)}`,
        totalMinutes: wkMins,
        totalHours: round2(wkMins / 60),
        averageDailyHours: wkDays > 0 ? round2(wkMins / 60 / wkDays) : 0,
        daysWorked: wkDays,
        lateArrivals: pts.filter((p) => p.isLate).length,
        missingRecords: pts.filter((p) => p.isMissingAttendance).length,
        incompleteRecords: pts.filter((p) => p.isIncompletePunch).length,
      };
    });

  // Monthly aggregation
  const monthMap = new Map<string, DailyWorkingHoursPoint[]>();
  for (const d of daily) {
    const mo = d.date.slice(0, 7);
    const list = monthMap.get(mo) || [];
    list.push(d);
    monthMap.set(mo, list);
  }
  const monthly: MonthlyWorkingHoursBucket[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pts]) => {
      const valid = pts.filter((p) => p.hasValidDuration);
      const mMins = valid.reduce((s, p) => s + p.workingMinutes, 0);
      const mDays = valid.length;
      return {
        month,
        label: formatMonthLabel(month),
        totalMinutes: mMins,
        totalHours: round2(mMins / 60),
        averageDailyHours: mDays > 0 ? round2(mMins / 60 / mDays) : 0,
        daysWorked: mDays,
        lateArrivals: pts.filter((p) => p.isLate).length,
        missingRecords: pts.filter((p) => p.isMissingAttendance).length,
        incompleteRecords: pts.filter((p) => p.isIncompletePunch).length,
      };
    });

  return {
    summary: {
      startDate,
      endDate,
      timezone,
      totalMinutes,
      totalHours: round2(totalMinutes / 60),
      averageDailyMinutes,
      averageDailyHours: round2(averageDailyMinutes / 60),
      workingDaysRecorded,
      scheduledWorkingDays,
      highestDay,
      lowestDay,
      lateArrivalsCount: daily.filter((d) => d.isLate).length,
      missingAttendanceCount: daily.filter((d) => d.isMissingAttendance).length,
      incompleteRecordsCount: daily.filter((d) => d.isIncompletePunch).length,
    },
    daily,
    weekly,
    monthly,
  };
}

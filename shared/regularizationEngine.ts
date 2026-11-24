export type RegularizationRequestType =
  | 'missed_punch_in'
  | 'missed_punch_out'
  | 'both_missed'
  | 'incorrect_punch'
  | 'other_discrepancy';

export type RegularizedAttendanceStatus =
  | 'Present'
  | 'Late'
  | 'Half Day'
  | 'Incomplete Attendance';

export const REGULARIZATION_TYPE_LABELS: Record<RegularizationRequestType, string> = {
  missed_punch_in: 'Missed Punch-In',
  missed_punch_out: 'Missed Punch-Out',
  both_missed: 'Both Punch-In & Punch-Out Missed',
  incorrect_punch: 'Incorrect Recorded Punch Time',
  other_discrepancy: 'Other Attendance Discrepancy',
};

export const REGULARIZATION_REQUEST_TYPES: RegularizationRequestType[] = [
  'missed_punch_in',
  'missed_punch_out',
  'both_missed',
  'incorrect_punch',
  'other_discrepancy',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDateStr(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidHHmm(hhmm: string): boolean {
  return HHMM_RE.test(hhmm);
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function resolveSafeTimezone(timeZone?: string): string {
  const candidate = (timeZone || '').trim() || 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'Asia/Kolkata';
  }
}

export function getLocalTodayForTimezone(timeZone = 'Asia/Kolkata', referenceNow = new Date()): string {
  const safeTz = resolveSafeTimezone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(referenceNow);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function getZonedDateTimeComponents(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const getNum = (type: string) => Number(parts.find((p) => p.type === type)?.value || '0');
  return {
    year: getNum('year'),
    month: getNum('month'),
    day: getNum('day'),
    hour: getNum('hour') % 24,
    minute: getNum('minute'),
    second: getNum('second'),
  };
}

/**
 * Converts a wall-clock YYYY-MM-DD + HH:mm in a specific IANA timezone (e.g. Asia/Kolkata, Asia/Dubai)
 * into an authoritative UTC ISO-8601 timestamp string.
 */
export function localDateTimeToUtcIso(dateStr: string, hhmm: string, timeZone = 'Asia/Kolkata'): string {
  if (!isValidDateStr(dateStr)) {
    throw new Error(`Invalid attendance date: ${dateStr}`);
  }
  if (!isValidHHmm(hhmm)) {
    throw new Error(`Invalid time value: ${hhmm}`);
  }
  const safeTz = resolveSafeTimezone(timeZone);
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);

  const desiredUtcMs = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  let guessMs = desiredUtcMs;

  // Iterative fixed-point offset resolution (converges in 2 steps for all IANA zones)
  for (let i = 0; i < 4; i++) {
    const z = getZonedDateTimeComponents(new Date(guessMs), safeTz);
    const zonedAsUtcMs = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second, 0);
    const diffMs = desiredUtcMs - zonedAsUtcMs;
    if (diffMs === 0) break;
    guessMs += diffMs;
  }

  return new Date(guessMs).toISOString();
}

export function utcIsoToLocalHHmm(iso: string | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const safeTz = resolveSafeTimezone(timeZone);
  const z = getZonedDateTimeComponents(dt, safeTz);
  return `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
}

export function makeRegularizationLockId(
  employeeId: string,
  date: string,
  requestType: RegularizationRequestType
): string {
  return `${employeeId}_${date}_${requestType}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export interface ValidateRegularizationInput {
  date: string;
  todayInTimezone: string;
  requestType: RegularizationRequestType;
  requestedPunchIn?: string;
  requestedPunchOut?: string;
  reason: string;
}

export interface ValidateRegularizationResult {
  valid: boolean;
  error?: string;
  normalizedPunchIn: string;
  normalizedPunchOut: string;
  normalizedReason: string;
}

export function validateRegularizationPayload(
  input: ValidateRegularizationInput
): ValidateRegularizationResult {
  const date = (input.date || '').trim();
  const today = (input.todayInTimezone || '').trim();
  const punchIn = (input.requestedPunchIn || '').trim();
  const punchOut = (input.requestedPunchOut || '').trim();
  const reason = (input.reason || '').trim();
  const type = input.requestType;

  if (!REGULARIZATION_REQUEST_TYPES.includes(type)) {
    return {
      valid: false,
      error: 'Please select a valid regularization request type.',
      normalizedPunchIn: '',
      normalizedPunchOut: '',
      normalizedReason: reason,
    };
  }

  if (!isValidDateStr(date)) {
    return {
      valid: false,
      error: 'Please choose a valid attendance date (YYYY-MM-DD).',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (!isValidDateStr(today)) {
    return {
      valid: false,
      error: 'Unable to determine current reference date.',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (date >= today) {
    return {
      valid: false,
      error: 'Attendance regularization requests can only be submitted for past dates (not today or future dates).',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (punchIn && !isValidHHmm(punchIn)) {
    return {
      valid: false,
      error: 'Requested punch-in time must be in valid 24-hour HH:mm format.',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (punchOut && !isValidHHmm(punchOut)) {
    return {
      valid: false,
      error: 'Requested punch-out time must be in valid 24-hour HH:mm format.',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (type === 'missed_punch_in' && !punchIn) {
    return {
      valid: false,
      error: 'Please provide the requested punch-in time for a Missed Punch-In request.',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (type === 'missed_punch_out' && !punchOut) {
    return {
      valid: false,
      error: 'Please provide the requested punch-out time for a Missed Punch-Out request.',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (type === 'both_missed' && (!punchIn || !punchOut)) {
    return {
      valid: false,
      error: 'Please provide both requested punch-in and punch-out times.',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if ((type === 'incorrect_punch' || type === 'other_discrepancy') && !punchIn && !punchOut) {
    return {
      valid: false,
      error: 'Please specify at least one corrected punch-in or punch-out time.',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (punchIn && punchOut && hhmmToMinutes(punchOut) <= hhmmToMinutes(punchIn)) {
    return {
      valid: false,
      error: 'Requested punch-out time must be later than the punch-in time.',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  if (reason.length < 3 || reason.length > 500) {
    return {
      valid: false,
      error: 'Please provide a clear reason for regularization (3–500 characters).',
      normalizedPunchIn: punchIn,
      normalizedPunchOut: punchOut,
      normalizedReason: reason,
    };
  }

  return {
    valid: true,
    normalizedPunchIn: punchIn,
    normalizedPunchOut: punchOut,
    normalizedReason: reason,
  };
}

export interface RegularizationScheduleRule {
  timezone: string;
  officeStartTime: string; // HH:mm
  gracePeriodMinutes: number;
  halfDayMinHours: number;
  fullDayMinHours: number;
}

export interface ComputeRegularizationMetricsInput {
  date: string;
  timeZone: string;
  requestedPunchIn?: string;
  requestedPunchOut?: string;
  existingPunchInIso?: string;
  existingPunchOutIso?: string;
  schedule: RegularizationScheduleRule;
}

export interface ComputedRegularizationMetrics {
  timezone: string;
  punchInTime?: string;
  punchOutTime?: string;
  punchInHHmm: string;
  punchOutHHmm: string;
  workingMinutes: number;
  isLate: boolean;
  lateByMinutes: number;
  status: RegularizedAttendanceStatus;
}

export function computeRegularizedAttendanceMetrics(
  input: ComputeRegularizationMetricsInput
): ComputedRegularizationMetrics {
  const safeTz = resolveSafeTimezone(input.timeZone || input.schedule.timezone);
  const reqIn = (input.requestedPunchIn || '').trim();
  const reqOut = (input.requestedPunchOut || '').trim();

  const punchInTime = reqIn
    ? localDateTimeToUtcIso(input.date, reqIn, safeTz)
    : input.existingPunchInIso || undefined;
  const punchOutTime = reqOut
    ? localDateTimeToUtcIso(input.date, reqOut, safeTz)
    : input.existingPunchOutIso || undefined;

  if (punchInTime && punchOutTime) {
    const inMs = new Date(punchInTime).getTime();
    const outMs = new Date(punchOutTime).getTime();
    if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs <= inMs) {
      throw new Error('Effective punch-out time must be later than punch-in time.');
    }
  }

  const punchInHHmm = punchInTime ? utcIsoToLocalHHmm(punchInTime, safeTz) : '';
  const punchOutHHmm = punchOutTime ? utcIsoToLocalHHmm(punchOutTime, safeTz) : '';

  let isLate = false;
  let lateByMinutes = 0;

  if (punchInHHmm && isValidHHmm(punchInHHmm)) {
    const startHHmm = isValidHHmm(input.schedule.officeStartTime)
      ? input.schedule.officeStartTime
      : '09:30';
    const officeStartMinutes = hhmmToMinutes(startHHmm);
    const punchInMinutes = hhmmToMinutes(punchInHHmm);
    const diff = punchInMinutes - officeStartMinutes;
    const grace = Math.max(0, Number(input.schedule.gracePeriodMinutes || 0));
    isLate = diff > grace;
    lateByMinutes = isLate ? Math.max(1, diff) : 0;
  }

  let workingMinutes = 0;
  let status: RegularizedAttendanceStatus = 'Incomplete Attendance';

  if (punchInTime && punchOutTime) {
    const inMs = new Date(punchInTime).getTime();
    const outMs = new Date(punchOutTime).getTime();
    workingMinutes = Math.max(0, Math.min(1440, Math.round((outMs - inMs) / 60000)));
    const fullDayMin = Math.max(1, Number(input.schedule.fullDayMinHours || 8)) * 60;
    if (workingMinutes < fullDayMin) {
      status = 'Half Day';
    } else {
      status = isLate ? 'Late' : 'Present';
    }
  } else {
    workingMinutes = 0;
    status = 'Incomplete Attendance';
  }

  return {
    timezone: safeTz,
    punchInTime,
    punchOutTime,
    punchInHHmm,
    punchOutHHmm,
    workingMinutes,
    isLate,
    lateByMinutes,
    status,
  };
}

export type CelebrationType = 'birthday' | 'anniversary';

export type CelebrationVisibilityScope = 'all_active' | 'department' | 'leaders_only';

export interface CelebrationSettings {
  birthdaysEnabled: boolean;
  anniversariesEnabled: boolean;
  feedEnabled: boolean;
  upcomingRemindersEnabled: boolean;
  upcomingWindowDays: number;
  wishesEnabled: boolean;
  visibilityScope: CelebrationVisibilityScope;
  timezone: string;
}

export const DEFAULT_CELEBRATION_SETTINGS: CelebrationSettings = {
  birthdaysEnabled: true,
  anniversariesEnabled: true,
  feedEnabled: true,
  upcomingRemindersEnabled: true,
  upcomingWindowDays: 7,
  wishesEnabled: true,
  visibilityScope: 'all_active',
  timezone: 'Asia/Kolkata',
};

export function normalizeCelebrationSettings(
  raw?: Partial<CelebrationSettings> | null
): CelebrationSettings {
  const windowDays = Number(raw?.upcomingWindowDays ?? DEFAULT_CELEBRATION_SETTINGS.upcomingWindowDays);
  const clampedDays = Number.isFinite(windowDays) ? Math.min(30, Math.max(1, Math.round(windowDays))) : 7;
  const scope = raw?.visibilityScope;
  const validScope: CelebrationVisibilityScope =
    scope === 'department' || scope === 'leaders_only' ? scope : 'all_active';

  return {
    birthdaysEnabled:
      typeof raw?.birthdaysEnabled === 'boolean'
        ? raw.birthdaysEnabled
        : DEFAULT_CELEBRATION_SETTINGS.birthdaysEnabled,
    anniversariesEnabled:
      typeof raw?.anniversariesEnabled === 'boolean'
        ? raw.anniversariesEnabled
        : DEFAULT_CELEBRATION_SETTINGS.anniversariesEnabled,
    feedEnabled:
      typeof raw?.feedEnabled === 'boolean' ? raw.feedEnabled : DEFAULT_CELEBRATION_SETTINGS.feedEnabled,
    upcomingRemindersEnabled:
      typeof raw?.upcomingRemindersEnabled === 'boolean'
        ? raw.upcomingRemindersEnabled
        : DEFAULT_CELEBRATION_SETTINGS.upcomingRemindersEnabled,
    upcomingWindowDays: clampedDays,
    wishesEnabled:
      typeof raw?.wishesEnabled === 'boolean'
        ? raw.wishesEnabled
        : DEFAULT_CELEBRATION_SETTINGS.wishesEnabled,
    visibilityScope: validScope,
    timezone:
      typeof raw?.timezone === 'string' && raw.timezone.trim()
        ? raw.timezone.trim()
        : DEFAULT_CELEBRATION_SETTINGS.timezone,
  };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getCelebrationDateParts(referenceNow: Date, timeZone = 'Asia/Kolkata'): {
  todayDate: string; // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  monthDay: string; // MM-DD
} {
  let validTz = 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(referenceNow);
    validTz = timeZone;
  } catch {
    validTz = 'Asia/Kolkata';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(referenceNow);

  const y = Number(parts.find((p) => p.type === 'year')?.value || referenceNow.getUTCFullYear());
  const m = Number(parts.find((p) => p.type === 'month')?.value || referenceNow.getUTCMonth() + 1);
  const d = Number(parts.find((p) => p.type === 'day')?.value || referenceNow.getUTCDate());
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');

  return {
    todayDate: `${y}-${mm}-${dd}`,
    year: y,
    month: m,
    day: d,
    monthDay: `${mm}-${dd}`,
  };
}

export function addDaysToIsoDate(isoDate: string, offsetDays: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

export function extractMonthDayFromDate(dateStr?: string): string | undefined {
  if (!dateStr || typeof dateStr !== 'string') return undefined;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed.slice(5, 10);
  }
  if (/^\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

/**
 * Resolves a MM-DD celebration date into an exact YYYY-MM-DD for the given calendar year,
 * mapping Feb 29 to Feb 28 in non-leap years.
 */
export function resolveMonthDayForYear(monthDay: string, year: number): string | null {
  if (!/^\d{2}-\d{2}$/.test(monthDay)) return null;
  if (monthDay === '02-29' && !isLeapYear(year)) {
    return `${year}-02-28`;
  }
  return `${year}-${monthDay}`;
}

export interface EngineCelebrationProfileInput {
  employeeId: string;
  employeeUid?: string;
  fullName: string;
  department: string;
  designation?: string;
  location?: string;
  status: string;
  profilePhotoAssetId?: string;
  birthdayMonthDay?: string; // MM-DD (privacy-safe: no birth year)
  joiningDate?: string; // YYYY-MM-DD
}

export interface ComputedCelebrationOccurrence {
  notificationId: string;
  type: CelebrationType;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department: string;
  designation: string;
  profilePhotoAssetId?: string;
  celebrationDate: string; // YYYY-MM-DD
  celebrationMonthDay: string; // MM-DD
  year: number;
  yearsCompleted?: number;
  daysUntil: number; // 0 = today, >0 = upcoming, <0 = recent past
  title: string;
  message: string;
}

export function makeCelebrationNotificationId(
  type: CelebrationType,
  employeeId: string,
  year: number
): string {
  const safeEmp = String(employeeId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return `cel_${type}_${safeEmp}_${year}`;
}

export function formatCelebrationMonthDayLabel(monthDayOrIso: string): string {
  const md = extractMonthDayFromDate(monthDayOrIso);
  if (!md) return monthDayOrIso;
  const [m, d] = md.split('-').map(Number);
  const dt = new Date(Date.UTC(2024, (m || 1) - 1, d || 1)); // leap year safe for Feb 29
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatAnniversaryHeadline(yearsCompleted: number, companyName = 'TalentGrade'): string {
  return `Celebrating ${yearsCompleted} ${yearsCompleted === 1 ? 'year' : 'years'} at ${companyName}!`;
}

/**
 * Evaluates celebrations across a relative day window [lookbackDays .. lookaheadDays]
 * anchored to `referenceNow` in the configured company timezone.
 */
export function evaluateCelebrationsWindow(params: {
  profiles: EngineCelebrationProfileInput[];
  settings: CelebrationSettings;
  companyName?: string;
  referenceNow?: Date;
  lookbackDays?: number;
  lookaheadDays?: number;
}): {
  todayDate: string;
  timezone: string;
  occurrences: ComputedCelebrationOccurrence[];
  notificationsToPersist: ComputedCelebrationOccurrence[];
} {
  const companyName = (params.companyName || 'TalentGrade').trim() || 'TalentGrade';
  const cfg = normalizeCelebrationSettings(params.settings);
  const now = params.referenceNow || new Date();
  const { todayDate } = getCelebrationDateParts(now, cfg.timezone);
  const lookback = Math.max(0, params.lookbackDays ?? 7);
  const lookahead = Math.max(0, params.lookaheadDays ?? cfg.upcomingWindowDays);

  const occurrences: ComputedCelebrationOccurrence[] = [];
  const notificationsToPersist: ComputedCelebrationOccurrence[] = [];
  const seenKeys = new Set<string>();

  for (const emp of params.profiles) {
    // Strictly exclude Inactive, Resigned, or Terminated employees
    if (emp.status !== 'Active') continue;

    for (let offset = -lookback; offset <= lookahead; offset++) {
      const targetDate = addDaysToIsoDate(todayDate, offset);
      const targetYear = Number(targetDate.slice(0, 4));
      const targetMonthDay = targetDate.slice(5, 10);

      // 1. Birthday check (uses only MM-DD — never exposes birth year)
      if (cfg.birthdaysEnabled && emp.birthdayMonthDay) {
        const effectiveMd =
          emp.birthdayMonthDay === '02-29' && !isLeapYear(targetYear)
            ? '02-28'
            : emp.birthdayMonthDay;

        if (effectiveMd === targetMonthDay) {
          const notifId = makeCelebrationNotificationId('birthday', emp.employeeId, targetYear);
          if (!seenKeys.has(notifId)) {
            seenKeys.add(notifId);
            const item: ComputedCelebrationOccurrence = {
              notificationId: notifId,
              type: 'birthday',
              employeeId: emp.employeeId,
              employeeUid: emp.employeeUid || '',
              employeeName: emp.fullName,
              department: emp.department,
              designation: emp.designation || '',
              profilePhotoAssetId: emp.profilePhotoAssetId,
              celebrationDate: targetDate,
              celebrationMonthDay: emp.birthdayMonthDay,
              year: targetYear,
              daysUntil: offset,
              title: `Birthday · ${emp.fullName}`,
              message: `Happy Birthday to ${emp.fullName} (${emp.department})!`,
            };
            occurrences.push(item);
            if (offset <= 0) {
              notificationsToPersist.push(item);
            }
          }
        }
      }

      // 2. Work Anniversary check (only >= 1 full completed year)
      if (cfg.anniversariesEnabled && emp.joiningDate && /^\d{4}-\d{2}-\d{2}$/.test(emp.joiningDate)) {
        const joinYear = Number(emp.joiningDate.slice(0, 4));
        const joinMd = emp.joiningDate.slice(5, 10);
        const completedYears = targetYear - joinYear;

        if (completedYears >= 1) {
          const effectiveJoinMd =
            joinMd === '02-29' && !isLeapYear(targetYear) ? '02-28' : joinMd;
          if (effectiveJoinMd === targetMonthDay) {
            const notifId = makeCelebrationNotificationId('anniversary', emp.employeeId, targetYear);
            if (!seenKeys.has(notifId)) {
              seenKeys.add(notifId);
              const headline = formatAnniversaryHeadline(completedYears, companyName);
              const item: ComputedCelebrationOccurrence = {
                notificationId: notifId,
                type: 'anniversary',
                employeeId: emp.employeeId,
                employeeUid: emp.employeeUid || '',
                employeeName: emp.fullName,
                department: emp.department,
                designation: emp.designation || '',
                profilePhotoAssetId: emp.profilePhotoAssetId,
                celebrationDate: targetDate,
                celebrationMonthDay: joinMd,
                year: targetYear,
                yearsCompleted: completedYears,
                daysUntil: offset,
                title: `Work Anniversary · ${emp.fullName}`,
                message: headline,
              };
              occurrences.push(item);
              if (offset <= 0) {
                notificationsToPersist.push(item);
              }
            }
          }
        }
      }
    }
  }

  occurrences.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return a.employeeName.localeCompare(b.employeeName);
  });

  notificationsToPersist.sort((a, b) => b.celebrationDate.localeCompare(a.celebrationDate));

  return {
    todayDate,
    timezone: cfg.timezone,
    occurrences,
    notificationsToPersist,
  };
}

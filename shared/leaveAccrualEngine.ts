export type LeaveType = 'SL' | 'CL' | 'LWP';

export type LeaveLedgerEntryType =
  | 'monthly_accrual'
  | 'monthly_expiry'
  | 'year_reset'
  | 'carry_forward'
  | 'approved_deduction'
  | 'leave_reversal'
  | 'admin_adjustment'
  | 'migration_baseline'
  | 'opening_balance';

export type LeaveLedgerSource =
  | 'accrual_engine'
  | 'annual_cycle'
  | 'leave_approval'
  | 'leave_reversal'
  | 'admin_manual'
  | 'legacy_migration';

export interface LeavePolicyConfig {
  sickLeaveMonthlyRate: number;
  sickLeaveCarryForward: boolean;
  sickLeaveAnnualReset: boolean;
  casualLeaveMonthlyRate: number;
  casualLeaveEligibilityMonths: number;
  casualLeaveCarryForward: boolean;
  casualLeaveMaxCarryForward?: number; // 0 or undefined = unlimited
  casualLeaveExpiryMonths?: number; // 0 or undefined = no expiry by default
}

export const DEFAULT_LEAVE_POLICY: LeavePolicyConfig = {
  sickLeaveMonthlyRate: 1,
  sickLeaveCarryForward: false,
  sickLeaveAnnualReset: true,
  casualLeaveMonthlyRate: 1,
  casualLeaveEligibilityMonths: 6,
  casualLeaveCarryForward: true,
  casualLeaveMaxCarryForward: 0,
  casualLeaveExpiryMonths: 0,
};

export interface LeaveLedgerEntry {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeEmail: string;
  employeeName: string;
  leaveType: LeaveType;
  entryType: LeaveLedgerEntryType;
  month: string; // YYYY-MM
  year: number;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  source: LeaveLedgerSource;
  referenceId?: string;
  reason: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
}

export interface EngineEmployeeInput {
  id: string;
  uid: string;
  email: string;
  fullName: string;
  joiningDate: string; // YYYY-MM-DD
  status: string;
  timezone?: string;
  sickLeaveBalance: number;
  casualLeaveBalance: number;
  carryForwardBalance: number;
  leavePolicyMigrated?: boolean;
  leaveBaselineMonth?: string; // YYYY-MM (months <= baselineMonth are covered by opening/migration baseline)
  leaveLastSyncedMonth?: string;
  leaveLastResetYear?: number;
  clEligibilityDate?: string;
  clEligibilityCustom?: boolean;
  leaveMigrationNote?: string;
}

export interface EngineApprovedLeaveInput {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
}

export interface EmployeeLeaveComputedSummary {
  employeeId: string;
  todayLocal: string;
  currentYear: number;
  currentMonth: string;
  clEligibilityDate: string;
  isClEligible: boolean;
  sickLeaveBalance: number;
  casualLeaveBalance: number;
  carryForwardBalance: number;
  migrationBaselineSl: number;
  migrationBaselineCl: number;
  slAccruedThisYear: number;
  slExpiredThisYear: number;
  clAccruedThisYear: number;
  clAccruedTotal: number;
  slAdjustedThisYear: number;
  clAdjustedTotal: number;
  slUsedThisYear: number;
  clUsedThisYear: number;
  clUsedTotal: number;
  lwpUsedThisYear: number;
  policyExpectedSlToDate: number;
  policyExpectedClToDate: number;
  needsMigrationReview: boolean;
  leaveMigrationNote?: string;
}

export interface EmployeeAccrualPlan {
  employeeId: string;
  newLedgerEntries: Omit<LeaveLedgerEntry, 'createdAt'>[];
  employeeUpdates: {
    sickLeaveBalance: number;
    casualLeaveBalance: number;
    carryForwardBalance: number;
    leavePolicyMigrated: boolean;
    leaveBaselineMonth?: string;
    leaveLastSyncedMonth: string;
    leaveLastResetYear: number;
    clEligibilityDate: string;
    clEligibilityCustom?: boolean;
    leaveMigrationNote?: string;
  };
  hasChanges: boolean;
  summary: EmployeeLeaveComputedSummary;
}

export function round2(n: number): number {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

export function isValidIsoDate(val?: string | null): val is string {
  if (typeof val !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidYearMonth(val?: string | null): val is string {
  return typeof val === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(val.trim());
}

export function normalizeLeavePolicyConfig(raw?: Partial<LeavePolicyConfig> | null): LeavePolicyConfig {
  return {
    sickLeaveMonthlyRate:
      typeof raw?.sickLeaveMonthlyRate === 'number' &&
      Number.isFinite(raw.sickLeaveMonthlyRate) &&
      raw.sickLeaveMonthlyRate >= 0
        ? raw.sickLeaveMonthlyRate
        : DEFAULT_LEAVE_POLICY.sickLeaveMonthlyRate,
    sickLeaveCarryForward:
      typeof raw?.sickLeaveCarryForward === 'boolean'
        ? raw.sickLeaveCarryForward
        : DEFAULT_LEAVE_POLICY.sickLeaveCarryForward,
    sickLeaveAnnualReset:
      typeof raw?.sickLeaveAnnualReset === 'boolean'
        ? raw.sickLeaveAnnualReset
        : DEFAULT_LEAVE_POLICY.sickLeaveAnnualReset,
    casualLeaveMonthlyRate:
      typeof raw?.casualLeaveMonthlyRate === 'number' &&
      Number.isFinite(raw.casualLeaveMonthlyRate) &&
      raw.casualLeaveMonthlyRate >= 0
        ? raw.casualLeaveMonthlyRate
        : DEFAULT_LEAVE_POLICY.casualLeaveMonthlyRate,
    casualLeaveEligibilityMonths:
      typeof raw?.casualLeaveEligibilityMonths === 'number' &&
      Number.isFinite(raw.casualLeaveEligibilityMonths) &&
      raw.casualLeaveEligibilityMonths >= 0
        ? Math.floor(raw.casualLeaveEligibilityMonths)
        : DEFAULT_LEAVE_POLICY.casualLeaveEligibilityMonths,
    casualLeaveCarryForward:
      typeof raw?.casualLeaveCarryForward === 'boolean'
        ? raw.casualLeaveCarryForward
        : DEFAULT_LEAVE_POLICY.casualLeaveCarryForward,
    casualLeaveMaxCarryForward:
      typeof raw?.casualLeaveMaxCarryForward === 'number' &&
      Number.isFinite(raw.casualLeaveMaxCarryForward) &&
      raw.casualLeaveMaxCarryForward >= 0
        ? raw.casualLeaveMaxCarryForward
        : 0,
    casualLeaveExpiryMonths:
      typeof raw?.casualLeaveExpiryMonths === 'number' &&
      Number.isFinite(raw.casualLeaveExpiryMonths) &&
      raw.casualLeaveExpiryMonths >= 0
        ? Math.floor(raw.casualLeaveExpiryMonths)
        : 0,
  };
}

export function getLocalTodayInTimezone(date: Date, timezone = 'Asia/Kolkata'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback below
  }
  return date.toISOString().slice(0, 10);
}

export function addCalendarMonths(dateStr: string, monthsToAdd: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return dateStr;
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  const day = Number(match[3]);

  const totalMonths = year * 12 + monthIdx + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIdx = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIdx + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);

  return `${String(targetYear).padStart(4, '0')}-${String(targetMonthIdx + 1).padStart(2, '0')}-${String(
    clampedDay
  ).padStart(2, '0')}`;
}

export function calculateCasualLeaveEligibilityDate(
  joiningDate: string,
  eligibilityMonths = 6
): string {
  return addCalendarMonths(joiningDate, eligibilityMonths);
}

export function enumerateYearMonths(startYM: string, endYM: string): string[] {
  const sMatch = /^(\d{4})-(\d{2})$/.exec(startYM);
  const eMatch = /^(\d{4})-(\d{2})$/.exec(endYM);
  if (!sMatch || !eMatch) return [];
  let y = Number(sMatch[1]);
  let m = Number(sMatch[2]);
  const endY = Number(eMatch[1]);
  const endM = Number(eMatch[2]);

  const out: string[] = [];
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 240) {
    out.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    guard++;
  }
  return out;
}

function getPreviousYearMonth(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return ym;
  let y = Number(match[1]);
  let m = Number(match[2]) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

function monthDiff(olderYM: string, newerYM: string): number {
  const oMatch = /^(\d{4})-(\d{2})$/.exec(olderYM);
  const nMatch = /^(\d{4})-(\d{2})$/.exec(newerYM);
  if (!oMatch || !nMatch) return 0;
  return (Number(nMatch[1]) - Number(oMatch[1])) * 12 + (Number(nMatch[2]) - Number(oMatch[2]));
}

export function makeAccrualDocId(employeeId: string, leaveType: 'SL' | 'CL', yearMonth: string): string {
  return `acc_${employeeId}_${leaveType}_${yearMonth.replace('-', '_')}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function computeEmployeeLeaveAccrualPlan(params: {
  employee: EngineEmployeeInput;
  policy: LeavePolicyConfig;
  existingLedger: LeaveLedgerEntry[];
  approvedLeaves: EngineApprovedLeaveInput[];
  referenceNow: Date;
  actorUid: string;
  actorName: string;
  isNewEmployeeInit?: boolean;
}): EmployeeAccrualPlan {
  const { employee, policy, referenceNow, isNewEmployeeInit } = params;
  const actorUid = String(params.actorUid || 'system').trim() || 'system';
  const actorName = (String(params.actorName || '').trim() || 'System Engine').slice(0, 120);
  const empEmail = (String(employee.email || '').trim() || `${employee.id}@talentgrade.local`)
    .toLowerCase()
    .slice(0, 120);
  const empName = (String(employee.fullName || '').trim() || 'Employee').slice(0, 120);

  const tz = employee.timezone || 'Asia/Kolkata';
  const todayLocal = getLocalTodayInTimezone(referenceNow, tz);
  const currentYear = Number(todayLocal.slice(0, 4));
  const currentMonth = todayLocal.slice(0, 7);
  const joiningDate = isValidIsoDate(employee.joiningDate) ? employee.joiningDate.trim() : todayLocal;
  const joiningMonth = joiningDate.slice(0, 7);
  const joiningYear = Number(joiningDate.slice(0, 4));

  const defaultClEligibilityDate = calculateCasualLeaveEligibilityDate(
    joiningDate,
    policy.casualLeaveEligibilityMonths
  );
  const clEligibilityDate =
    employee.clEligibilityCustom && isValidIsoDate(employee.clEligibilityDate)
      ? employee.clEligibilityDate.trim()
      : defaultClEligibilityDate;
  const clEligibilityMonth = clEligibilityDate.slice(0, 7);
  const isClEligible = todayLocal >= clEligibilityDate;

  const empLedger = params.existingLedger.filter((e) => e.employeeId === employee.id);
  const empApproved = params.approvedLeaves.filter(
    (l) => l.employeeId === employee.id && l.status === 'Approved'
  );

  // Policy-expected current entitlement to date (used for onboarding defaults & legacy variance display)
  const slThisYearStart = joiningMonth > `${currentYear}-01` ? joiningMonth : `${currentYear}-01`;
  const expectedSlMonths =
    joiningDate <= todayLocal && slThisYearStart <= currentMonth
      ? enumerateYearMonths(slThisYearStart, currentMonth)
      : [];
  const policyExpectedSlToDate = !policy.sickLeaveCarryForward
    ? expectedSlMonths.includes(currentMonth)
      ? round2(policy.sickLeaveMonthlyRate)
      : 0
    : round2(expectedSlMonths.length * policy.sickLeaveMonthlyRate);

  const expectedClMonths =
    isClEligible && clEligibilityMonth <= currentMonth
      ? enumerateYearMonths(clEligibilityMonth, currentMonth).filter(
          (ym) => ym < currentMonth || todayLocal >= clEligibilityDate
        )
      : [];
  const policyExpectedClToDate = round2(expectedClMonths.length * policy.casualLeaveMonthlyRate);

  const slUsedThisYear = round2(
    empApproved
      .filter((l) => l.leaveType === 'SL' && Number(String(l.startDate || '').slice(0, 4)) === currentYear)
      .reduce((s, l) => s + Number(l.days || 0), 0)
  );
  const clUsedThisYear = round2(
    empApproved
      .filter((l) => l.leaveType === 'CL' && Number(String(l.startDate || '').slice(0, 4)) === currentYear)
      .reduce((s, l) => s + Number(l.days || 0), 0)
  );
  const clUsedTotal = round2(
    empApproved
      .filter((l) => l.leaveType === 'CL')
      .reduce((s, l) => s + Number(l.days || 0), 0)
  );
  const lwpUsedThisYear = round2(
    empApproved
      .filter((l) => l.leaveType === 'LWP' && Number(String(l.startDate || '').slice(0, 4)) === currentYear)
      .reduce((s, l) => s + Number(l.days || 0), 0)
  );

  const newEntries: Omit<LeaveLedgerEntry, 'createdAt'>[] = [];

  // SAFE LEGACY / BASELINE PRESERVATION:
  // If an employee has NO ledger entries yet (pre-migration legacy employee, or an employee whose
  // opening ledger wasn't written), preserve their stored SL/CL/CF balances in baseline entries
  // without silently overwriting or wiping them!
  if (empLedger.length === 0 && !isNewEmployeeInit) {
    const preservedSl = round2(employee.sickLeaveBalance);
    const preservedCl = round2(employee.casualLeaveBalance);
    const preservedCf = round2(employee.carryForwardBalance);

    const isLegacyUnmigrated = !employee.leavePolicyMigrated;
    const slEntryId = (
      isLegacyUnmigrated ? `mig_${employee.id}_SL` : `init_${employee.id}_SL`
    ).replace(/[^a-zA-Z0-9_-]/g, '');
    const clEntryId = (
      isLegacyUnmigrated ? `mig_${employee.id}_CL` : `init_${employee.id}_CL`
    ).replace(/[^a-zA-Z0-9_-]/g, '');

    const baselineMonth = isValidYearMonth(employee.leaveBaselineMonth)
      ? employee.leaveBaselineMonth.trim()
      : isValidYearMonth(employee.leaveLastSyncedMonth)
      ? employee.leaveLastSyncedMonth.trim()
      : currentMonth;
    const baselineYear = Number(baselineMonth.slice(0, 4)) || currentYear;

    newEntries.push({
      id: slEntryId,
      employeeId: employee.id,
      employeeUid: employee.uid || '',
      employeeEmail: empEmail,
      employeeName: empName,
      leaveType: 'SL',
      entryType: isLegacyUnmigrated ? 'migration_baseline' : 'opening_balance',
      month: baselineMonth,
      year: baselineYear,
      amount: preservedSl,
      balanceBefore: 0,
      balanceAfter: preservedSl,
      source: isLegacyUnmigrated ? 'legacy_migration' : 'admin_manual',
      reason: isLegacyUnmigrated
        ? `Preserved existing Sick Leave balance (${preservedSl}d) on policy migration`
        : `Preserved configured opening Sick Leave balance (${preservedSl}d)`,
      createdBy: actorUid,
      createdByName: actorName,
    });

    newEntries.push({
      id: clEntryId,
      employeeId: employee.id,
      employeeUid: employee.uid || '',
      employeeEmail: empEmail,
      employeeName: empName,
      leaveType: 'CL',
      entryType: isLegacyUnmigrated ? 'migration_baseline' : 'opening_balance',
      month: baselineMonth,
      year: baselineYear,
      amount: preservedCl,
      balanceBefore: 0,
      balanceAfter: preservedCl,
      source: isLegacyUnmigrated ? 'legacy_migration' : 'admin_manual',
      reason: isLegacyUnmigrated
        ? `Preserved existing Casual Leave balance (${preservedCl}d) on policy migration`
        : `Preserved configured opening Casual Leave balance (${preservedCl}d)`,
      createdBy: actorUid,
      createdByName: actorName,
    });

    const expectedSlNet = round2(Math.max(0, policyExpectedSlToDate - slUsedThisYear));
    const expectedClNet = round2(Math.max(0, policyExpectedClToDate - clUsedTotal));
    const hasVariance = isLegacyUnmigrated && (preservedSl !== expectedSlNet || preservedCl !== expectedClNet);
    const leaveMigrationNote = hasVariance
      ? `Legacy balance (${preservedSl} SL / ${preservedCl} CL) preserved; TalentGrade policy to date is ${expectedSlNet} SL / ${expectedClNet} CL.`
      : undefined;

    return {
      employeeId: employee.id,
      newLedgerEntries: newEntries,
      employeeUpdates: {
        sickLeaveBalance: preservedSl,
        casualLeaveBalance: preservedCl,
        carryForwardBalance: preservedCf,
        leavePolicyMigrated: true,
        leaveBaselineMonth: baselineMonth,
        leaveLastSyncedMonth: currentMonth,
        leaveLastResetYear: currentYear,
        clEligibilityDate,
        ...(employee.clEligibilityCustom ? { clEligibilityCustom: true } : {}),
        ...(leaveMigrationNote ? { leaveMigrationNote } : {}),
      },
      hasChanges: true,
      summary: {
        employeeId: employee.id,
        todayLocal,
        currentYear,
        currentMonth,
        clEligibilityDate,
        isClEligible,
        sickLeaveBalance: preservedSl,
        casualLeaveBalance: preservedCl,
        carryForwardBalance: preservedCf,
        migrationBaselineSl: isLegacyUnmigrated ? preservedSl : 0,
        migrationBaselineCl: isLegacyUnmigrated ? preservedCl : 0,
        slAccruedThisYear: 0,
        slExpiredThisYear: 0,
        clAccruedThisYear: 0,
        clAccruedTotal: 0,
        slAdjustedThisYear: 0,
        clAdjustedTotal: 0,
        slUsedThisYear,
        clUsedThisYear,
        clUsedTotal,
        lwpUsedThisYear,
        policyExpectedSlToDate,
        policyExpectedClToDate,
        needsMigrationReview: Boolean(leaveMigrationNote),
        leaveMigrationNote,
      },
    };
  }

  // NORMAL ENGINE PROGRESSION (Migrated employees & new hires)
  const workingLedger: LeaveLedgerEntry[] = [...empLedger];
  const existingIds = new Set(workingLedger.map((e) => e.id));

  const baselineEntry = workingLedger.find(
    (e) => e.entryType === 'migration_baseline' || e.entryType === 'opening_balance'
  );
  const effectiveBaselineMonth = isValidYearMonth(employee.leaveBaselineMonth)
    ? employee.leaveBaselineMonth.trim()
    : baselineEntry?.month;
  const baselineYear = effectiveBaselineMonth ? Number(effectiveBaselineMonth.slice(0, 4)) : undefined;

  const startYear = Math.min(currentYear, baselineYear ?? joiningYear);
  let carryForwardBalance = round2(employee.carryForwardBalance);

  const sumBalanceFor = (leaveType: 'SL' | 'CL', beforeYear?: number): number => {
    return round2(
      workingLedger
        .filter((e) => e.leaveType === leaveType && (beforeYear === undefined || e.year < beforeYear))
        .reduce((s, e) => s + Number(e.amount || 0), 0)
    );
  };

  const sumBalanceBeforeMonth = (leaveType: 'SL' | 'CL', beforeMonth: string): number => {
    return round2(
      workingLedger
        .filter((e) => e.leaveType === leaveType && e.month < beforeMonth)
        .reduce((s, e) => s + Number(e.amount || 0), 0)
    );
  };

  const sumMonthlyAccrualInMonth = (leaveType: 'SL' | 'CL', ym: string): number => {
    return round2(
      workingLedger
        .filter((e) => e.leaveType === leaveType && e.entryType === 'monthly_accrual' && e.month === ym)
        .reduce((s, e) => s + Number(e.amount || 0), 0)
    );
  };

  const sumNetUsedInMonth = (leaveType: 'SL' | 'CL', ym: string): number => {
    return round2(
      workingLedger
        .filter(
          (e) =>
            e.leaveType === leaveType &&
            (e.entryType === 'approved_deduction' || e.entryType === 'leave_reversal') &&
            e.month === ym
        )
        .reduce((s, e) => s - Number(e.amount || 0), 0)
    );
  };

  for (let yr = startYear; yr <= currentYear; yr++) {
    // Process year-start rollover when stepping into a new year
    if (yr > startYear) {
      // 1. Sick Leave Annual Reset (if non-carry-forwardable)
      if (!policy.sickLeaveCarryForward && policy.sickLeaveAnnualReset) {
        const priorSl = sumBalanceFor('SL', yr);
        const resetId = `reset_${employee.id}_SL_${yr}`.replace(/[^a-zA-Z0-9_-]/g, '');
        if (priorSl > 0 && !existingIds.has(resetId)) {
          const currentSlBefore = sumBalanceFor('SL');
          const entry: Omit<LeaveLedgerEntry, 'createdAt'> = {
            id: resetId,
            employeeId: employee.id,
            employeeUid: employee.uid || '',
            employeeEmail: empEmail,
            employeeName: empName,
            leaveType: 'SL',
            entryType: 'year_reset',
            month: `${yr}-01`,
            year: yr,
            amount: round2(-priorSl),
            balanceBefore: currentSlBefore,
            balanceAfter: round2(currentSlBefore - priorSl),
            source: 'annual_cycle',
            reason: `Annual Sick Leave reset for calendar year ${yr} (non-carry-forwardable)`,
            createdBy: actorUid,
            createdByName: actorName,
          };
          workingLedger.push(entry);
          newEntries.push(entry);
          existingIds.add(resetId);
        }
      }

      // 2. Casual Leave Carry-Forward (or reset if admin explicitly disabled CL carry-forward)
      const priorCl = sumBalanceFor('CL', yr);
      if (policy.casualLeaveCarryForward) {
        let carried = Math.max(0, priorCl);
        if (
          policy.casualLeaveMaxCarryForward &&
          policy.casualLeaveMaxCarryForward > 0 &&
          carried > policy.casualLeaveMaxCarryForward
        ) {
          const excess = round2(carried - policy.casualLeaveMaxCarryForward);
          const capId = `reset_${employee.id}_CL_CAP_${yr}`.replace(/[^a-zA-Z0-9_-]/g, '');
          if (!existingIds.has(capId) && excess > 0) {
            const clBeforeCap = sumBalanceFor('CL');
            const capEntry: Omit<LeaveLedgerEntry, 'createdAt'> = {
              id: capId,
              employeeId: employee.id,
              employeeUid: employee.uid || '',
              employeeEmail: empEmail,
              employeeName: empName,
              leaveType: 'CL',
              entryType: 'year_reset',
              month: `${yr}-01`,
              year: yr,
              amount: round2(-excess),
              balanceBefore: clBeforeCap,
              balanceAfter: round2(clBeforeCap - excess),
              source: 'annual_cycle',
              reason: `Casual Leave carry-forward cap applied for ${yr} (max ${policy.casualLeaveMaxCarryForward}d)`,
              createdBy: actorUid,
              createdByName: actorName,
            };
            workingLedger.push(capEntry);
            newEntries.push(capEntry);
            existingIds.add(capId);
          }
          carried = policy.casualLeaveMaxCarryForward;
        }

        const cfId = `cf_${employee.id}_CL_${yr}`.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!existingIds.has(cfId)) {
          const cfEntry: Omit<LeaveLedgerEntry, 'createdAt'> = {
            id: cfId,
            employeeId: employee.id,
            employeeUid: employee.uid || '',
            employeeEmail: empEmail,
            employeeName: empName,
            leaveType: 'CL',
            entryType: 'carry_forward',
            month: `${yr}-01`,
            year: yr,
            amount: 0,
            balanceBefore: carried,
            balanceAfter: carried,
            source: 'annual_cycle',
            reason: `Carried forward ${carried} Casual Leave day(s) into ${yr}`,
            createdBy: actorUid,
            createdByName: actorName,
          };
          workingLedger.push(cfEntry);
          newEntries.push(cfEntry);
          existingIds.add(cfId);
        }
        carryForwardBalance = carried;
      } else {
        const resetClId = `reset_${employee.id}_CL_${yr}`.replace(/[^a-zA-Z0-9_-]/g, '');
        if (priorCl !== 0 && !existingIds.has(resetClId)) {
          const clBeforeReset = sumBalanceFor('CL');
          const resetEntry: Omit<LeaveLedgerEntry, 'createdAt'> = {
            id: resetClId,
            employeeId: employee.id,
            employeeUid: employee.uid || '',
            employeeEmail: empEmail,
            employeeName: empName,
            leaveType: 'CL',
            entryType: 'year_reset',
            month: `${yr}-01`,
            year: yr,
            amount: round2(-priorCl),
            balanceBefore: clBeforeReset,
            balanceAfter: round2(clBeforeReset - priorCl),
            source: 'annual_cycle',
            reason: `Annual Casual Leave reset for ${yr} (carry-forward disabled in settings)`,
            createdBy: actorUid,
            createdByName: actorName,
          };
          workingLedger.push(resetEntry);
          newEntries.push(resetEntry);
          existingIds.add(resetClId);
        }
        carryForwardBalance = 0;
      }
    }

    // Monthly Accruals inside year `yr`
    const yrStartMonth = `${yr}-01`;
    const yrEndMonth = yr === currentYear ? currentMonth : `${yr}-12`;
    const monthsInYear = enumerateYearMonths(yrStartMonth, yrEndMonth);

    for (const ym of monthsInYear) {
      // 1. Non-carry-forward SL monthly expiry for immediately preceding month's unused monthly accrual
      if (!policy.sickLeaveCarryForward && (!effectiveBaselineMonth || ym > effectiveBaselineMonth)) {
        const prevYm = getPreviousYearMonth(ym);
        const isYearStartAfterAnnualReset = ym.endsWith('-01') && policy.sickLeaveAnnualReset && yr > startYear;
        const alreadySyncedPreRollout =
          Boolean(employee.leavePolicyMigrated) &&
          isValidYearMonth(employee.leaveLastSyncedMonth) &&
          prevYm < employee.leaveLastSyncedMonth.trim();

        if (!isYearStartAfterAnnualReset && !alreadySyncedPreRollout) {
          const accruedPrev = sumMonthlyAccrualInMonth('SL', prevYm);
          const usedPrev = Math.max(0, sumNetUsedInMonth('SL', prevYm));
          const unspentMonthly = round2(Math.max(0, accruedPrev - usedPrev));
          const availableEnteringYm = Math.max(0, sumBalanceBeforeMonth('SL', ym));
          const toExpire = round2(Math.min(unspentMonthly, availableEnteringYm));
          const expSlId = `exp_${employee.id}_SL_${prevYm.replace('-', '_')}`.replace(
            /[^a-zA-Z0-9_-]/g,
            ''
          );
          if (toExpire > 0 && !existingIds.has(expSlId)) {
            const balBefore = sumBalanceFor('SL');
            const balAfter = round2(balBefore - toExpire);
            const expEntry: Omit<LeaveLedgerEntry, 'createdAt'> = {
              id: expSlId,
              employeeId: employee.id,
              employeeUid: employee.uid || '',
              employeeEmail: empEmail,
              employeeName: empName,
              leaveType: 'SL',
              entryType: 'monthly_expiry',
              month: ym,
              year: yr,
              amount: round2(-toExpire),
              balanceBefore: balBefore,
              balanceAfter: balAfter,
              source: 'annual_cycle',
              reason: `Unused monthly Sick Leave from ${prevYm} expired (non-carry-forward policy)`,
              createdBy: actorUid,
              createdByName: actorName,
            };
            workingLedger.push(expEntry);
            newEntries.push(expEntry);
            existingIds.add(expSlId);
          }
        }
      }

      // 2. Sick Leave monthly accrual
      const slEligible =
        policy.sickLeaveMonthlyRate > 0 &&
        ym >= joiningMonth &&
        (!effectiveBaselineMonth || ym > effectiveBaselineMonth) &&
        (ym < currentMonth || todayLocal >= joiningDate);

      if (slEligible) {
        const slAccId = makeAccrualDocId(employee.id, 'SL', ym);
        if (!existingIds.has(slAccId)) {
          const balBefore = sumBalanceFor('SL');
          const runningSl = round2(balBefore + policy.sickLeaveMonthlyRate);
          const entry: Omit<LeaveLedgerEntry, 'createdAt'> = {
            id: slAccId,
            employeeId: employee.id,
            employeeUid: employee.uid || '',
            employeeEmail: empEmail,
            employeeName: empName,
            leaveType: 'SL',
            entryType: 'monthly_accrual',
            month: ym,
            year: yr,
            amount: policy.sickLeaveMonthlyRate,
            balanceBefore: balBefore,
            balanceAfter: runningSl,
            source: 'accrual_engine',
            reason: `Monthly Sick Leave accrual for ${ym}`,
            createdBy: actorUid,
            createdByName: actorName,
          };
          workingLedger.push(entry);
          newEntries.push(entry);
          existingIds.add(slAccId);
        }
      }

      // 3. Casual Leave monthly accrual (only after completing eligibility period)
      const clEligible =
        policy.casualLeaveMonthlyRate > 0 &&
        ym >= clEligibilityMonth &&
        (!effectiveBaselineMonth || ym > effectiveBaselineMonth) &&
        (ym < currentMonth || todayLocal >= clEligibilityDate);

      if (clEligible) {
        const clAccId = makeAccrualDocId(employee.id, 'CL', ym);
        if (!existingIds.has(clAccId)) {
          const balBefore = sumBalanceFor('CL');
          const runningCl = round2(balBefore + policy.casualLeaveMonthlyRate);
          const entry: Omit<LeaveLedgerEntry, 'createdAt'> = {
            id: clAccId,
            employeeId: employee.id,
            employeeUid: employee.uid || '',
            employeeEmail: empEmail,
            employeeName: empName,
            leaveType: 'CL',
            entryType: 'monthly_accrual',
            month: ym,
            year: yr,
            amount: policy.casualLeaveMonthlyRate,
            balanceBefore: balBefore,
            balanceAfter: runningCl,
            source: 'accrual_engine',
            reason: employee.clEligibilityCustom
              ? `Monthly Casual Leave accrual for ${ym} (eligible from ${clEligibilityDate})`
              : `Monthly Casual Leave accrual for ${ym} (${policy.casualLeaveEligibilityMonths}-month tenure completed on ${clEligibilityDate})`,
            createdBy: actorUid,
            createdByName: actorName,
          };
          workingLedger.push(entry);
          newEntries.push(entry);
          existingIds.add(clAccId);
        }
      }
    }
  }

  // Optional Casual Leave Expiry rule (ONLY runs if Super Admin configured > 0 months; default is 0 = no expiry)
  if (policy.casualLeaveExpiryMonths && policy.casualLeaveExpiryMonths > 0) {
    const expiredAccruals = workingLedger
      .filter(
        (e) =>
          e.leaveType === 'CL' &&
          e.entryType === 'monthly_accrual' &&
          monthDiff(e.month, currentMonth) >= policy.casualLeaveExpiryMonths!
      )
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalClUsedOrExpired = workingLedger
      .filter((e) => e.leaveType === 'CL' && e.amount < 0)
      .reduce((s, e) => s + Math.abs(Number(e.amount || 0)), 0);
    const toExpire = round2(Math.max(0, expiredAccruals - totalClUsedOrExpired));
    const expId = `exp_${employee.id}_CL_${currentMonth.replace('-', '_')}`.replace(/[^a-zA-Z0-9_-]/g, '');
    if (toExpire > 0 && !existingIds.has(expId)) {
      const balBefore = sumBalanceFor('CL');
      const runningCl = round2(balBefore - toExpire);
      const expEntry: Omit<LeaveLedgerEntry, 'createdAt'> = {
        id: expId,
        employeeId: employee.id,
        employeeUid: employee.uid || '',
        employeeEmail: empEmail,
        employeeName: empName,
        leaveType: 'CL',
        entryType: 'year_reset',
        month: currentMonth,
        year: currentYear,
        amount: round2(-toExpire),
        balanceBefore: balBefore,
        balanceAfter: runningCl,
        source: 'annual_cycle',
        reason: `Configured Casual Leave expiry (${policy.casualLeaveExpiryMonths} months rule)`,
        createdBy: actorUid,
        createdByName: actorName,
      };
      workingLedger.push(expEntry);
      newEntries.push(expEntry);
      existingIds.add(expId);
    }
  }

  // Check if a carry_forward snapshot exists in currentYear
  const currentYearCfEntry = workingLedger.find(
    (e) => e.leaveType === 'CL' && e.entryType === 'carry_forward' && e.year === currentYear
  );
  if (currentYearCfEntry && typeof currentYearCfEntry.balanceAfter === 'number') {
    carryForwardBalance = round2(currentYearCfEntry.balanceAfter);
  }

  const finalSlBalance = sumBalanceFor('SL');
  const finalClBalance = sumBalanceFor('CL');

  const slAccruedThisYear = round2(
    workingLedger
      .filter((e) => e.leaveType === 'SL' && e.entryType === 'monthly_accrual' && e.year === currentYear)
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  );
  const slExpiredThisYear = round2(
    workingLedger
      .filter(
        (e) =>
          e.leaveType === 'SL' &&
          (e.entryType === 'monthly_expiry' || e.entryType === 'year_reset') &&
          e.year === currentYear
      )
      .reduce((s, e) => s + Math.abs(Number(e.amount || 0)), 0)
  );
  const clAccruedThisYear = round2(
    workingLedger
      .filter((e) => e.leaveType === 'CL' && e.entryType === 'monthly_accrual' && e.year === currentYear)
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  );
  const clAccruedTotal = round2(
    workingLedger
      .filter((e) => e.leaveType === 'CL' && e.entryType === 'monthly_accrual')
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  );

  const migrationBaselineSl = round2(
    workingLedger
      .filter((e) => e.leaveType === 'SL' && e.entryType === 'migration_baseline')
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  );
  const migrationBaselineCl = round2(
    workingLedger
      .filter((e) => e.leaveType === 'CL' && e.entryType === 'migration_baseline')
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  );
  const slAdjustedThisYear = round2(
    workingLedger
      .filter(
        (e) =>
          e.leaveType === 'SL' &&
          (e.entryType === 'admin_adjustment' || e.entryType === 'opening_balance') &&
          e.year === currentYear
      )
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  );
  const clAdjustedTotal = round2(
    workingLedger
      .filter(
        (e) =>
          e.leaveType === 'CL' &&
          (e.entryType === 'admin_adjustment' || e.entryType === 'opening_balance')
      )
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  );

  const resolvedBaselineMonth = effectiveBaselineMonth || currentMonth;

  const hasChanges =
    newEntries.length > 0 ||
    round2(employee.sickLeaveBalance) !== finalSlBalance ||
    round2(employee.casualLeaveBalance) !== finalClBalance ||
    round2(employee.carryForwardBalance) !== carryForwardBalance ||
    !employee.leavePolicyMigrated ||
    employee.leaveLastSyncedMonth !== currentMonth ||
    employee.leaveLastResetYear !== currentYear ||
    employee.clEligibilityDate !== clEligibilityDate;

  return {
    employeeId: employee.id,
    newLedgerEntries: newEntries,
    employeeUpdates: {
      sickLeaveBalance: finalSlBalance,
      casualLeaveBalance: finalClBalance,
      carryForwardBalance,
      leavePolicyMigrated: true,
      ...(resolvedBaselineMonth ? { leaveBaselineMonth: resolvedBaselineMonth } : {}),
      leaveLastSyncedMonth: currentMonth,
      leaveLastResetYear: currentYear,
      clEligibilityDate,
      ...(employee.clEligibilityCustom ? { clEligibilityCustom: true } : {}),
      ...(employee.leaveMigrationNote ? { leaveMigrationNote: employee.leaveMigrationNote } : {}),
    },
    hasChanges,
    summary: {
      employeeId: employee.id,
      todayLocal,
      currentYear,
      currentMonth,
      clEligibilityDate,
      isClEligible,
      sickLeaveBalance: finalSlBalance,
      casualLeaveBalance: finalClBalance,
      carryForwardBalance,
      migrationBaselineSl,
      migrationBaselineCl,
      slAccruedThisYear,
      slExpiredThisYear,
      clAccruedThisYear,
      clAccruedTotal,
      slAdjustedThisYear,
      clAdjustedTotal,
      slUsedThisYear,
      clUsedThisYear,
      clUsedTotal,
      lwpUsedThisYear,
      policyExpectedSlToDate,
      policyExpectedClToDate,
      needsMigrationReview: Boolean(employee.leaveMigrationNote),
      leaveMigrationNote: employee.leaveMigrationNote,
    },
  };
}

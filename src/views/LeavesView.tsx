import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Plus,
  Check,
  X,
  RotateCcw,
  Paperclip,
  RefreshCw,
  SlidersHorizontal,
  History,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  Department,
  Employee,
  EmployeeLeaveComputedSummary,
  LeaveApplication,
  LeaveLedgerEntry,
  LeaveType,
} from '../types/hr';
import {
  adjustEmployeeLeaveBalance,
  applyForLeave,
  cancelPendingLeave,
  countDaysInclusive,
  fetchAllEmployees,
  fetchLeaveApplications,
  fetchLeaveLedger,
  fetchMediaAsset,
  getDepartments,
  getEffectiveSchedule,
  getTodayInTimezone,
  resolveMigrationVariance,
  reviewLeaveApplication,
  runServerLeaveAccrualSync,
  uploadMediaAsset,
} from '../lib/hrService';
import {
  computeEmployeeLeaveAccrualPlan,
  normalizeLeavePolicyConfig,
  round2,
} from '../../shared/leaveAccrualEngine';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 500 * 1024) {
      reject(new Error('Attachment must be under 500 KB.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function formatEntryTypeLabel(entryType: LeaveLedgerEntry['entryType']): string {
  switch (entryType) {
    case 'monthly_accrual':
      return 'Monthly Accrual';
    case 'monthly_expiry':
      return 'Monthly Expiry';
    case 'year_reset':
      return 'Annual Reset';
    case 'carry_forward':
      return 'Carry Forward';
    case 'approved_deduction':
      return 'Approved Leave';
    case 'leave_reversal':
      return 'Leave Reversal';
    case 'admin_adjustment':
      return 'Admin Adjustment';
    case 'migration_baseline':
      return 'Legacy Baseline';
    case 'opening_balance':
      return 'Opening Balance';
    default:
      return entryType;
  }
}

export function LeavesView() {
  const { employee, settings, refreshSession } = useAuth();
  const { showToast } = useToast();

  const myTz = useMemo(() => {
    if (!employee || !settings) return 'Asia/Kolkata';
    return getEffectiveSchedule(employee, settings).timezone;
  }, [employee, settings]);

  const todayStr = useMemo(() => getTodayInTimezone(myTz), [myTz]);

  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [ledger, setLedger] = useState<LeaveLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const autoSyncedRef = useRef(false);

  // Navigation / View Tabs
  const [adminTab, setAdminTab] = useState<'requests' | 'balances'>('requests');
  const [showMyLedger, setShowMyLedger] = useState(false);

  // Request Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [empFilter, setEmpFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Ledger Filters
  const [ledgerEmpFilter, setLedgerEmpFilter] = useState<string>('all');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<string>('all');

  // Apply Leave Modal
  const [applyOpen, setApplyOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>('CL');
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [reason, setReason] = useState('');
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Admin Manual Balance Adjustment Modal
  const [adjustTarget, setAdjustTarget] = useState<Employee | null>(null);
  const [adjustLeaveType, setAdjustLeaveType] = useState<'SL' | 'CL'>('SL');
  const [adjustMode, setAdjustMode] = useState<'delta' | 'set'>('delta');
  const [adjustDelta, setAdjustDelta] = useState<number>(1);
  const [adjustExactTarget, setAdjustExactTarget] = useState<number>(0);
  const [adjustCfDelta, setAdjustCfDelta] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [resolvingMigId, setResolvingMigId] = useState<string | null>(null);

  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const canViewAll = settings?.teamLeaderPermissions?.canViewAllEmployees ?? true;
      const [leaveList, empList, deptList, ledgerList] = await Promise.all([
        fetchLeaveApplications(employee),
        employee.role === 'employee'
          ? Promise.resolve([employee])
          : fetchAllEmployees(employee, canViewAll),
        getDepartments(),
        fetchLeaveLedger(employee),
      ]);
      setLeaves(leaveList);
      setEmployees(empList);
      setDepartments(deptList);
      setLedger(ledgerList);

      // Automatic server-side accrual sync when Super Admin opens Leave Management
      if (employee.role === 'super_admin' && settings && !autoSyncedRef.current) {
        autoSyncedRef.current = true;
        setSyncing(true);
        try {
          const syncRes = await runServerLeaveAccrualSync({
            actor: employee,
            employees: empList,
            settings,
            existingLedger: ledgerList,
            leaves: leaveList,
          });
          setLastSyncedAt(syncRes.serverTimeIso);
          if (syncRes.committedEntriesCount > 0 || syncRes.updatedEmployeesCount > 0) {
            const [refreshedEmps, refreshedLedger] = await Promise.all([
              fetchAllEmployees(employee, canViewAll),
              fetchLeaveLedger(employee),
            ]);
            setEmployees(refreshedEmps);
            setLedger(refreshedLedger);
            await refreshSession();
            if (syncRes.committedEntriesCount > 0) {
              showToast(
                `Synced ${syncRes.committedEntriesCount} leave accrual/cycle entry(ies).`,
                'success'
              );
            }
          }
        } catch (syncErr: unknown) {
          console.warn('Auto accrual sync failed:', syncErr);
          showToast(
            syncErr instanceof Error ? syncErr.message : 'Automatic leave accrual sync failed.',
            'error'
          );
        } finally {
          setSyncing(false);
        }
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load leaves', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, settings, refreshSession, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const policy = useMemo(
    () => normalizeLeavePolicyConfig(settings?.leavePolicy),
    [settings?.leavePolicy]
  );

  // Compute policy summaries for UI visibility
  const summaryByEmployee = useMemo(() => {
    const map: Record<string, EmployeeLeaveComputedSummary> = {};
    if (!employee) return map;
    const list = employee.role === 'employee' ? [employee] : employees.length > 0 ? employees : [employee];
    const now = new Date();
    for (const emp of list) {
      const plan = computeEmployeeLeaveAccrualPlan({
        employee: emp,
        policy,
        existingLedger: ledger,
        approvedLeaves: leaves,
        referenceNow: now,
        actorUid: employee.uid,
        actorName: employee.fullName,
      });
      map[emp.id] = plan.summary;
    }
    return map;
  }, [employee, employees, ledger, leaves, policy]);

  if (!employee || !settings) return null;

  const isPrivileged = employee.role === 'super_admin' || employee.role === 'team_leader';
  const isSuperAdmin = employee.role === 'super_admin';
  const canApproveLeaves =
    isSuperAdmin ||
    (employee.role === 'team_leader' && settings.teamLeaderPermissions.canApproveLeaves);

  const mySummary = summaryByEmployee[employee.id];
  const myPendingCount = leaves.filter(
    (l) => l.employeeId === employee.id && l.status === 'Pending'
  ).length;
  const myLedger = ledger.filter((entry) => entry.employeeId === employee.id);

  const computedDays = countDaysInclusive(startDate, endDate);

  const handleManualSync = async () => {
    if (!isSuperAdmin) return;
    setSyncing(true);
    try {
      const syncRes = await runServerLeaveAccrualSync({
        actor: employee,
        employees,
        settings,
        existingLedger: ledger,
        leaves,
      });
      setLastSyncedAt(syncRes.serverTimeIso);
      const canViewAll = settings?.teamLeaderPermissions?.canViewAllEmployees ?? true;
      const [refreshedEmps, refreshedLedger] = await Promise.all([
        fetchAllEmployees(employee, canViewAll),
        fetchLeaveLedger(employee),
      ]);
      setEmployees(refreshedEmps);
      setLedger(refreshedLedger);
      await refreshSession();
      showToast(
        syncRes.committedEntriesCount > 0
          ? `Committed ${syncRes.committedEntriesCount} accrual/reset ledger entry(ies) across ${syncRes.updatedEmployeesCount} employee(s).`
          : 'All employee leave accruals and annual cycles are up to date.',
        'success'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Accrual synchronization failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (computedDays <= 0) {
      showToast('End date must be on or after start date.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      let attachmentAssetId: string | undefined;
      if (attachFile) {
        const dataUrl = await readFileAsDataUrl(attachFile);
        attachmentAssetId = await uploadMediaAsset({
          ownerUid: employee.uid,
          assetType: 'attachment',
          fileName: attachFile.name,
          mimeType: attachFile.type || 'application/octet-stream',
          dataUrl,
        });
      }
      await applyForLeave({
        employee,
        leaveType,
        startDate,
        endDate,
        days: computedDays,
        reason,
        attachmentAssetId,
      });
      showToast('Leave application submitted.', 'success');
      setApplyOpen(false);
      setReason('');
      setAttachFile(null);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to submit leave request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOwn = async (leaveId: string) => {
    try {
      await cancelPendingLeave(leaveId, employee);
      showToast('Leave request cancelled.', 'info');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not cancel request', 'error');
    }
  };

  const handleReview = async (leave: LeaveApplication, decision: 'Approved' | 'Rejected' | 'Cancelled') => {
    try {
      await reviewLeaveApplication({
        leave,
        decision,
        comment: reviewComments[leave.id] || '',
        actor: employee,
      });
      showToast(`Leave request ${decision.toLowerCase()}.`, 'success');
      await loadData();
      await refreshSession();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setAdjusting(true);
    try {
      await adjustEmployeeLeaveBalance({
        targetEmployee: adjustTarget,
        leaveType: adjustLeaveType,
        delta: adjustMode === 'delta' ? adjustDelta : 0,
        targetBalance: adjustMode === 'set' ? adjustExactTarget : undefined,
        carryForwardDelta: adjustLeaveType === 'CL' && adjustCfDelta !== 0 ? adjustCfDelta : undefined,
        reason: adjustReason,
        actor: employee,
      });
      showToast(`Updated ${adjustLeaveType} balance for ${adjustTarget.fullName}.`, 'success');
      setAdjustTarget(null);
      setAdjustMode('delta');
      setAdjustDelta(1);
      setAdjustExactTarget(0);
      setAdjustCfDelta(0);
      setAdjustReason('');
      await loadData();
      if (adjustTarget.id === employee.id) {
        await refreshSession();
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Adjustment failed', 'error');
    } finally {
      setAdjusting(false);
    }
  };

  const handleResolveMigration = async (target: Employee, action: 'align' | 'dismiss') => {
    setResolvingMigId(target.id);
    try {
      await resolveMigrationVariance({
        targetEmployee: target,
        action,
        settings,
        existingLedger: ledger,
        leaves,
        actor: employee,
      });
      showToast(
        action === 'align'
          ? `Aligned ${target.fullName} to TalentGrade policy.`
          : `Preserved existing balance notice dismissed for ${target.fullName}.`,
        'success'
      );
      await loadData();
      if (target.id === employee.id) {
        await refreshSession();
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not update migration note', 'error');
    } finally {
      setResolvingMigId(null);
    }
  };

  const openAttachment = async (assetId: string) => {
    const asset = await fetchMediaAsset(assetId);
    if (!asset) {
      showToast('Attachment unavailable', 'error');
      return;
    }
    const link = document.createElement('a');
    link.href = asset.dataUrl;
    link.download = asset.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredLeaves = leaves.filter((l) => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (typeFilter !== 'all' && l.leaveType !== typeFilter) return false;
    if (deptFilter !== 'all' && l.department !== deptFilter) return false;
    if (empFilter !== 'all' && l.employeeId !== empFilter) return false;
    if (dateFilter && !(l.startDate <= dateFilter && l.endDate >= dateFilter)) return false;
    return true;
  });

  const filteredLedger = ledger.filter((entry) => {
    if (ledgerEmpFilter !== 'all' && entry.employeeId !== ledgerEmpFilter) return false;
    if (ledgerTypeFilter !== 'all' && entry.leaveType !== ledgerTypeFilter) return false;
    return true;
  });

  const migrationVarianceEmployees = employees.filter((e) => Boolean(e.leaveMigrationNote));

  const insufficientBalanceWarning =
    (leaveType === 'SL' && computedDays > employee.sickLeaveBalance) ||
    (leaveType === 'CL' && computedDays > employee.casualLeaveBalance);

  const clNotYetEligibleWarning =
    leaveType === 'CL' && mySummary && !mySummary.isClEligible;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-zinc-950 dark:text-zinc-100">
            Leave Management
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            TalentGrade Policy: {policy.sickLeaveMonthlyRate} SL/mo (annual reset) · {policy.casualLeaveMonthlyRate} CL/mo after{' '}
            {policy.casualLeaveEligibilityMonths} months ({policy.casualLeaveCarryForward ? 'carry-forward' : 'no carry-forward'})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={handleManualSync}
              disabled={syncing}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing Accruals...' : 'Sync Monthly Accruals'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setApplyOpen(true)}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            Apply for Leave
          </button>
        </div>
      </div>

      {/* Personal Leave Summary Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Sick Leave (SL)</span>
            <span className="font-mono">{mySummary?.currentYear || todayStr.slice(0, 4)}</span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums">{employee.sickLeaveBalance}</div>
          <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
            Accrued: {mySummary?.slAccruedThisYear ?? 0}d · Used: {mySummary?.slUsedThisYear ?? 0}d
            {!policy.sickLeaveCarryForward ? ' · Resets Jan 1' : ''}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Casual Leave (CL)</span>
            <span className="font-mono">Carry Fwd: {employee.carryForwardBalance}d</span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums">{employee.casualLeaveBalance}</div>
          <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
            Accrued: {mySummary?.clAccruedTotal ?? 0}d · Used: {mySummary?.clUsedTotal ?? 0}d
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>CL Eligibility &amp; Queue</span>
            <button
              type="button"
              onClick={() => setShowMyLedger((v) => !v)}
              className="text-[#B5121B] dark:text-red-400 font-medium inline-flex items-center gap-1 hover:underline"
            >
              <History className="w-3 h-3" />
              {showMyLedger ? 'Hide History' : 'My Ledger'}
            </button>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
            {mySummary?.isClEligible ? 'Eligible' : 'Waiting Period'}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
            {mySummary?.isClEligible ? 'Since' : 'Eligible on'} {mySummary?.clEligibilityDate || employee.clEligibilityDate || '—'} ·{' '}
            {myPendingCount} pending
          </div>
        </div>
      </section>

      {/* Personal Accrual Ledger (Expandable for every employee) */}
      {showMyLedger && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-semibold">My Monthly Accrual &amp; Leave Ledger ({myLedger.length})</span>
            <button
              type="button"
              onClick={() => setShowMyLedger(false)}
              className="text-xs text-zinc-500 hover:underline"
            >
              Close
            </button>
          </div>
          {myLedger.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-500">
              No personal accrual ledger records recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Month</th>
                    <th className="py-2.5 px-4 font-medium">Leave Type</th>
                    <th className="py-2.5 px-4 font-medium">Event</th>
                    <th className="py-2.5 px-4 font-medium text-right">Change</th>
                    <th className="py-2.5 px-4 font-medium text-right">Before → After</th>
                    <th className="py-2.5 px-4 font-medium">Details &amp; Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {myLedger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">{entry.month}</td>
                      <td className="py-2.5 px-4 font-mono">{entry.leaveType}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap">{formatEntryTypeLabel(entry.entryType)}</td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                          entry.amount >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#B5121B] dark:text-red-400'
                        }`}
                      >
                        {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {typeof entry.balanceBefore === 'number' && typeof entry.balanceAfter === 'number'
                          ? `${entry.balanceBefore} → ${entry.balanceAfter}`
                          : typeof entry.balanceAfter === 'number'
                          ? entry.balanceAfter
                          : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-zinc-600 dark:text-zinc-400">
                        <div>{entry.reason}</div>
                        <div className="text-[10px] text-zinc-500">By {entry.createdByName}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Migration Variance Review Alert (Super Admin Only — non-destructive visibility) */}
      {isSuperAdmin && migrationVarianceEmployees.length > 0 && (
        <section className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-2xl p-4 space-y-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Legacy Balance Preservation Notice ({migrationVarianceEmployees.length}{' '}
              {migrationVarianceEmployees.length === 1 ? 'employee' : 'employees'})
            </span>
          </div>
          <p className="text-amber-800 dark:text-amber-300/90">
            Existing balances were preserved untouched during TalentGrade policy rollout. Review and either align to the monthly accrual policy or keep the preserved balance.
          </p>
          <div className="space-y-2">
            {migrationVarianceEmployees.map((emp) => (
              <div
                key={emp.id}
                className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                    {emp.fullName} ({emp.employeeCode})
                  </div>
                  <div className="text-zinc-600 dark:text-zinc-400">{emp.leaveMigrationNote}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={resolvingMigId === emp.id}
                    onClick={() => handleResolveMigration(emp, 'align')}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg bg-black dark:bg-white text-white dark:text-black font-medium disabled:opacity-50"
                  >
                    Align to Policy
                  </button>
                  <button
                    type="button"
                    disabled={resolvingMigId === emp.id}
                    onClick={() => handleResolveMigration(emp, 'dismiss')}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium disabled:opacity-50"
                  >
                    Keep Preserved
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Privileged Tabs */}
      {isPrivileged && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 p-1 bg-zinc-200/70 dark:bg-zinc-800 rounded-xl">
            <button
              type="button"
              onClick={() => setAdminTab('requests')}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap ${
                adminTab === 'requests'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Leave Requests ({leaves.length})
            </button>
            <button
              type="button"
              onClick={() => setAdminTab('balances')}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap ${
                adminTab === 'balances'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Balances &amp; Accrual Ledger ({employees.length})
            </button>
          </div>
          {lastSyncedAt && (
            <span className="text-[11px] font-mono text-zinc-500">
              Last server sync: {lastSyncedAt.slice(0, 19).replace('T', ' ')} UTC
            </span>
          )}
        </div>
      )}

      {/* TAB 1: LEAVE REQUESTS */}
      {(!isPrivileged || adminTab === 'requests') && (
        <>
          {/* Filters */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
            >
              <option value="all">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="Cancelled">Cancelled</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
            >
              <option value="all">All Types</option>
              <option value="SL">Sick Leave (SL)</option>
              <option value="CL">Casual Leave (CL)</option>
              <option value="LWP">Unpaid Leave (LWP)</option>
            </select>

            {isPrivileged && (
              <>
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
                >
                  <option value="all">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>

                <select
                  value={empFilter}
                  onChange={(e) => setEmpFilter(e.target.value)}
                  className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
                >
                  <option value="all">All Employees</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName}
                    </option>
                  ))}
                </select>
              </>
            )}

            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filter by date"
              className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="text-xs text-zinc-500 hover:underline"
              >
                Clear date
              </button>
            )}
          </div>

          {/* Leave Applications List */}
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
              </div>
            ) : filteredLeaves.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <CalendarDays className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto" />
                <p className="text-sm font-medium">No leave applications match your filters</p>
                <p className="text-xs text-zinc-500">Click &quot;Apply for Leave&quot; to submit a new request.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredLeaves.map((leave) => {
                  const targetEmp = employees.find((e) => e.id === leave.employeeId);
                  return (
                    <div key={leave.id} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-sm text-zinc-950 dark:text-zinc-100">
                            {leave.employeeName}
                          </span>
                          <span className="text-zinc-400">·</span>
                          <span className="text-zinc-600 dark:text-zinc-400">{leave.department}</span>
                          <span className="text-zinc-400">·</span>
                          <span className="font-mono font-medium">
                            {leave.leaveType === 'SL'
                              ? 'Sick Leave'
                              : leave.leaveType === 'CL'
                              ? 'Casual Leave'
                              : 'Unpaid Leave (LWP)'}
                          </span>
                          <span className="text-zinc-400">·</span>
                          <span
                            className={`font-semibold ${
                              leave.status === 'Approved'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : leave.status === 'Rejected'
                                ? 'text-[#B5121B] dark:text-red-400'
                                : leave.status === 'Cancelled'
                                ? 'text-zinc-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {leave.status}
                          </span>
                        </div>

                        <div className="text-xs font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                          {leave.startDate} to {leave.endDate} ({leave.days} {leave.days === 1 ? 'day' : 'days'})
                        </div>

                        <p className="text-xs text-zinc-600 dark:text-zinc-400">{leave.reason}</p>

                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                          {targetEmp && isPrivileged && (
                            <span className="font-mono tabular-nums">
                              Current Balance: SL {targetEmp.sickLeaveBalance} · CL {targetEmp.casualLeaveBalance}
                            </span>
                          )}
                          {leave.reviewedByName && <span>Reviewed by {leave.reviewedByName}</span>}
                          {leave.reviewComment && <span>Comment: {leave.reviewComment}</span>}
                          {leave.attachmentAssetId && (
                            <button
                              type="button"
                              onClick={() => openAttachment(leave.attachmentAssetId!)}
                              className="inline-flex items-center gap-1 text-[#B5121B] dark:text-red-400 underline"
                            >
                              <Paperclip className="w-3 h-3" />
                              View Attachment
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {leave.status === 'Pending' && leave.employeeUid === employee.uid && (
                          <button
                            type="button"
                            onClick={() => handleCancelOwn(leave.id)}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          >
                            Cancel Request
                          </button>
                        )}

                        {leave.status === 'Pending' && canApproveLeaves && (
                          <>
                            <input
                              type="text"
                              placeholder="Approval note (optional)"
                              value={reviewComments[leave.id] || ''}
                              onChange={(e) => setReviewComments((p) => ({ ...p, [leave.id]: e.target.value }))}
                              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs w-44"
                            />
                            <button
                              type="button"
                              onClick={() => handleReview(leave, 'Approved')}
                              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-medium inline-flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReview(leave, 'Rejected')}
                              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-[#B5121B] dark:text-red-400 text-xs font-medium inline-flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </>
                        )}

                        {leave.status === 'Approved' && isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => handleReview(leave, 'Cancelled')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 text-xs font-medium inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Reverse &amp; Restore Balance
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* TAB 2: ADMIN BALANCES, ELIGIBILITY & ACCRUAL LEDGER */}
      {isPrivileged && adminTab === 'balances' && (
        <div className="space-y-6">
          {/* Employee Leave Balances & CL Eligibility Table */}
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Employee Leave Balances &amp; Eligibility</span>
              <span className="text-[11px] text-zinc-500">
                SL resets annually · CL accrues after {policy.casualLeaveEligibilityMonths} months &amp; carries forward
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4 font-medium">Employee</th>
                    <th className="py-3 px-4 font-medium">Joined</th>
                    <th className="py-3 px-4 font-medium">CL Eligibility</th>
                    <th className="py-3 px-4 font-medium text-right">SL Balance</th>
                    <th className="py-3 px-4 font-medium text-right">CL Balance</th>
                    <th className="py-3 px-4 font-medium text-right">Carry Fwd</th>
                    <th className="py-3 px-4 font-medium text-right">Used (SL / CL)</th>
                    <th className="py-3 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {employees.map((emp) => {
                    const sum = summaryByEmployee[emp.id];
                    return (
                      <tr key={emp.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-zinc-950 dark:text-zinc-100">{emp.fullName}</div>
                          <div className="text-[11px] text-zinc-500 font-mono">
                            {emp.employeeCode} · {emp.department}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">{emp.joiningDate}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono tabular-nums">{sum?.clEligibilityDate || emp.clEligibilityDate || '—'}</div>
                          <div
                            className={`text-[11px] font-medium ${
                              sum?.isClEligible ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {sum?.isClEligible ? 'Eligible' : 'Waiting 6m'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          <div className="font-bold text-sm">{emp.sickLeaveBalance}</div>
                          <div className="text-[10px] text-zinc-500">Accrued: {sum?.slAccruedThisYear ?? 0}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          <div className="font-bold text-sm">{emp.casualLeaveBalance}</div>
                          <div className="text-[10px] text-zinc-500">Accrued: {sum?.clAccruedTotal ?? 0}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">{emp.carryForwardBalance}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {sum?.slUsedThisYear ?? 0} / {sum?.clUsedTotal ?? 0}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setLedgerEmpFilter(emp.id)}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              Ledger
                            </button>
                            {isSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAdjustTarget(emp);
                                  setAdjustLeaveType('SL');
                                  setAdjustMode('delta');
                                  setAdjustDelta(1);
                                  setAdjustExactTarget(emp.sickLeaveBalance);
                                  setAdjustCfDelta(0);
                                  setAdjustReason('');
                                }}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-medium inline-flex items-center gap-1"
                              >
                                <SlidersHorizontal className="w-3 h-3" />
                                Adjust
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Monthly Accrual & Adjustment Ledger Table */}
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Monthly Accrual &amp; Adjustment Ledger</h2>
                <p className="text-[11px] text-zinc-500">
                  Immutable history of monthly Sick/Casual accruals, annual resets, carry-forwards, approved deductions, reversals, and manual adjustments.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={ledgerEmpFilter}
                  onChange={(e) => setLedgerEmpFilter(e.target.value)}
                  className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
                >
                  <option value="all">All Employees</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName}
                    </option>
                  ))}
                </select>
                <select
                  value={ledgerTypeFilter}
                  onChange={(e) => setLedgerTypeFilter(e.target.value)}
                  className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
                >
                  <option value="all">All Leave Types</option>
                  <option value="SL">Sick Leave (SL)</option>
                  <option value="CL">Casual Leave (CL)</option>
                </select>
              </div>
            </div>

            {filteredLedger.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                No ledger entries match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                      <th className="py-2.5 px-4 font-medium">Month</th>
                      <th className="py-2.5 px-4 font-medium">Employee</th>
                      <th className="py-2.5 px-4 font-medium">Type</th>
                      <th className="py-2.5 px-4 font-medium">Event</th>
                      <th className="py-2.5 px-4 font-medium text-right">Change</th>
                      <th className="py-2.5 px-4 font-medium text-right">Before → After</th>
                      <th className="py-2.5 px-4 font-medium">Reason &amp; Actor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredLedger.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                        <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">{entry.month}</td>
                        <td className="py-2.5 px-4 font-medium whitespace-nowrap">{entry.employeeName}</td>
                        <td className="py-2.5 px-4 font-mono">{entry.leaveType}</td>
                        <td className="py-2.5 px-4 whitespace-nowrap">{formatEntryTypeLabel(entry.entryType)}</td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                            entry.amount >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#B5121B] dark:text-red-400'
                          }`}
                        >
                          {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {typeof entry.balanceBefore === 'number' && typeof entry.balanceAfter === 'number'
                            ? `${entry.balanceBefore} → ${entry.balanceAfter}`
                            : typeof entry.balanceAfter === 'number'
                            ? entry.balanceAfter
                            : '—'}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="text-zinc-700 dark:text-zinc-300">{entry.reason}</div>
                          <div className="text-[10px] text-zinc-500">By {entry.createdByName}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Apply for Leave Modal */}
      {applyOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleApplySubmit}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Apply for Leave</h3>
              <button
                type="button"
                onClick={() => setApplyOpen(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Leave Type</label>
                <select
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                >
                  <option value="CL">Casual Leave (CL) — Balance: {employee.casualLeaveBalance}d</option>
                  <option value="SL">Sick Leave (SL) — Balance: {employee.sickLeaveBalance}d</option>
                  <option value="LWP">Unpaid Leave (LWP)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (e.target.value > endDate) setEndDate(e.target.value);
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    min={startDate}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
              </div>

              <div className="text-xs font-mono tabular-nums text-zinc-600 dark:text-zinc-300 flex flex-wrap items-center justify-between gap-2">
                <span>
                  Duration: {computedDays} {computedDays === 1 ? 'day' : 'days'}
                </span>
                {(leaveType === 'SL' || leaveType === 'CL') && (
                  <span>
                    Balance: {leaveType === 'SL' ? employee.sickLeaveBalance : employee.casualLeaveBalance}d → After approval:{' '}
                    {round2(
                      (leaveType === 'SL' ? employee.sickLeaveBalance : employee.casualLeaveBalance) - computedDays
                    )}
                    d
                  </span>
                )}
              </div>

              {clNotYetEligibleWarning && (
                <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300">
                  Your Casual Leave eligibility date is <span className="font-mono font-semibold">{mySummary?.clEligibilityDate}</span> ({policy.casualLeaveEligibilityMonths} months from joining). You may still submit this request for manager review.
                </div>
              )}

              {insufficientBalanceWarning && (
                <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300">
                  Requested days exceed your current balance. You may still submit this application for manager review.
                </div>
              )}

              <div>
                <label className="block font-medium mb-1">Reason</label>
                <textarea
                  required
                  minLength={3}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Provide reason for leave..."
                  className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">Attachment (optional, max 500 KB)</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setAttachFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-zinc-600 dark:text-zinc-300"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setApplyOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || computedDays <= 0}
                className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Leave'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Manual Leave Balance Adjustment Modal (Super Admin Only) */}
      {adjustTarget && isSuperAdmin && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAdjustSubmit}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Adjust Leave Balance</h3>
                <p className="text-[11px] text-zinc-500">
                  {adjustTarget.fullName} ({adjustTarget.employeeCode}) · Current SL {adjustTarget.sickLeaveBalance} · CL{' '}
                  {adjustTarget.casualLeaveBalance}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-medium mb-1">Leave Type</label>
                <select
                  value={adjustLeaveType}
                  onChange={(e) => {
                    const nextType = e.target.value as 'SL' | 'CL';
                    setAdjustLeaveType(nextType);
                    setAdjustExactTarget(
                      nextType === 'SL' ? adjustTarget.sickLeaveBalance : adjustTarget.casualLeaveBalance
                    );
                  }}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                >
                  <option value="SL">Sick Leave (SL) — Current: {adjustTarget.sickLeaveBalance}d</option>
                  <option value="CL">Casual Leave (CL) — Current: {adjustTarget.casualLeaveBalance}d</option>
                </select>
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => setAdjustMode('delta')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${
                    adjustMode === 'delta'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  Adjust (+/-)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdjustMode('set');
                    setAdjustExactTarget(
                      adjustLeaveType === 'SL'
                        ? adjustTarget.sickLeaveBalance
                        : adjustTarget.casualLeaveBalance
                    );
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${
                    adjustMode === 'set'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  Set Exact Balance
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {adjustMode === 'delta' ? (
                  <div>
                    <label className="block font-medium mb-1">Adjustment (+/- days)</label>
                    <input
                      type="number"
                      step="0.5"
                      required
                      value={adjustDelta}
                      onChange={(e) => {
                        const val = e.target.value === '' ? 0 : Number(e.target.value);
                        setAdjustDelta(Number.isFinite(val) ? val : 0);
                      }}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block font-medium mb-1">Target Balance (days)</label>
                    <input
                      type="number"
                      step="0.5"
                      min={-60}
                      max={365}
                      required
                      value={adjustExactTarget}
                      onChange={(e) => {
                        const val = e.target.value === '' ? 0 : Number(e.target.value);
                        setAdjustExactTarget(Number.isFinite(val) ? val : 0);
                      }}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                    />
                  </div>
                )}
                {adjustLeaveType === 'CL' && (
                  <div>
                    <label className="block font-medium mb-1">Carry-Fwd Delta (optional)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={adjustCfDelta}
                      onChange={(e) => {
                        const val = e.target.value === '' ? 0 : Number(e.target.value);
                        setAdjustCfDelta(Number.isFinite(val) ? val : 0);
                      }}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                    />
                  </div>
                )}
              </div>

              {(() => {
                const currentBal =
                  adjustLeaveType === 'SL' ? adjustTarget.sickLeaveBalance : adjustTarget.casualLeaveBalance;
                const nextBal =
                  adjustMode === 'set'
                    ? round2(adjustExactTarget)
                    : round2(currentBal + Number(adjustDelta || 0));
                const effDelta = round2(nextBal - currentBal);
                return (
                  <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 font-mono tabular-nums flex items-center justify-between">
                    <span>
                      Change: {effDelta > 0 ? `+${effDelta}` : effDelta}d
                    </span>
                    <span>
                      New {adjustLeaveType}: <span className="font-bold">{nextBal}d</span>
                    </span>
                  </div>
                );
              })()}

              <div>
                <label className="block font-medium mb-1">Mandatory Reason (Audit Logged)</label>
                <textarea
                  required
                  minLength={3}
                  rows={3}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Explain why this manual leave balance adjustment is being applied..."
                  className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  adjusting ||
                  !adjustReason.trim() ||
                  ((adjustMode === 'delta'
                    ? adjustDelta === 0
                    : round2(
                        adjustExactTarget -
                          (adjustLeaveType === 'SL'
                            ? adjustTarget.sickLeaveBalance
                            : adjustTarget.casualLeaveBalance)
                      ) === 0) &&
                    adjustCfDelta === 0)
                }
                className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {adjusting ? 'Saving...' : 'Apply Adjustment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

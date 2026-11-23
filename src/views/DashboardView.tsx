import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LogIn,
  LogOut,
  Clock,
  CalendarDays,
  Users,
  Receipt,
  CheckCircle2,
  AlertCircle,
  FileEdit,
  Download,
  ChevronRight,
  Settings,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { CameraCaptureModal } from '../components/CameraCaptureModal';
import {
  AppPage,
  AttendanceCorrection,
  AttendanceRecord,
  Employee,
  LeaveApplication,
  PayrollRecord,
} from '../types/hr';
import {
  fetchAllEmployees,
  fetchAttendanceCorrections,
  fetchAttendanceRecords,
  fetchLeaveApplications,
  fetchPayrollRecords,
  formatDurationMinutes,
  formatMoney,
  formatTimeDisplay,
  generatePayslipPdfBlob,
  getEffectiveSchedule,
  getTodayInTimezone,
  punchIn,
  punchOut,
} from '../lib/hrService';
import { calculateCasualLeaveEligibilityDate, normalizeLeavePolicyConfig } from '../../shared/leaveAccrualEngine';

interface DashboardViewProps {
  onNavigate: (page: AppPage) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const { employee, settings } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
  const [punchModal, setPunchModal] = useState<'in' | 'out' | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const schedule = useMemo(() => {
    if (!employee || !settings) return null;
    return getEffectiveSchedule(employee, settings);
  }, [employee, settings]);

  const todayStr = useMemo(
    () => getTodayInTimezone(schedule?.timezone || 'Asia/Kolkata'),
    [schedule?.timezone]
  );
  const currentMonth = todayStr.slice(0, 7);

  const loadData = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const [empList, attList, leaveList, corrList, payList] = await Promise.all([
        employee.role === 'employee' ? Promise.resolve([employee]) : fetchAllEmployees(employee),
        fetchAttendanceRecords(employee),
        fetchLeaveApplications(employee),
        fetchAttendanceCorrections(employee),
        fetchPayrollRecords(employee),
      ]);
      setEmployees(empList);
      setAttendance(attList);
      setLeaves(leaveList);
      setCorrections(corrList);
      setPayrolls(payList);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!employee || !settings || !schedule) return null;

  const myTodayRecord = attendance.find((a) => a.employeeId === employee.id && a.date === todayStr);
  const myMonthRecords = attendance.filter((a) => a.employeeId === employee.id && a.date.startsWith(currentMonth));
  const myLeaves = leaves.filter((l) => l.employeeId === employee.id);
  const myLatestPayslip = payrolls.find((p) => p.employeeId === employee.id && p.status === 'Published');

  const activeEmployees = employees.filter((e) => e.status === 'Active');
  const todayRecords = attendance.filter((a) => a.date === todayStr);
  const presentTodayCount = todayRecords.filter((a) => a.punchInTime && a.status !== 'Leave').length;
  const lateTodayCount = todayRecords.filter((a) => a.isLate).length;
  const currentlyPunchedInCount = todayRecords.filter((a) => a.punchInTime && !a.punchOutTime).length;
  const onLeaveTodayCount = todayRecords.filter((a) => a.status === 'Leave').length;
  const incompletePastCount = attendance.filter(
    (a) => a.date < todayStr && a.punchInTime && !a.punchOutTime
  ).length;
  const absentTodayCount = Math.max(0, activeEmployees.length - presentTodayCount - onLeaveTodayCount);
  const pendingLeavesCount = leaves.filter((l) => l.status === 'Pending').length;
  const pendingCorrectionsCount = corrections.filter((c) => c.status === 'Pending').length;

  const monthPayrolls = payrolls.filter((p) => p.month === currentMonth);
  const publishedMonthCount = monthPayrolls.filter((p) => p.status === 'Published').length;
  const draftMonthCount = monthPayrolls.filter((p) => p.status === 'Draft').length;

  const greetingHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: schedule.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  );
  const greeting =
    greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';

  const formattedTodayHeader = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

  const handlePunchConfirm = async (payload: {
    photoDataUrl: string;
    lat: number;
    lng: number;
    accuracy: number;
  }) => {
    if (punchModal === 'in') {
      const rec = await punchIn({
        employee,
        settings,
        ...payload,
      });
      showToast(
        rec.isLate
          ? `Punched in (${rec.lateByMinutes}m late). Have a productive day.`
          : 'Punched in on time. Attendance recorded.',
        'success'
      );
    } else if (punchModal === 'out' && myTodayRecord) {
      const rec = await punchOut({
        employee,
        settings,
        recordId: myTodayRecord.id,
        ...payload,
      });
      showToast(
        `Punched out. Total duration: ${formatDurationMinutes(rec.workingMinutes)}.`,
        'success'
      );
    }
    await loadData();
  };

  const handleDownloadPayslip = async (payslip: PayrollRecord) => {
    setDownloadingId(payslip.id);
    try {
      const blob = await generatePayslipPdfBlob(payslip, settings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payslip_${payslip.employeeCode}_${payslip.month}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'PDF download failed', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const [yr, mo] = currentMonth.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const firstDayOffset = new Date(yr, mo - 1, 1).getDay();

  return (
    <div className="space-y-6">
      {/* Greeting Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {formattedTodayHeader} · {employee.department} · {schedule.location} ({schedule.timezone})
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-semibold text-zinc-950 dark:text-zinc-100 mt-0.5">
            {greeting}, {employee.fullName.split(' ')[0]}
          </h1>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
          Schedule: {schedule.officeStartTime} – {schedule.officeEndTime} ({schedule.gracePeriodMinutes}m grace)
        </div>
      </div>

      {/* Prominent Attendance Punch Card */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Clock className="w-4 h-4 text-[#B5121B]" />
              <span>Today&apos;s Attendance Status</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-zinc-950 dark:text-zinc-100">
                {myTodayRecord ? myTodayRecord.status : 'Not Punched In'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-4 sm:gap-8 pt-1">
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Punch In</div>
                <div className="text-lg sm:text-xl font-semibold font-mono tabular-nums text-zinc-950 dark:text-zinc-100 mt-0.5">
                  {formatTimeDisplay(myTodayRecord?.punchInTime, myTodayRecord?.timezone || schedule.timezone)}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Punch Out</div>
                <div className="text-lg sm:text-xl font-semibold font-mono tabular-nums text-zinc-950 dark:text-zinc-100 mt-0.5">
                  {formatTimeDisplay(myTodayRecord?.punchOutTime, myTodayRecord?.timezone || schedule.timezone)}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Working Time</div>
                <div className="text-lg sm:text-xl font-semibold font-mono tabular-nums text-zinc-950 dark:text-zinc-100 mt-0.5">
                  {myTodayRecord?.workingMinutes ? formatDurationMinutes(myTodayRecord.workingMinutes) : '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 lg:shrink-0">
            <button
              type="button"
              disabled={Boolean(myTodayRecord?.punchInTime)}
              onClick={() => setPunchModal('in')}
              className="min-h-[48px] px-6 py-3 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              {myTodayRecord?.punchInTime ? 'Punched In' : 'Punch In Now'}
            </button>
            <button
              type="button"
              disabled={!myTodayRecord?.punchInTime || Boolean(myTodayRecord?.punchOutTime)}
              onClick={() => setPunchModal('out')}
              className="min-h-[48px] px-6 py-3 rounded-xl bg-black dark:bg-white text-white dark:text-black hover:opacity-90 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-35 transition-opacity"
            >
              <LogOut className="w-4 h-4" />
              {myTodayRecord?.punchOutTime ? 'Punched Out' : 'Punch Out'}
            </button>
          </div>
        </div>
      </section>

      {/* SUPER ADMIN / TEAM LEADER WORKFORCE OVERVIEW */}
      {(employee.role === 'super_admin' || employee.role === 'team_leader') && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-semibold text-zinc-950 dark:text-zinc-100">
              {employee.role === 'super_admin' ? 'TalentGrade Operations Overview' : 'Team Operations Overview'}
            </h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              India: {activeEmployees.filter((e) => (e.location || 'India') === 'India').length} · Dubai:{' '}
              {activeEmployees.filter((e) => e.location === 'Dubai, UAE').length}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Active Employees</div>
              <div className="text-2xl font-bold font-mono tabular-nums mt-1">{activeEmployees.length}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {employees.length} total records
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Present Today</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                {presentTodayCount}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {currentlyPunchedInCount} currently active
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Late / Absent Today</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#B5121B] dark:text-red-400 mt-1">
                {lateTodayCount} <span className="text-zinc-400 font-normal">/</span> {absentTodayCount}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {onLeaveTodayCount} on approved leave
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Pending Reviews</div>
              <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                {pendingLeavesCount + pendingCorrectionsCount}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {pendingLeavesCount} leaves · {pendingCorrectionsCount} corrections
              </div>
            </div>
          </div>

          {/* Quick Action Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <button
              onClick={() => onNavigate('leaves')}
              className="min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:border-[#B5121B] transition-colors"
            >
              <span>Review Leaves ({pendingLeavesCount})</span>
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </button>
            <button
              onClick={() => onNavigate('attendance')}
              className="min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:border-[#B5121B] transition-colors"
            >
              <span>Corrections ({pendingCorrectionsCount})</span>
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </button>
            <button
              onClick={() => onNavigate('employees')}
              className="min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:border-[#B5121B] transition-colors"
            >
              <span className="inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Directory</span>
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </button>
            <button
              onClick={() => onNavigate('reports')}
              className="min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:border-[#B5121B] transition-colors"
            >
              <span className="inline-flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Reports</span>
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </button>
            {employee.role === 'super_admin' && (
              <>
                <button
                  onClick={() => onNavigate('payroll')}
                  className="min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:border-[#B5121B] transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    <Receipt className="w-3.5 h-3.5 shrink-0" /> Payroll ({publishedMonthCount} pub · {draftMonthCount} draft)
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </button>
                <button
                  onClick={() => onNavigate('settings')}
                  className="min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:border-[#B5121B] transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5"><Settings className="w-3.5 h-3.5" /> Settings</span>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                </button>
              </>
            )}
          </div>

          {incompletePastCount > 0 && (
            <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between gap-3 text-xs">
              <span className="text-amber-800 dark:text-amber-300">
                {incompletePastCount} past attendance record{incompletePastCount > 1 ? 's' : ''} missing a punch-out timestamp.
              </span>
              <button
                onClick={() => onNavigate('attendance')}
                className="font-semibold text-amber-900 dark:text-amber-200 underline shrink-0"
              >
                Inspect Attendance
              </button>
            </div>
          )}
        </section>
      )}

      {/* PERSONAL METRICS, CALENDAR, LEAVES & LATEST PAYSLIP */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Monthly Attendance Calendar & Summary */}
        <section className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-display font-semibold text-zinc-950 dark:text-zinc-100">
                My Monthly Attendance ({currentMonth})
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 mt-1 tabular-nums">
                <span>Present: {myMonthRecords.filter((r) => r.status === 'Present' || r.status === 'Late').length}</span>
                <span aria-hidden="true">·</span>
                <span>Late Count: {myMonthRecords.filter((r) => r.isLate).length}</span>
                <span aria-hidden="true">·</span>
                <span>Half Day: {myMonthRecords.filter((r) => r.status === 'Half Day').length}</span>
                <span aria-hidden="true">·</span>
                <span>Leave: {myMonthRecords.filter((r) => r.status === 'Leave').length}</span>
              </div>
            </div>
            <button
              onClick={() => onNavigate('attendance')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <FileEdit className="w-3.5 h-3.5" />
              Request Correction
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstDayOffset }).map((_, idx) => (
              <div key={`empty_${idx}`} className="h-11 rounded-lg bg-zinc-50/50 dark:bg-zinc-950/30" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const dayNum = idx + 1;
              const dateKey = `${currentMonth}-${String(dayNum).padStart(2, '0')}`;
              const rec = myMonthRecords.find((r) => r.date === dateKey);
              const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
              const isOff = !schedule.workingDays.includes(dow);
              const isHoliday = settings.holidays?.some((h) => h.date === dateKey);

              let cellStyle = 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300';
              let shortLabel = isHoliday ? 'Hol' : isOff ? 'Off' : '';

              if (rec) {
                if (rec.status === 'Present') {
                  cellStyle = 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300';
                  shortLabel = 'P';
                } else if (rec.status === 'Late') {
                  cellStyle = 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300';
                  shortLabel = 'Late';
                } else if (rec.status === 'Half Day') {
                  cellStyle = 'border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300';
                  shortLabel = 'HD';
                } else if (rec.status === 'Leave') {
                  cellStyle = 'border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300';
                  shortLabel = 'L';
                }
              }

              return (
                <div
                  key={dateKey}
                  className={`h-11 rounded-lg border p-1 flex flex-col items-center justify-center text-xs tabular-nums ${cellStyle} ${
                    dateKey === todayStr ? 'ring-2 ring-[#B5121B]' : ''
                  }`}
                >
                  <span className="font-semibold leading-none">{dayNum}</span>
                  {shortLabel && <span className="text-[10px] mt-0.5 leading-none">{shortLabel}</span>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Right Column: Leave Balances, Recent Leaves & Latest Payslip */}
        <div className="space-y-5">
          {/* Leave Balances */}
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-display font-semibold">Leave Balances</h2>
              <button
                onClick={() => onNavigate('leaves')}
                className="text-xs font-medium text-[#B5121B] dark:text-red-400 hover:underline"
              >
                Apply Leave
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Sick (SL)</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-0.5">{employee.sickLeaveBalance}</div>
              </div>
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Casual (CL)</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-0.5">{employee.casualLeaveBalance}</div>
              </div>
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Carry Fwd</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-0.5">{employee.carryForwardBalance}</div>
              </div>
            </div>

            {(() => {
              const policy = normalizeLeavePolicyConfig(settings.leavePolicy);
              const clEligDate =
                employee.clEligibilityDate ||
                calculateCasualLeaveEligibilityDate(employee.joiningDate, policy.casualLeaveEligibilityMonths);
              const isClEligible = todayStr >= clEligDate;
              const myPendingCount = myLeaves.filter((l) => l.status === 'Pending').length;
              return (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                  <span>
                    CL {isClEligible ? 'eligible since' : 'eligible on'} {clEligDate}
                  </span>
                  <span>Pending: {myPendingCount}</span>
                </div>
              );
            })()}

            <div className="space-y-2 pt-1">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Recent Leave Requests</div>
              {loading ? (
                <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
              ) : myLeaves.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">No leave requests submitted yet.</p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {myLeaves.slice(0, 3).map((l) => (
                    <div key={l.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-950 dark:text-zinc-100 truncate">
                          {l.leaveType} · {l.startDate} ({l.days}d)
                        </div>
                        <div className="text-zinc-500 dark:text-zinc-400 truncate">{l.reason}</div>
                      </div>
                      <span
                        className={`shrink-0 font-medium inline-flex items-center gap-1 ${
                          l.status === 'Approved'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : l.status === 'Rejected'
                            ? 'text-[#B5121B] dark:text-red-400'
                            : l.status === 'Cancelled'
                            ? 'text-zinc-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {l.status === 'Approved' && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {l.status === 'Rejected' && <AlertCircle className="w-3.5 h-3.5" />}
                        {l.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Latest Published Payslip */}
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-display font-semibold">Latest Payslip</h2>
              <button
                onClick={() => onNavigate('payroll')}
                className="text-xs font-medium text-[#B5121B] dark:text-red-400 hover:underline"
              >
                View All
              </button>
            </div>

            {myLatestPayslip ? (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{myLatestPayslip.month}</div>
                    <div className="text-xl font-bold font-mono tabular-nums mt-0.5">
                      {formatMoney(myLatestPayslip.netSalary, myLatestPayslip.currency || schedule.currency)}
                    </div>
                  </div>
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Published</span>
                </div>
                <button
                  onClick={() => handleDownloadPayslip(myLatestPayslip)}
                  disabled={downloadingId === myLatestPayslip.id}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  {downloadingId === myLatestPayslip.id ? 'Generating PDF...' : 'Download Payslip PDF'}
                </button>
              </div>
            ) : (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 py-2">
                <CalendarDays className="w-4 h-4 shrink-0" />
                <span>No published payslips available yet.</span>
              </div>
            )}
          </section>
        </div>
      </div>

      <CameraCaptureModal
        mode={punchModal || 'in'}
        isOpen={punchModal !== null}
        onClose={() => setPunchModal(null)}
        onConfirm={handlePunchConfirm}
      />
    </div>
  );
}

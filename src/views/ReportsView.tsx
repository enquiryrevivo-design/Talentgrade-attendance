import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  AttendanceRecord,
  Department,
  Employee,
  LeaveApplication,
  PayrollRecord,
} from '../types/hr';
import {
  exportToCsv,
  fetchAllEmployees,
  fetchAttendanceRecords,
  fetchLeaveApplications,
  fetchPayrollRecords,
  formatDurationMinutes,
  formatMoney,
  formatTimeDisplay,
  getDepartments,
  getEffectiveSchedule,
  getTodayInTimezone,
} from '../lib/hrService';

export function ReportsView() {
  const { employee, settings } = useAuth();
  const { showToast } = useToast();

  const todayStr = getTodayInTimezone(
    employee && settings ? getEffectiveSchedule(employee, settings).timezone : 'Asia/Kolkata'
  );
  const [category, setCategory] = useState<'attendance' | 'leave' | 'payroll'>('attendance');
  const [attReportType, setAttReportType] = useState<
    'daily' | 'monthly' | 'employee' | 'late' | 'absent' | 'half_day' | 'incomplete'
  >('monthly');
  const [leaveReportType, setLeaveReportType] = useState<'history' | 'balances' | 'summary'>('history');

  const [monthFilter, setMonthFilter] = useState(todayStr.slice(0, 7));
  const [dateFilter, setDateFilter] = useState(todayStr);
  const [deptFilter, setDeptFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!employee || !settings) return;
    setLoading(true);
    try {
      const canPayroll =
        employee.role === 'super_admin' ||
        (employee.role === 'team_leader' && settings.teamLeaderPermissions.canViewSalary);
      const [empList, deptList, attList, leaveList, payList] = await Promise.all([
        fetchAllEmployees(employee),
        getDepartments(),
        fetchAttendanceRecords(employee),
        fetchLeaveApplications(employee),
        canPayroll ? fetchPayrollRecords(employee) : Promise.resolve([]),
      ]);
      setEmployees(empList);
      setDepartments(deptList);
      setAttendance(attList);
      setLeaves(leaveList);
      setPayrolls(payList);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, settings, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!employee || !settings) return null;

  const canPayroll =
    employee.role === 'super_admin' ||
    (employee.role === 'team_leader' && settings.teamLeaderPermissions.canViewSalary);

  const availableLocations =
    settings.locations && settings.locations.length > 0 ? settings.locations : ['India', 'Dubai, UAE'];

  const matchesEmpLocation = (empId: string) => {
    if (locationFilter === 'all') return true;
    const emp = employees.find((e) => e.id === empId);
    return (emp?.location || 'India') === locationFilter;
  };

  const deptEmployees = employees.filter((e) => {
    if (deptFilter !== 'all' && e.department !== deptFilter) return false;
    if (locationFilter !== 'all' && (e.location || 'India') !== locationFilter) return false;
    return true;
  });

  const filteredAtt = attendance.filter((r) => {
    if (deptFilter !== 'all' && r.department !== deptFilter) return false;
    if (!matchesEmpLocation(r.employeeId)) return false;
    if (attReportType === 'daily') return r.date === dateFilter;
    if (!r.date.startsWith(monthFilter)) return false;
    if (attReportType === 'late') return r.isLate || r.status === 'Late';
    if (attReportType === 'half_day') return r.status === 'Half Day';
    if (attReportType === 'incomplete') return Boolean(r.punchInTime && !r.punchOutTime);
    return true;
  });

  const absentEmployeesOnDate = deptEmployees.filter(
    (e) =>
      e.status === 'Active' &&
      !attendance.some((a) => a.employeeId === e.id && a.date === dateFilter)
  );

  const employeeMonthlySummary = deptEmployees.map((e) => {
    const recs = attendance.filter((a) => a.employeeId === e.id && a.date.startsWith(monthFilter));
    return {
      employee: e,
      present: recs.filter((r) => r.status === 'Present' || r.status === 'Late').length,
      late: recs.filter((r) => r.isLate).length,
      halfDay: recs.filter((r) => r.status === 'Half Day').length,
      leave: recs.filter((r) => r.status === 'Leave').length,
      totalMinutes: recs.reduce((s, r) => s + (r.workingMinutes || 0), 0),
    };
  });

  const filteredLeaves = leaves.filter((l) => {
    if (deptFilter !== 'all' && l.department !== deptFilter) return false;
    if (!matchesEmpLocation(l.employeeId)) return false;
    return true;
  });

  const filteredPayrolls = payrolls.filter((p) => {
    if (p.month !== monthFilter) return false;
    if (deptFilter !== 'all' && p.department !== deptFilter) return false;
    if (locationFilter !== 'all' && (p.location || 'India') !== locationFilter) return false;
    return true;
  });

  // Group payroll totals cleanly by currency (INR and AED should never be blindly summed together)
  const currencyTotals = filteredPayrolls.reduce<Record<string, number>>((acc, p) => {
    const cur = p.currency || 'INR';
    acc[cur] = (acc[cur] || 0) + p.netSalary;
    return acc;
  }, {});

  const handleExport = () => {
    if (category === 'attendance') {
      if (attReportType === 'absent') {
        exportToCsv(
          `absence_report_${dateFilter}.csv`,
          ['Employee Code', 'Full Name', 'Location', 'Department', 'Designation', 'Date'],
          absentEmployeesOnDate.map((e) => [
            e.employeeCode,
            e.fullName,
            e.location || 'India',
            e.department,
            e.designation,
            dateFilter,
          ])
        );
      } else if (attReportType === 'employee') {
        exportToCsv(
          `employee_attendance_summary_${monthFilter}.csv`,
          ['Employee Code', 'Name', 'Location', 'Department', 'Present Days', 'Late Count', 'Half Days', 'Leave Days', 'Working Hours'],
          employeeMonthlySummary.map((s) => [
            s.employee.employeeCode,
            s.employee.fullName,
            s.employee.location || 'India',
            s.employee.department,
            s.present,
            s.late,
            s.halfDay,
            s.leave,
            formatDurationMinutes(s.totalMinutes),
          ])
        );
      } else {
        exportToCsv(
          `attendance_${attReportType}_${attReportType === 'daily' ? dateFilter : monthFilter}.csv`,
          ['Date', 'Employee', 'Department', 'Timezone', 'Punch In', 'Punch Out', 'Duration', 'Status', 'Late By (min)'],
          filteredAtt.map((r) => [
            r.date,
            r.employeeName,
            r.department,
            r.timezone || 'Asia/Kolkata',
            formatTimeDisplay(r.punchInTime, r.timezone || 'Asia/Kolkata'),
            formatTimeDisplay(r.punchOutTime, r.timezone || 'Asia/Kolkata'),
            formatDurationMinutes(r.workingMinutes),
            r.status,
            r.lateByMinutes,
          ])
        );
      }
    } else if (category === 'leave') {
      if (leaveReportType === 'balances') {
        exportToCsv(
          `leave_balances_${todayStr}.csv`,
          ['Code', 'Employee', 'Location', 'Department', 'Sick Leave (SL)', 'Casual Leave (CL)', 'Carry Forward'],
          deptEmployees.map((e) => [
            e.employeeCode,
            e.fullName,
            e.location || 'India',
            e.department,
            e.sickLeaveBalance,
            e.casualLeaveBalance,
            e.carryForwardBalance,
          ])
        );
      } else {
        exportToCsv(
          `leave_history_${todayStr}.csv`,
          ['Employee', 'Department', 'Type', 'Start Date', 'End Date', 'Days', 'Status', 'Reason'],
          filteredLeaves.map((l) => [
            l.employeeName,
            l.department,
            l.leaveType,
            l.startDate,
            l.endDate,
            l.days,
            l.status,
            l.reason,
          ])
        );
      }
    } else if (category === 'payroll' && canPayroll) {
      exportToCsv(
        `payroll_summary_${monthFilter}.csv`,
        ['Month', 'Code', 'Employee', 'Location', 'Currency', 'Department', 'Gross', 'Deductions', 'Net Salary', 'Status'],
        filteredPayrolls.map((p) => [
          p.month,
          p.employeeCode,
          p.employeeName,
          p.location || 'India',
          p.currency || 'INR',
          p.department,
          p.grossEarnings,
          p.totalDeductions,
          p.netSalary,
          p.status,
        ])
      );
    }
    showToast('CSV report exported.', 'success');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Reports &amp; Exports</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Operational attendance, leave, and multi-currency (INR / AED) payroll reports with CSV export
          </p>
        </div>

        <button
          type="button"
          onClick={handleExport}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-black dark:bg-white text-white dark:text-black text-xs font-semibold"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Category Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
          <button
            type="button"
            onClick={() => setCategory('attendance')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium ${
              category === 'attendance' ? 'bg-white dark:bg-zinc-900 shadow-sm text-zinc-950 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Attendance Reports
          </button>
          <button
            type="button"
            onClick={() => setCategory('leave')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium ${
              category === 'leave' ? 'bg-white dark:bg-zinc-900 shadow-sm text-zinc-950 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Leave Reports
          </button>
          {canPayroll && (
            <button
              type="button"
              onClick={() => setCategory('payroll')}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium ${
                category === 'payroll' ? 'bg-white dark:bg-zinc-900 shadow-sm text-zinc-950 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Payroll Reports
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {category === 'attendance' && (
            <select
              value={attReportType}
              onChange={(e) => setAttReportType(e.target.value as typeof attReportType)}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
            >
              <option value="monthly">Monthly Attendance</option>
              <option value="daily">Daily Attendance</option>
              <option value="employee">Employee-wise Summary</option>
              <option value="late">Late-Arrival Report</option>
              <option value="absent">Absence Report</option>
              <option value="half_day">Half-Day Report</option>
              <option value="incomplete">Incomplete Punch Report</option>
            </select>
          )}

          {category === 'leave' && (
            <select
              value={leaveReportType}
              onChange={(e) => setLeaveReportType(e.target.value as typeof leaveReportType)}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
            >
              <option value="history">Leave History</option>
              <option value="balances">Employee Leave Balances</option>
              <option value="summary">Leave-Type Summary</option>
            </select>
          )}

          {category === 'attendance' && (attReportType === 'daily' || attReportType === 'absent') ? (
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
            />
          ) : (
            category !== 'leave' && (
              <input
                type="month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            )
          )}

          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          >
            <option value="all">All Locations</option>
            {availableLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Report Data Table */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 h-32 animate-pulse bg-zinc-100 dark:bg-zinc-800" />
        ) : category === 'attendance' ? (
          attReportType === 'absent' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Designation</th>
                    <th className="py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {absentEmployeesOnDate.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-500">
                        No absences recorded for {dateFilter}.
                      </td>
                    </tr>
                  ) : (
                    absentEmployeesOnDate.map((e) => (
                      <tr key={e.id}>
                        <td className="py-3 px-4 font-mono">{e.employeeCode}</td>
                        <td className="py-3 px-4 font-semibold">{e.fullName}</td>
                        <td className="py-3 px-4">{e.location || 'India'}</td>
                        <td className="py-3 px-4">{e.department}</td>
                        <td className="py-3 px-4">{e.designation}</td>
                        <td className="py-3 px-4 font-mono">{dateFilter}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : attReportType === 'employee' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4 text-right">Present</th>
                    <th className="py-3 px-4 text-right">Late</th>
                    <th className="py-3 px-4 text-right">Half Day</th>
                    <th className="py-3 px-4 text-right">Leave</th>
                    <th className="py-3 px-4 text-right">Working Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {employeeMonthlySummary.map((row) => (
                    <tr key={row.employee.id}>
                      <td className="py-3 px-4 font-semibold">
                        {row.employee.fullName} ({row.employee.employeeCode})
                      </td>
                      <td className="py-3 px-4">{row.employee.location || 'India'}</td>
                      <td className="py-3 px-4">{row.employee.department}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{row.present}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{row.late}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{row.halfDay}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{row.leave}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatDurationMinutes(row.totalMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Punch In</th>
                    <th className="py-3 px-4">Punch Out</th>
                    <th className="py-3 px-4 text-right">Duration</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredAtt.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500">
                        No matching attendance records.
                      </td>
                    </tr>
                  ) : (
                    filteredAtt.map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 px-4 font-mono">{r.date}</td>
                        <td className="py-3 px-4 font-semibold">{r.employeeName}</td>
                        <td className="py-3 px-4">{r.department}</td>
                        <td className="py-3 px-4 font-mono">{formatTimeDisplay(r.punchInTime, r.timezone || 'Asia/Kolkata')}</td>
                        <td className="py-3 px-4 font-mono">{formatTimeDisplay(r.punchOutTime, r.timezone || 'Asia/Kolkata')}</td>
                        <td className="py-3 px-4 text-right font-mono">
                          {formatDurationMinutes(r.workingMinutes)}
                        </td>
                        <td className="py-3 px-4 font-medium">{r.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : category === 'leave' ? (
          leaveReportType === 'balances' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4 text-right">Sick Leave (SL)</th>
                    <th className="py-3 px-4 text-right">Casual Leave (CL)</th>
                    <th className="py-3 px-4 text-right">Carry Forward</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {deptEmployees.map((e) => (
                    <tr key={e.id}>
                      <td className="py-3 px-4 font-semibold">
                        {e.fullName} ({e.employeeCode})
                      </td>
                      <td className="py-3 px-4">{e.location || 'India'}</td>
                      <td className="py-3 px-4">{e.department}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{e.sickLeaveBalance}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{e.casualLeaveBalance}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{e.carryForwardBalance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : leaveReportType === 'summary' ? (
            <div className="p-6 grid sm:grid-cols-3 gap-4 text-xs">
              {(['SL', 'CL', 'LWP'] as const).map((t) => {
                const items = filteredLeaves.filter((l) => l.leaveType === t);
                const approvedDays = items
                  .filter((l) => l.status === 'Approved')
                  .reduce((s, l) => s + l.days, 0);
                return (
                  <div key={t} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <div className="font-semibold text-sm">{t} Summary</div>
                    <div className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-400">
                      <div>Total Applications: {items.length}</div>
                      <div>Pending: {items.filter((l) => l.status === 'Pending').length}</div>
                      <div>Approved Days: {approvedDays}</div>
                      <div>Rejected: {items.filter((l) => l.status === 'Rejected').length}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Period</th>
                    <th className="py-3 px-4 text-right">Days</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredLeaves.map((l) => (
                    <tr key={l.id}>
                      <td className="py-3 px-4 font-semibold">{l.employeeName}</td>
                      <td className="py-3 px-4 font-mono">{l.leaveType}</td>
                      <td className="py-3 px-4 font-mono">
                        {l.startDate} → {l.endDate}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{l.days}</td>
                      <td className="py-3 px-4 font-medium">{l.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div>
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs bg-zinc-50 dark:bg-zinc-950/40">
              <span>Monthly Payroll Totals ({monthFilter})</span>
              <div className="flex flex-wrap items-center gap-4 font-mono font-bold text-sm">
                {Object.keys(currencyTotals).length === 0 ? (
                  <span>{formatMoney(0, 'INR')}</span>
                ) : (
                  Object.entries(currencyTotals).map(([cur, total]) => (
                    <span key={cur}>{formatMoney(total, cur)}</span>
                  ))
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Location · Currency</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4 text-right">Gross</th>
                    <th className="py-3 px-4 text-right">Deductions</th>
                    <th className="py-3 px-4 text-right">Net Salary</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredPayrolls.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500">
                        No payroll records for {monthFilter}.
                      </td>
                    </tr>
                  ) : (
                    filteredPayrolls.map((p) => {
                      const cur = p.currency || 'INR';
                      return (
                        <tr key={p.id}>
                          <td className="py-3 px-4 font-semibold">
                            {p.employeeName} ({p.employeeCode})
                          </td>
                          <td className="py-3 px-4 font-mono">
                            {p.location || 'India'} · {cur}
                          </td>
                          <td className="py-3 px-4">{p.department}</td>
                          <td className="py-3 px-4 text-right font-mono">
                            {formatMoney(p.grossEarnings, cur)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono">
                            {formatMoney(p.totalDeductions, cur)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold">
                            {formatMoney(p.netSalary, cur)}
                          </td>
                          <td className="py-3 px-4">{p.status}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

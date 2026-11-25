import React, { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Eye,
  Plus,
  Trash2,
  FileText,
  Send,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  AttendanceRecord,
  Employee,
  EmployeeSalary,
  PayrollRecord,
  PayrollStatus,
  SalaryLineItem,
} from '../types/hr';
import {
  fetchAllEmployees,
  fetchAllSalaries,
  fetchAttendanceRecords,
  fetchPayrollRecords,
  formatMoney,
  generatePayslipPdfBlob,
  getEffectiveSchedule,
  saveEmployeeSalary,
  savePayrollRecord,
} from '../lib/hrService';

export function PayrollView() {
  const { employee, settings } = useAuth();
  const { showToast } = useToast();

  const currentMonth = new Date().toISOString().slice(0, 7);

  const [tab, setTab] = useState<'workbench' | 'salaries' | 'archive'>('workbench');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaries, setSalaries] = useState<EmployeeSalary[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Workbench State
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [payrollCurrency, setPayrollCurrency] = useState('INR');
  const [basicSalary, setBasicSalary] = useState(0);
  const [hra, setHra] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [professionalTax, setProfessionalTax] = useState(0);
  const [otherEarnings, setOtherEarnings] = useState<SalaryLineItem[]>([]);
  const [deductions, setDeductions] = useState<SalaryLineItem[]>([]);
  const [workingDaysInMonth, setWorkingDaysInMonth] = useState(22);
  const [presentDays, setPresentDays] = useState(22);
  const [leaveDays, setLeaveDays] = useState(0);
  const [notes, setNotes] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Salary Configuration State
  const [salEmpId, setSalEmpId] = useState('');
  const [salCurrency, setSalCurrency] = useState('INR');
  const [salBasic, setSalBasic] = useState(0);
  const [salHra, setSalHra] = useState(0);
  const [salBonus, setSalBonus] = useState(0);
  const [salTax, setSalTax] = useState(0);
  const [salOther, setSalOther] = useState<SalaryLineItem[]>([]);
  const [salDed, setSalDed] = useState<SalaryLineItem[]>([]);

  // PDF Preview Modal
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  const loadData = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const isSuperAdmin = employee.role === 'super_admin';
      const canViewSalary =
        isSuperAdmin ||
        (employee.role === 'team_leader' && Boolean(settings?.teamLeaderPermissions?.canViewSalary));
      const [empList, salList, payList, attList] = await Promise.all([
        isSuperAdmin ? fetchAllEmployees(employee, true) : Promise.resolve([employee]),
        isSuperAdmin ? fetchAllSalaries() : Promise.resolve([]),
        fetchPayrollRecords(employee, canViewSalary),
        fetchAttendanceRecords(employee, undefined, settings?.teamLeaderPermissions?.canViewAllEmployees ?? true),
      ]);
      setEmployees(empList);
      setSalaries(salList);
      setPayrolls(payList);
      setAttendance(attList);

      if (isSuperAdmin && empList.length > 0 && !selectedEmpId) {
        setSelectedEmpId(empList[0].id);
        setSalEmpId(empList[0].id);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load payroll data', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, settings?.teamLeaderPermissions?.canViewSalary, settings?.teamLeaderPermissions?.canViewAllEmployees, selectedEmpId, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Populate workbench when selected employee or month changes
  useEffect(() => {
    if (!selectedEmpId || !settings) return;
    const targetEmp = employees.find((e) => e.id === selectedEmpId);
    const effective = targetEmp ? getEffectiveSchedule(targetEmp, settings) : null;
    const existingPayroll = payrolls.find(
      (p) => p.employeeId === selectedEmpId && p.month === selectedMonth
    );
    const salConfig = salaries.find((s) => s.employeeId === selectedEmpId);

    const monthAtt = attendance.filter(
      (a) => a.employeeId === selectedEmpId && a.date.startsWith(selectedMonth)
    );
    const presCount = monthAtt.filter((a) => a.status === 'Present' || a.status === 'Late').length;
    const leaveCount = monthAtt.filter((a) => a.status === 'Leave').length;

    const [yr, mo] = selectedMonth.split('-').map(Number);
    const daysTotal = new Date(yr, mo, 0).getDate();
    const empWorkingDays = effective?.workingDays || settings.workingDays || [1, 2, 3, 4, 5];
    let workDays = 0;
    for (let d = 1; d <= daysTotal; d++) {
      const dow = new Date(Date.UTC(yr, mo - 1, d)).getUTCDay();
      if (empWorkingDays.includes(dow)) workDays++;
    }

    if (existingPayroll) {
      setPayrollCurrency(existingPayroll.currency || salConfig?.currency || effective?.currency || 'INR');
      setBasicSalary(existingPayroll.basicSalary);
      setHra(existingPayroll.hra);
      setBonus(existingPayroll.bonus);
      setProfessionalTax(existingPayroll.professionalTax);
      setOtherEarnings(existingPayroll.otherEarnings || []);
      setDeductions(existingPayroll.deductions || []);
      setWorkingDaysInMonth(existingPayroll.workingDaysInMonth);
      setPresentDays(existingPayroll.presentDays);
      setLeaveDays(existingPayroll.leaveDays);
      setNotes(existingPayroll.notes || '');
      setRevisionReason('');
    } else if (salConfig) {
      setPayrollCurrency(salConfig.currency || effective?.currency || 'INR');
      setBasicSalary(salConfig.basicSalary);
      setHra(salConfig.hra);
      setBonus(salConfig.defaultBonus);
      setProfessionalTax(salConfig.professionalTax);
      setOtherEarnings(salConfig.otherEarnings || []);
      setDeductions(salConfig.deductions || []);
      setWorkingDaysInMonth(workDays);
      setPresentDays(presCount);
      setLeaveDays(leaveCount);
      setNotes('');
      setRevisionReason('');
    } else {
      setPayrollCurrency(effective?.currency || 'INR');
      setBasicSalary(0);
      setHra(0);
      setBonus(0);
      setProfessionalTax(0);
      setOtherEarnings([]);
      setDeductions([]);
      setWorkingDaysInMonth(workDays);
      setPresentDays(presCount);
      setLeaveDays(leaveCount);
      setNotes('');
      setRevisionReason('');
    }
  }, [selectedEmpId, selectedMonth, payrolls, salaries, attendance, settings, employees]);

  // Populate Salary Config form when salEmpId changes
  useEffect(() => {
    if (!salEmpId || !settings) return;
    const targetEmp = employees.find((e) => e.id === salEmpId);
    const effective = targetEmp ? getEffectiveSchedule(targetEmp, settings) : null;
    const s = salaries.find((x) => x.employeeId === salEmpId);
    setSalCurrency(s?.currency || effective?.currency || 'INR');
    setSalBasic(s?.basicSalary ?? 0);
    setSalHra(s?.hra ?? 0);
    setSalBonus(s?.defaultBonus ?? 0);
    setSalTax(s?.professionalTax ?? 0);
    setSalOther(s?.otherEarnings || []);
    setSalDed(s?.deductions || []);
  }, [salEmpId, salaries, employees, settings]);

  if (!employee || !settings) return null;

  const isSuperAdmin = employee.role === 'super_admin';
  const myCurrency = getEffectiveSchedule(employee, settings).currency;

  const grossEarnings =
    basicSalary + hra + bonus + otherEarnings.reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalDeductions =
    professionalTax + deductions.reduce((s, x) => s + Number(x.amount || 0), 0);
  const netSalary = grossEarnings - totalDeductions;

  const existingSelectedPayroll = payrolls.find(
    (p) => p.employeeId === selectedEmpId && p.month === selectedMonth
  );
  const selectedWorkbenchEmp = employees.find((e) => e.id === selectedEmpId);

  const handleSavePayroll = async (targetStatus: PayrollStatus) => {
    const targetEmp = employees.find((e) => e.id === selectedEmpId);
    if (!targetEmp) return;
    setSaving(true);
    try {
      await savePayrollRecord(
        {
          employee: targetEmp,
          month: selectedMonth,
          currency: payrollCurrency,
          basicSalary,
          hra,
          otherEarnings,
          bonus,
          deductions,
          professionalTax,
          workingDaysInMonth,
          presentDays,
          leaveDays,
          status: targetStatus,
          notes,
          revisionReason,
        },
        employee
      );
      showToast(`Payroll saved as ${targetStatus} (${payrollCurrency}).`, 'success');
      setRevisionReason('');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save payroll', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSalaryConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmp = employees.find((x) => x.id === salEmpId);
    if (!targetEmp) return;
    try {
      await saveEmployeeSalary(
        {
          employee: targetEmp,
          currency: salCurrency,
          basicSalary: salBasic,
          hra: salHra,
          otherEarnings: salOther,
          deductions: salDed,
          professionalTax: salTax,
          defaultBonus: salBonus,
        },
        employee
      );
      showToast(`Salary configuration saved for ${targetEmp.fullName} (${salCurrency}).`, 'success');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save salary structure', 'error');
    }
  };

  const handlePdfAction = async (payslip: PayrollRecord, action: 'preview' | 'download') => {
    try {
      const blob = await generatePayslipPdfBlob(payslip, settings);
      const url = URL.createObjectURL(blob);
      if (action === 'preview') {
        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl(url);
        setPreviewTitle(`${payslip.employeeName} — ${payslip.month}`);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `Payslip_${payslip.employeeCode}_${payslip.month}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'PDF generation failed', 'error');
    }
  };

  // Employee / Non-Admin View: My Published Payslips ONLY
  if (!isSuperAdmin) {
    const myPayslips = payrolls.filter((p) => p.employeeId === employee.id && p.status === 'Published');
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-semibold">My Payslips</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            View and download your published TalentGrade salary statements ({myCurrency})
          </p>
        </div>

        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-6 h-24 animate-pulse bg-zinc-100 dark:bg-zinc-800" />
          ) : myPayslips.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <FileText className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto" />
              <p className="text-sm font-medium">No published payslips yet</p>
              <p className="text-xs text-zinc-500">Published payslips will appear here once finalized by HR.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {myPayslips.map((p) => {
                const cur = p.currency || myCurrency;
                return (
                  <div key={p.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold font-mono">{p.month}</div>
                      <div className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                        Gross {formatMoney(p.grossEarnings, cur)} · Deductions{' '}
                        {formatMoney(p.totalDeductions, cur)} · Net{' '}
                        <span className="font-semibold text-zinc-950 dark:text-zinc-100">
                          {formatMoney(p.netSalary, cur)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handlePdfAction(p, 'preview')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Preview PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePdfAction(p, 'download')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-medium inline-flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {pdfPreviewUrl && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-4xl h-[88vh] bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
              <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <span className="text-sm font-semibold">{previewTitle}</span>
                <button
                  onClick={() => {
                    URL.revokeObjectURL(pdfPreviewUrl);
                    setPdfPreviewUrl(null);
                  }}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <iframe src={pdfPreviewUrl} title="Payslip PDF Preview" className="w-full flex-1 bg-zinc-100" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // SUPER ADMIN VIEW
  const previewRecordObj: PayrollRecord | null = (() => {
    const targetEmp = employees.find((e) => e.id === selectedEmpId);
    if (!targetEmp) return null;
    return {
      id: `${targetEmp.id}_${selectedMonth}`,
      employeeId: targetEmp.id,
      employeeUid: targetEmp.uid,
      employeeName: targetEmp.fullName,
      employeeCode: targetEmp.employeeCode,
      designation: targetEmp.designation,
      department: targetEmp.department,
      location: targetEmp.location || 'India',
      currency: payrollCurrency,
      month: selectedMonth,
      basicSalary,
      hra,
      otherEarnings,
      bonus,
      deductions,
      professionalTax,
      grossEarnings,
      totalDeductions,
      netSalary,
      workingDaysInMonth,
      presentDays,
      leaveDays,
      status: existingSelectedPayroll?.status || 'Draft',
      notes,
      createdBy: employee.uid,
    };
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Manual Payroll &amp; Payslips</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Configure INR &amp; AED salaries, prepare monthly payroll, and publish PDF payslips
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-zinc-200/70 dark:bg-zinc-800 rounded-xl">
          {(
            [
              { id: 'workbench', label: 'Monthly Payroll' },
              { id: 'salaries', label: 'Salary Config' },
              { id: 'archive', label: `Payslips (${payrolls.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap ${
                tab === t.id
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: MONTHLY PAYROLL WORKBENCH */}
      {tab === 'workbench' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-5 text-xs">
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-medium mb-1">Payroll Month</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Employee</label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName} ({e.employeeCode}) · {e.location || 'India'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Payslip Currency</label>
                <select
                  value={payrollCurrency}
                  onChange={(e) => setPayrollCurrency(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="AED">AED (د.إ)</option>
                </select>
              </div>
            </div>

            {existingSelectedPayroll && (
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <span>
                  Current Record Status:{' '}
                  <strong className="text-zinc-950 dark:text-zinc-100">{existingSelectedPayroll.status}</strong>
                </span>
                <span className="font-mono tabular-nums">
                  Saved Net: {formatMoney(existingSelectedPayroll.netSalary, existingSelectedPayroll.currency || payrollCurrency)}
                </span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-medium mb-1">Working Days</label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={workingDaysInMonth}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    setWorkingDaysInMonth(Number.isFinite(v) ? Math.max(0, Math.min(31, v)) : 0);
                  }}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Present Days</label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  step="0.5"
                  value={presentDays}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    setPresentDays(Number.isFinite(v) ? Math.max(0, Math.min(31, v)) : 0);
                  }}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Leave Days</label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  step="0.5"
                  value={leaveDays}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    setLeaveDays(Number.isFinite(v) ? Math.max(0, Math.min(31, v)) : 0);
                  }}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                />
              </div>
            </div>

            {/* Earnings & Deductions Inputs */}
            <div className="grid sm:grid-cols-2 gap-5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div className="space-y-3">
                <div className="font-semibold text-sm">Earnings ({payrollCurrency})</div>
                <div>
                  <label className="block font-medium mb-1">Basic Salary</label>
                  <input
                    type="number"
                    min={0}
                    value={basicSalary}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      setBasicSalary(Number.isFinite(v) ? Math.max(0, v) : 0);
                    }}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">HRA / Housing Allowance</label>
                  <input
                    type="number"
                    min={0}
                    value={hra}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      setHra(Number.isFinite(v) ? Math.max(0, v) : 0);
                    }}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Bonus / Incentives</label>
                  <input
                    type="number"
                    min={0}
                    value={bonus}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      setBonus(Number.isFinite(v) ? Math.max(0, v) : 0);
                    }}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                {otherEarnings.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      placeholder="Label"
                      value={item.label}
                      onChange={(e) =>
                        setOtherEarnings((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x))
                        )
                      }
                      className="flex-1 min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    />
                    <input
                      type="number"
                      min={0}
                      value={item.amount}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
                        setOtherEarnings((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, amount: safe } : x))
                        );
                      }}
                      className="w-24 min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setOtherEarnings((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 text-[#B5121B]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setOtherEarnings((p) => [...p, { label: 'Allowance', amount: 0 }])}
                  className="inline-flex items-center gap-1 text-[#B5121B] dark:text-red-400 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Earning Item
                </button>
              </div>

              <div className="space-y-3">
                <div className="font-semibold text-sm">Deductions ({payrollCurrency})</div>
                <div>
                  <label className="block font-medium mb-1">Professional Tax / Standard Tax</label>
                  <input
                    type="number"
                    min={0}
                    value={professionalTax}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      setProfessionalTax(Number.isFinite(v) ? Math.max(0, v) : 0);
                    }}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                {deductions.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      placeholder="Deduction label"
                      value={item.label}
                      onChange={(e) =>
                        setDeductions((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x))
                        )
                      }
                      className="flex-1 min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    />
                    <input
                      type="number"
                      min={0}
                      value={item.amount}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
                        setDeductions((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, amount: safe } : x))
                        );
                      }}
                      className="w-24 min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setDeductions((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 text-[#B5121B]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setDeductions((p) => [...p, { label: 'Other Deduction', amount: 0 }])}
                  className="inline-flex items-center gap-1 text-[#B5121B] dark:text-red-400 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Deduction Item
                </button>
              </div>
            </div>

            <div>
              <label className="block font-medium mb-1">Payslip Notes (optional)</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reimbursements, overtime notes, or settlement details..."
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>

            {existingSelectedPayroll && existingSelectedPayroll.status !== 'Draft' && (
              <div>
                <label className="block font-medium mb-1 text-amber-700 dark:text-amber-400">
                  Authorized Revision Reason (Required to update Finalized/Published payroll)
                </label>
                <input
                  value={revisionReason}
                  onChange={(e) => setRevisionReason(e.target.value)}
                  placeholder="Document why this finalized payroll entry is being revised..."
                  className="w-full min-h-[40px] px-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20"
                />
              </div>
            )}
          </div>

          {/* Right: Live Net Calculation & Actions */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-5 h-fit">
            <div>
              <h2 className="text-base font-display font-semibold">Payroll Summary</h2>
              {selectedWorkbenchEmp && (
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {selectedWorkbenchEmp.fullName} · {selectedWorkbenchEmp.location || 'India'} · {payrollCurrency}
                </p>
              )}
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Gross Earnings</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatMoney(grossEarnings, payrollCurrency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Total Deductions</span>
                <span className="font-mono font-semibold tabular-nums text-[#B5121B] dark:text-red-400">
                  -{formatMoney(totalDeductions, payrollCurrency)}
                </span>
              </div>
              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-baseline">
                <span className="font-semibold text-sm">Net Payable</span>
                <span className="text-2xl font-bold font-mono tabular-nums text-zinc-950 dark:text-white">
                  {formatMoney(netSalary, payrollCurrency)}
                </span>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              {previewRecordObj && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handlePdfAction(previewRecordObj, 'preview')}
                    className="min-h-[42px] px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center justify-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Preview PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePdfAction(previewRecordObj, 'download')}
                    className="min-h-[42px] px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download PDF
                  </button>
                </div>
              )}

              <button
                type="button"
                disabled={saving}
                onClick={() => handleSavePayroll('Draft')}
                className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Save as Draft
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSavePayroll('Finalized')}
                className="w-full min-h-[44px] rounded-xl bg-black dark:bg-white text-white dark:text-black text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Finalize Payroll
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSavePayroll('Published')}
                className="w-full min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                Publish Payslip to Employee
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SALARY CONFIGURATION */}
      {tab === 'salaries' && (
        <form
          onSubmit={handleSaveSalaryConfig}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 max-w-3xl space-y-5 text-xs"
        >
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block font-medium mb-1">Select Employee</label>
              <select
                value={salEmpId}
                onChange={(e) => setSalEmpId(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.employeeCode}) — {e.department} · {e.location || 'India'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Salary Currency</label>
              <select
                value={salCurrency}
                onChange={(e) => setSalCurrency(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              >
                <option value="INR">INR (₹)</option>
                <option value="AED">AED (د.إ)</option>
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1">Basic Salary ({salCurrency})</label>
              <input
                type="number"
                min={0}
                value={salBasic}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setSalBasic(Number.isFinite(v) ? Math.max(0, v) : 0);
                }}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">HRA / Housing ({salCurrency})</label>
              <input
                type="number"
                min={0}
                value={salHra}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setSalHra(Number.isFinite(v) ? Math.max(0, v) : 0);
                }}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Default Bonus / Incentives ({salCurrency})</label>
              <input
                type="number"
                min={0}
                value={salBonus}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setSalBonus(Number.isFinite(v) ? Math.max(0, v) : 0);
                }}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Professional Tax ({salCurrency})</label>
              <input
                type="number"
                min={0}
                value={salTax}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setSalTax(Number.isFinite(v) ? Math.max(0, v) : 0);
                }}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="font-medium">Other Earnings</div>
              {salOther.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    value={item.label}
                    onChange={(e) =>
                      setSalOther((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                    }
                    className="flex-1 min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                  <input
                    type="number"
                    min={0}
                    value={item.amount}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
                      setSalOther((p) => p.map((x, i) => (i === idx ? { ...x, amount: safe } : x)));
                    }}
                    className="w-24 min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setSalOther((p) => p.filter((_, i) => i !== idx))}
                    className="text-[#B5121B] p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSalOther((p) => [...p, { label: 'Special Allowance', amount: 0 }])}
                className="inline-flex items-center gap-1 text-[#B5121B] dark:text-red-400 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Earning Component
              </button>
            </div>

            <div className="space-y-2">
              <div className="font-medium">Standard Deductions</div>
              {salDed.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    value={item.label}
                    onChange={(e) =>
                      setSalDed((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                    }
                    className="flex-1 min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                  <input
                    type="number"
                    min={0}
                    value={item.amount}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
                      setSalDed((p) => p.map((x, i) => (i === idx ? { ...x, amount: safe } : x)));
                    }}
                    className="w-24 min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setSalDed((p) => p.filter((_, i) => i !== idx))}
                    className="text-[#B5121B] p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSalDed((p) => [...p, { label: 'Standard Deduction', amount: 0 }])}
                className="inline-flex items-center gap-1 text-[#B5121B] dark:text-red-400 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Deduction Component
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
          >
            Save Salary Structure
          </button>
        </form>
      )}

      {/* TAB 3: PAYSLIP ARCHIVE */}
      {tab === 'archive' && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          {payrolls.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">No payroll entries created yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4 font-medium">Month</th>
                    <th className="py-3 px-4 font-medium">Employee</th>
                    <th className="py-3 px-4 font-medium">Location · Currency</th>
                    <th className="py-3 px-4 font-medium text-right">Gross</th>
                    <th className="py-3 px-4 font-medium text-right">Deductions</th>
                    <th className="py-3 px-4 font-medium text-right">Net Salary</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {payrolls.map((p) => {
                    const cur = p.currency || 'INR';
                    return (
                      <tr key={p.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                        <td className="py-3 px-4 font-mono tabular-nums">{p.month}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold">{p.employeeName}</div>
                          <div className="text-[11px] text-zinc-500">
                            {p.employeeCode} · {p.department}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-mono">
                          {p.location || 'India'} · {cur}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {formatMoney(p.grossEarnings, cur)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {formatMoney(p.totalDeductions, cur)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums">
                          {formatMoney(p.netSalary, cur)}
                        </td>
                        <td className="py-3 px-4 font-medium">{p.status}</td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handlePdfAction(p, 'preview')}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePdfAction(p, 'download')}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-black dark:bg-white text-white dark:text-black inline-flex items-center gap-1"
                            >
                              <Download className="w-3.5 h-3.5" />
                              PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Server PDF Preview Modal */}
      {pdfPreviewUrl && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[88vh] bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-sm font-semibold">Payslip PDF Preview — {previewTitle}</span>
              <button
                onClick={() => {
                  URL.revokeObjectURL(pdfPreviewUrl);
                  setPdfPreviewUrl(null);
                }}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <iframe src={pdfPreviewUrl} title="Payslip PDF Preview" className="w-full flex-1 bg-zinc-100" />
          </div>
        </div>
      )}
    </div>
  );
}

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
  Building2,
  Upload,
  Layers,
  Edit3,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  AttendanceRecord,
  CompanyId,
  CompanyIdentityOverride,
  Employee,
  EmployeeSalary,
  enforceCompanyCurrency,
  formatPayslipPdfFilename,
  getCompanyShortName,
  normalizeCompanyId,
  PayrollRecord,
  PayrollStatus,
  resolveCompanyProfile,
  SalaryLineItem,
} from '../types/hr';
import { CompanyBadge } from '../components/CompanyBadge';
import {
  bulkGeneratePayrollRecords,
  fetchAllEmployees,
  fetchAllSalaries,
  fetchAttendanceRecords,
  fetchPayrollRecords,
  formatMoney,
  generatePayslipPdfBlob,
  getEffectiveSchedule,
  saveEmployeeSalary,
  savePayrollRecord,
  uploadMediaAsset,
} from '../lib/hrService';

export function PayrollView() {
  const { employee, settings } = useAuth();
  const { showToast } = useToast();

  const currentMonth = new Date().toISOString().slice(0, 7);

  const [tab, setTab] = useState<'workbench' | 'salaries' | 'archive'>('workbench');
  const [companyFilter, setCompanyFilter] = useState<'all' | CompanyId>('all');
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

  // Per-Payslip Company Override State
  const [companyOverridden, setCompanyOverridden] = useState(false);
  const [overrideCompanyId, setOverrideCompanyId] = useState<CompanyId>('talentgrade');
  const [overrideCompanyName, setOverrideCompanyName] = useState('');
  const [overrideCompanyAddress, setOverrideCompanyAddress] = useState('');
  const [overrideLogoMode, setOverrideLogoMode] = useState<'default' | 'vector' | 'custom'>('default');
  const [overrideLogoAssetId, setOverrideLogoAssetId] = useState('');
  const [uploadingOverrideLogo, setUploadingOverrideLogo] = useState(false);

  // Bulk Generate Modal
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMonth, setBulkMonth] = useState(currentMonth);
  const [bulkCompanyFilter, setBulkCompanyFilter] = useState<'all' | CompanyId>('all');
  const [bulkStatus, setBulkStatus] = useState<PayrollStatus>('Draft');
  const [bulkGenerating, setBulkGenerating] = useState(false);

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
  const [previewRecord, setPreviewRecord] = useState<PayrollRecord | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

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

  // Keep selected employee aligned when companyFilter changes
  useEffect(() => {
    const visible =
      companyFilter === 'all'
        ? employees
        : employees.filter((e) => normalizeCompanyId(e.companyId) === companyFilter);
    if (visible.length > 0) {
      if (!visible.some((e) => e.id === selectedEmpId)) {
        setSelectedEmpId(visible[0].id);
      }
      if (!visible.some((e) => e.id === salEmpId)) {
        setSalEmpId(visible[0].id);
      }
    }
  }, [companyFilter, employees, selectedEmpId, salEmpId]);

  // Populate workbench when selected employee or month changes
  useEffect(() => {
    if (!selectedEmpId || !settings) return;
    const targetEmp = employees.find((e) => e.id === selectedEmpId);
    const empCompanyId = normalizeCompanyId(targetEmp?.companyId);
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
      const isOverridden = Boolean(existingPayroll.companyOverridden);
      const effCompany = normalizeCompanyId(existingPayroll.companyId || empCompanyId);
      const baseProfile = resolveCompanyProfile(effCompany, settings);
      setCompanyOverridden(isOverridden);
      setOverrideCompanyId(effCompany);
      setOverrideCompanyName(existingPayroll.companyName || baseProfile.legalName);
      setOverrideCompanyAddress(existingPayroll.companyAddress || baseProfile.address);
      if (isOverridden && typeof existingPayroll.companyLogoAssetId === 'string') {
        if (existingPayroll.companyLogoAssetId === '') {
          setOverrideLogoMode('vector');
          setOverrideLogoAssetId('');
        } else {
          setOverrideLogoMode('custom');
          setOverrideLogoAssetId(existingPayroll.companyLogoAssetId);
        }
      } else {
        setOverrideLogoMode('default');
        setOverrideLogoAssetId('');
      }

      const rawCurrency = existingPayroll.currency || salConfig?.currency || effective?.currency || 'INR';
      const lockedCompany = isOverridden ? effCompany : empCompanyId;
      setPayrollCurrency(
        enforceCompanyCurrency(
          empCompanyId === 'mygrade' || lockedCompany === 'mygrade' ? 'mygrade' : lockedCompany,
          rawCurrency
        )
      );
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
    } else {
      const baseProfile = resolveCompanyProfile(empCompanyId, settings);
      setCompanyOverridden(false);
      setOverrideCompanyId(empCompanyId);
      setOverrideCompanyName(baseProfile.legalName);
      setOverrideCompanyAddress(baseProfile.address);
      setOverrideLogoMode('default');
      setOverrideLogoAssetId('');

      if (salConfig) {
        setPayrollCurrency(
          enforceCompanyCurrency(empCompanyId, salConfig.currency || effective?.currency || 'INR')
        );
        setBasicSalary(salConfig.basicSalary);
        setHra(salConfig.hra);
        setBonus(salConfig.defaultBonus);
        setProfessionalTax(salConfig.professionalTax);
        setOtherEarnings(salConfig.otherEarnings || []);
        setDeductions(salConfig.deductions || []);
      } else {
        setPayrollCurrency(enforceCompanyCurrency(empCompanyId, effective?.currency || 'INR'));
        setBasicSalary(0);
        setHra(0);
        setBonus(0);
        setProfessionalTax(0);
        setOtherEarnings([]);
        setDeductions([]);
      }
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
    const empCompanyId = normalizeCompanyId(targetEmp?.companyId);
    const effective = targetEmp ? getEffectiveSchedule(targetEmp, settings) : null;
    const s = salaries.find((x) => x.employeeId === salEmpId);
    setSalCurrency(enforceCompanyCurrency(empCompanyId, s?.currency || effective?.currency || 'INR'));
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

  const employeeCompanyMap = employees.reduce<Record<string, CompanyId>>((acc, e) => {
    acc[e.id] = normalizeCompanyId(e.companyId);
    return acc;
  }, {});

  const filteredEmployees =
    companyFilter === 'all'
      ? employees
      : employees.filter((e) => normalizeCompanyId(e.companyId) === companyFilter);

  const filteredPayrolls =
    companyFilter === 'all'
      ? payrolls
      : payrolls.filter(
          (p) => normalizeCompanyId(p.companyId || employeeCompanyMap[p.employeeId]) === companyFilter
        );

  const activeOverride: CompanyIdentityOverride | null = companyOverridden
    ? {
        companyId: overrideCompanyId,
        companyName: overrideCompanyName,
        companyAddress: overrideCompanyAddress,
        companyLogoAssetId:
          overrideLogoMode === 'vector'
            ? ''
            : overrideLogoMode === 'custom'
              ? overrideLogoAssetId
              : undefined,
        companyOverridden: true,
      }
    : null;

  const selectedWorkbenchEmp = employees.find((e) => e.id === selectedEmpId);
  const workbenchEmpCompanyId = normalizeCompanyId(selectedWorkbenchEmp?.companyId);
  const resolvedWorkbenchCompany = resolveCompanyProfile(
    workbenchEmpCompanyId,
    settings,
    activeOverride
  );
  const workbenchInrLocked =
    workbenchEmpCompanyId === 'mygrade' || resolvedWorkbenchCompany.companyId === 'mygrade';
  const effectivePayrollCurrency = workbenchInrLocked ? 'INR' : payrollCurrency;

  const selectedSalaryEmp = employees.find((e) => e.id === salEmpId);
  const salaryEmpCompanyId = normalizeCompanyId(selectedSalaryEmp?.companyId);
  const salaryInrLocked = salaryEmpCompanyId === 'mygrade';
  const effectiveSalCurrency = salaryInrLocked ? 'INR' : salCurrency;

  const handleOverrideLogoUpload = async (file: File) => {
    if (file.size > 500 * 1024) {
      showToast('Logo image must be under 500 KB.', 'error');
      return;
    }
    setUploadingOverrideLogo(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const assetId = await uploadMediaAsset({
          ownerUid: employee.uid,
          assetType: 'company_logo',
          fileName: file.name,
          mimeType: file.type || 'image/png',
          dataUrl: String(reader.result),
        });
        setOverrideLogoMode('custom');
        setOverrideLogoAssetId(assetId);
        showToast('Custom payslip logo uploaded.', 'success');
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Logo upload failed', 'error');
      } finally {
        setUploadingOverrideLogo(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSavePayroll = async (targetStatus: PayrollStatus) => {
    const targetEmp = employees.find((e) => e.id === selectedEmpId);
    if (!targetEmp) return;
    setSaving(true);
    try {
      await savePayrollRecord(
        {
          employee: targetEmp,
          month: selectedMonth,
          currency: effectivePayrollCurrency,
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
          settings,
          companyOverride: activeOverride,
        },
        employee
      );
      showToast(
        `Payroll saved as ${targetStatus} (${resolvedWorkbenchCompany.shortName} · ${effectivePayrollCurrency}).`,
        'success'
      );
      setRevisionReason('');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save payroll', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkGenerating(true);
    try {
      const res = await bulkGeneratePayrollRecords(
        {
          employees,
          salaries,
          existingPayrolls: payrolls,
          attendance,
          settings,
          month: bulkMonth,
          status: bulkStatus,
          companyFilter: bulkCompanyFilter,
        },
        employee
      );
      const parts = [`Generated ${res.generatedCount} payslip(s) for ${bulkMonth}.`];
      if (res.skippedExistingCount > 0) {
        parts.push(`Skipped ${res.skippedExistingCount} finalized/published.`);
      }
      if (res.skippedNoSalaryNames.length > 0) {
        parts.push(`${res.skippedNoSalaryNames.length} missing salary config.`);
      }
      showToast(parts.join(' '), res.generatedCount > 0 ? 'success' : 'info');
      setBulkOpen(false);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Bulk generation failed', 'error');
    } finally {
      setBulkGenerating(false);
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
          currency: effectiveSalCurrency,
          basicSalary: salBasic,
          hra: salHra,
          otherEarnings: salOther,
          deductions: salDed,
          professionalTax: salTax,
          defaultBonus: salBonus,
        },
        employee
      );
      showToast(`Salary configuration saved for ${targetEmp.fullName} (${effectiveSalCurrency}).`, 'success');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save salary structure', 'error');
    }
  };

  const handlePdfAction = async (payslip: PayrollRecord, action: 'preview' | 'download') => {
    const actionKey = `${payslip.id || payslip.employeeId}_${action}`;
    setPdfLoadingId(actionKey);
    try {
      const blob = await generatePayslipPdfBlob(payslip, settings);
      const url = URL.createObjectURL(blob);
      if (action === 'preview') {
        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl(url);
        setPreviewRecord(payslip);
        setPreviewTitle(`${payslip.employeeName} — ${payslip.month}`);
      } else {
        const filename = formatPayslipPdfFilename(payslip);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to generate PDF.', 'error');
    } finally {
      setPdfLoadingId(null);
    }
  };

  // Employee / Non-Admin View: My Published Payslips ONLY
  if (!isSuperAdmin) {
    const myPayslips = payrolls.filter((p) => p.employeeId === employee.id && p.status === 'Published');
    const myCompanyShort = getCompanyShortName(employee.companyId);
    return (
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-display font-semibold">My Payslips</h1>
            <CompanyBadge companyId={employee.companyId} showLegalName />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            View and download your published {myCompanyShort} salary statements ({myCurrency})
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold font-mono">{p.month}</span>
                        <CompanyBadge companyId={p.companyId || employee.companyId} showLegalName />
                      </div>
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
                        disabled={Boolean(pdfLoadingId)}
                        onClick={() => handlePdfAction(p, 'preview')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {pdfLoadingId === `${p.id || p.employeeId}_preview` ? 'Loading...' : 'Preview PDF'}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(pdfLoadingId)}
                        onClick={() => handlePdfAction(p, 'download')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {pdfLoadingId === `${p.id || p.employeeId}_download` ? 'Generating...' : 'Download'}
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
              <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold truncate">{previewTitle}</span>
                <div className="flex items-center gap-2">
                  <a
                    href={pdfPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[34px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in New Tab
                  </a>
                  <a
                    href={pdfPreviewUrl}
                    download={previewRecord ? formatPayslipPdfFilename(previewRecord) : 'Payslip.pdf'}
                    className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(pdfPreviewUrl);
                      setPdfPreviewUrl(null);
                      setPreviewRecord(null);
                    }}
                    aria-label="Close PDF preview"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <iframe src={pdfPreviewUrl} title="Payslip PDF Preview" className="w-full flex-1 bg-zinc-100" />
            </div>
          </div>
        )}
      </div>
    );
  }

  const existingSelectedPayroll = payrolls.find(
    (p) => p.employeeId === selectedEmpId && p.month === selectedMonth
  );

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
      companyId: resolvedWorkbenchCompany.companyId,
      companyName: resolvedWorkbenchCompany.legalName,
      companyAddress: resolvedWorkbenchCompany.address,
      companyLogoAssetId: resolvedWorkbenchCompany.logoAssetId,
      companyOverridden: resolvedWorkbenchCompany.isOverridden,
      generatedAtIso: existingSelectedPayroll?.generatedAtIso || new Date().toISOString(),
      location: targetEmp.location || 'India',
      currency: effectivePayrollCurrency,
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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Payroll &amp; Payslips</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Manage TalentGrade (INR / AED) &amp; MyGrade (INR) salaries, per-payslip company identity, and PDF payslips
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value as 'all' | CompanyId)}
            className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium"
          >
            <option value="all">All Companies</option>
            <option value="talentgrade">TalentGrade</option>
            <option value="mygrade">MyGrade</option>
          </select>

          <button
            type="button"
            onClick={() => {
              setBulkMonth(selectedMonth);
              setBulkCompanyFilter(companyFilter);
              setBulkOpen(true);
            }}
            className="min-h-[38px] px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <Layers className="w-3.5 h-3.5 text-[#B5121B]" />
            Bulk Generate
          </button>

          <div className="flex items-center gap-1 p-1 bg-zinc-200/70 dark:bg-zinc-800 rounded-xl">
            {(
              [
                { id: 'workbench', label: 'Monthly Payroll' },
                { id: 'salaries', label: 'Salary Config' },
                { id: 'archive', label: `Payslips (${filteredPayrolls.length})` },
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
                  {filteredEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName} ({e.employeeCode}) · {getCompanyShortName(e.companyId)} · {e.location || 'India'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Payslip Currency</label>
                <select
                  value={effectivePayrollCurrency}
                  onChange={(e) => setPayrollCurrency(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="AED" disabled={workbenchInrLocked}>
                    AED (د.إ) {workbenchInrLocked ? '(TalentGrade only)' : ''}
                  </option>
                </select>
                {workbenchInrLocked && (
                  <div className="text-[10px] text-[#B5121B] dark:text-red-400 mt-1">
                    MyGrade payslips support INR only
                  </div>
                )}
              </div>
            </div>

            {/* Super Admin Per-Payslip Company Identity Override */}
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#B5121B]" />
                  <div>
                    <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                      Payslip Company Identity
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {companyOverridden
                        ? 'Overridden for this individual payslip snapshot only (employee profile unchanged)'
                        : `Using employee's assigned company (${resolvedWorkbenchCompany.legalName})`}
                    </div>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={companyOverridden}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setCompanyOverridden(next);
                      if (next) {
                        const base = resolveCompanyProfile(overrideCompanyId, settings);
                        if (!overrideCompanyName) setOverrideCompanyName(base.legalName);
                        if (!overrideCompanyAddress) setOverrideCompanyAddress(base.address);
                      }
                    }}
                    className="accent-[#B5121B]"
                  />
                  Override for this payslip
                </label>
              </div>

              {companyOverridden && (
                <div className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium mb-1">Payslip Brand</label>
                      <select
                        value={overrideCompanyId}
                        onChange={(e) => {
                          const nextBrand = e.target.value as CompanyId;
                          const base = resolveCompanyProfile(nextBrand, settings);
                          setOverrideCompanyId(nextBrand);
                          setOverrideCompanyName(base.legalName);
                          setOverrideCompanyAddress(base.address);
                          if (nextBrand === 'mygrade') {
                            setPayrollCurrency('INR');
                          }
                        }}
                        className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-medium"
                      >
                        <option value="talentgrade">TalentGrade</option>
                        <option value="mygrade">MyGrade (INR only)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Legal Company Name</label>
                      <input
                        value={overrideCompanyName}
                        onChange={(e) => setOverrideCompanyName(e.target.value)}
                        placeholder="Company legal name on payslip"
                        className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-medium mb-1">Company Address on Payslip</label>
                    <input
                      value={overrideCompanyAddress}
                      onChange={(e) => setOverrideCompanyAddress(e.target.value)}
                      placeholder="Registered address"
                      className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[180px]">
                      <label className="block font-medium mb-1">Payslip Logo</label>
                      <select
                        value={overrideLogoMode}
                        onChange={(e) =>
                          setOverrideLogoMode(e.target.value as 'default' | 'vector' | 'custom')
                        }
                        className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      >
                        <option value="default">Use Selected Brand Default Logo</option>
                        <option value="vector">Use Built-in Brand Emblem</option>
                        <option value="custom" disabled={!overrideLogoAssetId}>
                          Use Uploaded Payslip Logo
                        </option>
                      </select>
                    </div>
                    <div className="pt-5">
                      <label className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 cursor-pointer font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800">
                        <Upload className="w-3.5 h-3.5" />
                        {uploadingOverrideLogo ? 'Uploading...' : 'Upload Logo for Payslip'}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploadingOverrideLogo}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleOverrideLogoUpload(f);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
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
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-display font-semibold">Payroll Summary</h2>
                <CompanyBadge companyId={resolvedWorkbenchCompany.companyId} />
              </div>
              {selectedWorkbenchEmp && (
                <p className="text-[11px] text-zinc-500 mt-1">
                  {selectedWorkbenchEmp.fullName} · {selectedWorkbenchEmp.location || 'India'} · {effectivePayrollCurrency}
                </p>
              )}
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Payslip Entity: <strong className="text-zinc-800 dark:text-zinc-200">{resolvedWorkbenchCompany.legalName}</strong>
                {resolvedWorkbenchCompany.isOverridden ? ' (Override)' : ''}
              </p>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Gross Earnings</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatMoney(grossEarnings, effectivePayrollCurrency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Total Deductions</span>
                <span className="font-mono font-semibold tabular-nums text-[#B5121B] dark:text-red-400">
                  -{formatMoney(totalDeductions, effectivePayrollCurrency)}
                </span>
              </div>
              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-baseline">
                <span className="font-semibold text-sm">Net Payable</span>
                <span className="text-2xl font-bold font-mono tabular-nums text-zinc-950 dark:text-white">
                  {formatMoney(netSalary, effectivePayrollCurrency)}
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
                {filteredEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.employeeCode}) — {getCompanyShortName(e.companyId)} · {e.department} · {e.location || 'India'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Salary Currency</label>
              <select
                value={effectiveSalCurrency}
                onChange={(e) => setSalCurrency(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              >
                <option value="INR">INR (₹)</option>
                <option value="AED" disabled={salaryInrLocked}>
                  AED (د.إ) {salaryInrLocked ? '(TalentGrade only)' : ''}
                </option>
              </select>
              {salaryInrLocked && (
                <div className="text-[10px] text-[#B5121B] dark:text-red-400 mt-1">
                  MyGrade employees support INR only
                </div>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1">Basic Salary ({effectiveSalCurrency})</label>
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
              <label className="block font-medium mb-1">HRA / Housing ({effectiveSalCurrency})</label>
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
              <label className="block font-medium mb-1">Default Bonus / Incentives ({effectiveSalCurrency})</label>
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
              <label className="block font-medium mb-1">Professional Tax ({effectiveSalCurrency})</label>
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
          {filteredPayrolls.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">
              No payroll entries found for this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4 font-medium">Month</th>
                    <th className="py-3 px-4 font-medium">Employee</th>
                    <th className="py-3 px-4 font-medium">Payslip Company</th>
                    <th className="py-3 px-4 font-medium">Location · Currency</th>
                    <th className="py-3 px-4 font-medium text-right">Gross</th>
                    <th className="py-3 px-4 font-medium text-right">Deductions</th>
                    <th className="py-3 px-4 font-medium text-right">Net Salary</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredPayrolls.map((p) => {
                    const cur = p.currency || 'INR';
                    const resolvedArchiveCompany = p.companyId || employeeCompanyMap[p.employeeId];
                    return (
                      <tr key={p.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                        <td className="py-3 px-4 font-mono tabular-nums">{p.month}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold">{p.employeeName}</div>
                          <div className="text-[11px] text-zinc-500">
                            {p.employeeCode} · {p.department}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <CompanyBadge companyId={resolvedArchiveCompany} />
                            {p.companyOverridden && (
                              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                Override
                              </span>
                            )}
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
                              onClick={() => {
                                setCompanyFilter('all');
                                setSelectedEmpId(p.employeeId);
                                setSelectedMonth(p.month);
                                setTab('workbench');
                              }}
                              title="Edit / Override in Workbench"
                              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Edit
                            </button>
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

      {/* Bulk Generate Payslips Modal */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleBulkGenerate}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden text-xs"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-base font-semibold">Bulk Generate Monthly Payroll</h3>
              <button
                type="button"
                disabled={bulkGenerating}
                onClick={() => setBulkOpen(false)}
                className="text-zinc-500 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-zinc-500 dark:text-zinc-400">
                Generates payslips from each active employee&apos;s Salary Config and assigned company
                (MyGrade stays INR-only). Existing Finalized or Published payslips are preserved untouched.
              </p>
              <div>
                <label className="block font-medium mb-1">Payroll Month</label>
                <input
                  type="month"
                  required
                  value={bulkMonth}
                  onChange={(e) => setBulkMonth(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Company Scope</label>
                <select
                  value={bulkCompanyFilter}
                  onChange={(e) => setBulkCompanyFilter(e.target.value as 'all' | CompanyId)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-medium"
                >
                  <option value="all">All Companies (TalentGrade &amp; MyGrade)</option>
                  <option value="talentgrade">TalentGrade Only</option>
                  <option value="mygrade">MyGrade Only (INR)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Initial Status</label>
                <select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value as PayrollStatus)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                >
                  <option value="Draft">Draft (Review before finalizing)</option>
                  <option value="Finalized">Finalized</option>
                  <option value="Published">Published (Visible to employees)</option>
                </select>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={bulkGenerating}
                onClick={() => setBulkOpen(false)}
                className="min-h-[40px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={bulkGenerating}
                className="min-h-[40px] px-5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold disabled:opacity-50"
              >
                {bulkGenerating ? 'Generating...' : 'Run Bulk Generation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Server PDF Preview Modal */}
      {pdfPreviewUrl && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[88vh] bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold truncate">Payslip PDF Preview — {previewTitle}</span>
              <div className="flex items-center gap-2">
                <a
                  href={pdfPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[34px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in New Tab
                </a>
                <a
                  href={pdfPreviewUrl}
                  download={previewRecord ? formatPayslipPdfFilename(previewRecord) : 'Payslip.pdf'}
                  className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(pdfPreviewUrl);
                    setPdfPreviewUrl(null);
                    setPreviewRecord(null);
                  }}
                  aria-label="Close PDF preview"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <iframe src={pdfPreviewUrl} title="Payslip PDF Preview" className="w-full flex-1 bg-zinc-100" />
          </div>
        </div>
      )}
    </div>
  );
}

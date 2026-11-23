import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Upload, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { TalentGradeLogo } from '../components/TalentGradeLogo';
import { AuditLog, CompanySettings, Department, HolidayItem } from '../types/hr';
import { DEFAULT_LEAVE_POLICY, normalizeLeavePolicyConfig } from '../../shared/leaveAccrualEngine';
import {
  createDepartment,
  deleteDepartment,
  fetchAuditLogs,
  getDepartments,
  saveCompanySettings,
  uploadMediaAsset,
} from '../lib/hrService';

const WEEKDAYS = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
];

export function SettingsView() {
  const { employee, settings, companyLogoUrl, refreshSession } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'company' | 'rules' | 'permissions' | 'departments' | 'audit'>('company');
  const [form, setForm] = useState<Omit<CompanySettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [saving, setSaving] = useState(false);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');

  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState('');

  const loadAux = useCallback(async () => {
    try {
      const [depts, logs] = await Promise.all([getDepartments(), fetchAuditLogs()]);
      setDepartments(depts);
      setAuditLogs(logs);
    } catch {
      // Handled safely
    }
  }, []);

  useEffect(() => {
    if (settings) {
      setForm({
        companyName: settings.companyName || 'TalentGrade',
        companyAddress: settings.companyAddress || '',
        companyPhone: settings.companyPhone || '',
        companyEmail: settings.companyEmail || '',
        companyWebsite: settings.companyWebsite || '',
        taxId: settings.taxId || '',
        logoAssetId: settings.logoAssetId || '',
        locations: settings.locations || ['India', 'Dubai, UAE'],
        supportedCurrencies: settings.supportedCurrencies || ['INR', 'AED'],
        officeStartTime: settings.officeStartTime,
        officeEndTime: settings.officeEndTime,
        gracePeriodMinutes: settings.gracePeriodMinutes,
        halfDayMinHours: settings.halfDayMinHours,
        fullDayMinHours: settings.fullDayMinHours,
        workingDays: settings.workingDays || [1, 2, 3, 4, 5],
        holidays: settings.holidays || [],
        defaultSickLeave: settings.defaultSickLeave,
        defaultCasualLeave: settings.defaultCasualLeave,
        leavePolicy: normalizeLeavePolicyConfig(settings.leavePolicy),
        currency: settings.currency || 'INR',
        teamLeaderPermissions: { ...settings.teamLeaderPermissions },
      });
    }
    loadAux();
  }, [settings, loadAux]);

  if (!employee || !form || employee.role !== 'super_admin') return null;

  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await saveCompanySettings(form, employee);
      await refreshSession();
      showToast('TalentGrade settings saved.', 'success');
      await loadAux();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (file.size > 500 * 1024) {
      showToast('Logo image must be under 500 KB.', 'error');
      return;
    }
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
        const nextForm = { ...form, logoAssetId: assetId };
        setForm(nextForm);
        await saveCompanySettings(nextForm, employee);
        await refreshSession();
        showToast('Company logo updated.', 'success');
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Logo upload failed', 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleWorkingDay = (day: number) => {
    setForm((prev) => {
      if (!prev) return prev;
      const exists = prev.workingDays.includes(day);
      return {
        ...prev,
        workingDays: exists ? prev.workingDays.filter((d) => d !== day) : [...prev.workingDays, day].sort(),
      };
    });
  };

  const addHoliday = () => {
    if (!holidayDate || !holidayName.trim()) return;
    const next: HolidayItem = { date: holidayDate, name: holidayName.trim() };
    setForm((prev) => (prev ? { ...prev, holidays: [...(prev.holidays || []), next] } : prev));
    setHolidayDate('');
    setHolidayName('');
  };

  const handleAddDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptName.trim() || !newDeptCode.trim()) return;
    try {
      await createDepartment(newDeptName, newDeptCode, employee);
      setNewDeptName('');
      setNewDeptCode('');
      showToast('Department added.', 'success');
      await loadAux();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not add department', 'error');
    }
  };

  const handleDeleteDept = async (dept: Department) => {
    try {
      await deleteDepartment(dept.id, dept.name, employee);
      showToast(`Deleted ${dept.name}.`, 'info');
      await loadAux();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not delete department', 'error');
    }
  };

  const filteredLogs = auditLogs.filter(
    (l) =>
      !auditFilter.trim() ||
      l.action.toLowerCase().includes(auditFilter.toLowerCase()) ||
      l.summary.toLowerCase().includes(auditFilter.toLowerCase()) ||
      l.actorName.toLowerCase().includes(auditFilter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">TalentGrade Settings &amp; Administration</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Configure company identity, default hours (overridable per employee), Team Leader permissions, and audit logs
        </p>
      </div>

      <div className="flex items-center gap-1 p-1 bg-zinc-200/70 dark:bg-zinc-800 rounded-xl overflow-x-auto">
        {(
          [
            { id: 'company', label: 'Company Profile' },
            { id: 'rules', label: 'Default Working Rules' },
            { id: 'permissions', label: 'Role Permissions' },
            { id: 'departments', label: 'Departments' },
            { id: 'audit', label: `Audit Logs (${auditLogs.length})` },
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

      {/* TAB 1: COMPANY PROFILE */}
      {tab === 'company' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 max-w-3xl space-y-5 text-xs"
        >
          <div className="flex items-center gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
            <TalentGradeLogo logoUrl={companyLogoUrl} companyName={form.companyName} compact />
            <div className="space-y-1.5">
              <div className="font-semibold text-sm">Company Logo (Appears on Payslips &amp; Portal)</div>
              <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 font-medium">
                <Upload className="w-3.5 h-3.5" />
                Upload Custom Logo (PNG/JPG, max 500 KB)
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLogoUpload(f);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1">Company Name</label>
              <input
                required
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Default Company Currency</label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              >
                <option value="INR">INR (₹) — India</option>
                <option value="AED">AED (د.إ) — Dubai, UAE</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Company Email</label>
              <input
                value={form.companyEmail}
                onChange={(e) => setForm({ ...form, companyEmail: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Company Phone</label>
              <input
                value={form.companyPhone}
                onChange={(e) => setForm({ ...form, companyPhone: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Website</label>
              <input
                value={form.companyWebsite}
                onChange={(e) => setForm({ ...form, companyWebsite: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Tax / Registration ID</label>
              <input
                value={form.taxId}
                onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1">Registered Locations &amp; Address</label>
            <input
              value={form.companyAddress}
              onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
              className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Operating offices: {(form.locations || ['India', 'Dubai, UAE']).join(' · ')} | Currencies:{' '}
              {(form.supportedCurrencies || ['INR', 'AED']).join(' · ')}
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
          >
            {saving ? 'Saving...' : 'Save Company Profile'}
          </button>
        </form>
      )}

      {/* TAB 2: WORKING HOURS, ATTENDANCE & LEAVE RULES */}
      {tab === 'rules' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 max-w-3xl space-y-5 text-xs"
        >
          <p className="text-zinc-500 dark:text-zinc-400">
            These defaults apply across TalentGrade unless overridden individually inside an employee&apos;s profile.
          </p>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium mb-1">Default Office Start Time</label>
              <input
                type="time"
                value={form.officeStartTime}
                onChange={(e) => setForm({ ...form, officeStartTime: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Default Office End Time</label>
              <input
                type="time"
                value={form.officeEndTime}
                onChange={(e) => setForm({ ...form, officeEndTime: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Grace Period (minutes)</label>
              <input
                type="number"
                min={0}
                max={180}
                value={form.gracePeriodMinutes}
                onChange={(e) => setForm({ ...form, gracePeriodMinutes: Number(e.target.value) })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-4 gap-4">
            <div>
              <label className="block font-medium mb-1">Half-Day Min Hours</label>
              <input
                type="number"
                step="0.5"
                value={form.halfDayMinHours}
                onChange={(e) => setForm({ ...form, halfDayMinHours: Number(e.target.value) })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Full-Day Min Hours</label>
              <input
                type="number"
                step="0.5"
                value={form.fullDayMinHours}
                onChange={(e) => setForm({ ...form, fullDayMinHours: Number(e.target.value) })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Default Sick Leave</label>
              <input
                type="number"
                value={form.defaultSickLeave}
                onChange={(e) => setForm({ ...form, defaultSickLeave: Number(e.target.value) })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Default Casual Leave</label>
              <input
                type="number"
                value={form.defaultCasualLeave}
                onChange={(e) => setForm({ ...form, defaultCasualLeave: Number(e.target.value) })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-medium">Default Weekly Working Days</label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((w) => {
                const active = form.workingDays.includes(w.day);
                return (
                  <button
                    type="button"
                    key={w.day}
                    onClick={() => toggleWorkingDay(w.day)}
                    className={`min-h-[38px] px-4 rounded-xl border font-medium ${
                      active
                        ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <label className="block font-medium">Company Holidays</label>
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                value={holidayDate}
                onChange={(e) => setHolidayDate(e.target.value)}
                className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              />
              <input
                placeholder="Holiday name"
                value={holidayName}
                onChange={(e) => setHolidayName(e.target.value)}
                className="flex-1 min-w-[180px] min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              />
              <button
                type="button"
                onClick={addHoliday}
                className="min-h-[38px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <div className="space-y-1.5 pt-2">
              {(form.holidays || []).map((h, i) => (
                <div
                  key={`${h.date}_${i}`}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                >
                  <span>
                    <span className="font-mono font-medium">{h.date}</span> · {h.name}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, holidays: (form.holidays || []).filter((_, idx) => idx !== i) })
                    }
                    className="text-[#B5121B] p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* TalentGrade Leave Policy & Accrual Engine Rules */}
          <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                  TalentGrade Leave Accrual Policy
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Monthly accrual, eligibility waiting period, and calendar-year carry-forward rules. Existing employee balances are safely preserved.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    leavePolicy: { ...DEFAULT_LEAVE_POLICY },
                  })
                }
                className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Reset to TalentGrade Defaults
              </button>
            </div>

            {(() => {
              const policy = normalizeLeavePolicyConfig(form.leavePolicy);
              const updatePolicy = (patch: Partial<typeof policy>) =>
                setForm({
                  ...form,
                  leavePolicy: { ...policy, ...patch },
                });

              return (
                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Sick Leave Rules */}
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 space-y-3">
                    <div className="font-semibold text-zinc-950 dark:text-zinc-100">Sick Leave (SL)</div>
                    <div>
                      <label className="block font-medium mb-1">Monthly Accrual Rate (days/month)</label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step="0.5"
                        value={policy.sickLeaveMonthlyRate}
                        onChange={(e) => updatePolicy({ sickLeaveMonthlyRate: Number(e.target.value) })}
                        className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                      />
                    </div>
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span>Allow SL Carry-Forward</span>
                      <input
                        type="checkbox"
                        checked={policy.sickLeaveCarryForward}
                        onChange={(e) => updatePolicy({ sickLeaveCarryForward: e.target.checked })}
                        className="w-4 h-4 accent-[#B5121B]"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span>Reset SL at Calendar Year Start (Jan 1)</span>
                      <input
                        type="checkbox"
                        checked={policy.sickLeaveAnnualReset}
                        onChange={(e) => updatePolicy({ sickLeaveAnnualReset: e.target.checked })}
                        className="w-4 h-4 accent-[#B5121B]"
                      />
                    </label>
                  </div>

                  {/* Casual Leave Rules */}
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 space-y-3">
                    <div className="font-semibold text-zinc-950 dark:text-zinc-100">Casual Leave (CL)</div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block font-medium mb-1">Monthly Rate</label>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          step="0.5"
                          value={policy.casualLeaveMonthlyRate}
                          onChange={(e) => updatePolicy({ casualLeaveMonthlyRate: Number(e.target.value) })}
                          className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Eligibility (Months)</label>
                        <input
                          type="number"
                          min={0}
                          max={36}
                          step="1"
                          value={policy.casualLeaveEligibilityMonths}
                          onChange={(e) =>
                            updatePolicy({ casualLeaveEligibilityMonths: Math.max(0, Math.floor(Number(e.target.value))) })
                          }
                          className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                      </div>
                    </div>
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span>Allow CL Carry-Forward</span>
                      <input
                        type="checkbox"
                        checked={policy.casualLeaveCarryForward}
                        onChange={(e) => updatePolicy({ casualLeaveCarryForward: e.target.checked })}
                        className="w-4 h-4 accent-[#B5121B]"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block font-medium mb-1">Max CF Cap (0 = None)</label>
                        <input
                          type="number"
                          min={0}
                          max={120}
                          value={policy.casualLeaveMaxCarryForward ?? 0}
                          onChange={(e) => updatePolicy({ casualLeaveMaxCarryForward: Math.max(0, Number(e.target.value)) })}
                          className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Expiry Mos (0 = Never)</label>
                        <input
                          type="number"
                          min={0}
                          max={120}
                          value={policy.casualLeaveExpiryMonths ?? 0}
                          onChange={(e) =>
                            updatePolicy({ casualLeaveExpiryMonths: Math.max(0, Math.floor(Number(e.target.value))) })
                          }
                          className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
          >
            {saving ? 'Saving...' : 'Save Working Hours & Rules'}
          </button>
        </form>
      )}

      {/* TAB 3: TEAM LEADER PERMISSIONS */}
      {tab === 'permissions' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 max-w-2xl space-y-4 text-xs"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="w-4 h-4 text-[#B5121B]" />
            Team Leader / Admin Role Permissions
          </div>
          <p className="text-zinc-500 dark:text-zinc-400">
            Configure what Team Leaders can access and approve. Enforced both in the UI and Firestore security rules.
          </p>

          {(
            [
              {
                key: 'canViewAllEmployees',
                title: 'View All Company Employees & Attendance',
                desc: 'Allows viewing employee directory and attendance outside directly assigned reports.',
              },
              {
                key: 'canApproveLeaves',
                title: 'Approve or Reject Leave Applications',
                desc: 'Allows reviewing pending leave requests and deducting leave balances.',
              },
              {
                key: 'canApproveCorrections',
                title: 'Approve or Reject Attendance Corrections',
                desc: 'Allows approving employee punch-in/out correction requests.',
              },
              {
                key: 'canEditAttendance',
                title: 'Directly Edit Attendance Records',
                desc: 'Allows modifying punch-in/out timestamps and statuses on the attendance calendar.',
              },
              {
                key: 'canViewSalary',
                title: 'Access Employee Salary & Payroll Reports (Restricted by Default)',
                desc: 'Disabled by default. Enable only if Team Leaders should inspect salary figures.',
              },
            ] as const
          ).map((item) => (
            <label
              key={item.key}
              className="flex items-start justify-between gap-4 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer"
            >
              <div>
                <div className="font-semibold text-zinc-950 dark:text-zinc-100">{item.title}</div>
                <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">{item.desc}</div>
              </div>
              <input
                type="checkbox"
                checked={Boolean(form.teamLeaderPermissions[item.key])}
                onChange={(e) =>
                  setForm({
                    ...form,
                    teamLeaderPermissions: {
                      ...form.teamLeaderPermissions,
                      [item.key]: e.target.checked,
                    },
                  })
                }
                className="w-4 h-4 mt-1 accent-[#B5121B]"
              />
            </label>
          ))}

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
          >
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>
        </form>
      )}

      {/* TAB 4: DEPARTMENTS */}
      {tab === 'departments' && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 max-w-2xl space-y-5 text-xs">
          <form onSubmit={handleAddDept} className="flex flex-wrap gap-2">
            <input
              required
              placeholder="Department name (e.g. Design)"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              className="flex-1 min-w-[180px] min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
            />
            <input
              required
              placeholder="Code (e.g. DSN)"
              value={newDeptCode}
              onChange={(e) => setNewDeptCode(e.target.value)}
              className="w-28 min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
            />
            <button
              type="submit"
              className="min-h-[40px] px-4 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold inline-flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </form>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {departments.map((d) => (
              <div key={d.id} className="py-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-sm">{d.name}</span>
                  <span className="ml-2 font-mono text-zinc-500">({d.code})</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteDept(d)}
                  className="min-h-[34px] px-2.5 rounded-lg text-[#B5121B] hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOGS */}
      {tab === 'audit' && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden text-xs">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <span className="font-semibold text-sm">Immutable Audit Trail</span>
            <input
              type="text"
              placeholder="Filter actor, action, or summary..."
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 w-64"
            />
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[540px] overflow-y-auto">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-zinc-500">No audit entries found.</div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="p-4 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#B5121B] dark:text-red-400">{log.action}</span>
                    <span className="text-zinc-500">
                      {log.actorName} ({log.actorRole}) · {log.entityType}
                    </span>
                  </div>
                  <p className="text-zinc-700 dark:text-zinc-300">{log.summary}</p>
                  {(log.previousValues || log.updatedValues) && (
                    <div className="text-[11px] font-mono text-zinc-500 pt-1">
                      {log.previousValues && <span>Prev: {JSON.stringify(log.previousValues)} · </span>}
                      {log.updatedValues && <span>Updated: {JSON.stringify(log.updatedValues)}</span>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

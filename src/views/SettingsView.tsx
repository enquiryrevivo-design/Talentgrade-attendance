import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Upload, Shield, Sparkles, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCelebrations } from '../context/CelebrationContext';
import { useToast } from '../components/Toast';
import { TalentGradeLogo } from '../components/TalentGradeLogo';
import {
  AuditLog,
  CelebrationVisibilityScope,
  COMPANY_IDS,
  CompanyId,
  CompanyProfileConfig,
  CompanySettings,
  DEFAULT_COMPANIES,
  Department,
  HolidayItem,
  normalizeCompaniesMap,
} from '../types/hr';
import { CompanyBadge } from '../components/CompanyBadge';
import { DEFAULT_LEAVE_POLICY, normalizeLeavePolicyConfig } from '../../shared/leaveAccrualEngine';
import {
  DEFAULT_CELEBRATION_SETTINGS,
  normalizeCelebrationSettings,
} from '../../shared/celebrationEngine';
import {
  DEFAULT_ATTENDANCE_REMINDER_SETTINGS,
  normalizeAttendanceReminderSettings,
} from '../../shared/attendanceReminderEngine';
import {
  createDepartment,
  deleteDepartment,
  fetchAllEmployees,
  fetchAuditLogs,
  fetchMediaAsset,
  getDepartments,
  getEffectiveSchedule,
  saveCompanySettings,
  uploadMediaAsset,
} from '../lib/hrService';
import { syncReminderSnapshotToServer } from '../lib/pushService';
import { SmartAttendanceRemindersCard } from '../components/SmartAttendanceRemindersCard';
import { AdminSmartRemindersPanel } from '../components/AdminSmartRemindersPanel';
import { PWAInstallButton } from '../components/PWAInstallButton';

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
  const { refreshCelebrations } = useCelebrations();
  const { showToast } = useToast();

  const [tab, setTab] = useState<
    'company' | 'rules' | 'reminders' | 'my_reminders' | 'celebrations' | 'permissions' | 'departments' | 'audit'
  >('company');
  const [form, setForm] = useState<Omit<CompanySettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkingCelebrations, setCheckingCelebrations] = useState(false);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');

  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [companyLogoMap, setCompanyLogoMap] = useState<Record<CompanyId, string>>({
    talentgrade: '',
    mygrade: '',
  });

  const isSuperAdmin = employee?.role === 'super_admin';

  useEffect(() => {
    if (employee && employee.role !== 'super_admin') {
      setTab('my_reminders');
    }
  }, [employee]);

  const loadAux = useCallback(async () => {
    if (!employee || employee.role !== 'super_admin') return;
    try {
      const [depts, logs, empList] = await Promise.all([
        getDepartments(),
        fetchAuditLogs(),
        fetchAllEmployees(employee),
      ]);
      setDepartments(depts);
      setAuditLogs(logs);
      if (settings) {
        void syncReminderSnapshotToServer({
          employee,
          settings,
          employees: empList,
        }).catch(() => {});
      }
    } catch {
      // Handled safely
    }
  }, [employee, settings]);

  useEffect(() => {
    if (settings) {
      const companies = normalizeCompaniesMap(settings);
      setForm({
        companyName: settings.companyName || companies.talentgrade.legalName,
        companyAddress: settings.companyAddress || companies.talentgrade.address,
        companyPhone: settings.companyPhone || '',
        companyEmail: settings.companyEmail || '',
        companyWebsite: settings.companyWebsite || '',
        taxId: settings.taxId || '',
        logoAssetId: settings.logoAssetId || companies.talentgrade.logoAssetId || '',
        companies,
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
        celebrationSettings: normalizeCelebrationSettings(settings.celebrationSettings),
        attendanceReminders: normalizeAttendanceReminderSettings(settings.attendanceReminders),
        currency: settings.currency || 'INR',
        teamLeaderPermissions: {
          ...settings.teamLeaderPermissions,
          canApproveExpenses: Boolean(settings.teamLeaderPermissions?.canApproveExpenses),
          canManageAssets: Boolean(settings.teamLeaderPermissions?.canManageAssets),
        },
      });

      // Load custom company logos for TalentGrade and MyGrade
      void (async () => {
        const nextMap: Record<CompanyId, string> = {
          talentgrade: companyLogoUrl || '',
          mygrade: '',
        };
        for (const cid of COMPANY_IDS) {
          const assetId = companies[cid].logoAssetId;
          if (assetId) {
            const asset = await fetchMediaAsset(assetId).catch(() => null);
            if (asset?.dataUrl) nextMap[cid] = asset.dataUrl;
          } else {
            nextMap[cid] = '';
          }
        }
        setCompanyLogoMap(nextMap);
      })();
    }
    loadAux();
  }, [settings, companyLogoUrl, loadAux]);

  if (!employee || !settings) return null;

  if (!isSuperAdmin) {
    const mySchedule = getEffectiveSchedule(employee, settings);
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display font-semibold">Employee Settings &amp; Preferences</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Manage Smart Attendance Reminders, browser push subscriptions, and portal app installation
            </p>
          </div>
          <PWAInstallButton />
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 grid sm:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">Location</div>
            <div className="font-semibold text-zinc-950 dark:text-zinc-100 mt-0.5">{mySchedule.location}</div>
          </div>
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">Assigned Timezone</div>
            <div className="font-mono font-semibold text-zinc-950 dark:text-zinc-100 mt-0.5">{mySchedule.timezone}</div>
          </div>
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">Shift Timing</div>
            <div className="font-mono tabular-nums font-semibold text-zinc-950 dark:text-zinc-100 mt-0.5">
              {mySchedule.officeStartTime} – {mySchedule.officeEndTime}
            </div>
          </div>
          <div>
            <div className="text-zinc-500 dark:text-zinc-400">Grace Window</div>
            <div className="font-mono tabular-nums font-semibold text-zinc-950 dark:text-zinc-100 mt-0.5">
              {mySchedule.gracePeriodMinutes} mins
            </div>
          </div>
        </div>

        <SmartAttendanceRemindersCard />
      </div>
    );
  }

  if (!form) return null;

  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await saveCompanySettings(form, employee);
      await syncReminderSnapshotToServer({
        employee,
        settings: {
          ...form,
          attendanceReminders: normalizeAttendanceReminderSettings(
            form.attendanceReminders || DEFAULT_ATTENDANCE_REMINDER_SETTINGS
          ),
          updatedBy: employee.uid,
        },
      }).catch(() => {});
      await refreshSession();
      await refreshCelebrations();
      showToast('TalentGrade settings saved.', 'success');
      await loadAux();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRunCelebrationCheck = async () => {
    setCheckingCelebrations(true);
    try {
      await refreshCelebrations();
      showToast('Celebration check completed against server time.', 'success');
    } catch {
      showToast('Could not refresh celebrations.', 'error');
    } finally {
      setCheckingCelebrations(false);
    }
  };

  const normalizedCompanies = normalizeCompaniesMap(form);

  const buildUpdatedCompaniesForm = (
    companyId: CompanyId,
    patch: Partial<CompanyProfileConfig>
  ): Omit<CompanySettings, 'updatedAt' | 'updatedBy'> => {
    const current = normalizedCompanies[companyId];
    const nextProfile: CompanyProfileConfig = {
      ...current,
      ...patch,
      id: companyId,
      supportedCurrencies: companyId === 'mygrade' ? ['INR'] : ['INR', 'AED'],
      defaultCurrency: companyId === 'mygrade' ? 'INR' : patch.defaultCurrency || current.defaultCurrency || 'INR',
    };
    const nextCompanies = {
      ...normalizedCompanies,
      [companyId]: nextProfile,
    };
    const tg = nextCompanies.talentgrade;
    return {
      ...form,
      companies: nextCompanies,
      companyName: tg.legalName,
      companyAddress: tg.address,
      companyPhone: tg.phone || '',
      companyEmail: tg.email || '',
      companyWebsite: tg.website || '',
      taxId: tg.taxId || '',
      logoAssetId: tg.logoAssetId || '',
      currency: tg.defaultCurrency || form.currency,
    };
  };

  const updateCompanyProfile = (companyId: CompanyId, patch: Partial<CompanyProfileConfig>) => {
    setForm(buildUpdatedCompaniesForm(companyId, patch));
  };

  const handleCompanyLogoUpload = async (companyId: CompanyId, file: File) => {
    if (file.size > 500 * 1024) {
      showToast('Logo image must be under 500 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result);
        const assetId = await uploadMediaAsset({
          ownerUid: employee.uid,
          assetType: 'company_logo',
          fileName: file.name,
          mimeType: file.type || 'image/png',
          dataUrl,
        });
        const nextForm = buildUpdatedCompaniesForm(companyId, { logoAssetId: assetId });
        setForm(nextForm);
        setCompanyLogoMap((prev) => ({ ...prev, [companyId]: dataUrl }));
        await saveCompanySettings(nextForm, employee);
        await refreshSession();
        showToast(`${DEFAULT_COMPANIES[companyId].shortName} logo updated.`, 'success');
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Logo upload failed', 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleResetCompanyLogo = async (companyId: CompanyId) => {
    try {
      const nextForm = buildUpdatedCompaniesForm(companyId, { logoAssetId: '' });
      setForm(nextForm);
      setCompanyLogoMap((prev) => ({ ...prev, [companyId]: '' }));
      await saveCompanySettings(nextForm, employee);
      await refreshSession();
      showToast(`Reverted ${DEFAULT_COMPANIES[companyId].shortName} to built-in brand logo.`, 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not reset logo', 'error');
    }
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
            { id: 'reminders', label: 'Smart Attendance Reminders' },
            { id: 'my_reminders', label: 'My Notification Devices' },
            { id: 'celebrations', label: 'Celebrations' },
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

      {/* TAB 1: DUAL-COMPANY PROFILES (TALENTGRADE & MYGRADE) */}
      {tab === 'company' && (
        <form onSubmit={handleSaveSettings} className="space-y-6 max-w-5xl text-xs">
          <div className="grid lg:grid-cols-2 gap-6">
            {COMPANY_IDS.map((cid) => {
              const profile = normalizedCompanies[cid];
              const isMyGrade = cid === 'mygrade';
              const logoUrl = companyLogoMap[cid] || null;
              return (
                <div
                  key={cid}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-5"
                >
                  <div className="flex items-start justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TalentGradeLogo
                          logoUrl={logoUrl}
                          companyId={cid}
                          companyName={profile.shortName}
                        />
                        <CompanyBadge companyId={cid} />
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Supported payslip currencies:{' '}
                        <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                          {isMyGrade ? 'INR only' : 'INR · AED'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 font-medium">
                      <Upload className="w-3.5 h-3.5" />
                      Upload {profile.shortName} Logo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleCompanyLogoUpload(cid, f);
                        }}
                      />
                    </label>
                    {profile.logoAssetId && (
                      <button
                        type="button"
                        onClick={() => handleResetCompanyLogo(cid)}
                        className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        Use Built-in Brand Mark
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block font-medium mb-1">Legal Company Name *</label>
                      <input
                        required
                        value={profile.legalName}
                        onChange={(e) => updateCompanyProfile(cid, { legalName: e.target.value })}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>

                    <div>
                      <label className="block font-medium mb-1">Registered Address *</label>
                      <textarea
                        rows={2}
                        required
                        value={profile.address}
                        onChange={(e) => updateCompanyProfile(cid, { address: e.target.value })}
                        className="w-full py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium mb-1">Default Payslip Currency</label>
                        <select
                          disabled={isMyGrade}
                          value={isMyGrade ? 'INR' : profile.defaultCurrency || 'INR'}
                          onChange={(e) =>
                            updateCompanyProfile(cid, {
                              defaultCurrency: e.target.value as 'INR' | 'AED',
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono disabled:opacity-75"
                        >
                          <option value="INR">INR (₹)</option>
                          {!isMyGrade && <option value="AED">AED (د.إ)</option>}
                        </select>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Company Email</label>
                        <input
                          value={profile.email || ''}
                          onChange={(e) => updateCompanyProfile(cid, { email: e.target.value })}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Company Phone</label>
                        <input
                          value={profile.phone || ''}
                          onChange={(e) => updateCompanyProfile(cid, { phone: e.target.value })}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Tax / Registration ID</label>
                        <input
                          value={profile.taxId || ''}
                          onChange={(e) => updateCompanyProfile(cid, { taxId: e.target.value })}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block font-medium mb-1">Website</label>
                      <input
                        value={profile.website || ''}
                        onChange={(e) => updateCompanyProfile(cid, { website: e.target.value })}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
            <span className="text-[11px] text-zinc-500">
              Operating locations: {(form.locations || ['India', 'Dubai, UAE']).join(' · ')}
            </span>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
            >
              {saving ? 'Saving...' : 'Save Company Profiles'}
            </button>
          </div>
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
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setForm({
                    ...form,
                    gracePeriodMinutes: Number.isFinite(v) ? Math.max(0, Math.min(180, v)) : 0,
                  });
                }}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-4 gap-4">
            <div>
              <label className="block font-medium mb-1">Half-Day Min Hours</label>
              <input
                type="number"
                min={0.5}
                max={16}
                step="0.5"
                value={form.halfDayMinHours}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setForm({
                    ...form,
                    halfDayMinHours: Number.isFinite(v) ? Math.max(0, Math.min(16, v)) : 0,
                  });
                }}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Full-Day Min Hours</label>
              <input
                type="number"
                min={1}
                max={24}
                step="0.5"
                value={form.fullDayMinHours}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setForm({
                    ...form,
                    fullDayMinHours: Number.isFinite(v) ? Math.max(0, Math.min(24, v)) : 0,
                  });
                }}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Default Sick Leave</label>
              <input
                type="number"
                min={0}
                max={60}
                value={form.defaultSickLeave}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setForm({
                    ...form,
                    defaultSickLeave: Number.isFinite(v) ? Math.max(0, Math.min(60, v)) : 0,
                  });
                }}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Default Casual Leave</label>
              <input
                type="number"
                min={0}
                max={60}
                value={form.defaultCasualLeave}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  setForm({
                    ...form,
                    defaultCasualLeave: Number.isFinite(v) ? Math.max(0, Math.min(60, v)) : 0,
                  });
                }}
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
                        onChange={(e) => {
                          const v = e.target.value === '' ? 0 : Number(e.target.value);
                          updatePolicy({ sickLeaveMonthlyRate: Number.isFinite(v) ? Math.max(0, v) : 0 });
                        }}
                        className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                      />
                    </div>
                    <label className="flex items-start justify-between gap-2 cursor-pointer">
                      <span>
                        <span className="block">Allow SL Carry-Forward (Month-to-Month &amp; Year-End)</span>
                        <span className="block text-[10px] text-zinc-500">
                          When unchecked, unused monthly SL expires at the start of the next month.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={policy.sickLeaveCarryForward}
                        onChange={(e) => updatePolicy({ sickLeaveCarryForward: e.target.checked })}
                        className="w-4 h-4 mt-0.5 accent-[#B5121B]"
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
                          onChange={(e) => {
                            const v = e.target.value === '' ? 0 : Number(e.target.value);
                            updatePolicy({ casualLeaveMonthlyRate: Number.isFinite(v) ? Math.max(0, v) : 0 });
                          }}
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
                          onChange={(e) => {
                            const v = e.target.value === '' ? 0 : Number(e.target.value);
                            updatePolicy({
                              casualLeaveEligibilityMonths: Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0,
                            });
                          }}
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
                          onChange={(e) => {
                            const v = e.target.value === '' ? 0 : Number(e.target.value);
                            updatePolicy({ casualLeaveMaxCarryForward: Number.isFinite(v) ? Math.max(0, v) : 0 });
                          }}
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
                          onChange={(e) => {
                            const v = e.target.value === '' ? 0 : Number(e.target.value);
                            updatePolicy({
                              casualLeaveExpiryMonths: Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0,
                            });
                          }}
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

      {/* TAB 2A: SMART ATTENDANCE REMINDERS (SUPER ADMIN POLICY & AUDIT) */}
      {tab === 'reminders' && (
        <AdminSmartRemindersPanel
          value={form.attendanceReminders}
          locations={form.locations || ['India', 'Dubai, UAE']}
          departments={departments}
          saving={saving}
          onChange={(next) => setForm({ ...form, attendanceReminders: next })}
          onSave={handleSaveSettings}
        />
      )}

      {/* TAB 2A-SELF: MY NOTIFICATION DEVICES */}
      {tab === 'my_reminders' && (
        <div className="space-y-4 max-w-4xl">
          <div className="flex justify-end">
            <PWAInstallButton />
          </div>
          <SmartAttendanceRemindersCard />
        </div>
      )}

      {/* TAB 2B: CELEBRATION SETTINGS */}
      {tab === 'celebrations' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 max-w-2xl space-y-5 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="w-4 h-4 text-[#B5121B]" />
                Birthday &amp; Work Anniversary Celebrations
              </div>
              <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                Configure automatic celebration detection, notifications, upcoming reminders, and wish privacy.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunCelebrationCheck}
              disabled={checkingCelebrations}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium inline-flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingCelebrations ? 'animate-spin' : ''}`} />
              Run Check Now
            </button>
          </div>

          {(() => {
            const cel = normalizeCelebrationSettings(form.celebrationSettings);
            const updateCel = (patch: Partial<typeof cel>) =>
              setForm({
                ...form,
                celebrationSettings: { ...cel, ...patch },
              });

            return (
              <div className="space-y-4">
                {(
                  [
                    {
                      key: 'birthdaysEnabled',
                      title: 'Enable Birthday Celebrations & Notifications',
                      desc: 'Detect employee birthdays automatically (birth year is always hidden from colleagues).',
                    },
                    {
                      key: 'anniversariesEnabled',
                      title: 'Enable Work Anniversary Celebrations',
                      desc: 'Celebrate completed full years of service (minimum 1 full year required).',
                    },
                    {
                      key: 'upcomingRemindersEnabled',
                      title: 'Show Upcoming Celebration Reminders',
                      desc: 'Highlight upcoming birthdays and anniversaries on the dashboard widget.',
                    },
                    {
                      key: 'feedEnabled',
                      title: 'Enable Celebration Feed',
                      desc: 'Show the internal wishes feed inside Celebrations and celebration detail modals.',
                    },
                    {
                      key: 'wishesEnabled',
                      title: 'Allow Employees to Send Wishes',
                      desc: 'Enable emoji and short message wishes from colleagues on active celebration dates.',
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
                      checked={Boolean(cel[item.key])}
                      onChange={(e) => updateCel({ [item.key]: e.target.checked })}
                      className="w-4 h-4 mt-1 accent-[#B5121B]"
                    />
                  </label>
                ))}

                <div className="grid sm:grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="block font-medium mb-1">Upcoming Window (Days)</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={cel.upcomingWindowDays}
                      onChange={(e) =>
                        updateCel({
                          upcomingWindowDays: Math.min(30, Math.max(1, Number(e.target.value) || 7)),
                        })
                      }
                      className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">Celebration Visibility</label>
                    <select
                      value={cel.visibilityScope}
                      onChange={(e) =>
                        updateCel({ visibilityScope: e.target.value as CelebrationVisibilityScope })
                      }
                      className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    >
                      <option value="all_active">All Active Employees</option>
                      <option value="department">Same Department Only</option>
                      <option value="leaders_only">Team Leaders &amp; Admins Only</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium mb-1">Evaluation Timezone</label>
                    <select
                      value={cel.timezone}
                      onChange={(e) => updateCel({ timezone: e.target.value })}
                      className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                    >
                      <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                      <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        celebrationSettings: { ...DEFAULT_CELEBRATION_SETTINGS },
                      })
                    }
                    className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Reset Defaults
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
                  >
                    {saving ? 'Saving...' : 'Save Celebration Settings'}
                  </button>
                </div>
              </div>
            );
          })()}
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
                title: 'Approve or Reject Attendance Regularization',
                desc: 'Allows reviewing and approving or rejecting employee attendance regularization requests.',
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
              {
                key: 'canApproveExpenses',
                title: 'Approve & Mark Paid Company Expense Claims',
                desc: 'Allows reviewing, approving/rejecting, and marking paid expense claims within their assigned company.',
              },
              {
                key: 'canManageAssets',
                title: 'Manage Company Assets & Exit Clearance',
                desc: 'Allows registering, assigning, and processing asset returns within their assigned company.',
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

import React, { useCallback, useEffect, useState } from 'react';
import {
  UserPlus,
  Search,
  Edit3,
  KeyRound,
  X,
  UserCheck,
  UserX,
  RefreshCw,
  Upload,
  SlidersHorizontal,
  Trash2,
  AlertTriangle,
  Laptop,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  AssetAssignment,
  AttendanceCorrection,
  AttendanceRecord,
  CompanyId,
  Department,
  Employee,
  EmployeeSalary,
  EmployeeStatus,
  LeaveApplication,
  LeaveLedgerEntry,
  normalizeCompanyId,
  UserRole,
} from '../types/hr';
import { CompanyBadge } from '../components/CompanyBadge';
import { WorkingHoursAnalytics } from '../components/WorkingHoursAnalytics';
import {
  adjustEmployeeLeaveBalance,
  BOOTSTRAPPED_ADMIN_EMAIL,
  compressImageFile,
  createEmployeeAccount,
  deleteEmployeeAccount,
  fetchAllEmployees,
  fetchAttendanceRecords,
  fetchEmployeeSalary,
  fetchLeaveApplications,
  fetchLeaveLedger,
  fetchMediaAsset,
  formatDurationMinutes,
  formatMoney,
  formatTimeDisplay,
  getDepartments,
  getEffectiveSchedule,
  getTodayInTimezone,
  LOCATION_PRESETS,
  saveEmployeeSalary,
  updateEmployeeProfile,
  uploadMediaAsset,
} from '../lib/hrService';
import { fetchAttendanceRegularizations } from '../lib/regularizationService';
import { computeEmployeeAssetClearance, fetchAssetAssignments } from '../lib/assetService';
import {
  calculateCasualLeaveEligibilityDate,
  computeEmployeeLeaveAccrualPlan,
  normalizeLeavePolicyConfig,
  round2,
} from '../../shared/leaveAccrualEngine';
import { formatCelebrationMonthDayLabel } from '../../shared/celebrationEngine';
import { useCelebrations } from '../context/CelebrationContext';

const WEEKDAYS = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
];

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'UTC'];

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function EmployeesView() {
  const { employee, settings, requestPasswordReset, refreshSession } = useAuth();
  const { showToast } = useToast();
  const { refreshCelebrations } = useCelebrations();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<'all' | CompanyId>('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');

  // Create Employee Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createCustomSchedule, setCreateCustomSchedule] = useState(false);
  const [leaveManualOverride, setLeaveManualOverride] = useState(false);
  const [newPhotoPreview, setNewPhotoPreview] = useState<string | null>(null);
  const [newEmp, setNewEmp] = useState({
    companyId: '' as CompanyId | '',
    fullName: '',
    employeeCode: '',
    email: '',
    phone: '',
    emergencyContact: '',
    role: 'employee' as UserRole,
    department: '',
    designation: '',
    joiningDate: new Date().toISOString().slice(0, 10),
    dateOfBirth: '',
    location: 'India',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    officeStartTime: '09:30',
    officeEndTime: '18:30',
    gracePeriodMinutes: 15,
    halfDayMinHours: 4,
    fullDayMinHours: 8,
    workingDays: [1, 2, 3, 4, 5] as number[],
    managerUid: '',
    sickLeaveBalance: 1,
    casualLeaveBalance: 0,
    carryForwardBalance: 0,
    clEligibilityDate: calculateCasualLeaveEligibilityDate(new Date().toISOString().slice(0, 10), 6),
    clEligibilityCustom: false,
    temporaryPassword: generateTempPassword(),
    mustChangePassword: false,
  });

  // Profile Drawer / Modal
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [profileTab, setProfileTab] = useState<'profile' | 'attendance' | 'leave' | 'payroll'>('profile');
  const [empAttendance, setEmpAttendance] = useState<AttendanceRecord[]>([]);
  const [empApprovedCorrections, setEmpApprovedCorrections] = useState<AttendanceCorrection[]>([]);
  const [empAssetAssignments, setEmpAssetAssignments] = useState<AssetAssignment[]>([]);
  const [empLeaves, setEmpLeaves] = useState<LeaveApplication[]>([]);
  const [empLedger, setEmpLedger] = useState<LeaveLedgerEntry[]>([]);
  const [empSalary, setEmpSalary] = useState<EmployeeSalary | null>(null);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});
  const [editCustomSchedule, setEditCustomSchedule] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [quickAdjType, setQuickAdjType] = useState<'SL' | 'CL'>('SL');
  const [quickAdjDelta, setQuickAdjDelta] = useState<number>(1);
  const [quickAdjReason, setQuickAdjReason] = useState('');
  const [quickAdjSaving, setQuickAdjSaving] = useState(false);
  const [salaryForm, setSalaryForm] = useState({
    currency: 'INR',
    basicSalary: 0,
    hra: 0,
    professionalTax: 0,
    defaultBonus: 0,
  });

  // Delete Employee Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleteRelatedRecords, setDeleteRelatedRecords] = useState(false);
  const [deletingEmp, setDeletingEmp] = useState(false);

  const loadData = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const canViewAll = settings?.teamLeaderPermissions?.canViewAllEmployees ?? true;
      const [empList, deptList] = await Promise.all([
        fetchAllEmployees(employee, canViewAll),
        getDepartments(),
      ]);
      setEmployees(empList);
      setDepartments(deptList);
      if (deptList.length > 0 && !newEmp.department) {
        setNewEmp((p) => ({ ...p, department: deptList[0].name }));
      }

      // Fetch profile avatars in parallel cleanly
      const withPhotos = empList.filter((e) => Boolean(e.profilePhotoAssetId));
      if (withPhotos.length > 0) {
        const entries = await Promise.all(
          withPhotos.map(async (e) => {
            const asset = await fetchMediaAsset(e.profilePhotoAssetId!);
            return asset?.dataUrl ? ([e.id, asset.dataUrl] as const) : null;
          })
        );
        const map: Record<string, string> = {};
        for (const item of entries) {
          if (item) map[item[0]] = item[1];
        }
        setPhotoUrls(map);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load directory', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, settings?.teamLeaderPermissions?.canViewAllEmployees, showToast, newEmp.department]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!employee || !settings) return null;

  const isSuperAdmin = employee.role === 'super_admin';
  const canViewSalary =
    isSuperAdmin || (employee.role === 'team_leader' && settings.teamLeaderPermissions.canViewSalary);

  const availableLocations =
    settings.locations && settings.locations.length > 0 ? settings.locations : ['India', 'Dubai, UAE'];

  const computeOpeningBalances = (
    joiningDate: string,
    timezone: string,
    clEligibilityDate?: string,
    clEligibilityCustom?: boolean
  ) => {
    const policy = normalizeLeavePolicyConfig(settings.leavePolicy);
    const plan = computeEmployeeLeaveAccrualPlan({
      employee: {
        id: 'preview_new',
        uid: '',
        email: 'preview@talentgrade.io',
        fullName: 'New Employee',
        joiningDate,
        status: 'Active',
        timezone,
        sickLeaveBalance: 0,
        casualLeaveBalance: 0,
        carryForwardBalance: 0,
        clEligibilityDate,
        clEligibilityCustom,
      },
      policy,
      existingLedger: [],
      approvedLeaves: [],
      referenceNow: new Date(),
      actorUid: employee.uid,
      actorName: employee.fullName,
      isNewEmployeeInit: true,
    });
    return plan.summary;
  };

  const handleNewCompanyChange = (companyId: CompanyId) => {
    setNewEmp((p) => ({
      ...p,
      companyId,
      currency: companyId === 'mygrade' ? 'INR' : p.currency,
    }));
  };

  const handleNewLocationChange = (loc: string) => {
    const preset = LOCATION_PRESETS[loc];
    const nextTz = preset ? preset.timezone : newEmp.timezone;
    const summary = computeOpeningBalances(
      newEmp.joiningDate,
      nextTz,
      newEmp.clEligibilityDate,
      newEmp.clEligibilityCustom
    );
    setNewEmp((p) => ({
      ...p,
      location: loc,
      timezone: nextTz,
      currency: p.companyId === 'mygrade' ? 'INR' : preset ? preset.currency : p.currency,
      ...(leaveManualOverride
        ? {}
        : {
            sickLeaveBalance: summary.sickLeaveBalance,
            casualLeaveBalance: summary.casualLeaveBalance,
            carryForwardBalance: summary.carryForwardBalance,
          }),
    }));
  };

  const handleEditLocationChange = (loc: string) => {
    const preset = LOCATION_PRESETS[loc];
    setEditForm((p) => {
      const empCompany = normalizeCompanyId(p.companyId || selectedEmp?.companyId);
      return {
        ...p,
        location: loc,
        timezone: preset ? preset.timezone : p.timezone,
        currency: empCompany === 'mygrade' ? 'INR' : preset ? preset.currency : p.currency,
      };
    });
  };

  const handleNewPhotoSelect = async (file: File) => {
    try {
      const compressed = await compressImageFile(file, 360);
      setNewPhotoPreview(compressed);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not process image', 'error');
    }
  };

  const handleProfilePhotoUpload = async (file: File) => {
    if (!selectedEmp || !isSuperAdmin) return;
    setUploadingPhoto(true);
    try {
      const compressed = await compressImageFile(file, 360);
      const assetId = await uploadMediaAsset({
        ownerUid: employee.uid,
        assetType: 'profile_photo',
        fileName: file.name,
        mimeType: 'image/jpeg',
        dataUrl: compressed,
      });
      await updateEmployeeProfile(selectedEmp.id, { profilePhotoAssetId: assetId }, employee);
      setPhotoUrls((prev) => ({ ...prev, [selectedEmp.id]: compressed }));
      setSelectedEmp((prev) => (prev ? { ...prev, profilePhotoAssetId: assetId } : null));
      showToast('Profile photo updated.', 'success');
      if (selectedEmp.id === employee.id) {
        await refreshSession();
      }
      await refreshCelebrations();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Photo upload failed', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const openProfile = async (emp: Employee) => {
    setSelectedEmp(emp);
    setProfileTab('profile');
    const hasCustomSchedule = Boolean(
      emp.officeStartTime ||
        emp.officeEndTime ||
        typeof emp.gracePeriodMinutes === 'number' ||
        (emp.workingDays && emp.workingDays.length > 0)
    );
    setEditCustomSchedule(hasCustomSchedule);

    const effective = getEffectiveSchedule(emp, settings);
    const policy = normalizeLeavePolicyConfig(settings.leavePolicy);
    const computedClElig = calculateCasualLeaveEligibilityDate(
      emp.joiningDate,
      policy.casualLeaveEligibilityMonths
    );
    setQuickAdjType('SL');
    setQuickAdjDelta(1);
    setQuickAdjReason('');
    const empCompany = normalizeCompanyId(emp.companyId);
    setEditForm({
      companyId: empCompany,
      fullName: emp.fullName,
      email: emp.email,
      phone: emp.phone || '',
      emergencyContact: emp.emergencyContact || '',
      role: emp.role,
      department: emp.department,
      designation: emp.designation,
      joiningDate: emp.joiningDate,
      dateOfBirth: isSuperAdmin || emp.id === employee.id ? emp.dateOfBirth || '' : undefined,
      status: emp.status,
      location: emp.location || effective.location,
      timezone: emp.timezone || effective.timezone,
      currency: empCompany === 'mygrade' ? 'INR' : emp.currency || effective.currency,
      officeStartTime: effective.officeStartTime,
      officeEndTime: effective.officeEndTime,
      gracePeriodMinutes: effective.gracePeriodMinutes,
      halfDayMinHours: effective.halfDayMinHours,
      fullDayMinHours: effective.fullDayMinHours,
      workingDays: effective.workingDays,
      managerUid: emp.managerUid || '',
      sickLeaveBalance: emp.sickLeaveBalance,
      casualLeaveBalance: emp.casualLeaveBalance,
      carryForwardBalance: emp.carryForwardBalance,
      clEligibilityDate: emp.clEligibilityDate || computedClElig,
      clEligibilityCustom: Boolean(emp.clEligibilityCustom),
    });

    try {
      const canViewAll = settings?.teamLeaderPermissions?.canViewAllEmployees ?? true;
      const canApproveCor =
        isSuperAdmin || Boolean(settings?.teamLeaderPermissions?.canApproveCorrections);
      const canManageAssets =
        isSuperAdmin || Boolean(settings?.teamLeaderPermissions?.canManageAssets);
      const [allAtt, allLeaves, allLedger, allCorrections, allAssignments] = await Promise.all([
        fetchAttendanceRecords(employee, undefined, canViewAll),
        fetchLeaveApplications(employee),
        fetchLeaveLedger(employee),
        fetchAttendanceRegularizations(employee, canApproveCor).catch(() => []),
        fetchAssetAssignments(employee, canManageAssets, canViewAll).catch(() => []),
      ]);
      setEmpAttendance(allAtt.filter((a) => a.employeeId === emp.id));
      setEmpApprovedCorrections(
        allCorrections.filter((c) => c.employeeId === emp.id && c.status === 'Approved')
      );
      setEmpAssetAssignments(allAssignments.filter((asg) => asg.employeeId === emp.id));
      setEmpLeaves(allLeaves.filter((l) => l.employeeId === emp.id));
      setEmpLedger(allLedger.filter((x) => x.employeeId === emp.id));

      if (canViewSalary) {
        const sal = await fetchEmployeeSalary(emp.id);
        setEmpSalary(sal);
        setSalaryForm({
          currency:
            empCompany === 'mygrade'
              ? 'INR'
              : sal?.currency || emp.currency || effective.currency,
          basicSalary: sal?.basicSalary ?? 0,
          hra: sal?.hra ?? 0,
          professionalTax: sal?.professionalTax ?? 0,
          defaultBonus: sal?.defaultBonus ?? 0,
        });
      }
    } catch {
      // Handled gracefully
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmp.companyId) {
      showToast('Please select a company (TalentGrade or MyGrade) before creating the employee.', 'error');
      return;
    }
    setCreating(true);
    try {
      let profilePhotoAssetId: string | undefined;
      if (newPhotoPreview) {
        profilePhotoAssetId = await uploadMediaAsset({
          ownerUid: employee.uid,
          assetType: 'profile_photo',
          fileName: `${newEmp.employeeCode || 'profile'}.jpg`,
          mimeType: 'image/jpeg',
          dataUrl: newPhotoPreview,
        });
      }

      const res = await createEmployeeAccount(
        {
          companyId: newEmp.companyId,
          employeeCode: newEmp.employeeCode,
          fullName: newEmp.fullName,
          email: newEmp.email,
          phone: newEmp.phone,
          emergencyContact: newEmp.emergencyContact,
          role: newEmp.role,
          department: newEmp.department || departments[0]?.name || 'Operations',
          designation: newEmp.designation,
          joiningDate: newEmp.joiningDate,
          dateOfBirth: newEmp.dateOfBirth || undefined,
          location: newEmp.location,
          timezone: newEmp.timezone,
          currency: newEmp.companyId === 'mygrade' ? 'INR' : newEmp.currency,
          officeStartTime: createCustomSchedule ? newEmp.officeStartTime : undefined,
          officeEndTime: createCustomSchedule ? newEmp.officeEndTime : undefined,
          gracePeriodMinutes: createCustomSchedule ? newEmp.gracePeriodMinutes : undefined,
          halfDayMinHours: createCustomSchedule ? newEmp.halfDayMinHours : undefined,
          fullDayMinHours: createCustomSchedule ? newEmp.fullDayMinHours : undefined,
          workingDays: createCustomSchedule ? newEmp.workingDays : undefined,
          profilePhotoAssetId,
          managerUid: newEmp.managerUid,
          sickLeaveBalance: newEmp.sickLeaveBalance,
          casualLeaveBalance: newEmp.casualLeaveBalance,
          carryForwardBalance: newEmp.carryForwardBalance,
          clEligibilityDate: newEmp.clEligibilityDate,
          clEligibilityCustom: newEmp.clEligibilityCustom,
          temporaryPassword: newEmp.temporaryPassword,
          mustChangePassword: false,
        },
        employee,
        { leavePolicy: settings.leavePolicy }
      );
      showToast(
        res.note || `Created account for ${res.employee.fullName} (${res.employee.employeeCode}).`,
        'success'
      );
      setCreateOpen(false);
      setNewPhotoPreview(null);
      setCreateCustomSchedule(false);
      setLeaveManualOverride(false);
      const resetJoin = getTodayInTimezone('Asia/Kolkata');
      const resetSummary = computeOpeningBalances(resetJoin, 'Asia/Kolkata');
      setNewEmp({
        companyId: '',
        fullName: '',
        employeeCode: '',
        email: '',
        phone: '',
        emergencyContact: '',
        role: 'employee',
        department: departments[0]?.name || '',
        designation: '',
        joiningDate: resetJoin,
        dateOfBirth: '',
        location: 'India',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        officeStartTime: settings.officeStartTime || '09:30',
        officeEndTime: settings.officeEndTime || '18:30',
        gracePeriodMinutes: settings.gracePeriodMinutes ?? 15,
        halfDayMinHours: settings.halfDayMinHours ?? 4,
        fullDayMinHours: settings.fullDayMinHours ?? 8,
        workingDays: settings.workingDays || [1, 2, 3, 4, 5],
        managerUid: '',
        sickLeaveBalance: resetSummary.sickLeaveBalance,
        casualLeaveBalance: resetSummary.casualLeaveBalance,
        carryForwardBalance: resetSummary.carryForwardBalance,
        clEligibilityDate: resetSummary.clEligibilityDate,
        clEligibilityCustom: false,
        temporaryPassword: generateTempPassword(),
        mustChangePassword: false,
      });
      await loadData();
      await refreshCelebrations();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not create employee', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmp || !isSuperAdmin) return;
    setSavingEdit(true);
    try {
      const nextCompanyId = normalizeCompanyId(editForm.companyId || selectedEmp.companyId);
      const payload: Partial<Employee> = {
        companyId: nextCompanyId,
        fullName: editForm.fullName,
        phone: editForm.phone,
        emergencyContact: editForm.emergencyContact,
        role: editForm.role,
        department: editForm.department,
        designation: editForm.designation,
        joiningDate: editForm.joiningDate,
        dateOfBirth: editForm.dateOfBirth ?? '',
        status: editForm.status,
        location: editForm.location,
        timezone: editForm.timezone,
        currency: nextCompanyId === 'mygrade' ? 'INR' : editForm.currency,
        managerUid: editForm.managerUid,
        sickLeaveBalance: editForm.sickLeaveBalance,
        casualLeaveBalance: editForm.casualLeaveBalance,
        carryForwardBalance: editForm.carryForwardBalance,
        clEligibilityDate: editForm.clEligibilityDate,
        clEligibilityCustom: Boolean(editForm.clEligibilityCustom),
      };

      if (editCustomSchedule) {
        payload.officeStartTime = editForm.officeStartTime;
        payload.officeEndTime = editForm.officeEndTime;
        payload.gracePeriodMinutes = editForm.gracePeriodMinutes;
        payload.halfDayMinHours = editForm.halfDayMinHours;
        payload.fullDayMinHours = editForm.fullDayMinHours;
        payload.workingDays = editForm.workingDays;
      }

      await updateEmployeeProfile(selectedEmp.id, payload, employee, {
        clearScheduleOverrides: !editCustomSchedule,
        leavePolicy: settings.leavePolicy,
      });
      showToast('Employee profile updated.', 'success');
      await loadData();
      await refreshCelebrations();
      if (selectedEmp.id === employee.id) {
        await refreshSession();
      }
      const updatedLedger = await fetchLeaveLedger(employee).catch(() => empLedger);
      setEmpLedger(updatedLedger.filter((x) => x.employeeId === selectedEmp.id));
      setSelectedEmp((prev) => {
        if (!prev) return null;
        const next = { ...prev, ...payload } as Employee;
        if (!editCustomSchedule) {
          delete next.officeStartTime;
          delete next.officeEndTime;
          delete next.gracePeriodMinutes;
          delete next.halfDayMinHours;
          delete next.fullDayMinHours;
          delete next.workingDays;
        }
        return next;
      });
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleStatus = async (emp: Employee) => {
    if (!isSuperAdmin) return;
    const nextStatus: EmployeeStatus = emp.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await updateEmployeeProfile(emp.id, { status: nextStatus }, employee);
      showToast(`${emp.fullName} marked as ${nextStatus}.`, 'info');
      await loadData();
      await refreshCelebrations();
      if (selectedEmp?.id === emp.id) {
        setSelectedEmp({ ...emp, status: nextStatus });
        setEditForm((p) => ({ ...p, status: nextStatus }));
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Status update failed', 'error');
    }
  };

  const handleResetPassword = async (emp: Employee) => {
    try {
      await requestPasswordReset(emp.email);
      showToast(`Password reset triggered for ${emp.email}.`, 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not send reset email', 'error');
    }
  };

  const canDeleteEmployee = (target: Employee) =>
    isSuperAdmin &&
    target.id !== employee.id &&
    target.uid !== employee.uid &&
    target.email.trim().toLowerCase() !== BOOTSTRAPPED_ADMIN_EMAIL;

  const openDeleteModal = (target: Employee) => {
    if (!canDeleteEmployee(target)) return;
    setDeleteRelatedRecords(false);
    setDeleteTarget(target);
  };

  const handleConfirmDeleteEmployee = async () => {
    if (!deleteTarget || !canDeleteEmployee(deleteTarget)) return;
    setDeletingEmp(true);
    try {
      const res = await deleteEmployeeAccount(deleteTarget, employee, {
        deleteRelatedRecords,
      });
      showToast(
        deleteRelatedRecords
          ? `Deleted ${deleteTarget.fullName} and ${res.deletedRelatedCount} related record(s).`
          : `Deleted ${deleteTarget.fullName} (${deleteTarget.employeeCode}) from the directory.`,
        'success'
      );
      if (selectedEmp?.id === deleteTarget.id) {
        setSelectedEmp(null);
      }
      setDeleteTarget(null);
      setDeleteRelatedRecords(false);
      await loadData();
      await refreshCelebrations();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not delete employee', 'error');
    } finally {
      setDeletingEmp(false);
    }
  };

  const handleSaveQuickSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmp || !isSuperAdmin) return;
    try {
      const saved = await saveEmployeeSalary(
        {
          employee: selectedEmp,
          currency: salaryForm.currency,
          basicSalary: salaryForm.basicSalary,
          hra: salaryForm.hra,
          otherEarnings: empSalary?.otherEarnings || [],
          deductions: empSalary?.deductions || [],
          professionalTax: salaryForm.professionalTax,
          defaultBonus: salaryForm.defaultBonus,
        },
        employee
      );
      setEmpSalary(saved);
      showToast(`Salary configuration saved (${salaryForm.currency}).`, 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not save salary', 'error');
    }
  };

  const filtered = employees.filter((emp) => {
    const loc = emp.location || 'India';
    const empCompany = normalizeCompanyId(emp.companyId);
    if (companyFilter !== 'all' && empCompany !== companyFilter) return false;
    if (locationFilter !== 'all' && loc !== locationFilter) return false;
    if (deptFilter !== 'all' && emp.department !== deptFilter) return false;
    if (statusFilter !== 'all' && emp.status !== statusFilter) return false;
    if (roleFilter !== 'all' && emp.role !== roleFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        emp.fullName.toLowerCase().includes(q) ||
        emp.employeeCode.toLowerCase().includes(q) ||
        emp.email.toLowerCase().includes(q) ||
        emp.designation.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const leaders = employees.filter((e) => e.role === 'team_leader' || e.role === 'super_admin');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-zinc-950 dark:text-zinc-100">
            Workforce Directory
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {employees.length} team members across TalentGrade &amp; MyGrade · Manage companies, schedules, leave balances &amp; currency
          </p>
        </div>
        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => {
              const initJoin = getTodayInTimezone('Asia/Kolkata');
              const opening = computeOpeningBalances(initJoin, 'Asia/Kolkata');
              setLeaveManualOverride(false);
              setNewEmp((p) => ({
                ...p,
                companyId: '',
                currency: 'INR',
                employeeCode: `TG-${String(employees.length + 1).padStart(3, '0')}`,
                joiningDate: initJoin,
                sickLeaveBalance: opening.sickLeaveBalance,
                casualLeaveBalance: opening.casualLeaveBalance,
                carryForwardBalance: opening.carryForwardBalance,
                clEligibilityDate: opening.clEligibilityDate,
                clEligibilityCustom: false,
                temporaryPassword: generateTempPassword(),
                officeStartTime: settings.officeStartTime || '09:30',
                officeEndTime: settings.officeEndTime || '18:30',
                gracePeriodMinutes: settings.gracePeriodMinutes ?? 15,
                halfDayMinHours: settings.halfDayMinHours ?? 4,
                fullDayMinHours: settings.fullDayMinHours ?? 8,
                workingDays: settings.workingDays || [1, 2, 3, 4, 5],
              }));
              setCreateOpen(true);
            }}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold"
          >
            <UserPlus className="w-4 h-4" />
            Add Employee
          </button>
        )}
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ID, email, designation..."
            className="w-full min-h-[40px] pl-9 pr-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
          />
        </div>

        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value as 'all' | CompanyId)}
          className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs font-medium"
        >
          <option value="all">All Companies</option>
          <option value="talentgrade">TalentGrade</option>
          <option value="mygrade">MyGrade</option>
        </select>

        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
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
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
        >
          <option value="all">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="Resigned">Resigned</option>
          <option value="Terminated">Terminated</option>
        </select>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
        >
          <option value="all">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="team_leader">Team Leader</option>
          <option value="employee">Employee</option>
        </select>
      </div>

      {/* Directory Table */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
            <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-xs text-zinc-500">No matching employees found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-3 px-4 font-medium">Employee</th>
                  <th className="py-3 px-4 font-medium">ID</th>
                  <th className="py-3 px-4 font-medium">Company</th>
                  <th className="py-3 px-4 font-medium">Department &amp; Role</th>
                  <th className="py-3 px-4 font-medium">Location &amp; Currency</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">SL / CL</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filtered.map((emp) => {
                  const effective = getEffectiveSchedule(emp, settings);
                  const avatar = photoUrls[emp.id];
                  return (
                    <tr key={emp.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {avatar ? (
                            <img
                              src={avatar}
                              alt={emp.fullName}
                              className="w-8 h-8 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-zinc-800 text-white flex items-center justify-center text-[11px] font-semibold shrink-0">
                              {getInitials(emp.fullName)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-zinc-950 dark:text-zinc-100 truncate">{emp.fullName}</div>
                            <div className="text-[11px] text-zinc-500 truncate">{emp.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">{emp.employeeCode}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <CompanyBadge companyId={emp.companyId} />
                      </td>
                      <td className="py-3 px-4">
                        <div>{emp.department}</div>
                        <div className="text-[11px] text-zinc-500">
                          {emp.designation} ·{' '}
                          {emp.role === 'super_admin' ? 'Super Admin' : emp.role === 'team_leader' ? 'Team Leader' : 'Employee'}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {effective.location} · {effective.currency}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          {effective.timezone} · {effective.officeStartTime}–{effective.officeEndTime}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-medium">
                        <span
                          className={
                            emp.status === 'Active'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-[#B5121B] dark:text-red-400'
                          }
                        >
                          {emp.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {emp.sickLeaveBalance} / {emp.casualLeaveBalance}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openProfile(emp)}
                            className="min-h-[34px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Profile
                          </button>
                          {isSuperAdmin && emp.id !== employee.id && (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(emp)}
                              title={emp.status === 'Active' ? 'Deactivate Account' : 'Activate Account'}
                              className="min-h-[34px] px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              {emp.status === 'Active' ? (
                                <UserX className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                              ) : (
                                <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                              )}
                            </button>
                          )}
                          {canDeleteEmployee(emp) && (
                            <button
                              type="button"
                              onClick={() => openDeleteModal(emp)}
                              title="Delete Employee"
                              aria-label={`Delete ${emp.fullName}`}
                              className="min-h-[34px] px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 text-[#B5121B] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
        )}
      </section>

      {/* Create Employee Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSubmit}
            className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-base font-semibold">Create TalentGrade Employee</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto text-xs">
              {/* Profile Photo Optional Upload */}
              <div className="flex items-center gap-4 pb-3 border-b border-zinc-200 dark:border-zinc-800">
                {newPhotoPreview ? (
                  <img
                    src={newPhotoPreview}
                    alt="Employee preview"
                    className="w-12 h-12 rounded-full object-cover border border-zinc-200 dark:border-zinc-700"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 flex items-center justify-center font-semibold">
                    {newEmp.fullName ? getInitials(newEmp.fullName) : 'TG'}
                  </div>
                )}
                <div>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 font-medium">
                    <Upload className="w-3.5 h-3.5" />
                    Upload Profile Photo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleNewPhotoSelect(f);
                      }}
                    />
                  </label>
                  <div className="text-[11px] text-zinc-500 mt-1">Optional · Automatically resized</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                <label className="block font-medium mb-1">Company *</label>
                <select
                  required
                  value={newEmp.companyId}
                  onChange={(e) => handleNewCompanyChange(e.target.value as CompanyId)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-medium"
                >
                  <option value="" disabled>
                    Select company (TalentGrade or MyGrade)...
                  </option>
                  <option value="talentgrade">TalentGrade — TalentGrade HR Services Pvt Ltd</option>
                  <option value="mygrade">MyGrade — MyGrade Learning Pvt Ltd (INR only)</option>
                </select>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Full Name *</label>
                  <input
                    required
                    value={newEmp.fullName}
                    onChange={(e) => setNewEmp((p) => ({ ...p, fullName: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Employee ID *</label>
                  <input
                    required
                    value={newEmp.employeeCode}
                    onChange={(e) => setNewEmp((p) => ({ ...p, employeeCode: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium mb-1">Work Email *</label>
                  <input
                    type="email"
                    required
                    value={newEmp.email}
                    onChange={(e) => setNewEmp((p) => ({ ...p, email: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Phone Number</label>
                  <input
                    value={newEmp.phone}
                    onChange={(e) => setNewEmp((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Emergency Contact</label>
                  <input
                    value={newEmp.emergencyContact}
                    onChange={(e) => setNewEmp((p) => ({ ...p, emergencyContact: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
              </div>

              {/* Location, Timezone & Currency */}
              <div className="grid sm:grid-cols-3 gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                <div>
                  <label className="block font-medium mb-1">Country / Location *</label>
                  <select
                    value={newEmp.location}
                    onChange={(e) => handleNewLocationChange(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                  >
                    {availableLocations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Timezone *</label>
                  <select
                    value={newEmp.timezone}
                    onChange={(e) => setNewEmp((p) => ({ ...p, timezone: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Salary Currency *</label>
                  <select
                    value={newEmp.companyId === 'mygrade' ? 'INR' : newEmp.currency}
                    onChange={(e) => setNewEmp((p) => ({ ...p, currency: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="AED" disabled={newEmp.companyId === 'mygrade'}>
                      AED (د.إ) {newEmp.companyId === 'mygrade' ? '(TalentGrade only)' : ''}
                    </option>
                  </select>
                  {newEmp.companyId === 'mygrade' && (
                    <div className="text-[10px] text-[#B5121B] dark:text-red-400 mt-1">
                      MyGrade supports INR only
                    </div>
                  )}
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium mb-1">Role *</label>
                  <select
                    value={newEmp.role}
                    onChange={(e) => setNewEmp((p) => ({ ...p, role: e.target.value as UserRole }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    <option value="employee">Employee</option>
                    <option value="team_leader">Team Leader / Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Department *</label>
                  <select
                    value={newEmp.department}
                    onChange={(e) => setNewEmp((p) => ({ ...p, department: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Designation *</label>
                  <input
                    required
                    value={newEmp.designation}
                    onChange={(e) => setNewEmp((p) => ({ ...p, designation: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium mb-1">Joining Date *</label>
                  <input
                    type="date"
                    required
                    value={newEmp.joiningDate}
                    onChange={(e) => {
                      const nextJoin = e.target.value;
                      const policy = normalizeLeavePolicyConfig(settings.leavePolicy);
                      const autoClElig = calculateCasualLeaveEligibilityDate(
                        nextJoin,
                        policy.casualLeaveEligibilityMonths
                      );
                      const nextClElig = newEmp.clEligibilityCustom ? newEmp.clEligibilityDate : autoClElig;
                      const opening = computeOpeningBalances(
                        nextJoin,
                        newEmp.timezone,
                        nextClElig,
                        newEmp.clEligibilityCustom
                      );
                      setNewEmp((p) => ({
                        ...p,
                        joiningDate: nextJoin,
                        ...(p.clEligibilityCustom ? {} : { clEligibilityDate: autoClElig }),
                        ...(leaveManualOverride
                          ? {}
                          : {
                              sickLeaveBalance: opening.sickLeaveBalance,
                              casualLeaveBalance: opening.casualLeaveBalance,
                              carryForwardBalance: opening.carryForwardBalance,
                            }),
                      }));
                    }}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={newEmp.dateOfBirth}
                    onChange={(e) => setNewEmp((p) => ({ ...p, dateOfBirth: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                  <div className="text-[10px] text-zinc-500 mt-0.5">Birth year hidden from team</div>
                </div>
                <div>
                  <label className="block font-medium mb-1">Reporting Manager</label>
                  <select
                    value={newEmp.managerUid}
                    onChange={(e) => setNewEmp((p) => ({ ...p, managerUid: e.target.value }))}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    <option value="">None assigned</option>
                    {leaders.map((l) => (
                      <option key={l.id} value={l.uid || l.id}>
                        {l.fullName} ({l.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dedicated Leave Balance Configuration Section (Super Admin Control) */}
              {(() => {
                const policy = normalizeLeavePolicyConfig(settings.leavePolicy);
                const autoClElig = calculateCasualLeaveEligibilityDate(
                  newEmp.joiningDate,
                  policy.casualLeaveEligibilityMonths
                );
                const preview = computeOpeningBalances(
                  newEmp.joiningDate,
                  newEmp.timezone,
                  newEmp.clEligibilityDate,
                  newEmp.clEligibilityCustom
                );
                return (
                  <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                          Leave Balance Configuration
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Set this employee&apos;s starting SL, CL, and accrual commencement date. Policy accrues{' '}
                          {policy.sickLeaveMonthlyRate} SL/mo (non-carry-forward) &amp; {policy.casualLeaveMonthlyRate}{' '}
                          CL/mo after {policy.casualLeaveEligibilityMonths}m (carries forward).
                        </div>
                      </div>
                      {(leaveManualOverride || newEmp.clEligibilityCustom) && (
                        <button
                          type="button"
                          onClick={() => {
                            setLeaveManualOverride(false);
                            const autoSummary = computeOpeningBalances(
                              newEmp.joiningDate,
                              newEmp.timezone,
                              autoClElig,
                              false
                            );
                            setNewEmp((p) => ({
                              ...p,
                              sickLeaveBalance: autoSummary.sickLeaveBalance,
                              casualLeaveBalance: autoSummary.casualLeaveBalance,
                              carryForwardBalance: autoSummary.carryForwardBalance,
                              clEligibilityDate: autoClElig,
                              clEligibilityCustom: false,
                            }));
                          }}
                          className="text-[#B5121B] dark:text-red-400 text-[11px] font-medium underline shrink-0"
                        >
                          Recalculate from Policy
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block font-medium mb-1">Initial Sick Leave (SL)</label>
                        <input
                          type="number"
                          step="0.5"
                          min={-60}
                          max={365}
                          value={newEmp.sickLeaveBalance}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            setLeaveManualOverride(true);
                            setNewEmp((p) => ({
                              ...p,
                              sickLeaveBalance: Number.isFinite(val) ? val : 0,
                            }));
                          }}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Initial Casual Leave (CL)</label>
                        <input
                          type="number"
                          step="0.5"
                          min={-60}
                          max={365}
                          value={newEmp.casualLeaveBalance}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            setLeaveManualOverride(true);
                            setNewEmp((p) => ({
                              ...p,
                              casualLeaveBalance: Number.isFinite(val) ? val : 0,
                            }));
                          }}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Carry Forward</label>
                        <input
                          type="number"
                          step="0.5"
                          min={0}
                          max={365}
                          value={newEmp.carryForwardBalance}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            setLeaveManualOverride(true);
                            setNewEmp((p) => ({
                              ...p,
                              carryForwardBalance: Number.isFinite(val) ? Math.max(0, val) : 0,
                            }));
                          }}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">
                          CL Eligibility Date{' '}
                          {newEmp.clEligibilityCustom && (
                            <span className="text-[10px] text-[#B5121B] dark:text-red-400">(Custom)</span>
                          )}
                        </label>
                        <input
                          type="date"
                          value={newEmp.clEligibilityDate}
                          onChange={(e) => {
                            const nextElig = e.target.value;
                            const isCustom = Boolean(nextElig && nextElig !== autoClElig);
                            const nextPreview = computeOpeningBalances(
                              newEmp.joiningDate,
                              newEmp.timezone,
                              nextElig,
                              isCustom
                            );
                            setNewEmp((p) => ({
                              ...p,
                              clEligibilityDate: nextElig || autoClElig,
                              clEligibilityCustom: isCustom,
                              ...(leaveManualOverride
                                ? {}
                                : {
                                    casualLeaveBalance: nextPreview.casualLeaveBalance,
                                  }),
                            }));
                          }}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                      </div>
                    </div>

                    <div className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono tabular-nums flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Policy default: SL {preview.policyExpectedSlToDate}d · CL {preview.policyExpectedClToDate}d · CL Eligible:{' '}
                        {newEmp.clEligibilityDate} ({preview.isClEligible ? 'Eligible' : 'Waiting period'})
                      </span>
                      {leaveManualOverride && (
                        <span className="text-zinc-700 dark:text-zinc-300 font-sans">
                          Custom opening balance locked against Sync
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Optional Per-Employee Schedule */}
              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="font-medium">Customize Working Hours &amp; Days for this Employee</span>
                  <input
                    type="checkbox"
                    checked={createCustomSchedule}
                    onChange={(e) => setCreateCustomSchedule(e.target.checked)}
                    className="accent-[#B5121B]"
                  />
                </label>
                {createCustomSchedule && (
                  <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block mb-1">Start Time</label>
                        <input
                          type="time"
                          value={newEmp.officeStartTime}
                          onChange={(e) => setNewEmp((p) => ({ ...p, officeStartTime: e.target.value }))}
                          className="w-full min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block mb-1">End Time</label>
                        <input
                          type="time"
                          value={newEmp.officeEndTime}
                          onChange={(e) => setNewEmp((p) => ({ ...p, officeEndTime: e.target.value }))}
                          className="w-full min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block mb-1">Grace (min)</label>
                        <input
                          type="number"
                          min={0}
                          max={180}
                          value={newEmp.gracePeriodMinutes}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            setNewEmp((p) => ({
                              ...p,
                              gracePeriodMinutes: Number.isFinite(val) ? Math.max(0, Math.min(180, val)) : 0,
                            }));
                          }}
                          className="w-full min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((w) => {
                        const active = newEmp.workingDays.includes(w.day);
                        return (
                          <button
                            type="button"
                            key={w.day}
                            onClick={() =>
                              setNewEmp((p) => ({
                                ...p,
                                workingDays: active
                                  ? p.workingDays.filter((d) => d !== w.day)
                                  : [...p.workingDays, w.day].sort(),
                              }))
                            }
                            className={`px-3 py-1.5 rounded-lg border text-[11px] font-medium ${
                              active
                                ? 'bg-black text-white dark:bg-white dark:text-black border-black dark:border-white'
                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                            }`}
                          >
                            {w.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-medium">Temporary Password</label>
                  <button
                    type="button"
                    onClick={() => setNewEmp((p) => ({ ...p, temporaryPassword: generateTempPassword() }))}
                    className="inline-flex items-center gap-1 text-[#B5121B] dark:text-red-400 font-medium"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Generate
                  </button>
                </div>
                <input
                  type="text"
                  value={newEmp.temporaryPassword}
                  onChange={(e) => setNewEmp((p) => ({ ...p, temporaryPassword: e.target.value }))}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                />
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  The employee can sign in immediately with this assigned password without a forced first-login reset.
                </p>
              </div>
            </div>

            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {creating ? 'Creating Account...' : 'Create Employee'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Employee Profile Inspector Drawer */}
      {selectedEmp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-end">
          <div className="w-full max-w-2xl h-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {photoUrls[selectedEmp.id] ? (
                  <img
                    src={photoUrls[selectedEmp.id]}
                    alt={selectedEmp.fullName}
                    className="w-11 h-11 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-black text-white flex items-center justify-center text-sm font-semibold shrink-0">
                    {getInitials(selectedEmp.fullName)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold truncate">{selectedEmp.fullName}</h3>
                    <CompanyBadge companyId={selectedEmp.companyId} showLegalName />
                  </div>
                  <p className="text-xs text-zinc-500 truncate mt-0.5">
                    {selectedEmp.employeeCode} · {selectedEmp.designation} · {selectedEmp.location || 'India'}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedEmp(null)} className="min-h-[40px] min-w-[40px] flex items-center justify-center text-zinc-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-6 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2 overflow-x-auto">
              {(['profile', 'attendance', 'leave', ...(canViewSalary ? ['payroll'] : [])] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setProfileTab(tab as typeof profileTab)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize whitespace-nowrap ${
                    profileTab === tab
                      ? 'bg-black dark:bg-white text-white dark:text-black'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {profileTab === 'profile' && (
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  {isSuperAdmin && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                      <div>
                        <div className="font-medium">Profile Photograph</div>
                        <div className="text-[11px] text-zinc-500">Stored securely for employee identification</div>
                      </div>
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 cursor-pointer font-medium">
                        <Upload className="w-3.5 h-3.5" />
                        {uploadingPhoto ? 'Uploading...' : 'Change Photo'}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploadingPhoto}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleProfilePhotoUpload(f);
                          }}
                        />
                      </label>
                    </div>
                  )}

                  <div className="grid sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-medium mb-1">Company</label>
                      <select
                        disabled={!isSuperAdmin}
                        value={normalizeCompanyId(editForm.companyId || selectedEmp.companyId)}
                        onChange={(e) => {
                          const nextCo = e.target.value as CompanyId;
                          setEditForm((p) => ({
                            ...p,
                            companyId: nextCo,
                            currency: nextCo === 'mygrade' ? 'INR' : p.currency,
                          }));
                        }}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70 font-medium"
                      >
                        <option value="talentgrade">TalentGrade</option>
                        <option value="mygrade">MyGrade (INR only)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Full Name</label>
                      <input
                        disabled={!isSuperAdmin}
                        value={editForm.fullName || ''}
                        onChange={(e) => setEditForm((p) => ({ ...p, fullName: e.target.value }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Employment Status</label>
                      <select
                        disabled={!isSuperAdmin}
                        value={editForm.status || 'Active'}
                        onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value as EmployeeStatus }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Resigned">Resigned</option>
                        <option value="Terminated">Terminated</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium mb-1">Joining Date</label>
                      <input
                        type="date"
                        disabled={!isSuperAdmin}
                        value={editForm.joiningDate || ''}
                        onChange={(e) => setEditForm((p) => ({ ...p, joiningDate: e.target.value }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70 font-mono"
                      />
                    </div>
                    {isSuperAdmin || selectedEmp.id === employee.id ? (
                      <div>
                        <label className="block font-medium mb-1">
                          Date of Birth <span className="text-[10px] font-normal text-zinc-500">(Year private)</span>
                        </label>
                        <input
                          type="date"
                          disabled={!isSuperAdmin}
                          value={editForm.dateOfBirth || ''}
                          onChange={(e) => setEditForm((p) => ({ ...p, dateOfBirth: e.target.value }))}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70 font-mono"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block font-medium mb-1">Birthday (Month &amp; Day)</label>
                        <div className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 flex items-center text-zinc-600 dark:text-zinc-300">
                          {selectedEmp.birthdayMonthDay
                            ? formatCelebrationMonthDayLabel(selectedEmp.birthdayMonthDay)
                            : 'Not configured'}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="block font-medium mb-1">Phone</label>
                      <input
                        disabled={!isSuperAdmin}
                        value={editForm.phone || ''}
                        onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Emergency Contact</label>
                      <input
                        disabled={!isSuperAdmin}
                        value={editForm.emergencyContact || ''}
                        onChange={(e) => setEditForm((p) => ({ ...p, emergencyContact: e.target.value }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70"
                      />
                    </div>
                  </div>

                  {/* Location, Timezone, Currency */}
                  <div className="grid sm:grid-cols-3 gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                    <div>
                      <label className="block font-medium mb-1">Location</label>
                      <select
                        disabled={!isSuperAdmin}
                        value={editForm.location || 'India'}
                        onChange={(e) => handleEditLocationChange(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 disabled:opacity-70"
                      >
                        {availableLocations.map((loc) => (
                          <option key={loc} value={loc}>
                            {loc}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Timezone</label>
                      <select
                        disabled={!isSuperAdmin}
                        value={editForm.timezone || 'Asia/Kolkata'}
                        onChange={(e) => setEditForm((p) => ({ ...p, timezone: e.target.value }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono disabled:opacity-70"
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Salary Currency</label>
                      <select
                        disabled={!isSuperAdmin}
                        value={normalizeCompanyId(editForm.companyId || selectedEmp.companyId) === 'mygrade' ? 'INR' : editForm.currency || 'INR'}
                        onChange={(e) => setEditForm((p) => ({ ...p, currency: e.target.value }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono disabled:opacity-70"
                      >
                        <option value="INR">INR (₹)</option>
                        <option
                          value="AED"
                          disabled={normalizeCompanyId(editForm.companyId || selectedEmp.companyId) === 'mygrade'}
                        >
                          AED (د.إ)
                          {normalizeCompanyId(editForm.companyId || selectedEmp.companyId) === 'mygrade'
                            ? ' (TalentGrade only)'
                            : ''}
                        </option>
                      </select>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-medium mb-1">Role</label>
                      <select
                        disabled={!isSuperAdmin}
                        value={editForm.role || 'employee'}
                        onChange={(e) => setEditForm((p) => ({ ...p, role: e.target.value as UserRole }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70"
                      >
                        <option value="employee">Employee</option>
                        <option value="team_leader">Team Leader</option>
                        <option value="super_admin">Super Admin</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Department</label>
                      <select
                        disabled={!isSuperAdmin}
                        value={editForm.department || ''}
                        onChange={(e) => setEditForm((p) => ({ ...p, department: e.target.value }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70"
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Designation</label>
                      <input
                        disabled={!isSuperAdmin}
                        value={editForm.designation || ''}
                        onChange={(e) => setEditForm((p) => ({ ...p, designation: e.target.value }))}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-70"
                      />
                    </div>
                  </div>

                  {/* Individual Working Hours Override */}
                  <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-3">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <div className="font-medium">Individual Schedule Override</div>
                        <div className="text-[11px] text-zinc-500">
                          {editCustomSchedule
                            ? 'Using employee-specific shift hours and working days'
                            : `Inherits company defaults (${settings.officeStartTime}–${settings.officeEndTime})`}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={!isSuperAdmin}
                        checked={editCustomSchedule}
                        onChange={(e) => setEditCustomSchedule(e.target.checked)}
                        className="accent-[#B5121B]"
                      />
                    </label>

                    {editCustomSchedule && (
                      <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                          <div>
                            <label className="block mb-1">Start</label>
                            <input
                              type="time"
                              disabled={!isSuperAdmin}
                              value={editForm.officeStartTime || '09:30'}
                              onChange={(e) => setEditForm((p) => ({ ...p, officeStartTime: e.target.value }))}
                              className="w-full min-h-[38px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block mb-1">End</label>
                            <input
                              type="time"
                              disabled={!isSuperAdmin}
                              value={editForm.officeEndTime || '18:30'}
                              onChange={(e) => setEditForm((p) => ({ ...p, officeEndTime: e.target.value }))}
                              className="w-full min-h-[38px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block mb-1">Grace (m)</label>
                            <input
                              type="number"
                              min={0}
                              max={180}
                              disabled={!isSuperAdmin}
                              value={editForm.gracePeriodMinutes ?? 15}
                              onChange={(e) => {
                                const val = e.target.value === '' ? 0 : Number(e.target.value);
                                setEditForm((p) => ({
                                  ...p,
                                  gracePeriodMinutes: Number.isFinite(val) ? Math.max(0, Math.min(180, val)) : 0,
                                }));
                              }}
                              className="w-full min-h-[38px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block mb-1">Half (h)</label>
                            <input
                              type="number"
                              min={0.5}
                              max={16}
                              step="0.5"
                              disabled={!isSuperAdmin}
                              value={editForm.halfDayMinHours ?? 4}
                              onChange={(e) => {
                                const val = e.target.value === '' ? 0 : Number(e.target.value);
                                setEditForm((p) => ({
                                  ...p,
                                  halfDayMinHours: Number.isFinite(val) ? Math.max(0, Math.min(16, val)) : 0,
                                }));
                              }}
                              className="w-full min-h-[38px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block mb-1">Full (h)</label>
                            <input
                              type="number"
                              min={1}
                              max={24}
                              step="0.5"
                              disabled={!isSuperAdmin}
                              value={editForm.fullDayMinHours ?? 8}
                              onChange={(e) => {
                                const val = e.target.value === '' ? 0 : Number(e.target.value);
                                setEditForm((p) => ({
                                  ...p,
                                  fullDayMinHours: Number.isFinite(val) ? Math.max(0, Math.min(24, val)) : 0,
                                }));
                              }}
                              className="w-full min-h-[38px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAYS.map((w) => {
                            const list = editForm.workingDays || settings.workingDays;
                            const active = list.includes(w.day);
                            return (
                              <button
                                type="button"
                                key={w.day}
                                disabled={!isSuperAdmin}
                                onClick={() =>
                                  setEditForm((p) => {
                                    const cur = p.workingDays || settings.workingDays;
                                    return {
                                      ...p,
                                      workingDays: active
                                        ? cur.filter((d) => d !== w.day)
                                        : [...cur, w.day].sort(),
                                    };
                                  })
                                }
                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-medium ${
                                  active
                                    ? 'bg-black text-white dark:bg-white dark:text-black border-black dark:border-white'
                                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                                }`}
                              >
                                {w.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                    <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                      Leave Balance &amp; Eligibility Configuration
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block font-medium mb-1">Sick Leave (SL)</label>
                        <input
                          type="number"
                          step="0.5"
                          min={-60}
                          max={365}
                          disabled={!isSuperAdmin}
                          value={editForm.sickLeaveBalance ?? 0}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            setEditForm((p) => ({
                              ...p,
                              sickLeaveBalance: Number.isFinite(val) ? val : 0,
                            }));
                          }}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Casual Leave (CL)</label>
                        <input
                          type="number"
                          step="0.5"
                          min={-60}
                          max={365}
                          disabled={!isSuperAdmin}
                          value={editForm.casualLeaveBalance ?? 0}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            setEditForm((p) => ({
                              ...p,
                              casualLeaveBalance: Number.isFinite(val) ? val : 0,
                            }));
                          }}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Carry Forward</label>
                        <input
                          type="number"
                          step="0.5"
                          min={0}
                          max={365}
                          disabled={!isSuperAdmin}
                          value={editForm.carryForwardBalance ?? 0}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            setEditForm((p) => ({
                              ...p,
                              carryForwardBalance: Number.isFinite(val) ? Math.max(0, val) : 0,
                            }));
                          }}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">CL Eligibility</label>
                        <input
                          type="date"
                          disabled={!isSuperAdmin}
                          value={editForm.clEligibilityDate || ''}
                          onChange={(e) => {
                            const nextElig = e.target.value;
                            const autoElig = calculateCasualLeaveEligibilityDate(
                              editForm.joiningDate || selectedEmp.joiningDate,
                              normalizeLeavePolicyConfig(settings.leavePolicy).casualLeaveEligibilityMonths
                            );
                            setEditForm((p) => ({
                              ...p,
                              clEligibilityDate: nextElig || autoElig,
                              clEligibilityCustom: Boolean(nextElig && nextElig !== autoElig),
                            }));
                          }}
                          className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const effectiveStatus = editForm.status || selectedEmp.status;
                    const clearance = computeEmployeeAssetClearance(selectedEmp.id, empAssetAssignments);
                    const isExitState =
                      effectiveStatus === 'Resigned' ||
                      effectiveStatus === 'Terminated' ||
                      effectiveStatus === 'Inactive';
                    if (!isExitState && clearance.assignments.length === 0) return null;
                    return (
                      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-950 dark:text-zinc-100">
                            <Laptop className="w-3.5 h-3.5 text-[#B5121B]" />
                            {isExitState ? 'Exit Asset Clearance Checklist' : 'Assigned Company Assets'}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${
                              clearance.clearanceStatus === 'Pending Return'
                                ? 'bg-red-50 text-[#B5121B] border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
                                : clearance.clearanceStatus === 'Cleared'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                            }`}
                          >
                            {clearance.clearanceStatus}
                          </span>
                        </div>
                        {clearance.currentlyAssigned.length > 0 ? (
                          <div className="space-y-1.5">
                            <div className="text-[11px] text-[#B5121B] dark:text-red-400 font-medium">
                              Pending Return ({clearance.currentlyAssigned.length}):
                            </div>
                            {clearance.currentlyAssigned.map((asg) => (
                              <div
                                key={asg.id}
                                className="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 flex items-center justify-between gap-2 text-[11px]"
                              >
                                <span>
                                  <span className="font-mono font-bold">{asg.assetTag}</span> · {asg.assetName} ({asg.assetCategory})
                                </span>
                                <span className="font-mono text-zinc-500">Assigned {asg.assignedDate}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            All assigned company assets have been returned or none assigned.
                          </div>
                        )}
                        {clearance.returned.length > 0 && (
                          <div className="text-[11px] text-zinc-500">
                            Returned ({clearance.returned.length}):{' '}
                            {clearance.returned.map((r) => `${r.assetTag} (${r.returnDate})`).join(', ')}
                          </div>
                        )}
                        {isExitState && (
                          <p className="text-[10px] text-zinc-500">
                            Assigned assets remain linked to this employee until formally processed via Assets → Return / Exit Clearance.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {isSuperAdmin && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleResetPassword(selectedEmp)}
                          className="min-h-[42px] px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-2 font-medium"
                        >
                          <KeyRound className="w-4 h-4" />
                          Send Password Reset
                        </button>
                        {canDeleteEmployee(selectedEmp) && (
                          <button
                            type="button"
                            onClick={() => openDeleteModal(selectedEmp)}
                            className="min-h-[42px] px-4 py-2 rounded-xl border border-red-200 dark:border-red-900/70 text-[#B5121B] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 inline-flex items-center gap-2 font-medium"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete Employee
                          </button>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={savingEdit}
                        className="min-h-[42px] px-5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
                      >
                        {savingEdit ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  )}
                </form>
              )}

              {profileTab === 'attendance' && (
                <div className="space-y-5">
                  <WorkingHoursAnalytics
                    targetEmployee={selectedEmp}
                    attendanceRecords={empAttendance}
                    approvedCorrections={empApprovedCorrections}
                    settings={settings}
                    compact
                  />

                  <div className="space-y-2">
                    <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                      Recent Attendance Logs ({Math.min(20, empAttendance.length)})
                    </div>
                    {empAttendance.length === 0 ? (
                      <p className="text-zinc-500">No recent attendance records found.</p>
                    ) : (
                      empAttendance.slice(0, 20).map((a) => (
                        <div key={a.id} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-mono font-semibold">{a.date}</div>
                            <div className="text-zinc-500 font-mono">
                              {formatTimeDisplay(a.punchInTime, a.timezone || 'Asia/Kolkata')} →{' '}
                              {formatTimeDisplay(a.punchOutTime, a.timezone || 'Asia/Kolkata')} ·{' '}
                              {formatDurationMinutes(a.workingMinutes)}
                            </div>
                          </div>
                          <span className="font-medium">{a.status}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {profileTab === 'leave' && (
                <div className="space-y-4">
                  {(() => {
                    const policy = normalizeLeavePolicyConfig(settings.leavePolicy);
                    const clElig =
                      selectedEmp.clEligibilityDate ||
                      calculateCasualLeaveEligibilityDate(
                        selectedEmp.joiningDate,
                        policy.casualLeaveEligibilityMonths
                      );
                    const empToday = getTodayInTimezone(selectedEmp.timezone || 'Asia/Kolkata');
                    const isEligible = empToday >= clElig;
                    return (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-3 gap-2.5">
                          <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                            <div className="text-[11px] text-zinc-500">Sick Leave</div>
                            <div className="text-lg font-bold font-mono tabular-nums">{selectedEmp.sickLeaveBalance}</div>
                          </div>
                          <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                            <div className="text-[11px] text-zinc-500">Casual Leave</div>
                            <div className="text-lg font-bold font-mono tabular-nums">{selectedEmp.casualLeaveBalance}</div>
                          </div>
                          <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                            <div className="text-[11px] text-zinc-500">Carry Fwd</div>
                            <div className="text-lg font-bold font-mono tabular-nums">{selectedEmp.carryForwardBalance}</div>
                          </div>
                        </div>
                        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-[11px] flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums">
                          <span>Joined: {selectedEmp.joiningDate}</span>
                          <span>
                            CL Eligibility: {clElig} ({isEligible ? 'Eligible' : 'Waiting'})
                          </span>
                        </div>
                        {selectedEmp.leaveMigrationNote && (
                          <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-[11px]">
                            {selectedEmp.leaveMigrationNote}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {isSuperAdmin && (
                    <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 space-y-2.5">
                      <div className="flex items-center gap-1.5 font-semibold text-zinc-950 dark:text-zinc-100">
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        Manual Leave Balance Adjustment (Audit Logged)
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          value={quickAdjType}
                          onChange={(e) => setQuickAdjType(e.target.value as 'SL' | 'CL')}
                          className="min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                        >
                          <option value="SL">Sick Leave (SL)</option>
                          <option value="CL">Casual Leave (CL)</option>
                        </select>
                        <input
                          type="number"
                          step="0.5"
                          value={quickAdjDelta}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            setQuickAdjDelta(Number.isFinite(val) ? val : 0);
                          }}
                          placeholder="Delta (+/-)"
                          className="min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                        />
                        <div className="min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between font-mono tabular-nums">
                          <span className="text-zinc-500">New:</span>
                          <span className="font-semibold">
                            {round2(
                              (quickAdjType === 'SL'
                                ? selectedEmp.sickLeaveBalance
                                : selectedEmp.casualLeaveBalance) + quickAdjDelta
                            )}
                            d
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={quickAdjReason}
                          onChange={(e) => setQuickAdjReason(e.target.value)}
                          placeholder="Mandatory reason for adjustment..."
                          className="flex-1 min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                        />
                        <button
                          type="button"
                          disabled={quickAdjSaving || !quickAdjReason.trim() || quickAdjDelta === 0}
                          onClick={async () => {
                            if (!selectedEmp) return;
                            setQuickAdjSaving(true);
                            try {
                              await adjustEmployeeLeaveBalance({
                                targetEmployee: selectedEmp,
                                leaveType: quickAdjType,
                                delta: quickAdjDelta,
                                reason: quickAdjReason,
                                actor: employee,
                              });
                              const nextBal = round2(
                                (quickAdjType === 'SL'
                                  ? selectedEmp.sickLeaveBalance
                                  : selectedEmp.casualLeaveBalance) + quickAdjDelta
                              );
                              setSelectedEmp((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      ...(quickAdjType === 'SL'
                                        ? { sickLeaveBalance: nextBal }
                                        : { casualLeaveBalance: nextBal }),
                                    }
                                  : null
                              );
                              setEditForm((prev) => ({
                                ...prev,
                                ...(quickAdjType === 'SL'
                                  ? { sickLeaveBalance: nextBal }
                                  : { casualLeaveBalance: nextBal }),
                              }));
                              setQuickAdjReason('');
                              await loadData();
                              const updatedLedger = await fetchLeaveLedger(employee);
                              setEmpLedger(updatedLedger.filter((x) => x.employeeId === selectedEmp.id));
                              if (selectedEmp.id === employee.id) await refreshSession();
                              showToast(`Adjusted ${quickAdjType} balance for ${selectedEmp.fullName}.`, 'success');
                            } catch (err: unknown) {
                              showToast(err instanceof Error ? err.message : 'Adjustment failed', 'error');
                            } finally {
                              setQuickAdjSaving(false);
                            }
                          }}
                          className="min-h-[38px] px-4 rounded-lg bg-black dark:bg-white text-white dark:text-black font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          {quickAdjSaving ? 'Saving...' : 'Apply'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="font-semibold text-zinc-950 dark:text-zinc-100">Accrual &amp; Adjustment Ledger</div>
                    {empLedger.length === 0 ? (
                      <p className="text-zinc-500">No accrual ledger entries yet. Open Leave Management to sync policy accruals.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {empLedger.map((entry) => (
                          <div key={entry.id} className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium truncate">
                                <span className="font-mono">{entry.month}</span> · {entry.leaveType} · {entry.entryType.replace(/_/g, ' ')}
                              </div>
                              <div className="text-[11px] text-zinc-500 truncate">
                                {entry.reason} · By {entry.createdByName}
                              </div>
                            </div>
                            <div className="text-right font-mono tabular-nums shrink-0">
                              <div className={entry.amount >= 0 ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-[#B5121B] dark:text-red-400 font-semibold'}>
                                {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                              </div>
                              {typeof entry.balanceAfter === 'number' && (
                                <div className="text-[10px] text-zinc-500">
                                  {typeof entry.balanceBefore === 'number'
                                    ? `${entry.balanceBefore} → ${entry.balanceAfter}`
                                    : `Bal: ${entry.balanceAfter}`}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold text-zinc-950 dark:text-zinc-100">Leave Applications</div>
                    {empLeaves.length === 0 ? (
                      <p className="text-zinc-500">No leave applications for this employee.</p>
                    ) : (
                      empLeaves.map((l) => (
                        <div key={l.id} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                          <div>
                            <div className="font-semibold">
                              {l.leaveType} · {l.startDate} to {l.endDate} ({l.days}d)
                            </div>
                            <div className="text-zinc-500">{l.reason}</div>
                          </div>
                          <span className="font-medium">{l.status}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {profileTab === 'payroll' && canViewSalary && (
                <form onSubmit={handleSaveQuickSalary} className="space-y-4">
                  <div>
                    <label className="block font-medium mb-1">Salary Currency</label>
                    <select
                      disabled={!isSuperAdmin}
                      value={normalizeCompanyId(selectedEmp.companyId) === 'mygrade' ? 'INR' : salaryForm.currency}
                      onChange={(e) => setSalaryForm((s) => ({ ...s, currency: e.target.value }))}
                      className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="AED" disabled={normalizeCompanyId(selectedEmp.companyId) === 'mygrade'}>
                        AED (د.إ)
                        {normalizeCompanyId(selectedEmp.companyId) === 'mygrade' ? ' (TalentGrade only)' : ''}
                      </option>
                    </select>
                    {normalizeCompanyId(selectedEmp.companyId) === 'mygrade' && (
                      <div className="text-[10px] text-[#B5121B] dark:text-red-400 mt-1">
                        MyGrade employees support INR only
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium mb-1">Basic Salary</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!isSuperAdmin}
                        value={salaryForm.basicSalary}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          setSalaryForm((s) => ({
                            ...s,
                            basicSalary: Number.isFinite(val) ? Math.max(0, val) : 0,
                          }));
                        }}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">HRA</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!isSuperAdmin}
                        value={salaryForm.hra}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          setSalaryForm((s) => ({
                            ...s,
                            hra: Number.isFinite(val) ? Math.max(0, val) : 0,
                          }));
                        }}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Default Bonus</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!isSuperAdmin}
                        value={salaryForm.defaultBonus}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          setSalaryForm((s) => ({
                            ...s,
                            defaultBonus: Number.isFinite(val) ? Math.max(0, val) : 0,
                          }));
                        }}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Professional Tax / Deductions</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!isSuperAdmin}
                        value={salaryForm.professionalTax}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          setSalaryForm((s) => ({
                            ...s,
                            professionalTax: Number.isFinite(val) ? Math.max(0, val) : 0,
                          }));
                        }}
                        className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                      />
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <span>Estimated Net Salary</span>
                    <span className="font-bold font-mono text-sm">
                      {formatMoney(
                        salaryForm.basicSalary + salaryForm.hra + salaryForm.defaultBonus - salaryForm.professionalTax,
                        salaryForm.currency
                      )}
                    </span>
                  </div>
                  {isSuperAdmin && (
                    <button
                      type="submit"
                      className="min-h-[42px] px-5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
                    >
                      Save Salary Configuration
                    </button>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Employee Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-employee-title"
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-[#B5121B] dark:text-red-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 id="delete-employee-title" className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                  Delete Employee Account
                </h3>
              </div>
              <button
                type="button"
                disabled={deletingEmp}
                onClick={() => setDeleteTarget(null)}
                className="text-zinc-500 p-1 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-1">
                <div className="font-semibold text-sm text-zinc-950 dark:text-zinc-100">{deleteTarget.fullName}</div>
                <div className="text-zinc-500">
                  {deleteTarget.employeeCode} · {deleteTarget.email}
                </div>
                <div className="text-zinc-500">
                  {deleteTarget.department} · {deleteTarget.designation}
                </div>
              </div>

              <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
                This permanently removes the employee from the directory, revokes portal login access and role permissions, and deletes their salary configuration and celebration profile.
              </p>

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-red-200/80 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteRelatedRecords}
                  disabled={deletingEmp}
                  onChange={(e) => setDeleteRelatedRecords(e.target.checked)}
                  className="mt-0.5 accent-[#B5121B]"
                />
                <span className="text-zinc-700 dark:text-zinc-200 leading-relaxed">
                  Also permanently delete all attendance records, selfies, correction requests, leave applications, and payroll records for this employee.
                </span>
              </label>

              <p className="text-[11px] text-zinc-500">
                Tip: If this employee left the company and you want to retain their profile for reporting, mark their status as Resigned or Inactive instead.
              </p>
            </div>

            <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={deletingEmp}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingEmp}
                onClick={handleConfirmDeleteEmployee}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletingEmp ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

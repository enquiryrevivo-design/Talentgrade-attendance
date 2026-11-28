import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  MapPin,
  LogIn,
  LogOut,
  FileEdit,
  Trash2,
  Check,
  X,
  ExternalLink,
  Calendar as CalendarIcon,
  List as ListIcon,
  Paperclip,
  Clock,
  Filter,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useHrNotifications } from '../context/HrNotificationContext';
import { useToast } from '../components/Toast';
import { CameraCaptureModal } from '../components/CameraCaptureModal';
import { SmartAttendanceRemindersCard } from '../components/SmartAttendanceRemindersCard';
import { WorkingHoursAnalytics } from '../components/WorkingHoursAnalytics';
import {
  AppPage,
  AttendanceCorrection,
  AttendancePhoto,
  AttendanceRecord,
  AttendanceStatus,
  Employee,
  REGULARIZATION_REQUEST_TYPES,
  REGULARIZATION_TYPE_LABELS,
  RegularizationRequestType,
} from '../types/hr';
import {
  deleteAttendancePhoto,
  editAttendanceDirectly,
  fetchAllEmployees,
  fetchAttendancePhoto,
  fetchAttendanceRecords,
  fetchLeaveApplications,
  fetchMediaAsset,
  formatDurationMinutes,
  formatTimeDisplay,
  getEffectiveSchedule,
  getTodayInTimezone,
  punchIn,
  punchOut,
  uploadMediaAsset,
} from '../lib/hrService';
import { syncReminderSnapshotToServer } from '../lib/pushService';
import {
  fetchAttendanceRegularizations,
  reviewAttendanceRegularization,
  submitAttendanceRegularization,
} from '../lib/regularizationService';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 500 * 1024) {
      reject(new Error('Attachment must be under 500 KB.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read attachment file.'));
    reader.readAsDataURL(file);
  });
}

function toHHmmInTimezone(iso: string | undefined, timezone: string, fallback: string): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).format(d);
  } catch {
    return fallback;
  }
}

function getYesterdayDateStr(todayStr: string): string {
  const [y, m, d] = todayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function formatSubmissionTimestamp(ts: unknown, isoFallback?: string, timezone = 'Asia/Kolkata'): string {
  let dt: Date | null = null;
  if (isoFallback) {
    const parsed = new Date(isoFallback);
    if (!Number.isNaN(parsed.getTime())) dt = parsed;
  }
  if (!dt && ts && typeof ts === 'object') {
    const maybe = ts as { toDate?: () => Date; seconds?: number };
    if (typeof maybe.toDate === 'function') dt = maybe.toDate();
    else if (typeof maybe.seconds === 'number') dt = new Date(maybe.seconds * 1000);
  }
  if (!dt && typeof ts === 'string') {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) dt = parsed;
  }
  if (!dt) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dt);
  } catch {
    return dt.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function AttendanceView({ onNavigate }: { onNavigate?: (page: AppPage) => void }) {
  const { employee, settings } = useAuth();
  const { refreshRegularizationState } = useHrNotifications();
  const { showToast } = useToast();

  const mySchedule = useMemo(() => {
    if (!employee || !settings) return null;
    return getEffectiveSchedule(employee, settings);
  }, [employee, settings]);

  const todayStr = useMemo(
    () => getTodayInTimezone(mySchedule?.timezone || 'Asia/Kolkata'),
    [mySchedule?.timezone]
  );
  const yesterdayStr = useMemo(() => getYesterdayDateStr(todayStr), [todayStr]);

  const [selectedMonth, setSelectedMonth] = useState(todayStr.slice(0, 7));
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'analytics'>('list');
  const [selectedEmpFilter, setSelectedEmpFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [regularizations, setRegularizations] = useState<AttendanceCorrection[]>([]);
  const [loading, setLoading] = useState(true);

  const [punchModal, setPunchModal] = useState<'in' | 'out' | null>(null);
  const [photoModal, setPhotoModal] = useState<{
    record: AttendanceRecord;
    inPhoto?: AttendancePhoto | null;
    outPhoto?: AttendancePhoto | null;
  } | null>(null);
  const [mapModal, setMapModal] = useState<{
    label: string;
    lat: number;
    lng: number;
    accuracy?: number;
  } | null>(null);

  // Regularization Request Form state
  const [regModalOpen, setRegModalOpen] = useState(false);
  const [regDate, setRegDate] = useState(yesterdayStr);
  const [regType, setRegType] = useState<RegularizationRequestType>('missed_punch_in');
  const [regIn, setRegIn] = useState(mySchedule?.officeStartTime || '09:30');
  const [regOut, setRegOut] = useState('');
  const [regReason, setRegReason] = useState('');
  const [regFile, setRegFile] = useState<File | null>(null);
  const [submittingReg, setSubmittingReg] = useState(false);

  // Admin / Super Admin Regularization Queue Filters & Review state
  const [queueStatusFilter, setQueueStatusFilter] = useState<'Pending' | 'Approved' | 'Rejected' | 'All'>('Pending');
  const [queueEmpFilter, setQueueEmpFilter] = useState<string>('all');
  const [queueDeptFilter, setQueueDeptFilter] = useState<string>('all');
  const [queueDateFilter, setQueueDateFilter] = useState<string>('');
  const [reviewComment, setReviewComment] = useState<Record<string, string>>({});
  const [processingRegId, setProcessingRegId] = useState<string | null>(null);

  const [editModal, setEditModal] = useState<{
    targetEmp: Employee;
    date: string;
    punchInHHmm: string;
    punchOutHHmm: string;
    status: AttendanceStatus;
    notes: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const canApproveCorrections = Boolean(
    employee &&
      settings &&
      (employee.role === 'super_admin' ||
        (employee.role === 'team_leader' && settings.teamLeaderPermissions.canApproveCorrections))
  );

  const loadAll = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const canViewAll = settings?.teamLeaderPermissions?.canViewAllEmployees ?? true;
      const [recList, regList, empList, leaveList] = await Promise.all([
        fetchAttendanceRecords(employee, undefined, canViewAll),
        fetchAttendanceRegularizations(employee, canApproveCorrections),
        employee.role === 'employee'
          ? Promise.resolve([employee])
          : fetchAllEmployees(employee, canViewAll),
        fetchLeaveApplications(employee),
      ]);
      setRecords(recList);
      setRegularizations(regList);
      setEmployees(empList);
      void syncReminderSnapshotToServer({
        employee,
        settings,
        employees: empList,
        attendanceRecords: recList,
        approvedLeaves: leaveList,
      }).catch(() => {});
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load attendance data', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, settings, canApproveCorrections, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openRegularizationModal = () => {
    const defaultDate = yesterdayStr;
    setRegDate(defaultDate);
    setRegType('missed_punch_in');
    const existing = records.find((r) => r.employeeId === employee?.id && r.date === defaultDate);
    const tz = existing?.timezone || mySchedule?.timezone || 'Asia/Kolkata';
    setRegIn(
      existing?.punchInTime
        ? toHHmmInTimezone(existing.punchInTime, tz, mySchedule?.officeStartTime || '09:30')
        : mySchedule?.officeStartTime || '09:30'
    );
    setRegOut(
      existing?.punchOutTime ? toHHmmInTimezone(existing.punchOutTime, tz, '') : ''
    );
    setRegReason('');
    setRegFile(null);
    setRegModalOpen(true);
  };

  const handleRegDateOrTypeChange = (nextDate: string, nextType: RegularizationRequestType) => {
    setRegDate(nextDate);
    setRegType(nextType);
    const existing = records.find((r) => r.employeeId === employee?.id && r.date === nextDate);
    const tz = existing?.timezone || mySchedule?.timezone || 'Asia/Kolkata';
    const existingIn = existing?.punchInTime ? toHHmmInTimezone(existing.punchInTime, tz, '') : '';
    const existingOut = existing?.punchOutTime ? toHHmmInTimezone(existing.punchOutTime, tz, '') : '';

    if (nextType === 'missed_punch_in') {
      setRegIn(existingIn || mySchedule?.officeStartTime || '09:30');
      setRegOut(existingOut);
    } else if (nextType === 'missed_punch_out') {
      setRegIn(existingIn);
      setRegOut(existingOut || mySchedule?.officeEndTime || '18:30');
    } else if (nextType === 'both_missed') {
      setRegIn(existingIn || mySchedule?.officeStartTime || '09:30');
      setRegOut(existingOut || mySchedule?.officeEndTime || '18:30');
    } else {
      setRegIn(existingIn || mySchedule?.officeStartTime || '09:30');
      setRegOut(existingOut || mySchedule?.officeEndTime || '18:30');
    }
  };

  if (!employee || !settings || !mySchedule) return null;

  const isPrivileged = employee.role === 'super_admin' || employee.role === 'team_leader';
  const canEditAttendance =
    employee.role === 'super_admin' ||
    (employee.role === 'team_leader' && settings.teamLeaderPermissions.canEditAttendance);

  const myTodayRecord = records.find((r) => r.employeeId === employee.id && r.date === todayStr);
  const selectedDateExistingRecord = records.find(
    (r) => r.employeeId === employee.id && r.date === regDate
  );

  const filteredRecords = records.filter((r) => {
    if (!r.date.startsWith(selectedMonth)) return false;
    if (selectedEmpFilter !== 'all' && r.employeeId !== selectedEmpFilter) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  const handlePunchConfirm = async (payload: {
    photoDataUrl: string;
    lat: number;
    lng: number;
    accuracy: number;
  }) => {
    if (punchModal === 'in') {
      await punchIn({ employee, settings, ...payload });
      showToast('Punch-in recorded successfully.', 'success');
    } else if (punchModal === 'out' && myTodayRecord) {
      await punchOut({ employee, settings, recordId: myTodayRecord.id, ...payload });
      showToast('Punch-out recorded successfully.', 'success');
    }
    await loadAll();
  };

  const openPhotoInspector = async (rec: AttendanceRecord) => {
    try {
      const [inPhoto, outPhoto] = await Promise.all([
        rec.punchInPhotoId ? fetchAttendancePhoto(rec.punchInPhotoId) : Promise.resolve(null),
        rec.punchOutPhotoId ? fetchAttendancePhoto(rec.punchOutPhotoId) : Promise.resolve(null),
      ]);
      setPhotoModal({ record: rec, inPhoto, outPhoto });
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to fetch attendance photos', 'error');
    }
  };

  const handleDeletePhoto = async (photoId: string, which: 'in' | 'out') => {
    if (!photoModal) return;
    try {
      await deleteAttendancePhoto(photoId, employee);
      showToast('Attendance photo permanently deleted.', 'success');
      setPhotoModal((prev) =>
        prev
          ? {
              ...prev,
              inPhoto: which === 'in' ? null : prev.inPhoto,
              outPhoto: which === 'out' ? null : prev.outPhoto,
            }
          : null
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete photo', 'error');
    }
  };

  const handleRegularizationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regReason.trim()) return;
    setSubmittingReg(true);
    try {
      let attachmentAssetId: string | undefined;
      if (regFile) {
        const dataUrl = await readFileAsDataUrl(regFile);
        attachmentAssetId = await uploadMediaAsset({
          ownerUid: employee.uid,
          assetType: 'attachment',
          fileName: regFile.name,
          mimeType: regFile.type || 'application/octet-stream',
          dataUrl,
        });
      }
      await submitAttendanceRegularization({
        employee,
        settings,
        date: regDate,
        requestType: regType,
        requestedPunchIn: regIn,
        requestedPunchOut: regOut,
        reason: regReason,
        attachmentAssetId,
      });
      showToast('Attendance Regularization request submitted and queued for approval.', 'success');
      setRegModalOpen(false);
      setRegReason('');
      setRegFile(null);
      await Promise.all([loadAll(), refreshRegularizationState()]);
    } catch (err: unknown) {
      showToast(
        err instanceof Error ? err.message : 'Could not submit attendance regularization request',
        'error'
      );
    } finally {
      setSubmittingReg(false);
    }
  };

  const handleReviewRegularization = async (
    reqItem: AttendanceCorrection,
    decision: 'Approved' | 'Rejected'
  ) => {
    if (processingRegId) return;
    setProcessingRegId(reqItem.id);
    try {
      await reviewAttendanceRegularization({
        request: reqItem,
        decision,
        comment: reviewComment[reqItem.id] || '',
        actor: employee,
        settings,
      });
      showToast(
        `Attendance Regularization request ${decision.toLowerCase()}.`,
        'success'
      );
      await Promise.all([loadAll(), refreshRegularizationState()]);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Review action failed', 'error');
    } finally {
      setProcessingRegId(null);
    }
  };

  const handleDirectEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setSavingEdit(true);
    try {
      await editAttendanceDirectly({
        employee: editModal.targetEmp,
        date: editModal.date,
        punchInHHmm: editModal.punchInHHmm,
        punchOutHHmm: editModal.punchOutHHmm,
        status: editModal.status,
        notes: editModal.notes,
        actor: employee,
      });
      showToast('Attendance record updated and logged in audit trail.', 'success');
      setEditModal(null);
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update attendance', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const openAttachment = async (assetId: string) => {
    const asset = await fetchMediaAsset(assetId);
    if (!asset) {
      showToast('Attachment not found', 'error');
      return;
    }
    const link = document.createElement('a');
    link.href = asset.dataUrl;
    link.download = asset.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Approval Queue derived datasets & filters
  const queueDepartments = Array.from(
    new Set(regularizations.map((r) => r.department).filter(Boolean))
  ).sort();
  const queueEmployeesMap = new Map<string, { id: string; name: string; code?: string }>();
  for (const emp of employees) {
    queueEmployeesMap.set(emp.id, { id: emp.id, name: emp.fullName, code: emp.employeeCode });
  }
  for (const r of regularizations) {
    if (!queueEmployeesMap.has(r.employeeId)) {
      queueEmployeesMap.set(r.employeeId, {
        id: r.employeeId,
        name: r.employeeName,
        code: r.employeeCode,
      });
    }
  }
  const queueEmployeeOptions = Array.from(queueEmployeesMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const filteredQueueRegularizations = regularizations.filter((r) => {
    if (queueStatusFilter !== 'All' && r.status !== queueStatusFilter) return false;
    if (queueEmpFilter !== 'all' && r.employeeId !== queueEmpFilter) return false;
    if (queueDeptFilter !== 'all' && r.department !== queueDeptFilter) return false;
    if (queueDateFilter && r.date !== queueDateFilter) return false;
    return true;
  });

  const pendingQueueCount = regularizations.filter((r) => r.status === 'Pending').length;
  const myRegularizationHistory = regularizations.filter((r) => r.employeeUid === employee.uid);

  const [yr, mo] = selectedMonth.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const firstDayOffset = new Date(yr, mo - 1, 1).getDay();
  const calendarTargetEmpId = selectedEmpFilter !== 'all' ? selectedEmpFilter : employee.id;
  const calendarTargetEmp = employees.find((e) => e.id === calendarTargetEmpId) || employee;
  const calendarTargetSchedule = getEffectiveSchedule(calendarTargetEmp, settings);

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-zinc-950 dark:text-zinc-100">
            Attendance &amp; Time Logs
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Live selfie &amp; GPS required from any location · Your schedule {mySchedule.officeStartTime}–{mySchedule.officeEndTime} ({mySchedule.timezone})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={openRegularizationModal}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium hover:border-[#B5121B] hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <FileEdit className="w-4 h-4 text-[#B5121B]" />
            Request Attendance Regularization
          </button>
          <button
            type="button"
            disabled={Boolean(myTodayRecord?.punchInTime)}
            onClick={() => setPunchModal('in')}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-40"
          >
            <LogIn className="w-4 h-4" />
            {myTodayRecord?.punchInTime ? 'Punched In' : 'Punch In'}
          </button>
          <button
            type="button"
            disabled={!myTodayRecord?.punchInTime || Boolean(myTodayRecord?.punchOutTime)}
            onClick={() => setPunchModal('out')}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-black dark:bg-white text-white dark:text-black text-xs font-semibold disabled:opacity-35"
          >
            <LogOut className="w-4 h-4" />
            {myTodayRecord?.punchOutTime ? 'Punched Out' : 'Punch Out'}
          </button>
        </div>
      </div>

      {/* Smart Attendance Reminders Quick Setup & Status */}
      <SmartAttendanceRemindersCard
        compact
        onOpenSettings={onNavigate ? () => onNavigate('settings') : undefined}
      />

      {/* Filters & View Mode Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="sr-only">Month</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs font-mono"
            />
          </div>

          {isPrivileged && (
            <select
              value={selectedEmpFilter}
              onChange={(e) => setSelectedEmpFilter(e.target.value)}
              className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
            >
              <option value="all">All Employees ({employees.length})</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} ({emp.employeeCode})
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="Present">Present</option>
            <option value="Late">Late</option>
            <option value="Half Day">Half Day</option>
            <option value="Leave">Leave</option>
            <option value="Incomplete Attendance">Incomplete Attendance</option>
          </select>
        </div>

        <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
              viewMode === 'list'
                ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            Records
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
              viewMode === 'calendar'
                ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setViewMode('analytics')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
              viewMode === 'analytics'
                ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Working Hours
          </button>
        </div>
      </div>

      {/* Working Hours Graph View */}
      {viewMode === 'analytics' && (
        <WorkingHoursAnalytics
          targetEmployee={calendarTargetEmp}
          attendanceRecords={records.filter((r) => r.employeeId === calendarTargetEmpId)}
          approvedCorrections={regularizations.filter(
            (c) => c.employeeId === calendarTargetEmpId && c.status === 'Approved'
          )}
          settings={settings}
        />
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold">
              Monthly Attendance Calendar — {calendarTargetEmp.fullName} ({calendarTargetSchedule.timezone})
            </h2>
            {canEditAttendance && (
              <span className="text-xs text-zinc-500">Click any date to edit attendance</span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-zinc-500">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: firstDayOffset }).map((_, i) => (
              <div key={`pad_${i}`} className="h-16 rounded-xl bg-zinc-50/40 dark:bg-zinc-950/30" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const day = idx + 1;
              const dateKey = `${selectedMonth}-${String(day).padStart(2, '0')}`;
              const rec = records.find((r) => r.employeeId === calendarTargetEmpId && r.date === dateKey);
              const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
              const isWeeklyOff = !calendarTargetSchedule.workingDays.includes(dow);

              return (
                <button
                  type="button"
                  key={dateKey}
                  disabled={!canEditAttendance}
                  onClick={() => {
                    if (!canEditAttendance) return;
                    setEditModal({
                      targetEmp: calendarTargetEmp,
                      date: dateKey,
                      punchInHHmm: toHHmmInTimezone(
                        rec?.punchInTime,
                        rec?.timezone || calendarTargetSchedule.timezone,
                        calendarTargetSchedule.officeStartTime
                      ),
                      punchOutHHmm: toHHmmInTimezone(
                        rec?.punchOutTime,
                        rec?.timezone || calendarTargetSchedule.timezone,
                        calendarTargetSchedule.officeEndTime
                      ),
                      status: rec?.status || 'Present',
                      notes: rec?.notes || '',
                    });
                  }}
                  className={`h-16 rounded-xl border p-1.5 flex flex-col justify-between text-left transition-colors ${
                    rec?.status === 'Present'
                      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30'
                      : rec?.status === 'Late'
                      ? 'border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30'
                      : rec?.status === 'Half Day'
                      ? 'border-orange-200 dark:border-orange-900 bg-orange-50/60 dark:bg-orange-950/30'
                      : rec?.status === 'Leave'
                      ? 'border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                  } ${canEditAttendance ? 'hover:border-[#B5121B] cursor-pointer' : 'cursor-default'}`}
                >
                  <span className="text-xs font-semibold tabular-nums">{day}</span>
                  <span className="text-[10px] truncate text-zinc-600 dark:text-zinc-300">
                    {rec ? rec.status : isWeeklyOff ? 'Weekly Off' : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Attendance Table */}
      {viewMode === 'list' && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              <div className="h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
              <div className="h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-medium text-zinc-950 dark:text-zinc-100">No attendance records found</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Punch in or adjust your month/employee filters to view records.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400">
                    <th className="py-3 px-4 font-medium">Date</th>
                    {isPrivileged && <th className="py-3 px-4 font-medium">Employee</th>}
                    <th className="py-3 px-4 font-medium">Punch In</th>
                    <th className="py-3 px-4 font-medium">Punch Out</th>
                    <th className="py-3 px-4 font-medium text-right">Duration</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Evidence &amp; Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredRecords.map((rec) => {
                    const targetEmp = employees.find((e) => e.id === rec.employeeId) || employee;
                    const targetSchedule = getEffectiveSchedule(targetEmp, settings);
                    const recTz = rec.timezone || targetSchedule.timezone;
                    return (
                      <tr key={rec.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">{rec.date}</td>
                        {isPrivileged && (
                          <td className="py-3 px-4">
                            <div className="font-medium text-zinc-950 dark:text-zinc-100">{rec.employeeName}</div>
                            <div className="text-[11px] text-zinc-500">
                              {rec.department} · {targetSchedule.location}
                            </div>
                          </td>
                        )}
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          {formatTimeDisplay(rec.punchInTime, recTz)}
                          {rec.isLate && (
                            <span className="ml-1.5 text-[11px] text-[#B5121B] dark:text-red-400">
                              (+{rec.lateByMinutes}m)
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          {formatTimeDisplay(rec.punchOutTime, recTz)}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-right whitespace-nowrap">
                          {rec.workingMinutes ? formatDurationMinutes(rec.workingMinutes) : '—'}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-medium">
                          <span
                            className={
                              rec.status === 'Present'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : rec.status === 'Late'
                                ? 'text-[#B5121B] dark:text-red-400'
                                : rec.status === 'Leave'
                                ? 'text-sky-700 dark:text-sky-400'
                                : 'text-zinc-700 dark:text-zinc-300'
                            }
                          >
                            {rec.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {(rec.punchInPhotoId || rec.punchOutPhotoId) && (
                              <button
                                type="button"
                                onClick={() => openPhotoInspector(rec)}
                                title="View Selfie Photos"
                                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Camera className="w-3.5 h-3.5" />
                                Photos
                              </button>
                            )}
                            {typeof rec.punchInLat === 'number' && typeof rec.punchInLng === 'number' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setMapModal({
                                    label: `${rec.employeeName} — Punch In (${rec.date})`,
                                    lat: rec.punchInLat!,
                                    lng: rec.punchInLng!,
                                    accuracy: rec.punchInAccuracy,
                                  })
                                }
                                title="View GPS Location"
                                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                GPS
                              </button>
                            )}
                            {canEditAttendance && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditModal({
                                    targetEmp,
                                    date: rec.date,
                                    punchInHHmm: toHHmmInTimezone(rec.punchInTime, recTz, targetSchedule.officeStartTime),
                                    punchOutHHmm: toHHmmInTimezone(rec.punchOutTime, recTz, targetSchedule.officeEndTime),
                                    status: rec.status,
                                    notes: rec.notes || '',
                                  })
                                }
                                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <FileEdit className="w-3.5 h-3.5" />
                                Edit
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
      )}

      {/* ADMIN / SUPER ADMIN ATTENDANCE REGULARIZATION APPROVAL QUEUE */}
      {canApproveCorrections && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-display font-semibold text-zinc-950 dark:text-zinc-100">
                Attendance Regularization Approval Queue
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {pendingQueueCount} pending · {regularizations.length} total regularization requests
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs">
              {(['Pending', 'Approved', 'Rejected', 'All'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setQueueStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    queueStatusFilter === st
                      ? 'bg-zinc-950 text-white dark:bg-white dark:text-black'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
                  }`}
                >
                  {st}
                  {st === 'Pending' && pendingQueueCount > 0 ? ` (${pendingQueueCount})` : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Filter Strip: Employee, Department, Date */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 mr-1">
              <Filter className="w-3.5 h-3.5" />
              Filters:
            </span>
            <select
              value={queueEmpFilter}
              onChange={(e) => setQueueEmpFilter(e.target.value)}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
            >
              <option value="all">All Employees</option>
              {queueEmployeeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                  {opt.code ? ` (${opt.code})` : ''}
                </option>
              ))}
            </select>

            <select
              value={queueDeptFilter}
              onChange={(e) => setQueueDeptFilter(e.target.value)}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
            >
              <option value="all">All Departments</option>
              {queueDepartments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={queueDateFilter}
              onChange={(e) => setQueueDateFilter(e.target.value)}
              aria-label="Filter regularization queue by attendance date"
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs font-mono"
            />

            {(queueEmpFilter !== 'all' || queueDeptFilter !== 'all' || queueDateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setQueueEmpFilter('all');
                  setQueueDeptFilter('all');
                  setQueueDateFilter('');
                }}
                className="text-xs font-medium text-[#B5121B] dark:text-red-400 hover:underline px-2"
              >
                Reset filters
              </button>
            )}
          </div>

          {filteredQueueRegularizations.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
              No attendance regularization requests match the selected filters.
            </div>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredQueueRegularizations.map((reqItem) => {
                const matchedEmp = employees.find((e) => e.id === reqItem.employeeId);
                const empCode = reqItem.employeeCode || matchedEmp?.employeeCode || reqItem.employeeId;
                const tz = reqItem.timezone || matchedEmp?.timezone || 'Asia/Kolkata';
                const liveRecord = records.find(
                  (r) => r.employeeId === reqItem.employeeId && r.date === reqItem.date
                );
                const origInIso = reqItem.originalPunchInTime ?? liveRecord?.punchInTime;
                const origOutIso = reqItem.originalPunchOutTime ?? liveRecord?.punchOutTime;
                const typeLabel = reqItem.requestType
                  ? REGULARIZATION_TYPE_LABELS[reqItem.requestType]
                  : 'Attendance Regularization';
                const isSelfRequest =
                  employee.role !== 'super_admin' && reqItem.employeeUid === employee.uid;
                const isProcessing = processingRegId === reqItem.id;

                return (
                  <div key={reqItem.id} className="py-4 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                            {reqItem.employeeName}
                          </span>
                          <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                            {empCode}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {reqItem.department}
                          </span>
                          <span className="text-xs font-semibold text-[#B5121B] dark:text-red-400">
                            {typeLabel}
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              reqItem.status === 'Approved'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : reqItem.status === 'Rejected'
                                ? 'text-[#B5121B] dark:text-red-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {reqItem.status}
                          </span>
                        </div>

                        <div className="grid sm:grid-cols-3 gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 text-xs">
                          <div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              Attendance Date &amp; Submitted
                            </div>
                            <div className="font-mono font-semibold text-zinc-950 dark:text-zinc-100 mt-0.5">
                              {reqItem.date}
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                              Submitted {formatSubmissionTimestamp(reqItem.createdAt, reqItem.submittedAtIso, tz)}
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              Original Recorded Punches
                            </div>
                            <div className="font-mono tabular-nums mt-0.5 text-zinc-800 dark:text-zinc-200">
                              In: {origInIso ? formatTimeDisplay(origInIso, tz) : 'Not recorded'}
                            </div>
                            <div className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
                              Out: {origOutIso ? formatTimeDisplay(origOutIso, tz) : 'Not recorded'}
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              Requested Punches ({tz})
                            </div>
                            <div className="font-mono tabular-nums font-semibold mt-0.5 text-zinc-950 dark:text-zinc-100">
                              In: {reqItem.requestedPunchIn || 'Keep existing'}
                            </div>
                            <div className="font-mono tabular-nums font-semibold text-zinc-950 dark:text-zinc-100">
                              Out: {reqItem.requestedPunchOut || 'Keep existing'}
                            </div>
                          </div>
                        </div>

                        <div className="text-xs text-zinc-700 dark:text-zinc-300">
                          <span className="font-medium text-zinc-950 dark:text-zinc-100">Reason: </span>
                          {reqItem.reason}
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {reqItem.attachmentAssetId && (
                            <button
                              type="button"
                              onClick={() => openAttachment(reqItem.attachmentAssetId!)}
                              className="inline-flex items-center gap-1 text-[#B5121B] dark:text-red-400 hover:underline font-medium"
                            >
                              <Paperclip className="w-3 h-3" />
                              Download Supporting Attachment
                            </button>
                          )}
                          {reqItem.reviewedByName && (
                            <span>
                              Reviewed by {reqItem.reviewedByName}
                              {reqItem.reviewedAt
                                ? ` on ${formatSubmissionTimestamp(reqItem.reviewedAt, undefined, tz)}`
                                : ''}
                            </span>
                          )}
                          {reqItem.reviewComment && <span>Note: {reqItem.reviewComment}</span>}
                          {reqItem.appliedChanges && (
                            <span className="font-mono">
                              Applied: {reqItem.appliedChanges.status} (
                              {formatDurationMinutes(reqItem.appliedChanges.workingMinutes)})
                            </span>
                          )}
                        </div>
                      </div>

                      {reqItem.status === 'Pending' && !isSelfRequest && (
                        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2 shrink-0 lg:w-64">
                          <input
                            type="text"
                            placeholder="Approval / rejection note (optional)"
                            value={reviewComment[reqItem.id] || ''}
                            onChange={(e) =>
                              setReviewComment((prev) => ({ ...prev, [reqItem.id]: e.target.value }))
                            }
                            disabled={isProcessing}
                            className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs w-full"
                          />
                          <div className="flex items-center gap-2 w-full">
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleReviewRegularization(reqItem, 'Approved')}
                              className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-50"
                            >
                              <Check className="w-3.5 h-3.5" />
                              {isProcessing ? 'Saving...' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleReviewRegularization(reqItem, 'Rejected')}
                              className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-[#B5121B] dark:text-red-400 text-xs font-semibold inline-flex items-center justify-center gap-1 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </div>
                        </div>
                      )}

                      {reqItem.status === 'Pending' && isSelfRequest && (
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 italic shrink-0">
                          Awaiting Super Admin review (self-approval disabled)
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* EMPLOYEE ATTENDANCE REGULARIZATION HISTORY */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-display font-semibold text-zinc-950 dark:text-zinc-100">
              My Attendance Regularization History
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Track your submitted regularization requests, reviewer decisions, and notes.
            </p>
          </div>
          <span className="text-xs font-mono text-zinc-500">
            {myRegularizationHistory.length} request{myRegularizationHistory.length === 1 ? '' : 's'}
          </span>
        </div>

        {myRegularizationHistory.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
            You have not submitted any attendance regularization requests yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400">
                  <th className="py-3 px-3 font-medium">Attendance Date</th>
                  <th className="py-3 px-3 font-medium">Request Type</th>
                  <th className="py-3 px-3 font-medium">Requested Punches</th>
                  <th className="py-3 px-3 font-medium">Submitted</th>
                  <th className="py-3 px-3 font-medium">Status</th>
                  <th className="py-3 px-3 font-medium">Approver &amp; Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {myRegularizationHistory.map((item) => {
                  const tz = item.timezone || mySchedule.timezone;
                  const typeLabel = item.requestType
                    ? REGULARIZATION_TYPE_LABELS[item.requestType]
                    : 'Attendance Regularization';
                  return (
                    <tr key={item.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 align-top">
                      <td className="py-3 px-3 font-mono tabular-nums whitespace-nowrap font-medium">
                        {item.date}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-zinc-950 dark:text-zinc-100">{typeLabel}</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                          {item.reason}
                        </div>
                        {item.attachmentAssetId && (
                          <button
                            type="button"
                            onClick={() => openAttachment(item.attachmentAssetId!)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#B5121B] dark:text-red-400 hover:underline"
                          >
                            <Paperclip className="w-3 h-3" />
                            Attachment
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums whitespace-nowrap">
                        <div>In: {item.requestedPunchIn || '—'}</div>
                        <div>Out: {item.requestedPunchOut || '—'}</div>
                      </td>
                      <td className="py-3 px-3 text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                        {formatSubmissionTimestamp(item.createdAt, item.submittedAtIso, tz)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-semibold">
                        <span
                          className={
                            item.status === 'Approved'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : item.status === 'Rejected'
                              ? 'text-[#B5121B] dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                        {item.reviewedByName ? (
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                            {item.reviewedByName}
                          </div>
                        ) : (
                          <div className="text-zinc-400">Pending review</div>
                        )}
                        {item.reviewComment && (
                          <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">{item.reviewComment}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Camera Punch Modal */}
      <CameraCaptureModal
        mode={punchModal || 'in'}
        isOpen={punchModal !== null}
        onClose={() => setPunchModal(null)}
        onConfirm={handlePunchConfirm}
      />

      {/* Private Attendance Photo Viewer Modal */}
      {photoModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h3 className="text-sm font-semibold">
                  Attendance Photographs · {photoModal.record.employeeName} ({photoModal.record.date})
                </h3>
                <p className="text-xs text-zinc-500">
                  {photoModal.record.timezone || 'Asia/Kolkata'} · Stored securely in TalentGrade
                </p>
              </div>
              <button
                onClick={() => setPhotoModal(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 grid sm:grid-cols-2 gap-4">
              {(['in', 'out'] as const).map((side) => {
                const photo = side === 'in' ? photoModal.inPhoto : photoModal.outPhoto;
                const time = side === 'in' ? photoModal.record.punchInTime : photoModal.record.punchOutTime;
                return (
                  <div key={side} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>{side === 'in' ? 'Punch-In Photo' : 'Punch-Out Photo'}</span>
                      <span className="font-mono text-zinc-500">
                        {formatTimeDisplay(time, photoModal.record.timezone || mySchedule.timezone)}
                      </span>
                    </div>
                    {photo ? (
                      <div className="space-y-2">
                        <img
                          src={photo.dataUrl}
                          alt={`${side} attendance`}
                          className="w-full aspect-[4/3] object-cover rounded-xl border border-zinc-200 dark:border-zinc-800"
                        />
                        {employee.role === 'super_admin' && (
                          <button
                            type="button"
                            onClick={() => handleDeletePhoto(photo.id, side)}
                            className="inline-flex items-center gap-1.5 text-xs text-[#B5121B] dark:text-red-400 hover:underline"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete Retained Photo
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="aspect-[4/3] rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-xs text-zinc-400">
                        No photo recorded
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* GPS Location Map Modal */}
      {mapModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h3 className="text-sm font-semibold">{mapModal.label}</h3>
                <p className="text-xs font-mono text-zinc-500 tabular-nums">
                  {mapModal.lat.toFixed(6)}, {mapModal.lng.toFixed(6)}
                  {mapModal.accuracy ? ` · ±${Math.round(mapModal.accuracy)}m accuracy` : ''}
                </p>
              </div>
              <button
                onClick={() => setMapModal(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <iframe
                title="GPS Attendance Location"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapModal.lng - 0.005}%2C${mapModal.lat - 0.004}%2C${mapModal.lng + 0.005}%2C${mapModal.lat + 0.004}&layer=mapnik&marker=${mapModal.lat}%2C${mapModal.lng}`}
                className="w-full h-72 rounded-xl border border-zinc-200 dark:border-zinc-800"
              />
              <div className="flex justify-end">
                <a
                  href={`https://www.google.com/maps?q=${mapModal.lat},${mapModal.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-medium"
                >
                  Open in Google Maps
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit Attendance Regularization Modal */}
      {regModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleRegularizationSubmit}
            className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl my-auto"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                  Request Attendance Regularization
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Submitting as {employee.fullName} ({employee.employeeCode}) · Timezone {mySchedule.timezone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRegModalOpen(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Attendance Date (past dates only)</label>
                  <input
                    type="date"
                    required
                    max={yesterdayStr}
                    value={regDate}
                    onChange={(e) => handleRegDateOrTypeChange(e.target.value, regType)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Request Type</label>
                  <select
                    value={regType}
                    onChange={(e) =>
                      handleRegDateOrTypeChange(regDate, e.target.value as RegularizationRequestType)
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    {REGULARIZATION_REQUEST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {REGULARIZATION_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Existing recorded attendance context for selected date */}
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                  <Clock className="w-3.5 h-3.5 text-[#B5121B] shrink-0" />
                  <span>
                    Recorded on <span className="font-mono font-medium">{regDate || '—'}</span>:
                    {' '}
                    In{' '}
                    <span className="font-mono font-medium">
                      {selectedDateExistingRecord?.punchInTime
                        ? formatTimeDisplay(selectedDateExistingRecord.punchInTime, mySchedule.timezone)
                        : 'None'}
                    </span>
                    {' · '}
                    Out{' '}
                    <span className="font-mono font-medium">
                      {selectedDateExistingRecord?.punchOutTime
                        ? formatTimeDisplay(selectedDateExistingRecord.punchOutTime, mySchedule.timezone)
                        : 'None'}
                    </span>
                  </span>
                </div>
                {selectedDateExistingRecord && (
                  <span className="text-[11px] font-medium text-zinc-500 shrink-0">
                    {selectedDateExistingRecord.status}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">
                    Requested Punch-In Time
                    {(regType === 'missed_punch_in' || regType === 'both_missed') && (
                      <span className="text-[#B5121B]"> *</span>
                    )}
                  </label>
                  <input
                    type="time"
                    required={regType === 'missed_punch_in' || regType === 'both_missed'}
                    value={regIn}
                    onChange={(e) => setRegIn(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                  {regType === 'missed_punch_out' && (
                    <span className="block text-[10px] text-zinc-500 mt-1">
                      Leave unchanged or blank to keep recorded Punch-In.
                    </span>
                  )}
                </div>
                <div>
                  <label className="block font-medium mb-1">
                    Requested Punch-Out Time
                    {(regType === 'missed_punch_out' || regType === 'both_missed') && (
                      <span className="text-[#B5121B]"> *</span>
                    )}
                  </label>
                  <input
                    type="time"
                    required={regType === 'missed_punch_out' || regType === 'both_missed'}
                    value={regOut}
                    onChange={(e) => setRegOut(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                  {regType === 'missed_punch_in' && (
                    <span className="block text-[10px] text-zinc-500 mt-1">
                      Leave blank to keep recorded Punch-Out.
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">
                  Reason for Regularization <span className="text-[#B5121B]">*</span>
                </label>
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  value={regReason}
                  onChange={(e) => setRegReason(e.target.value)}
                  placeholder="Describe why this attendance regularization is required..."
                  className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">Supporting Attachment (optional, max 500 KB)</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setRegFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-zinc-600 dark:text-zinc-300"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRegModalOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingReg}
                className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {submittingReg ? 'Submitting...' : 'Submit Regularization'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Direct Admin Edit Attendance Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleDirectEditSave}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Edit Attendance Record</h3>
                <p className="text-xs text-zinc-500">
                  {editModal.targetEmp.fullName} · {editModal.date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Punch In</label>
                  <input
                    type="time"
                    value={editModal.punchInHHmm}
                    onChange={(e) => setEditModal((m) => (m ? { ...m, punchInHHmm: e.target.value } : null))}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Punch Out</label>
                  <input
                    type="time"
                    value={editModal.punchOutHHmm}
                    onChange={(e) => setEditModal((m) => (m ? { ...m, punchOutHHmm: e.target.value } : null))}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Attendance Status</label>
                <select
                  value={editModal.status}
                  onChange={(e) =>
                    setEditModal((m) => (m ? { ...m, status: e.target.value as AttendanceStatus } : null))
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                >
                  <option value="Present">Present</option>
                  <option value="Late">Late</option>
                  <option value="Half Day">Half Day</option>
                  <option value="Absent">Absent</option>
                  <option value="Leave">Leave</option>
                  <option value="Incomplete Attendance">Incomplete Attendance</option>
                  <option value="Holiday">Holiday</option>
                  <option value="Weekly Off">Weekly Off</option>
                </select>
              </div>

              <div>
                <label className="block font-medium mb-1">Audit Note</label>
                <input
                  type="text"
                  value={editModal.notes}
                  onChange={(e) => setEditModal((m) => (m ? { ...m, notes: e.target.value } : null))}
                  placeholder="Reason for manual attendance edit"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {savingEdit ? 'Saving...' : 'Save & Audit'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

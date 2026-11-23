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
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { CameraCaptureModal } from '../components/CameraCaptureModal';
import {
  AttendanceCorrection,
  AttendancePhoto,
  AttendanceRecord,
  AttendanceStatus,
  Employee,
} from '../types/hr';
import {
  deleteAttendancePhoto,
  editAttendanceDirectly,
  fetchAllEmployees,
  fetchAttendanceCorrections,
  fetchAttendancePhoto,
  fetchAttendanceRecords,
  fetchMediaAsset,
  formatDurationMinutes,
  formatTimeDisplay,
  getEffectiveSchedule,
  getTodayInTimezone,
  punchIn,
  punchOut,
  reviewAttendanceCorrection,
  submitAttendanceCorrection,
  uploadMediaAsset,
} from '../lib/hrService';

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
    }).format(d);
  } catch {
    return fallback;
  }
}

export function AttendanceView() {
  const { employee, settings } = useAuth();
  const { showToast } = useToast();

  const mySchedule = useMemo(() => {
    if (!employee || !settings) return null;
    return getEffectiveSchedule(employee, settings);
  }, [employee, settings]);

  const todayStr = useMemo(
    () => getTodayInTimezone(mySchedule?.timezone || 'Asia/Kolkata'),
    [mySchedule?.timezone]
  );

  const [selectedMonth, setSelectedMonth] = useState(todayStr.slice(0, 7));
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [selectedEmpFilter, setSelectedEmpFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([]);
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

  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [corrDate, setCorrDate] = useState(todayStr);
  const [corrIn, setCorrIn] = useState(mySchedule?.officeStartTime || '09:30');
  const [corrOut, setCorrOut] = useState(mySchedule?.officeEndTime || '18:30');
  const [corrReason, setCorrReason] = useState('');
  const [corrFile, setCorrFile] = useState<File | null>(null);
  const [submittingCorr, setSubmittingCorr] = useState(false);

  const [editModal, setEditModal] = useState<{
    targetEmp: Employee;
    date: string;
    punchInHHmm: string;
    punchOutHHmm: string;
    status: AttendanceStatus;
    notes: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [reviewComment, setReviewComment] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const [recList, corrList, empList] = await Promise.all([
        fetchAttendanceRecords(employee),
        fetchAttendanceCorrections(employee),
        employee.role === 'employee' ? Promise.resolve([employee]) : fetchAllEmployees(employee),
      ]);
      setRecords(recList);
      setCorrections(corrList);
      setEmployees(empList);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load attendance data', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (!employee || !settings || !mySchedule) return null;

  const isPrivileged = employee.role === 'super_admin' || employee.role === 'team_leader';
  const canEditAttendance =
    employee.role === 'super_admin' ||
    (employee.role === 'team_leader' && settings.teamLeaderPermissions.canEditAttendance);
  const canApproveCorrections =
    employee.role === 'super_admin' ||
    (employee.role === 'team_leader' && settings.teamLeaderPermissions.canApproveCorrections);

  const myTodayRecord = records.find((r) => r.employeeId === employee.id && r.date === todayStr);

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

  const handleCorrectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corrReason.trim()) return;
    setSubmittingCorr(true);
    try {
      let attachmentAssetId: string | undefined;
      if (corrFile) {
        const dataUrl = await readFileAsDataUrl(corrFile);
        attachmentAssetId = await uploadMediaAsset({
          ownerUid: employee.uid,
          assetType: 'attachment',
          fileName: corrFile.name,
          mimeType: corrFile.type || 'application/octet-stream',
          dataUrl,
        });
      }
      await submitAttendanceCorrection({
        employee,
        date: corrDate,
        requestedPunchIn: corrIn,
        requestedPunchOut: corrOut,
        reason: corrReason,
        attachmentAssetId,
      });
      showToast('Attendance correction request submitted.', 'success');
      setCorrectionModalOpen(false);
      setCorrReason('');
      setCorrFile(null);
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not submit correction', 'error');
    } finally {
      setSubmittingCorr(false);
    }
  };

  const handleReviewCorrection = async (corr: AttendanceCorrection, decision: 'Approved' | 'Rejected') => {
    try {
      await reviewAttendanceCorrection({
        correction: corr,
        decision,
        comment: reviewComment[corr.id] || '',
        actor: employee,
        settings,
      });
      showToast(`Correction request ${decision.toLowerCase()}.`, 'success');
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
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
            onClick={() => setCorrectionModalOpen(true)}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <FileEdit className="w-4 h-4" />
            Request Correction
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
        </div>
      </div>

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

      {/* Attendance Correction Requests */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-display font-semibold">Attendance Correction Requests</h2>
          <span className="text-xs text-zinc-500">{corrections.length} requests</span>
        </div>

        {corrections.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">No attendance correction requests submitted.</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {corrections.map((c) => (
              <div key={c.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                    {c.employeeName} · {c.date} · Requested {c.requestedPunchIn} – {c.requestedPunchOut}
                  </div>
                  <p className="text-zinc-600 dark:text-zinc-400">{c.reason}</p>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                    <span>Status: {c.status}</span>
                    {c.reviewedByName && <span>Reviewed by {c.reviewedByName}</span>}
                    {c.reviewComment && <span>Note: {c.reviewComment}</span>}
                    {c.attachmentAssetId && (
                      <button
                        type="button"
                        onClick={() => openAttachment(c.attachmentAssetId!)}
                        className="inline-flex items-center gap-1 text-[#B5121B] dark:text-red-400 underline"
                      >
                        <Paperclip className="w-3 h-3" />
                        Attachment
                      </button>
                    )}
                  </div>
                </div>

                {c.status === 'Pending' && canApproveCorrections && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <input
                      type="text"
                      placeholder="Review note (optional)"
                      value={reviewComment[c.id] || ''}
                      onChange={(e) => setReviewComment((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs w-44"
                    />
                    <button
                      type="button"
                      onClick={() => handleReviewCorrection(c, 'Approved')}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-medium inline-flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewCorrection(c, 'Rejected')}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-[#B5121B] dark:text-red-400 text-xs font-medium inline-flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
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

      {/* Submit Correction Modal */}
      {correctionModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCorrectionSubmit}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Request Attendance Correction</h3>
              <button
                type="button"
                onClick={() => setCorrectionModalOpen(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={corrDate}
                  onChange={(e) => setCorrDate(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Requested Punch In</label>
                  <input
                    type="time"
                    required
                    value={corrIn}
                    onChange={(e) => setCorrIn(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Requested Punch Out</label>
                  <input
                    type="time"
                    required
                    value={corrOut}
                    onChange={(e) => setCorrOut(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Reason</label>
                <textarea
                  required
                  minLength={3}
                  rows={3}
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  placeholder="Explain why an attendance adjustment is needed..."
                  className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Supporting Attachment (optional, max 500 KB)</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setCorrFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-zinc-600 dark:text-zinc-300"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCorrectionModalOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingCorr}
                className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {submittingCorr ? 'Submitting...' : 'Submit Request'}
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

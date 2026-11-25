import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, Play, RefreshCw, Users, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  AttendanceReminderLog,
  AttendanceReminderSettings,
  Department,
  REMINDER_TYPE_LABELS,
  UserRole,
} from '../types/hr';
import {
  DEFAULT_ATTENDANCE_REMINDER_SETTINGS,
  normalizeAttendanceReminderSettings,
} from '../../shared/attendanceReminderEngine';
import {
  ReminderOverviewMetrics,
  fetchReminderHistoryAndStatus,
  triggerAdminReminderRunNow,
} from '../lib/pushService';
import { useToast } from './Toast';

interface AdminSmartRemindersPanelProps {
  value?: AttendanceReminderSettings;
  locations: string[];
  departments: Department[];
  saving: boolean;
  onChange: (next: AttendanceReminderSettings) => void;
  onSave: (e: React.FormEvent) => void;
}

export function AdminSmartRemindersPanel({
  value,
  locations,
  departments,
  saving,
  onChange,
  onSave,
}: AdminSmartRemindersPanelProps) {
  const { showToast } = useToast();
  const cfg = normalizeAttendanceReminderSettings(value);

  const [overview, setOverview] = useState<ReminderOverviewMetrics | null>(null);
  const [logs, setLogs] = useState<AttendanceReminderLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [runningNow, setRunningNow] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'failed' | 'expired'>('all');

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await fetchReminderHistoryAndStatus('all', 200);
      setLogs(data.logs || []);
      if (data.overview) setOverview(data.overview);
    } catch {
      // Handled gracefully
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const updateCfg = (patch: Partial<AttendanceReminderSettings>) => {
    onChange(normalizeAttendanceReminderSettings({ ...cfg, ...patch }));
  };

  const toggleTargetItem = <T extends string>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      const res = await triggerAdminReminderRunNow();
      if (res.overview) setOverview(res.overview);
      showToast(
        `Evaluated ${res.evaluatedEmployees} employee(s): ${res.sent} sent, ${res.expired} expired, ${res.failed} failed.`,
        res.failed > 0 ? 'info' : 'success'
      );
      await loadHistory();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Manual evaluation failed', 'error');
    } finally {
      setRunningNow(false);
    }
  };

  const filteredLogs = logs.filter((l) => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return (
      l.employeeName.toLowerCase().includes(q) ||
      l.department.toLowerCase().includes(q) ||
      l.attendanceDate.includes(q) ||
      (REMINDER_TYPE_LABELS[l.reminderType] || l.reminderType).toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Live Overview Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Subscribed Staff</div>
          <div className="text-xl font-bold font-mono tabular-nums mt-1">
            {overview?.subscribedEmployeesCount ?? 0}
            <span className="text-xs font-normal text-zinc-400"> / {overview?.activeEmployeesCount ?? 0}</span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
            <Users className="w-3 h-3" /> Active employee profiles synced
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Active Push Devices</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
            {overview?.activeDeviceSubscriptions ?? 0}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            {overview?.expiredDeviceSubscriptions ?? 0} expired cleanup pending
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Delivered Today (UTC)</div>
          <div className="text-xl font-bold font-mono tabular-nums mt-1">{overview?.sentToday ?? 0}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Deduplicated per shift event
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Failed / Expired Today</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#B5121B] dark:text-red-400 mt-1">
            {overview?.failedToday ?? 0}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-[#B5121B]" />
            {overview?.lastRunIso ? `Last tick ${overview.lastRunIso.slice(11, 16)} UTC` : 'Background loop active'}
          </div>
        </div>
      </div>

      {/* Super Admin Policy Form */}
      <form
        onSubmit={onSave}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-5 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              <BellRing className="w-4 h-4 text-[#B5121B]" />
              Smart Attendance Reminders — Company Configuration
            </div>
            <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">
              Evaluated continuously on the server using each employee&apos;s individual schedule, timezone, holidays, and approved leaves.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={runningNow}
              onClick={handleRunNow}
              className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium inline-flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 text-[#B5121B]" />
              {runningNow ? 'Evaluating...' : 'Run Scheduler Now'}
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_ATTENDANCE_REMINDER_SETTINGS })}
              className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Reset Defaults
            </button>
          </div>
        </div>

        {/* Global Enable Toggles */}
        <div className="grid sm:grid-cols-2 gap-3">
          {(
            [
              {
                key: 'enabled',
                title: 'Enable Smart Attendance Reminders (Global)',
                desc: 'Master switch controlling background Web Push attendance reminders.',
              },
              {
                key: 'punchInEnabled',
                title: 'Enable Automatic Punch-In Reminders',
                desc: 'Remind working employees who have not punched in for the day.',
              },
              {
                key: 'punchOutEnabled',
                title: 'Enable Automatic Punch-Out Reminders',
                desc: 'Remind employees near or after shift end if punch-out is pending.',
              },
              {
                key: 'sendPunchOutIfNotPunchedIn',
                title: 'Send Punch-Out Reminder Even If Not Punched In',
                desc: 'Disabled by default so un-punched staff are not prompted to punch out.',
              },
            ] as const
          ).map((item) => (
            <label
              key={item.key}
              className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer"
            >
              <div>
                <div className="font-semibold text-zinc-950 dark:text-zinc-100">{item.title}</div>
                <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">{item.desc}</div>
              </div>
              <input
                type="checkbox"
                checked={Boolean(cfg[item.key])}
                onChange={(e) => updateCfg({ [item.key]: e.target.checked })}
                className="w-4 h-4 mt-1 accent-[#B5121B]"
              />
            </label>
          ))}
        </div>

        {/* Timing & Anti-Spam Rules */}
        <div className="grid sm:grid-cols-3 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div>
            <label className="block font-medium mb-1">Punch-In Offset (min vs Start)</label>
            <input
              type="number"
              min={-60}
              max={120}
              value={cfg.punchInOffsetMinutes}
              onChange={(e) => {
                const v = e.target.value === '' ? 0 : Number(e.target.value);
                updateCfg({
                  punchInOffsetMinutes: Number.isFinite(v) ? Math.max(-60, Math.min(120, v)) : 0,
                });
              }}
              className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
            />
            <span className="text-[11px] text-zinc-500">0 = exact start time, -10 = 10m before</span>
          </div>
          <div>
            <label className="block font-medium mb-1">Missed Punch-In Follow-Up (min after Start)</label>
            <input
              type="number"
              min={5}
              max={240}
              value={cfg.punchInFollowUpDelayMinutes}
              onChange={(e) => {
                const v = e.target.value === '' ? 5 : Number(e.target.value);
                updateCfg({
                  punchInFollowUpDelayMinutes: Number.isFinite(v) ? Math.max(5, Math.min(240, v)) : 5,
                });
              }}
              className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Max Reminders Per Event</label>
            <select
              value={cfg.maxRemindersPerEvent}
              onChange={(e) => {
                const v = Number(e.target.value);
                updateCfg({ maxRemindersPerEvent: v === 2 ? 2 : 1 });
              }}
              className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
            >
              <option value={1}>1 (Initial reminder only)</option>
              <option value={2}>2 (Initial + 1 follow-up)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium mb-1">Punch-Out Offset (min vs End)</label>
            <input
              type="number"
              min={-60}
              max={120}
              value={cfg.punchOutOffsetMinutes}
              onChange={(e) => {
                const v = e.target.value === '' ? 0 : Number(e.target.value);
                updateCfg({
                  punchOutOffsetMinutes: Number.isFinite(v) ? Math.max(-60, Math.min(120, v)) : 0,
                });
              }}
              className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
            />
            <span className="text-[11px] text-zinc-500">-5 = 5m before shift end</span>
          </div>
          <div>
            <label className="block font-medium mb-1">Missed Punch-Out Follow-Up (min after End)</label>
            <input
              type="number"
              min={5}
              max={240}
              value={cfg.punchOutFollowUpDelayMinutes}
              onChange={(e) => {
                const v = e.target.value === '' ? 5 : Number(e.target.value);
                updateCfg({
                  punchOutFollowUpDelayMinutes: Number.isFinite(v) ? Math.max(5, Math.min(240, v)) : 5,
                });
              }}
              className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Max Reminders Per Employee / Day</label>
            <input
              type="number"
              min={1}
              max={6}
              value={cfg.maxRemindersPerDay}
              onChange={(e) => {
                const v = e.target.value === '' ? 1 : Number(e.target.value);
                updateCfg({
                  maxRemindersPerDay: Number.isFinite(v) ? Math.max(1, Math.min(6, v)) : 1,
                });
              }}
              className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
            />
          </div>
        </div>

        {/* Targeting Scope Filters (Empty = All) */}
        <div className="space-y-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div>
            <div className="font-semibold text-zinc-950 dark:text-zinc-100">
              Audience Targeting (Leave unselected to apply to all employees)
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <div className="font-medium text-zinc-600 dark:text-zinc-400">
                Locations ({cfg.targetLocations.length === 0 ? 'All' : cfg.targetLocations.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {locations.map((loc) => {
                  const selected = cfg.targetLocations.includes(loc);
                  return (
                    <button
                      type="button"
                      key={loc}
                      onClick={() => updateCfg({ targetLocations: toggleTargetItem(cfg.targetLocations, loc) })}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${
                        selected
                          ? 'border-[#B5121B] bg-[#B5121B] text-white'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {loc}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="font-medium text-zinc-600 dark:text-zinc-400">
                Departments ({cfg.targetDepartments.length === 0 ? 'All' : cfg.targetDepartments.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {departments.map((d) => {
                  const selected = cfg.targetDepartments.includes(d.name);
                  return (
                    <button
                      type="button"
                      key={d.id}
                      onClick={() =>
                        updateCfg({ targetDepartments: toggleTargetItem(cfg.targetDepartments, d.name) })
                      }
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${
                        selected
                          ? 'border-[#B5121B] bg-[#B5121B] text-white'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="font-medium text-zinc-600 dark:text-zinc-400">
                Roles ({cfg.targetRoles.length === 0 ? 'All' : cfg.targetRoles.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'employee', label: 'Employees' },
                    { id: 'team_leader', label: 'Team Leaders' },
                    { id: 'super_admin', label: 'Super Admins' },
                  ] as Array<{ id: UserRole; label: string }>
                ).map((roleItem) => {
                  const selected = cfg.targetRoles.includes(roleItem.id);
                  return (
                    <button
                      type="button"
                      key={roleItem.id}
                      onClick={() =>
                        updateCfg({ targetRoles: toggleTargetItem(cfg.targetRoles, roleItem.id) })
                      }
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${
                        selected
                          ? 'border-[#B5121B] bg-[#B5121B] text-white'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {roleItem.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold"
        >
          {saving ? 'Saving...' : 'Save Smart Attendance Reminder Rules'}
        </button>
      </form>

      {/* Company-Wide Delivery & Audit History */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden text-xs">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-sm text-zinc-950 dark:text-zinc-100">
              Reminder Delivery History &amp; Audit Log
            </div>
            <div className="text-[11px] text-zinc-500">
              Tracks sent push alerts, expired browser endpoint cleanup, and delivery errors
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
            >
              <option value="all">All Statuses</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="expired">Expired</option>
            </select>
            <input
              type="text"
              placeholder="Filter employee, dept, or date..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 w-56"
            />
            <button
              type="button"
              onClick={loadHistory}
              className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1 font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">
              {loadingHistory ? 'Loading delivery logs...' : 'No reminder delivery logs recorded yet.'}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Employee</th>
                  <th className="py-2.5 px-4 font-medium">Type</th>
                  <th className="py-2.5 px-4 font-medium">Attendance Date</th>
                  <th className="py-2.5 px-4 font-medium">Device</th>
                  <th className="py-2.5 px-4 font-medium">Sent Timestamp</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-zinc-950 dark:text-zinc-100">{log.employeeName}</div>
                      <div className="text-[11px] text-zinc-500">
                        {log.department} · {log.location}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-medium">
                      {REMINDER_TYPE_LABELS[log.reminderType] || log.reminderType}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">{log.attendanceDate}</td>
                    <td className="py-2.5 px-4 text-zinc-500 max-w-[160px] truncate">
                      {log.deviceLabel || 'Browser'}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">
                      {log.sentAtIso.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-semibold ${
                          log.status === 'sent'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : log.status === 'expired' || log.status === 'failed'
                            ? 'text-[#B5121B] dark:text-red-400'
                            : 'text-zinc-500'
                        }`}
                      >
                        {log.status.toUpperCase()}
                      </span>
                      {log.failureDetail && (
                        <div className="text-[10px] text-zinc-500 max-w-[220px] truncate">
                          {log.failureDetail}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

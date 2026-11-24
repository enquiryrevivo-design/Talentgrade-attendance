import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Send,
  Smartphone,
  ShieldAlert,
  Clock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import {
  AttendanceReminderLog,
  REMINDER_TYPE_LABELS,
} from '../types/hr';
import {
  normalizeAttendanceReminderSettings,
  normalizeEmployeeReminderPreferences,
} from '../../shared/attendanceReminderEngine';
import {
  ReminderBrowserInspection,
  ServerSubscriptionSummary,
  disableAttendancePushReminders,
  enableAttendancePushReminders,
  fetchReminderHistoryAndStatus,
  inspectReminderBrowserState,
  saveEmployeeReminderPreferences,
  sendTestAttendancePush,
} from '../lib/pushService';
import { getEffectiveSchedule } from '../lib/hrService';

interface SmartAttendanceRemindersCardProps {
  compact?: boolean;
  onOpenSettings?: () => void;
}

export function SmartAttendanceRemindersCard({
  compact = false,
  onOpenSettings,
}: SmartAttendanceRemindersCardProps) {
  const { employee, settings, refreshSession } = useAuth();
  const { showToast } = useToast();

  const [inspection, setInspection] = useState<ReminderBrowserInspection | null>(null);
  const [subscriptions, setSubscriptions] = useState<ServerSubscriptionSummary[]>([]);
  const [historyLogs, setHistoryLogs] = useState<AttendanceReminderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const loadState = useCallback(async () => {
    if (!employee) return;
    try {
      const serverData = await fetchReminderHistoryAndStatus('self', compact ? 5 : 40);
      setSubscriptions(serverData.subscriptions || []);
      setHistoryLogs(serverData.logs || []);
      const browserState = await inspectReminderBrowserState(
        serverData.subscriptions || [],
        employee.reminderPreferences
      );
      setInspection(browserState);
    } catch {
      const browserState = await inspectReminderBrowserState([], employee.reminderPreferences);
      setInspection(browserState);
    } finally {
      setLoading(false);
    }
  }, [employee, compact]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  if (!employee || !settings) return null;

  const companyRules = normalizeAttendanceReminderSettings(settings.attendanceReminders);
  const empPrefs = normalizeEmployeeReminderPreferences(employee.reminderPreferences);
  const schedule = getEffectiveSchedule(employee, settings);

  const handleEnableOrResubscribe = async (forceResubscribe = false) => {
    setBusy(true);
    try {
      const res = await enableAttendancePushReminders({ employee, forceResubscribe });
      if (res.permission === 'denied') {
        showToast(
          'Notification permission was blocked in browser settings. Please allow notifications to receive attendance reminders.',
          'error'
        );
      } else if (res.permission === 'granted') {
        showToast('Smart Attendance Reminders enabled on this device.', 'success');
        await refreshSession();
      } else {
        showToast('Notification permission prompt was dismissed.', 'info');
      }
      await loadState();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not enable notifications', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async (thisDeviceOnly: boolean) => {
    setBusy(true);
    try {
      await disableAttendancePushReminders({ employee, thisDeviceOnly });
      showToast(
        thisDeviceOnly
          ? 'Push notifications disabled on this browser.'
          : 'Smart Attendance Reminders disabled across your account.',
        'info'
      );
      await refreshSession();
      await loadState();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not disable reminders', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleType = async (key: 'punchInReminders' | 'punchOutReminders', value: boolean) => {
    setBusy(true);
    try {
      await saveEmployeeReminderPreferences({
        employee,
        preferences: { [key]: value },
      });
      await refreshSession();
      showToast('Reminder preference updated.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not update preference', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleTestPush = async () => {
    setTesting(true);
    try {
      const res = await sendTestAttendancePush();
      if (res.sent > 0) {
        showToast(`Test push notification delivered to ${res.sent} active device(s).`, 'success');
      } else if (res.expired > 0) {
        showToast('Your browser subscription expired. Click Re-Subscribe to restore push alerts.', 'error');
      } else {
        showToast('Could not deliver test push notification.', 'error');
      }
      await loadState();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Test push failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const state = inspection?.state || 'not_enabled';

  const statusBadge = (() => {
    switch (state) {
      case 'active':
        return {
          label: 'Push Subscription Active',
          tone: 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300',
          icon: CheckCircle2,
        };
      case 'permission_granted_needs_sub':
        return {
          label: 'Permission Granted · Device Needs Activation',
          tone: 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
          icon: AlertTriangle,
        };
      case 'subscription_expired':
        return {
          label: 'Subscription Expired or Unavailable',
          tone: 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
          icon: RefreshCw,
        };
      case 'denied':
        return {
          label: 'Browser Permission Denied',
          tone: 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-[#B5121B] dark:text-red-300',
          icon: BellOff,
        };
      case 'unsupported':
        return {
          label: 'Unsupported Browser',
          tone: 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400',
          icon: ShieldAlert,
        };
      default:
        return {
          label: 'Not Enabled',
          tone: 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300',
          icon: Bell,
        };
    }
  })();

  const StatusIcon = statusBadge.icon;

  return (
    <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-[#B5121B]" />
            <h2 className="text-base font-display font-semibold text-zinc-950 dark:text-zinc-100">
              {state === 'not_enabled' ? 'Enable Attendance Reminders' : 'Smart Attendance Reminders'}
            </h2>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-2xl">
            Receive genuine browser push notifications for shift punch-in ({schedule.officeStartTime}), punch-out ({schedule.officeEndTime}), and missed attendance follow-ups in {schedule.timezone} — even when tabs are closed.
          </p>
        </div>

        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium shrink-0 ${statusBadge.tone}`}>
          <StatusIcon className="w-3.5 h-3.5 shrink-0" />
          <span>{loading ? 'Checking status...' : statusBadge.label}</span>
        </div>
      </div>

      {!companyRules.enabled && (
        <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
          Company-wide Smart Attendance Reminders are currently paused by your Super Admin.
        </div>
      )}

      {/* Primary Action / State Guidance */}
      {!loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {state === 'unsupported' && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Web Push notifications require a modern desktop browser, Android Chrome/Edge, or iOS 16.4+ installed Home Screen PWA over HTTPS.
            </p>
          )}

          {state === 'denied' && (
            <div className="text-xs text-zinc-600 dark:text-zinc-300 space-y-1">
              <p className="font-medium text-[#B5121B] dark:text-red-400">
                Notifications are blocked in your browser for this site.
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                Open your browser site permissions (lock/info icon next to the address bar), set Notifications to Allow, then click Refresh Status below.
              </p>
            </div>
          )}

          {state === 'not_enabled' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => handleEnableOrResubscribe(false)}
              className="min-h-[42px] px-5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Bell className="w-4 h-4" />
              {busy ? 'Requesting Permission...' : 'Enable Notifications'}
            </button>
          )}

          {state === 'permission_granted_needs_sub' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => handleEnableOrResubscribe(false)}
              className="min-h-[42px] px-5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <BellRing className="w-4 h-4" />
              {busy ? 'Activating...' : 'Activate Reminders on This Device'}
            </button>
          )}

          {state === 'subscription_expired' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => handleEnableOrResubscribe(true)}
              className="min-h-[42px] px-5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              {busy ? 'Re-subscribing...' : 'Re-Subscribe Browser Push'}
            </button>
          )}

          {state === 'active' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={testing}
                onClick={handleTestPush}
                className="min-h-[38px] px-3.5 py-2 rounded-xl bg-black dark:bg-white text-white dark:text-black text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {testing ? 'Sending...' : 'Send Test Notification'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDisable(true)}
                className="min-h-[38px] px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Disable on This Device
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDisable(false)}
                className="min-h-[38px] px-3.5 py-2 rounded-xl border border-red-200 dark:border-red-900 text-xs font-medium text-[#B5121B] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                Turn Off All
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {state === 'denied' && (
              <button
                type="button"
                onClick={loadState}
                className="min-h-[36px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh Status
              </button>
            )}
            {compact && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-xs font-medium text-[#B5121B] dark:text-red-400 hover:underline"
              >
                Manage Reminder Settings
              </button>
            )}
          </div>
        </div>
      )}

      {/* Per-Employee Punch-In / Punch-Out Toggles & Device Summary */}
      <div className="grid sm:grid-cols-2 gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xs">
        <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer">
          <div>
            <div className="font-semibold text-zinc-950 dark:text-zinc-100">Punch-In Reminders</div>
            <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">
              Morning shift prompt &amp; missed punch-in alert
            </div>
          </div>
          <input
            type="checkbox"
            disabled={busy}
            checked={empPrefs.punchInReminders}
            onChange={(e) => handleToggleType('punchInReminders', e.target.checked)}
            className="w-4 h-4 accent-[#B5121B]"
          />
        </label>

        <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer">
          <div>
            <div className="font-semibold text-zinc-950 dark:text-zinc-100">Punch-Out Reminders</div>
            <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">
              End-of-shift prompt &amp; missed punch-out alert
            </div>
          </div>
          <input
            type="checkbox"
            disabled={busy}
            checked={empPrefs.punchOutReminders}
            onChange={(e) => handleToggleType('punchOutReminders', e.target.checked)}
            className="w-4 h-4 accent-[#B5121B]"
          />
        </label>
      </div>

      {/* Full Mode: Registered Devices & Personal Reminder Notification History */}
      {!compact && (
        <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
          <div className="space-y-2">
            <div className="font-semibold text-zinc-950 dark:text-zinc-100 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-zinc-500" />
              Registered Browsers &amp; Devices ({subscriptions.filter((s) => s.status === 'active').length} active)
            </div>
            {subscriptions.length === 0 ? (
              <p className="text-zinc-500 dark:text-zinc-400">
                No push-enabled browsers registered yet for your account.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                {subscriptions.map((sub) => (
                  <div key={sub.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-950 dark:text-zinc-100 truncate">
                        {sub.deviceLabel}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                        Updated {sub.updatedAtIso.slice(0, 16).replace('T', ' ')} UTC
                        {sub.lastFailureReason ? ` · ${sub.lastFailureReason}` : ''}
                      </div>
                    </div>
                    <span
                      className={`font-medium shrink-0 ${
                        sub.status === 'active'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : sub.status === 'expired'
                          ? 'text-[#B5121B] dark:text-red-400'
                          : 'text-zinc-500'
                      }`}
                    >
                      {sub.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-zinc-950 dark:text-zinc-100 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              My Reminder Delivery History
            </div>
            {historyLogs.length === 0 ? (
              <p className="text-zinc-500 dark:text-zinc-400">
                No attendance reminder notifications have been sent to your devices yet.
              </p>
            ) : (
              <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500">
                    <tr>
                      <th className="py-2 px-3 font-medium">Date / Time</th>
                      <th className="py-2 px-3 font-medium">Reminder Type</th>
                      <th className="py-2 px-3 font-medium">Device</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {historyLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                        <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap">
                          {log.attendanceDate} · {log.sentAtIso.slice(11, 16)} UTC
                        </td>
                        <td className="py-2 px-3 font-medium">
                          {REMINDER_TYPE_LABELS[log.reminderType] || log.reminderType}
                        </td>
                        <td className="py-2 px-3 text-zinc-500 truncate max-w-[160px]">
                          {log.deviceLabel || 'Browser'}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`font-medium ${
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
                            <div className="text-[10px] text-zinc-500 truncate max-w-[200px]">
                              {log.failureDetail}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

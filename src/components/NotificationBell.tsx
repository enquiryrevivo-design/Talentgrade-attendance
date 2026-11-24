import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Bell,
  Cake,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useCelebrations } from '../context/CelebrationContext';
import { useHrNotifications } from '../context/HrNotificationContext';
import { AppPage, CelebrationNotification, HrNotification } from '../types/hr';
import { formatCelebrationMonthDayLabel } from '../../shared/celebrationEngine';

interface NotificationBellProps {
  onNavigate: (page: AppPage) => void;
  align?: 'left' | 'right';
}

type FeedItem =
  | { kind: 'hr'; sortMs: number; hr: HrNotification; isUnread: boolean }
  | { kind: 'celebration'; sortMs: number; cel: CelebrationNotification; isUnread: boolean };

function toMs(ts: unknown, fallbackDate?: string): number {
  if (typeof ts === 'string') {
    const ms = new Date(ts).getTime();
    if (!Number.isNaN(ms)) return ms;
  } else if (typeof ts === 'object' && ts !== null) {
    const maybe = ts as { toMillis?: () => number; seconds?: number };
    if (typeof maybe.toMillis === 'function') return maybe.toMillis();
    if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  }
  if (fallbackDate) {
    const ms = new Date(`${fallbackDate}T00:00:00Z`).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

export function NotificationBell({ onNavigate, align = 'right' }: NotificationBellProps) {
  const {
    notifications: celNotifications,
    readNotificationIds: celReadIds,
    unreadCount: celUnreadCount,
    openCelebrationByNotification,
    markAsRead: markCelRead,
    markAllAsRead: markAllCelRead,
  } = useCelebrations();

  const {
    notifications: hrNotifications,
    readIds: hrReadIds,
    unreadCount: hrUnreadCount,
    pendingRegularizationCount,
    canReviewRegularizations,
    markAsRead: markHrRead,
    markAllAsRead: markAllHrRead,
  } = useHrNotifications();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'unread' | 'history'>('unread');
  const [category, setCategory] = useState<'all' | 'regularization' | 'celebrations'>('all');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', onDocClick);
    }
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const totalUnread = celUnreadCount + hrUnreadCount;

  const combinedFeed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    if (category === 'all' || category === 'regularization') {
      for (const hr of hrNotifications) {
        items.push({
          kind: 'hr',
          sortMs: toMs(hr.createdAt, hr.attendanceDate),
          hr,
          isUnread: !hrReadIds.has(hr.id),
        });
      }
    }
    if (category === 'all' || category === 'celebrations') {
      for (const cel of celNotifications) {
        items.push({
          kind: 'celebration',
          sortMs: toMs(cel.createdAt, cel.celebrationDate),
          cel,
          isUnread: !celReadIds.has(cel.id),
        });
      }
    }
    return items.sort((a, b) => b.sortMs - a.sortMs);
  }, [category, hrNotifications, hrReadIds, celNotifications, celReadIds]);

  const unreadList = combinedFeed.filter((item) => item.isUnread);
  const displayList = tab === 'unread' ? unreadList : combinedFeed;

  const handleMarkAllRead = async () => {
    await Promise.all([markAllHrRead(), markAllCelRead()]);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Portal notifications (${totalUnread} unread)`}
        className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {totalUnread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#B5121B] text-white text-[10px] font-bold font-mono tabular-nums flex items-center justify-center">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute ${
            align === 'left' ? 'left-0' : 'right-0'
          } mt-2 w-[330px] sm:w-[390px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl z-50 overflow-hidden`}
        >
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-zinc-950 dark:text-zinc-100">
                Portal Notifications
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {totalUnread} unread
                {canReviewRegularizations && pendingRegularizationCount > 0
                  ? ` · ${pendingRegularizationCount} pending regularization`
                  : ''}
              </div>
            </div>
            {totalUnread > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#B5121B] dark:text-red-400 hover:underline"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="px-3 pt-2 pb-1 border-b border-zinc-200 dark:border-zinc-800 space-y-1.5 bg-zinc-50 dark:bg-zinc-950">
            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'regularization', label: `Regularization (${hrNotifications.length})` },
                  { id: 'celebrations', label: `Celebrations (${celNotifications.length})` },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-medium truncate ${
                    category === c.id
                      ? 'bg-zinc-950 text-white dark:bg-white dark:text-black'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 pb-1">
              <button
                type="button"
                onClick={() => setTab('unread')}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium ${
                  tab === 'unread'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                Unread ({unreadList.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('history')}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium ${
                  tab === 'history'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                History ({combinedFeed.length})
              </button>
            </div>
          </div>

          <div className="max-h-[340px] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {displayList.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                {tab === 'unread'
                  ? 'All caught up — no unread notifications.'
                  : 'No notification history recorded yet.'}
              </div>
            ) : (
              displayList.map((item) => {
                if (item.kind === 'hr') {
                  const n = item.hr;
                  const isApproved = n.eventType === 'approved';
                  const isRejected = n.eventType === 'rejected';
                  return (
                    <div
                      key={n.id}
                      className={`p-3.5 flex items-start justify-between gap-2.5 transition-colors ${
                        item.isUnread
                          ? 'bg-red-50/40 dark:bg-red-950/15'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          markHrRead(n.id);
                          setOpen(false);
                          onNavigate('attendance');
                        }}
                        className="flex items-start gap-2.5 text-left min-w-0 flex-1"
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            isApproved
                              ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                              : isRejected
                              ? 'bg-red-100 dark:bg-red-950/50 text-[#B5121B] dark:text-red-400'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          {isApproved ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : isRejected ? (
                            <XCircle className="w-4 h-4" />
                          ) : (
                            <Clock className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-zinc-950 dark:text-zinc-100 truncate">
                            {n.title}
                          </div>
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-0.5 line-clamp-2">
                            {n.message}
                          </div>
                          {n.note && (
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 italic line-clamp-2">
                              Note: {n.note}
                            </div>
                          )}
                          <div className="text-[10px] font-mono text-zinc-400 mt-1">
                            {n.attendanceDate} · {n.department}
                          </div>
                        </div>
                      </button>

                      {item.isUnread && (
                        <button
                          type="button"
                          onClick={() => markHrRead(n.id)}
                          title="Mark as read"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                }

                const notif = item.cel;
                const isBirthday = notif.type === 'birthday';
                return (
                  <div
                    key={notif.id}
                    className={`p-3.5 flex items-start justify-between gap-2.5 transition-colors ${
                      item.isUnread
                        ? 'bg-red-50/40 dark:bg-red-950/15'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        openCelebrationByNotification(notif);
                      }}
                      className="flex items-start gap-2.5 text-left min-w-0 flex-1"
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          isBirthday
                            ? 'bg-red-100 dark:bg-red-950/50 text-[#B5121B] dark:text-red-400'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                        }`}
                      >
                        {isBirthday ? <Cake className="w-4 h-4" /> : <Award className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-950 dark:text-zinc-100 truncate">
                          {notif.employeeName}
                        </div>
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-0.5 line-clamp-2">
                          {isBirthday
                            ? `Birthday · ${notif.department}`
                            : `Work Anniversary (${notif.yearsCompleted || 1} yr${
                                notif.yearsCompleted === 1 ? '' : 's'
                              }) · ${notif.department}`}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-400 mt-1">
                          {formatCelebrationMonthDayLabel(notif.celebrationMonthDay)}
                        </div>
                      </div>
                    </button>

                    {item.isUnread && (
                      <button
                        type="button"
                        onClick={() => markCelRead(notif.id)}
                        title="Mark as read"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 divide-y divide-zinc-200 dark:divide-zinc-800">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNavigate('attendance');
              }}
              className="w-full px-4 py-2.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:text-[#B5121B] dark:hover:text-red-400 flex items-center justify-between"
            >
              <span>
                Open Attendance Regularization
                {canReviewRegularizations && pendingRegularizationCount > 0
                  ? ` (${pendingRegularizationCount} pending)`
                  : ''}
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNavigate('celebrations');
              }}
              className="w-full px-4 py-2.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:text-[#B5121B] dark:hover:text-red-400 flex items-center justify-between"
            >
              <span>Open Upcoming Celebrations &amp; Feed</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
